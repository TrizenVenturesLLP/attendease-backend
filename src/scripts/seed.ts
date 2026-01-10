import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import User, { UserRole } from '../models/User';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/attendease';

/**
 * Seed script to create initial users including Super Admin
 */
async function seedDatabase() {
  try {
    console.log('🌱 Starting database seed...');

    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Check if super admin already exists
    const existingSuperAdmin = await User.findOne({ role: UserRole.SUPER_ADMIN });

    if (existingSuperAdmin) {
      console.log('⚠️  Super Admin already exists. Skipping seed.');
      await mongoose.disconnect();
      return;
    }

    // Create Super Admin
    const superAdmin = new User({
      email: 'demo@trizenventures.com',
      password: 'demo123', // Will be hashed by the pre-save hook
      firstName: 'Super',
      lastName: 'Admin',
      role: UserRole.SUPER_ADMIN,
      department: 'Management',
      employeeId: 'EMP001',
      isActive: true,
    });

    await superAdmin.save();
    console.log('✅ Super Admin created: demo@trizenventures.com / demo123');

    // Optional: Create sample users for testing
    const sampleUsers = [
      {
        email: 'admin@trizenventures.com',
        password: 'admin123',
        firstName: 'John',
        lastName: 'Doe',
        role: UserRole.ADMIN,
        department: 'Operations',
        employeeId: 'EMP002',
        createdBy: superAdmin._id,
      },
      {
        email: 'hr@trizenventures.com',
        password: 'hr1234',
        firstName: 'Jane',
        lastName: 'Smith',
        role: UserRole.HR,
        department: 'Human Resources',
        employeeId: 'EMP003',
        createdBy: superAdmin._id,
      },
      {
        email: 'supervisor@trizenventures.com',
        password: 'supervisor123',
        firstName: 'Mike',
        lastName: 'Johnson',
        role: UserRole.SUPERVISOR,
        department: 'Engineering',
        employeeId: 'EMP004',
        createdBy: superAdmin._id,
      },
      {
        email: 'employee@trizenventures.com',
        password: 'employee123',
        firstName: 'Sarah',
        lastName: 'Williams',
        role: UserRole.EMPLOYEE,
        department: 'Engineering',
        employeeId: 'EMP005',
        createdBy: superAdmin._id,
      },
    ];

    // Create sample users
    for (const userData of sampleUsers) {
      const user = new User(userData);
      await user.save();
      console.log(`✅ Created ${userData.role}: ${userData.email}`);
    }

    // Assign supervisor to employee
    const supervisor = await User.findOne({ email: 'supervisor@trizenventures.com' });
    const employee = await User.findOne({ email: 'employee@trizenventures.com' });

    if (supervisor && employee) {
      employee.supervisorId = supervisor._id as mongoose.Types.ObjectId;
      await employee.save();
      console.log('✅ Assigned supervisor to employee');
    }

    console.log('\n🎉 Database seeded successfully!');
    console.log('\n📋 Login Credentials:');
    console.log('Super Admin: demo@trizenventures.com / demo123');
    console.log('Admin: admin@trizenventures.com / admin123');
    console.log('HR: hr@trizenventures.com / hr123');
    console.log('Supervisor: supervisor@trizenventures.com / supervisor123');
    console.log('Employee: employee@trizenventures.com / employee123');

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

// Run seed
seedDatabase();
