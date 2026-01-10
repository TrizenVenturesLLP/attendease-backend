import mongoose from 'mongoose';
import Holiday, { HolidayType } from '../models/Holiday';
import config from '../config';

/**
 * Seed Indian National Holidays for 2026
 * Run this script once to populate initial holidays
 */

const INDIAN_HOLIDAYS_2026 = [
  {
    name: "Republic Day",
    date: new Date('2026-01-26'),
    type: HolidayType.NATIONAL,
    description: "Celebrates the day India's Constitution came into effect",
    isRecurring: true,
  },
  {
    name: "Holi",
    date: new Date('2026-03-14'),
    type: HolidayType.NATIONAL,
    description: "Festival of Colors",
    isRecurring: true,
  },
  {
    name: "Good Friday",
    date: new Date('2026-04-03'),
    type: HolidayType.NATIONAL,
    description: "Christian observance of the crucifixion of Jesus",
    isRecurring: false, // Date varies each year
  },
  {
    name: "Eid ul-Fitr",
    date: new Date('2026-04-21'),
    type: HolidayType.NATIONAL,
    description: "Islamic festival marking the end of Ramadan",
    isRecurring: false, // Date varies based on lunar calendar
  },
  {
    name: "Independence Day",
    date: new Date('2026-08-15'),
    type: HolidayType.NATIONAL,
    description: "Commemorates India's independence from British rule in 1947",
    isRecurring: true,
  },
  {
    name: "Janmashtami",
    date: new Date('2026-08-23'),
    type: HolidayType.NATIONAL,
    description: "Celebration of Lord Krishna's birthday",
    isRecurring: false, // Date varies
  },
  {
    name: "Gandhi Jayanti",
    date: new Date('2026-10-02'),
    type: HolidayType.NATIONAL,
    description: "Mahatma Gandhi's birthday, International Day of Non-Violence",
    isRecurring: true,
  },
  {
    name: "Dussehra",
    date: new Date('2026-10-12'),
    type: HolidayType.NATIONAL,
    description: "Celebrates the victory of good over evil",
    isRecurring: false, // Date varies
  },
  {
    name: "Diwali",
    date: new Date('2026-11-01'),
    type: HolidayType.NATIONAL,
    description: "Festival of Lights",
    isRecurring: false, // Date varies
  },
  {
    name: "Guru Nanak Jayanti",
    date: new Date('2026-11-11'),
    type: HolidayType.NATIONAL,
    description: "Birthday of Guru Nanak, founder of Sikhism",
    isRecurring: false, // Date varies
  },
  {
    name: "Christmas",
    date: new Date('2026-12-25'),
    type: HolidayType.NATIONAL,
    description: "Celebration of the birth of Jesus Christ",
    isRecurring: true,
  },
];

async function seedHolidays() {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.mongoUri);
    console.log('Connected to MongoDB');

    // Check if holidays already exist
    const existingCount = await Holiday.countDocuments();
    if (existingCount > 0) {
      console.log(`Found ${existingCount} existing holidays. Skipping seed.`);
      console.log('Delete existing holidays first if you want to re-seed.');
      process.exit(0);
    }

    // Create a default admin user ID (you'll need to replace this with actual admin ID)
    // For now, we'll use a placeholder that you should update
    const adminUserId = new mongoose.Types.ObjectId(); // Replace with actual admin user ID

    console.log('Seeding Indian National Holidays for 2026...');

    const holidaysWithCreator = INDIAN_HOLIDAYS_2026.map(holiday => ({
      ...holiday,
      createdBy: adminUserId,
    }));

    const result = await Holiday.insertMany(holidaysWithCreator);
    
    console.log(`✅ Successfully seeded ${result.length} holidays:`);
    result.forEach(holiday => {
      console.log(`  - ${holiday.name} (${holiday.date.toDateString()})`);
    });

    console.log('\n✨ Holiday seeding completed successfully!');
    
  } catch (error) {
    console.error('❌ Error seeding holidays:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
    process.exit(0);
  }
}

// Run the seed function
seedHolidays();
