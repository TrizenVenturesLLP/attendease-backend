/**
 * Direct password update script
 * Updates a specific user's password in the database
 */

require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

async function updateUserPassword() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected successfully\n');

    const userCollection = mongoose.connection.collection('users');
    const email = 'aasisvenkat@gmail.com';
    const newPassword = '123456';

    // Find the user
    const user = await userCollection.findOne({ email: email });
    
    if (!user) {
      console.log(`✗ User with email "${email}" not found`);
      return;
    }

    console.log(`Found user: ${user.email}`);
    console.log(`Current password (first 50 chars): ${user.password ? user.password.substring(0, 50) : 'NO PASSWORD'}`);
    console.log(`\nHashing new password: "${newPassword}"`);

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    console.log(`New hash: ${hashedPassword.substring(0, 50)}...`);
    console.log(`\nUpdating database...`);

    // Update the password
    const result = await userCollection.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword } }
    );

    if (result.modifiedCount === 1) {
      console.log(`✓ Password updated successfully!\n`);
      
      // Verify the update
      console.log(`Verifying the update...`);
      const isValid = await bcrypt.compare(newPassword, hashedPassword);
      
      if (isValid) {
        console.log(`✓ Password verification successful!`);
        console.log(`\nUser ${email} can now login with password: ${newPassword}`);
      } else {
        console.log(`✗ Password verification failed`);
      }
    } else {
      console.log(`✗ No records were updated`);
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    try {
      await mongoose.connection.close();
      console.log('\nDatabase connection closed');
    } catch (e) {
      // Ignore close errors
    }
  }
}

updateUserPassword();
