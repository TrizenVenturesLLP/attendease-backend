import { birthdayNotificationService } from '../services/birthdayNotificationService';
import { logger } from '../utils/logger';

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastRunDayKey: string | null = null;

function getRunHour(): number {
  const parsed = parseInt(process.env.BIRTHDAY_EMAIL_HOUR || '8', 10);
  if (Number.isNaN(parsed)) {
    return 8;
  }
  return Math.min(23, Math.max(0, parsed));
}

async function runIfDue(force = false): Promise<void> {
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const hour = getRunHour();

  if (!force && (now.getHours() !== hour || lastRunDayKey === dayKey)) {
    return;
  }

  lastRunDayKey = dayKey;
  await birthdayNotificationService.sendDailyBirthdayEmails();
}

/**
 * Checks every minute whether it is time to send daily birthday emails.
 * Default run hour: 08:00 server local time (override with BIRTHDAY_EMAIL_HOUR).
 */
export function startBirthdayEmailScheduler(): void {
  if (process.env.BIRTHDAY_EMAIL_SCHEDULER === 'false') {
    logger.info('Birthday email scheduler disabled (BIRTHDAY_EMAIL_SCHEDULER=false)');
    return;
  }

  const hour = getRunHour();
  logger.info('Birthday email scheduler started', { runHour: hour });

  if (process.env.BIRTHDAY_EMAIL_RUN_ON_STARTUP === 'true') {
    void runIfDue(true).catch((error) => {
      logger.error('Startup birthday email run failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  intervalHandle = setInterval(() => {
    void runIfDue().catch((error) => {
      logger.error('Scheduled birthday email run failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 60_000);
}

export function stopBirthdayEmailScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
