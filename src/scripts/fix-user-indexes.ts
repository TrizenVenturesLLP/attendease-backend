import mongoose from 'mongoose';
import config from '../config';
import User from '../models/User';

/**
 * Script to fix User model indexes
 * 
 * This script removes the legacy 'email_1' unique index that conflicts with
 * the new multi-organization design and ensures proper indexes are in place.
 * 
 * Issue: E11000 duplicate key error on email_1 index when users from different
 * organizations try to use Microsoft authentication with the same email.
 * 
 * Solution: Drop the global email index and rely on compound indexes:
 * - { organizationId: 1, email: 1 } for organization-scoped uniqueness
 * - { email: 1 } with partialFilterExpression for super_admin only
 */

async function fixUserIndexes() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(config.mongoUri);
    console.log('Connected to MongoDB');

    const collection = User.collection;

    // Get existing indexes
    console.log('\nCurrent indexes:');
    const indexes = await collection.listIndexes().toArray();
    indexes.forEach((index) => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key));
    });

    // Check if the problematic email_1 index exists
    const hasLegacyEmailIndex = indexes.some(
      (idx) => idx.name === 'email_1' && !idx.partialFilterExpression
    );

    if (hasLegacyEmailIndex) {
      console.log('\nDropping legacy email_1 index...');
      await collection.dropIndex('email_1');
      console.log('✓ Legacy email_1 index dropped');
    } else {
      console.log('\n✓ No legacy email_1 index found (already clean)');
    }

    // Check if the problematic organizationId_1_microsoftId_1 index exists (with sparse instead of partialFilterExpression)
    const hasLegacyMicrosoftIdIndex = indexes.some(
      (idx) => idx.name === 'organizationId_1_microsoftId_1' && !idx.partialFilterExpression
    );

    if (hasLegacyMicrosoftIdIndex) {
      console.log('\nDropping legacy organizationId_1_microsoftId_1 index...');
      await collection.dropIndex('organizationId_1_microsoftId_1');
      console.log('✓ Legacy organizationId_1_microsoftId_1 index dropped');
    } else {
      console.log('✓ No legacy organizationId_1_microsoftId_1 index found (already clean)');
    }

    // Ensure correct indexes exist
    console.log('\nSyncing indexes from schema...');
    await User.syncIndexes();
    console.log('✓ Indexes synced successfully');

    // Show final indexes
    console.log('\nFinal indexes:');
    const finalIndexes = await collection.listIndexes().toArray();
    finalIndexes.forEach((index) => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key));
      if (index.partialFilterExpression) {
        console.log(`    (partial filter: ${JSON.stringify(index.partialFilterExpression)})`);
      }
    });

    console.log('\n✅ User indexes fixed successfully!');
  } catch (error) {
    console.error('❌ Error fixing indexes:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
    process.exit(0);
  }
}

// Run the script
fixUserIndexes();
