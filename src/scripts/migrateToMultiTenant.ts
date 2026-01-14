import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Organization from '../models/Organization';
import User from '../models/User';
import Department from '../models/Department';
import Attendance from '../models/Attendance';
import Leave from '../models/Leave';
import LeaveBalance from '../models/LeaveBalance';
import Holiday from '../models/Holiday';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI!;

/**
 * Migration script to transform existing single-tenant data to multi-tenant architecture
 * This script:
 * 1. Creates a "Default Organization" if it doesn't exist
 * 2. Assigns all existing data to this organization
 * 3. Is idempotent - can be run multiple times safely
 */

interface MigrationStats {
  organizationCreated: boolean;
  usersUpdated: number;
  departmentsUpdated: number;
  attendanceUpdated: number;
  leavesUpdated: number;
  leaveBalancesUpdated: number;
  holidaysUpdated: number;
}

async function migrateToMultiTenant(): Promise<void> {
  try {
    console.log('🚀 Starting multi-tenant migration...\n');

    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const stats: MigrationStats = {
      organizationCreated: false,
      usersUpdated: 0,
      departmentsUpdated: 0,
      attendanceUpdated: 0,
      leavesUpdated: 0,
      leaveBalancesUpdated: 0,
      holidaysUpdated: 0,
    };

    // Step 1: Create or find Default Organization
    console.log('📋 Step 1: Creating Default Organization...');
    let defaultOrg = await Organization.findOne({ name: 'Default Organization' });

    if (!defaultOrg) {
      defaultOrg = await Organization.create({
        name: 'Default Organization',
        isActive: true,
        subscriptionPlan: 'premium',
        settings: {
          workingHours: {
            startTime: '09:00',
            endTime: '18:00',
          },
          leavePolicy: {
            sickLeave: 12,
            casualLeave: 12,
            vacationLeave: 18,
          },
          timezone: 'Asia/Kolkata',
          fiscalYearStart: 1, // January
        },
      });
      console.log(`✅ Created Default Organization (ID: ${defaultOrg._id})\n`);
      stats.organizationCreated = true;
    } else {
      console.log(`✅ Default Organization already exists (ID: ${defaultOrg._id})\n`);
    }

    const orgId = defaultOrg._id;

    // Step 2: Update Users
    console.log('📋 Step 2: Updating Users...');
    const usersWithoutOrg = await User.find({ organizationId: { $exists: false } });
    console.log(`   Found ${usersWithoutOrg.length} users without organization`);

    if (usersWithoutOrg.length > 0) {
      const userResult = await User.updateMany(
        { organizationId: { $exists: false } },
        { $set: { organizationId: orgId } }
      );
      stats.usersUpdated = userResult.modifiedCount;
      console.log(`✅ Updated ${stats.usersUpdated} users\n`);
    } else {
      console.log('✅ All users already have organization assigned\n');
    }

    // Step 3: Update Departments
    console.log('📋 Step 3: Updating Departments...');
    const departmentsWithoutOrg = await Department.find({
      organizationId: { $exists: false },
    });
    console.log(`   Found ${departmentsWithoutOrg.length} departments without organization`);

    if (departmentsWithoutOrg.length > 0) {
      const deptResult = await Department.updateMany(
        { organizationId: { $exists: false } },
        { $set: { organizationId: orgId } }
      );
      stats.departmentsUpdated = deptResult.modifiedCount;
      console.log(`✅ Updated ${stats.departmentsUpdated} departments\n`);
    } else {
      console.log('✅ All departments already have organization assigned\n');
    }

    // Step 4: Update Attendance records
    console.log('📋 Step 4: Updating Attendance records...');
    const attendanceWithoutOrg = await Attendance.countDocuments({
      organizationId: { $exists: false },
    });
    console.log(`   Found ${attendanceWithoutOrg} attendance records without organization`);

    if (attendanceWithoutOrg > 0) {
      const attendanceResult = await Attendance.updateMany(
        { organizationId: { $exists: false } },
        { $set: { organizationId: orgId } }
      );
      stats.attendanceUpdated = attendanceResult.modifiedCount;
      console.log(`✅ Updated ${stats.attendanceUpdated} attendance records\n`);
    } else {
      console.log('✅ All attendance records already have organization assigned\n');
    }

    // Step 5: Update Leave records
    console.log('📋 Step 5: Updating Leave records...');
    const leavesWithoutOrg = await Leave.countDocuments({
      organizationId: { $exists: false },
    });
    console.log(`   Found ${leavesWithoutOrg} leave records without organization`);

    if (leavesWithoutOrg > 0) {
      const leaveResult = await Leave.updateMany(
        { organizationId: { $exists: false } },
        { $set: { organizationId: orgId } }
      );
      stats.leavesUpdated = leaveResult.modifiedCount;
      console.log(`✅ Updated ${stats.leavesUpdated} leave records\n`);
    } else {
      console.log('✅ All leave records already have organization assigned\n');
    }

    // Step 6: Update LeaveBalance records
    console.log('📋 Step 6: Updating LeaveBalance records...');
    const leaveBalancesWithoutOrg = await LeaveBalance.countDocuments({
      organizationId: { $exists: false },
    });
    console.log(`   Found ${leaveBalancesWithoutOrg} leave balance records without organization`);

    if (leaveBalancesWithoutOrg > 0) {
      const balanceResult = await LeaveBalance.updateMany(
        { organizationId: { $exists: false } },
        { $set: { organizationId: orgId } }
      );
      stats.leaveBalancesUpdated = balanceResult.modifiedCount;
      console.log(`✅ Updated ${stats.leaveBalancesUpdated} leave balance records\n`);
    } else {
      console.log('✅ All leave balance records already have organization assigned\n');
    }

    // Step 7: Update Holiday records
    console.log('📋 Step 7: Updating Holiday records...');
    const holidaysWithoutOrg = await Holiday.countDocuments({
      organizationId: { $exists: false },
    });
    console.log(`   Found ${holidaysWithoutOrg} holiday records without organization`);

    if (holidaysWithoutOrg > 0) {
      const holidayResult = await Holiday.updateMany(
        { organizationId: { $exists: false } },
        { $set: { organizationId: orgId } }
      );
      stats.holidaysUpdated = holidayResult.modifiedCount;
      console.log(`✅ Updated ${stats.holidaysUpdated} holiday records\n`);
    } else {
      console.log('✅ All holiday records already have organization assigned\n');
    }

    // Print summary
    console.log('='.repeat(60));
    console.log('🎉 MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log('\n📊 Migration Summary:');
    console.log(`   Organization Created: ${stats.organizationCreated ? 'Yes' : 'No (already existed)'}`);
    console.log(`   Users Updated: ${stats.usersUpdated}`);
    console.log(`   Departments Updated: ${stats.departmentsUpdated}`);
    console.log(`   Attendance Records Updated: ${stats.attendanceUpdated}`);
    console.log(`   Leave Records Updated: ${stats.leavesUpdated}`);
    console.log(`   Leave Balance Records Updated: ${stats.leaveBalancesUpdated}`);
    console.log(`   Holiday Records Updated: ${stats.holidaysUpdated}`);
    console.log('\n✅ All existing data has been assigned to "Default Organization"');
    console.log('✅ Your application is now multi-tenant ready!');
    console.log('\n💡 Next Steps:');
    console.log('   1. Restart your backend server');
    console.log('   2. Test existing features to ensure they still work');
    console.log('   3. Use Super Admin to create new organizations\n');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
  } catch (error) {
    console.error('\n❌ Migration failed with error:');
    console.error(error);
    process.exit(1);
  }
}

// Run migration
migrateToMultiTenant()
  .then(() => {
    console.log('✅ Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration script failed:', error);
    process.exit(1);
  });
