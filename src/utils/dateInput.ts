import { startOfDay } from 'date-fns';

/** Parse API date query values as a local calendar day (avoids UTC `YYYY-MM-DD` shift). */
export function parseLocalDateInput(value: string | Date): Date {
  if (value instanceof Date) {
    return startOfDay(value);
  }

  const plain = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(plain);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    return startOfDay(new Date(year, month, day));
  }

  return startOfDay(new Date(plain));
}
