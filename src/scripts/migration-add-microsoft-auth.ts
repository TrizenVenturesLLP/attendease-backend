/**
 * Migration: Add Microsoft Authentication Fields
 * 
 * This migration adds Microsoft authentication support to existing users and organizations.
 * - Users: Add authProvider='local' and microsoftId=null
 * - Organizations: Add microsoftAuth configuration with defaults
 * 
 * Run with: npx ts-node src/scripts/migration-add-microsoft-auth.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User';
import Organization from '../models/Organization';

async function migrate() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is not defined');
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Migrate Users: Add authProvider='local' for existing users
    console.log('\n--- Migrating Users ---');
    const usersWithoutProvider = await User.countDocuments({ authProvider: { $exists: false } });
    console.log(`Found ${usersWithoutProvider} users without authProvider`);

    if (usersWithoutProvider > 0) {
      const userResult = await User.updateMany(
        { authProvider: { $exists: false } },
        { $set: { authProvider: 'local' } }
      );
      console.log(`Updated ${userResult.modifiedCount} users with authProvider='local'`);
    }

    // Migrate Organizations: Add microsoftAuth configuration
    console.log('\n--- Migrating Organizations ---');
    const orgsWithoutMsAuth = await Organization.countDocuments({ 
      'microsoftAuth.allowLocalAuth': { $exists: false } 
    });
    console.log(`Found ${orgsWithoutMsAuth} organizations without Microsoft auth config`);

    if (orgsWithoutMsAuth > 0) {
      const orgResult = await Organization.updateMany(
        { 'microsoftAuth.allowLocalAuth': { $exists: false } },
        { 
          $set: { 
            'microsoftAuth.allowMicrosoftAuth': false,
            'microsoftAuth.allowLocalAuth': true 
          } 
        }
      );
      console.log(`Updated ${orgResult.modifiedCount} organizations with default Microsoft auth config`);
    }

    // Summary
    console.log('\n--- Migration Summary ---');
    const totalUsers = await User.countDocuments();
    const localUsers = await User.countDocuments({ authProvider: 'local' });
    const microsoftUsers = await User.countDocuments({ authProvider: 'microsoft' });
    const totalOrgs = await Organization.countDocuments();
    const msEnabledOrgs = await Organization.countDocuments({ 'microsoftAuth.allowMicrosoftAuth': true });

    console.log(`Total Users: ${totalUsers}`);
    console.log(`  - Local Auth: ${localUsers}`);
    console.log(`  - Microsoft Auth: ${microsoftUsers}`);
    console.log(`Total Organizations: ${totalOrgs}`);
    console.log(`  - Microsoft Auth Enabled: ${msEnabledOrgs}`);

    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run migration
migrate();
