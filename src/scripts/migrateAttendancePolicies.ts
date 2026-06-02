import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/db';
import Organization from '../models/Organization';
import User from '../models/User';
import Department from '../models/Department';
import { attendancePolicyService } from '../services/attendancePolicyService';

dotenv.config();

async function migrate(): Promise<void> {
  await connectDB();

  const orgs = await Organization.find({}).select('_id name').lean();
  console.log(`Found ${orgs.length} organization(s)`);

  for (const org of orgs) {
    const orgId = org._id.toString();
    console.log(`\nProcessing org: ${(org as any).name ?? orgId}`);

    const defaultPolicy = await attendancePolicyService.ensureDefaultPolicyForOrg(orgId);
    console.log(`  Default policy: ${defaultPolicy.policyName} (${defaultPolicy._id})`);

    const deptResult = await Department.updateMany(
      { organizationId: orgId, defaultAttendancePolicyId: { $exists: false } },
      { $set: { defaultAttendancePolicyId: defaultPolicy._id } }
    );
    console.log(`  Updated ${deptResult.modifiedCount} department(s) with default policy`);

    const userResult = await User.updateMany(
      {
        organizationId: orgId,
        role: { $ne: 'super_admin' },
        $or: [{ attendancePolicyId: { $exists: false } }, { attendancePolicyId: null }],
      },
      { $set: { attendancePolicyId: defaultPolicy._id } }
    );
    console.log(`  Assigned policy to ${userResult.modifiedCount} user(s)`);
  }

  console.log('\nMigration complete.');
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
