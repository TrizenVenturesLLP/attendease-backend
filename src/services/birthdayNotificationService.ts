import mongoose from 'mongoose';
import User from '../models/User';
import Organization from '../models/Organization';
import BirthdayEmailLog from '../models/BirthdayEmailLog';
import emailNotificationService from './emailNotificationService';
import { birthdayTodayFilter, formatUserDisplayName, isBirthdayToday } from '../utils/birthdayUtils';
import { logger } from '../utils/logger';

type BirthdayUserRow = {
  _id: mongoose.Types.ObjectId;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email: string;
  organizationId?: mongoose.Types.ObjectId;
  dateOfBirth?: Date;
};

export class BirthdayNotificationService {
  private async alreadySentThisYear(userId: mongoose.Types.ObjectId, year: number): Promise<boolean> {
    const existing = await BirthdayEmailLog.findOne({ userId, year }).select('_id').lean();
    return Boolean(existing);
  }

  private async deliverBirthdayEmail(user: BirthdayUserRow, year: number): Promise<'sent' | 'skipped' | 'failed'> {
    const userId = user._id;

    if (await this.alreadySentThisYear(userId, year)) {
      return 'skipped';
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
      logger.info('Birthday email sent', { userId: String(userId), email: user.email });
      return 'sent';
    } catch (error) {
      logger.error('Birthday email failed', {
        userId: String(userId),
        email: user.email,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  }

  /**
   * Send birthday email for one user when today is their birthday.
   * Used after profile completion and by the daily scheduler.
   */
  async sendBirthdayEmailForUser(userId: string): Promise<boolean> {
    const user = await User.findById(userId)
      .select('firstName lastName fullName email organizationId dateOfBirth isActive')
      .lean();

    if (!user?.isActive || !user.dateOfBirth || !user.organizationId) {
      return false;
    }

    if (!isBirthdayToday(new Date(user.dateOfBirth))) {
      return false;
    }

    const year = new Date().getFullYear();
    const result = await this.deliverBirthdayEmail(user as BirthdayUserRow, year);
    return result === 'sent';
  }

  /**
   * Send one birthday email per user per calendar year (deduped via BirthdayEmailLog).
   */
  async sendDailyBirthdayEmails(): Promise<{ sent: number; skipped: number; failed: number }> {
    const year = new Date().getFullYear();

    const users = await User.find({
      ...birthdayTodayFilter(),
      organizationId: { $exists: true, $ne: null },
    })
      .select('firstName lastName fullName email organizationId dateOfBirth')
      .lean();

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const user of users) {
      const result = await this.deliverBirthdayEmail(user as BirthdayUserRow, year);
      if (result === 'sent') sent += 1;
      else if (result === 'skipped') skipped += 1;
      else failed += 1;
    }

    logger.info('Daily birthday emails finished', { sent, skipped, failed, candidates: users.length });
    return { sent, skipped, failed };
  }
}

export const birthdayNotificationService = new BirthdayNotificationService();
