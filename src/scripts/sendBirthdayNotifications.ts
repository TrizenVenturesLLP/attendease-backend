import connectDB from '../config/db';
import { birthdayNotificationService } from '../services/birthdayNotificationService';

async function main() {
  await connectDB();
  const result = await birthdayNotificationService.sendDailyBirthdayEmails();
  console.log('[sendBirthdayNotifications]', result);
  process.exit(0);
}

main().catch((error) => {
  console.error('[sendBirthdayNotifications] failed', error);
  process.exit(1);
});
