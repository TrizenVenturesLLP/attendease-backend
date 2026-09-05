/**
 * Script to verify and fix password hashes in the database
 * This fixes users whose passwords are stored as plain text instead of bcrypt hashes
 * 
 * Usage: npm run fix-password-hash
 * or: node scripts/fix-password-hash.js
 */

require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

async function fixPasswordHashes() {
  try {
    console.log('Connecting to MongoDB...');
    console.log(`Using MONGO_URI: ${process.env.MONGO_URI?.substring(0, 50)}...`);
    
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected successfully\n');

    const userCollection = mongoose.connection.collection('users');
    
    // Get all users with passwords
    const users = await userCollection.find({
      password: { $exists: true, $ne: null }
    }).toArray();

    console.log(`Found ${users.length} users with passwords\n`);

    let fixedCount = 0;
    let alreadyHashedCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      const password = user.password;
      const email = user.email || 'UNKNOWN';
      
      // Check if already hashed (bcrypt hashes start with $2a$, $2b$, or $2y$)
      if (password.startsWith('$2a$') || password.startsWith('$2b$') || password.startsWith('$2y$')) {
        alreadyHashedCount++;
        console.log(`✓ ${email}: Already hashed`);
      } else if (password.length < 8) {
        // Skip very short passwords that might be system placeholders
        skippedCount++;
        console.log(`⊘ ${email}: Skipped (too short: ${password.length} chars)`);
      } else {
        // Plain text password - needs hashing
        console.log(`✗ ${email}: Plain text password found!`);
        
        try {
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(password, salt);
          
          // Update the password in database
          await userCollection.updateOne(
            { _id: user._id },
            { $set: { password: hashedPassword } }
          );
          
          console.log(`  → Fixed: Password hashed and updated`);
          fixedCount++;
        } catch (hashError) {
          console.log(`  → ERROR: Failed to hash password: ${hashError.message}`);
        }
      }
    }

    console.log(`\n\nSummary:`);
    console.log(`Total users with passwords: ${users.length}`);
    console.log(`Already hashed: ${alreadyHashedCount}`);
    console.log(`Fixed: ${fixedCount}`);
    console.log(`Skipped: ${skippedCount}`);

    if (fixedCount > 0) {
      console.log('\n✓ Password hashes have been fixed!');
      console.log('Users should now be able to login with their passwords.');
    } else if (alreadyHashedCount === users.length) {
      console.log('\n✓ All passwords are already properly hashed!');
    } else {
      console.log('\n⚠ Some passwords may need manual intervention.');
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.error('\nMake sure:');
    console.error('1. MongoDB is running and accessible');
    console.error('2. .env file is properly configured with MONGO_URI');
    console.error('3. You have network access to the MongoDB cluster');
  } finally {
    try {
      await mongoose.connection.close();
      console.log('\nDatabase connection closed');
    } catch (e) {
      // Ignore close errors
    }
  }
}

fixPasswordHashes();
