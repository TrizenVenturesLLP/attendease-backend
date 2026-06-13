import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { UserRole } from '../models/User';
import Department from '../models/Department';
import userService from '../services/userService';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function run() {
  await mongoose.connect(process.env.MONGO_URI!, { dbName: process.env.MONGO_DB });
  console.log('✅ Connected to MongoDB\n');

  // Let's find a department to use
  const dept = await Department.findOne({});
  if (!dept) {
    console.error('❌ No department found in DB to run test.');
    await mongoose.disconnect();
    return;
  }
  const orgId = dept.organizationId.toString();

  console.log(`Using Org ID: ${orgId}`);
  console.log(`Using Department: ${dept.name}`);

  // 1. Create a new test user
  const email = `test_sync_${Date.now()}@example.com`;
  console.log(`\nCreating user: ${email}...`);
  const user = await userService.createUser({
    organizationId: orgId,
    email,
    firstName: 'Test',
    lastName: 'Sync',
    role: UserRole.EMPLOYEE,
    department: dept.name,
  }, '6a23ba5077527ae5e2667b91'); // Use an existing user ID as creator

  // Check if added to department members
  let updatedDept = await Department.findById(dept._id);
  const isAdded = updatedDept?.members.map(m => m.toString()).includes(user._id.toString());
  console.log(`Is user added to department members? ${isAdded ? '✅ YES' : '❌ NO'}`);

  // 2. Update user department to something else
  const otherDept = await Department.findOne({ organizationId: orgId, _id: { $ne: dept._id } });
  if (otherDept) {
    console.log(`\nUpdating user department to: ${otherDept.name}...`);
    await userService.updateUser(user._id.toString(), {
      department: otherDept.name
    });

    // Check old department
    const oldDeptUpdated = await Department.findById(dept._id);
    const inOld = oldDeptUpdated?.members.map(m => m.toString()).includes(user._id.toString());
    console.log(`Is user in old department members? ${inOld ? '❌ YES' : '✅ NO (correctly removed)'}`);

    // Check new department
    const newDeptUpdated = await Department.findById(otherDept._id);
    const inNew = newDeptUpdated?.members.map(m => m.toString()).includes(user._id.toString());
    console.log(`Is user in new department members? ${inNew ? '✅ YES' : '❌ NO'}`);
  }

  // Cleanup
  console.log('\nCleaning up test user...');
  await userService.deleteUser(user._id.toString(), '6a23ba5077527ae5e2667b91', UserRole.ADMIN, orgId);
  
  // Verify cleaned up
  if (otherDept) {
    const finalDept = await Department.findById(otherDept._id);
    const inFinal = finalDept?.members.map(m => m.toString()).includes(user._id.toString());
    console.log(`Is user removed from department members after delete? ${inFinal ? '❌ NO' : '✅ YES'}`);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
