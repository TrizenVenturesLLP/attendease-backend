import mongoose from 'mongoose';
import config from '../config';
import User, { UserRole } from '../models/User';

/**
 * Migration Script: Fix Super Admin Organization Handling
 * 
 * Purpose:
 * - Remove organizationId from Super Admin users (they are platform-level)
 * - Remove department, supervisorId, employeeId from Super Admin
 * - Ensure Super Admin users don't belong to any organization
 * 
 * Run: npx ts-node src/scripts/fixSuperAdmin.ts
 */

async function fixSuperAdminUsers() {
  try {
    console.log('🔄 Connecting to database...');
    await mongoose.connect(config.mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Find all Super Admin users
    const superAdmins = await User.find({ role: UserRole.SUPER_ADMIN });
    
    if (superAdmins.length === 0) {
      console.log('ℹ️  No Super Admin users found');
      return;
    }

    console.log(`📊 Found ${superAdmins.length} Super Admin user(s)\n`);

    for (const admin of superAdmins) {
      console.log(`Processing: ${admin.email} (${admin.firstName} ${admin.lastName})`);
      
      const updates: string[] = [];
      
      // Check and remove organizationId
      if (admin.organizationId) {
        console.log(`  - Removing organizationId: ${admin.organizationId}`);
        admin.organizationId = undefined as any;
        updates.push('organizationId');
      }
      
      // Check and remove department
      if (admin.department) {
        console.log(`  - Removing department: ${admin.department}`);
        admin.department = undefined;
        updates.push('department');
      }
      
      // Check and remove supervisorId
      if (admin.supervisorId) {
        console.log(`  - Removing supervisorId: ${admin.supervisorId}`);
        admin.supervisorId = undefined;
        updates.push('supervisorId');
      }
      
      // Check and remove employeeId
      if (admin.employeeId) {
        console.log(`  - Removing employeeId: ${admin.employeeId}`);
        admin.employeeId = undefined;
        updates.push('employeeId');
      }

      if (updates.length > 0) {
        await admin.save();
        console.log(`  ✅ Updated: ${updates.join(', ')}`);
      } else {
        console.log(`  ℹ️  Already clean - no updates needed`);
      }
      
      console.log('');
    }

    console.log('✅ Migration completed successfully!\n');
    console.log('📝 Summary:');
    console.log(`   - Total Super Admins processed: ${superAdmins.length}`);
    console.log(`   - Super Admins are now platform-level (no organization)`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from database');
  }
}

// Run the migration
fixSuperAdminUsers()
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
