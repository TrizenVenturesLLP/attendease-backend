import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';
import Department from '../models/Department';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function run() {
  await mongoose.connect(process.env.MONGO_URI!, { dbName: process.env.MONGO_DB });
  console.log(`✅ Connected to MongoDB (db: ${process.env.MONGO_DB})\n`);

  console.log('🔄 Reconciling Department members from User.department...');

  // 1. Clear all members arrays in all departments
  await Department.updateMany({}, { $set: { members: [] } });
  console.log(`🧹 Cleared members array for all departments.`);

  // 2. Find all active users with a department assigned
  const activeUsers = await User.find({
    isActive: true,
    department: { $exists: true, $ne: '' },
    organizationId: { $exists: true, $ne: null }
  });

  console.log(`👤 Found ${activeUsers.length} active users with department assigned.`);

  let matchedCount = 0;
  let missingDeptCount = 0;

  for (const user of activeUsers) {
    if (!user.department) continue;
    const deptName = user.department.trim();
    
    // Find department in user's organization (case-insensitive)
    const department = await Department.findOne({
      organizationId: user.organizationId,
      name: { $regex: `^${deptName}$`, $options: 'i' }
    });

    if (department) {
      await Department.updateOne(
        { _id: department._id },
        { $addToSet: { members: user._id } }
      );
      matchedCount++;
      console.log(`  ✓ Added ${user.firstName} ${user.lastName} to department "${department.name}"`);
    } else {
      missingDeptCount++;
      console.warn(`  ⚠ Department "${deptName}" not found in organization ${user.organizationId} for user ${user.firstName} ${user.lastName}`);
    }
  }

  console.log(`\n🎉 Reconcile completed!`);
  console.log(`   Added to departments: ${matchedCount}`);
  console.log(`   Missing departments:  ${missingDeptCount}`);

  await mongoose.disconnect();
  console.log('✅ Disconnected from MongoDB');
}

run().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
