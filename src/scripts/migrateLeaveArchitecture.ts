import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db';
import Organization from '../models/Organization';
import Leave from '../models/Leave';
import LeaveBalance from '../models/LeaveBalance';
import { leaveTypeService } from '../services/leaveTypeService';
import { approvalWorkflowService } from '../services/approvalWorkflowService';
import { leavePolicyService } from '../services/leavePolicyService';

dotenv.config();

const LEGACY_TYPE_MAP: Record<string, string> = {
  sick: 'SL',
  casual: 'CL',
  vacation: 'VAC',
  unpaid: 'UPL',
};

const STATUS_MAP: Record<string, string> = {
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  cancelled: 'CANCELLED',
};

async function migrate(): Promise<void> {
  await connectDB();

  const orgs = await Organization.find({}).select('_id name').lean();
  console.log(`Found ${orgs.length} organization(s)`);

  for (const org of orgs) {
    const orgId = org._id.toString();
    console.log(`\nProcessing org: ${(org as { name?: string }).name ?? orgId}`);

    const types = await leaveTypeService.ensureDefaultTypes(orgId);
    const workflow = await approvalWorkflowService.ensureDefaultWorkflow(orgId);
    const policy = await leavePolicyService.ensureDefaultPolicyForOrg(orgId);

    const typeByCode = new Map(types.map((t) => [t.code, t._id]));

    const legacyLeaves = (await Leave.collection
      .find({ organizationId: new mongoose.Types.ObjectId(orgId), leaveTypeId: { $exists: false } })
      .toArray()) as Array<{
      _id: mongoose.Types.ObjectId;
      leaveType?: string;
      status?: string;
      totalDays?: number;
    }>;

    for (const row of legacyLeaves) {
      const legacyType = String(row.leaveType ?? '').toLowerCase();
      const code = LEGACY_TYPE_MAP[legacyType];
      const leaveTypeId = code ? typeByCode.get(code) : typeByCode.get('OTHER');
      const status = STATUS_MAP[String(row.status ?? 'pending').toLowerCase()] ?? 'PENDING';

      await Leave.collection.updateOne(
        { _id: row._id },
        {
          $set: {
            leaveTypeId,
            leavePolicyId: policy._id,
            workflowId: workflow._id,
            currentApprovalStep: 1,
            status,
            isHalfDay: Number(row.totalDays) === 0.5,
          },
          $unset: {
            leaveType: '',
            reviewedBy: '',
            reviewedAt: '',
            reviewNotes: '',
          },
        }
      );
    }

    if (legacyLeaves.length > 0) {
      console.log(`  Migrated ${legacyLeaves.length} leave request(s)`);
    }

    const legacyBalances = (await LeaveBalance.collection
      .find({ organizationId: new mongoose.Types.ObjectId(orgId), balances: { $exists: false } })
      .toArray()) as Array<{
      _id: mongoose.Types.ObjectId;
      sickLeave?: { total?: number; used?: number };
      casualLeave?: { total?: number; used?: number };
      vacationLeave?: { total?: number; used?: number };
      unpaidLeave?: { used?: number };
    }>;

    for (const row of legacyBalances) {
      const balances = [];
      const mappings = [
        { code: 'SL', bucket: row.sickLeave },
        { code: 'CL', bucket: row.casualLeave },
        { code: 'VAC', bucket: row.vacationLeave },
        { code: 'UPL', bucket: row.unpaidLeave },
      ];

      for (const map of mappings) {
        const typeId = typeByCode.get(map.code);
        if (!typeId || !map.bucket) continue;
        const allocated = Number((map.bucket as { total?: number }).total ?? 0);
        const used = Number(map.bucket.used ?? 0);
        balances.push({
          leaveTypeId: typeId,
          allocated,
          used,
          remaining: Math.max(0, allocated - used),
        });
      }

      await LeaveBalance.collection.updateOne(
        { _id: row._id },
        {
          $set: { balances },
          $unset: {
            sickLeave: '',
            casualLeave: '',
            vacationLeave: '',
            unpaidLeave: '',
          },
        }
      );
    }

    if (legacyBalances.length > 0) {
      console.log(`  Migrated ${legacyBalances.length} leave balance record(s)`);
    }
  }

  console.log('\nLeave architecture migration complete.');
  await mongoose.disconnect();
}

migrate().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
