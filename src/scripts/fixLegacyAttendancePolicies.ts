/**
 * Repair legacy attendance policies missing shiftId (blocks employee check-in).
 *
 * Usage:
 *   npx ts-node src/scripts/fixLegacyAttendancePolicies.ts
 *   npx ts-node src/scripts/fixLegacyAttendancePolicies.ts --org trizenventures
 */
import mongoose from 'mongoose';
import dns from 'node:dns';
import dotenv from 'dotenv';

import connectDB from '../config/db';
import Organization from '../models/Organization';
import AttendancePolicy, { PolicyDayType } from '../models/AttendancePolicy';
import Shift, { ShiftStatus } from '../models/Shift';
import Department from '../models/Department';
import { attendancePolicyService } from '../services/attendancePolicyService';

dns.setServers(['8.8.8.8', '8.8.4.4']);
dotenv.config();

type LegacyWeekRule = {
  day: string;
  dayType: string;
  useDefaultTiming?: boolean;
  useShiftTiming?: boolean;
  startTime?: string;
  endTime?: string;
  expectedHours?: number;
  graceMinutes?: number;
};

type LegacyPolicy = {
  _id: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  policyName: string;
  defaultFullDayRule?: {
    startTime: string;
    endTime: string;
    expectedHours: number;
    graceMinutes: number;
  };
  weekRules?: LegacyWeekRule[];
  shiftId?: mongoose.Types.ObjectId;
};

function parseOrgFilter(): string | undefined {
  const idx = process.argv.indexOf('--org');
  if (idx === -1) return undefined;
  return process.argv[idx + 1]?.trim();
}

async function repairOrg(orgId: string, orgLabel: string): Promise<void> {
  console.log(`\n--- ${orgLabel} (${orgId}) ---`);

  const policies = (await AttendancePolicy.find({ organizationId: orgId }).lean()) as LegacyPolicy[];
  let repaired = 0;

  for (const policy of policies) {
    if (policy.shiftId) continue;

    const legacy = policy.defaultFullDayRule ?? {
      startTime: '09:00',
      endTime: '18:00',
      expectedHours: 8,
      graceMinutes: 15,
    };

    let shift = await Shift.findOne({ organizationId: orgId, shiftName: 'General Shift' });
    if (!shift) {
      shift = await Shift.findOne({ organizationId: orgId, status: ShiftStatus.ACTIVE }).sort({
        createdAt: 1,
      });
    }
    if (!shift) {
      shift = await Shift.create({
        organizationId: orgId,
        shiftName: 'General Shift',
        startTime: legacy.startTime,
        endTime: legacy.endTime,
        expectedHours: legacy.expectedHours,
        graceMinutes: legacy.graceMinutes,
        isNightShift: false,
        status: ShiftStatus.ACTIVE,
      });
      console.log(`  Created shift "${shift.shiftName}" for ${policy.policyName}`);
    }

    const weekRules = (policy.weekRules ?? []).map((rule) => {
      const useShiftTiming =
        rule.useShiftTiming ??
        (rule.useDefaultTiming !== undefined ? rule.useDefaultTiming : rule.dayType === PolicyDayType.FULL_DAY);

      const migrated: Record<string, unknown> = {
        day: rule.day,
        dayType: rule.dayType,
        useShiftTiming,
      };

      if (!useShiftTiming && rule.dayType !== PolicyDayType.WEEKLY_OFF) {
        migrated.startTime = rule.startTime ?? legacy.startTime;
        migrated.endTime = rule.endTime ?? legacy.endTime;
        migrated.expectedHours = rule.expectedHours ?? legacy.expectedHours;
        migrated.graceMinutes = rule.graceMinutes ?? legacy.graceMinutes;
      }

      return migrated;
    });

    await AttendancePolicy.updateOne(
      { _id: policy._id },
      {
        $set: {
          shiftId: shift._id,
          weekRules,
        },
        $unset: { defaultFullDayRule: '' },
      }
    );
    console.log(`  Repaired policy "${policy.policyName}" → shift ${shift.shiftName}`);
    repaired += 1;
  }

  await Department.updateMany(
    { organizationId: orgId },
    { $unset: { defaultAttendancePolicyId: '', defaultShiftId: '' } }
  );

  await attendancePolicyService.ensureDefaultPolicyForOrg(orgId);

  console.log(`  Done (${repaired} polic${repaired === 1 ? 'y' : 'ies'} repaired)`);
}

async function main(): Promise<void> {
  await connectDB();

  const orgFilter = parseOrgFilter();
  const orgQuery = orgFilter
    ? {
        $or: [
          { subdomain: orgFilter },
          { name: { $regex: orgFilter, $options: 'i' } },
        ],
      }
    : {};

  const orgs = await Organization.find(orgQuery).select('_id name subdomain').lean();
  if (orgs.length === 0) {
    console.log('No organizations matched.');
    await mongoose.disconnect();
    return;
  }

  for (const org of orgs) {
    await repairOrg(org._id.toString(), org.subdomain ?? org.name);
  }

  console.log('\nLegacy attendance policy repair complete.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Repair failed:', err);
  process.exit(1);
});
