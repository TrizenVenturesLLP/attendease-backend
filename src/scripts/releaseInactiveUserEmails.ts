/**
 * One-time cleanup: release emails on inactive users deleted before soft-delete
 * started anonymizing addresses. Run after deploy, then sync indexes:
 *   npx ts-node src/scripts/releaseInactiveUserEmails.ts
 *   npx ts-node src/scripts/fix-user-indexes.ts
 */
import mongoose from 'mongoose';
import config from '../config';
import User from '../models/User';

async function releaseInactiveUserEmails(): Promise<void> {
  await mongoose.connect(config.mongoUri);

  const inactiveWithRealEmail = await User.find({
    isActive: false,
    email: { $not: /^deleted\./ },
  }).select('_id email');

  console.log(`Found ${inactiveWithRealEmail.length} inactive user(s) with unreleased emails`);

  for (const user of inactiveWithRealEmail) {
    const previous = user.email;
    user.email = `deleted.${user._id.toString()}@removed.trizenhr`;
    user.employeeId = undefined;
    await user.save();
    console.log(`  Released: ${previous} -> ${user.email}`);
  }

  console.log('Done.');
  await mongoose.connection.close();
}

releaseInactiveUserEmails().catch((err) => {
  console.error(err);
  process.exit(1);
});
