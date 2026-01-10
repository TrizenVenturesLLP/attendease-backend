import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Department from '../models/Department';
import config from '../config';

dotenv.config();

const DEPARTMENTS = [
  {
    name: 'Engineering',
    description: 'Software development and technical operations',
  },
  {
    name: 'Human Resources',
    description: 'Employee management, recruitment, and HR operations',
  },
  {
    name: 'Sales',
    description: 'Sales and business development team',
  },
  {
    name: 'Marketing',
    description: 'Marketing, branding, and communications',
  },
  {
    name: 'Finance',
    description: 'Financial planning, accounting, and operations',
  },
  {
    name: 'Operations',
    description: 'Business operations and administrative functions',
  },
];

async function seedDepartments() {
  try {
    // Connect to MongoDB
    const mongoUri = config.mongoUri;
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Check if departments already exist
    const existingCount = await Department.countDocuments();
    if (existingCount > 0) {
      console.log(`Found ${existingCount} existing departments. Skipping seed.`);
      console.log('To re-seed, delete existing departments first.');
      process.exit(0);
    }

    // Create departments
    console.log('Creating departments...');
    for (const dept of DEPARTMENTS) {
      await Department.create(dept);
      console.log(`✓ Created: ${dept.name}`);
    }

    console.log('\n✅ Department seeding completed successfully!');
    console.log(`Created ${DEPARTMENTS.length} departments`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error seeding departments:', error);
    process.exit(1);
  }
}

seedDepartments();
