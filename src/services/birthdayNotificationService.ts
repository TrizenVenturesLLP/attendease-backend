import User from '../models/User';
import Organization from '../models/Organization';
import BirthdayEmailLog from '../models/BirthdayEmailLog';
import emailNotificationService from './emailNotificationService';
import { birthdayTodayFilter, formatUserDisplayName } from '../utils/birthdayUtils';
import { logger } from '../utils/logger';

export class BirthdayNotificationService {
  /**
   * Send one birthday email per user per calendar year (deduped via BirthdayEmailLog).
   */
  async sendDailyBirthdayEmails(): Promise<{ sent: number; skipped: number; failed: number }> {
    const year = new Date().getFullYear();

    const users = await User.find({
      ...birthdayTodayFilter(),
      organizationId: { $exists: true, $ne: null },
    })
      .select('firstName lastName fullName email organizationId')
      .lean();

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const user of users) {
      const userId = user._id;
      const alreadySent = await BirthdayEmailLog.findOne({ userId, year }).select('_id').lean();
      if (alreadySent) {
        skipped += 1;
        continue;
      }

      const org = user.organizationId
        ? await Organization.findById(user.organizationId).select('name').lean()
        : null;
      const name = formatUserDisplayName(user);

      try {
        await emailNotificationService.sendBirthdayEmail({
          email: user.email,
          name,
          organizationName: org?.name,
        });
        await BirthdayEmailLog.create({ userId, year, sentAt: new Date() });
        sent += 1;
      } catch (error) {
        failed += 1;
        logger.error('Birthday email failed', {
          userId: String(userId),
          email: user.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Daily birthday emails finished', { sent, skipped, failed, candidates: users.length });
    return { sent, skipped, failed };
  }
}

export const birthdayNotificationService = new BirthdayNotificationService();
