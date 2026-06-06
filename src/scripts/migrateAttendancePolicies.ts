import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db';
import Organization from '../models/Organization';
import User from '../models/User';
import Department from '../models/Department';
import AttendancePolicy from '../models/AttendancePolicy';
import Shift, { ShiftStatus } from '../models/Shift';
import { attendancePolicyService } from '../services/attendancePolicyService';
import { PolicyDayType } from '../models/AttendancePolicy';

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

async function migrate(): Promise<void> {
  await connectDB();

  const orgs = await Organization.find({}).select('_id name').lean();
  console.log(`Found ${orgs.length} organization(s)`);

  for (const org of orgs) {
    const orgId = org._id.toString();
    console.log(`\nProcessing org: ${(org as { name?: string }).name ?? orgId}`);

    const deptRename = await Department.updateMany(
      {
        organizationId: orgId,
        defaultAttendancePolicyId: { $exists: true },
        departmentAttendancePolicyId: { $exists: false },
      },
      [
        {
          $set: {
            departmentAttendancePolicyId: '$defaultAttendancePolicyId',
          },
        },
      ]
    );
    if (deptRename.modifiedCount > 0) {
      console.log(`  Renamed department policy field on ${deptRename.modifiedCount} department(s)`);
    }

    await Department.updateMany(
      { organizationId: orgId },
      { $unset: { defaultAttendancePolicyId: '', defaultShiftId: '' } }
    );

    const policies = (await AttendancePolicy.find({ organizationId: orgId }).lean()) as LegacyPolicy[];

    for (const policy of policies) {
      if (policy.shiftId) {
        continue;
      }

      const legacy = policy.defaultFullDayRule ?? {
        startTime: '09:00',
        endTime: '18:00',
        expectedHours: 8,
        graceMinutes: 15,
      };

      let shift = await Shift.findOne({
        organizationId: orgId,
        shiftName: 'General Shift',
      });

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
        console.log(`  Created default shift for org ${orgId}`);
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
      console.log(`  Migrated policy: ${policy.policyName}`);
    }

    await attendancePolicyService.ensureDefaultPolicyForOrg(orgId);
  }

  await User.updateMany({}, { $unset: { shiftId: '' } });

  console.log('\nMigration complete.');
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
