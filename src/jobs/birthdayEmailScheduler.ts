import { birthdayNotificationService } from '../services/birthdayNotificationService';
import { logger } from '../utils/logger';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

let dailyIntervalHandle: ReturnType<typeof setInterval> | null = null;
let nextRunTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
let startupRunTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

function getRunHour(): number {
  const parsed = parseInt(process.env.BIRTHDAY_EMAIL_HOUR || '8', 10);
  if (Number.isNaN(parsed)) {
    return 8;
  }
  return Math.min(23, Math.max(0, parsed));
}

function msUntilNextRun(reference = new Date()): number {
  const hour = getRunHour();
  const next = new Date(reference);
  next.setHours(hour, 0, 0, 0);
  if (next <= reference) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - reference.getTime();
}

async function runDailyBirthdayEmails(): Promise<void> {
  await birthdayNotificationService.sendDailyBirthdayEmails();
}

function scheduleDailyRuns(): void {
  nextRunTimeoutHandle = setTimeout(() => {
    void runDailyBirthdayEmails().catch((error) => {
      logger.error('Daily birthday email run failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    dailyIntervalHandle = setInterval(() => {
      void runDailyBirthdayEmails().catch((error) => {
        logger.error('Daily birthday email run failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, MS_PER_DAY);
  }, msUntilNextRun());
}

/**
 * Sends birthday emails once per day at BIRTHDAY_EMAIL_HOUR (default 08:00 server time).
 * Users who complete their profile on their birthday after that time still receive
 * an immediate email from the profile-completion flow.
 */
export function startBirthdayEmailScheduler(): void {
  if (process.env.BIRTHDAY_EMAIL_SCHEDULER === 'false') {
    logger.info('Birthday email scheduler disabled (BIRTHDAY_EMAIL_SCHEDULER=false)');
    return;
  }

  const hour = getRunHour();
  const delayMs = msUntilNextRun();
  logger.info('Birthday email scheduler started', {
    runHour: hour,
    frequency: 'once per day',
    nextRunInMinutes: Math.round(delayMs / 60_000),
  });

  if (process.env.BIRTHDAY_EMAIL_RUN_ON_STARTUP === 'true') {
    startupRunTimeoutHandle = setTimeout(() => {
      void runDailyBirthdayEmails().catch((error) => {
        logger.error('Startup birthday email run failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 10_000);
  }

  scheduleDailyRuns();
}

export function stopBirthdayEmailScheduler(): void {
  if (startupRunTimeoutHandle) {
    clearTimeout(startupRunTimeoutHandle);
    startupRunTimeoutHandle = null;
  }
  if (nextRunTimeoutHandle) {
    clearTimeout(nextRunTimeoutHandle);
    nextRunTimeoutHandle = null;
  }
  if (dailyIntervalHandle) {
    clearInterval(dailyIntervalHandle);
    dailyIntervalHandle = null;
  }
}
