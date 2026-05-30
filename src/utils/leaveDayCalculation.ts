import { eachDayOfInterval, isWeekend, startOfDay } from 'date-fns';

/**
 * Count weekday leave days overlapping a date range (excludes Sat/Sun).
 * Used for payroll month intersection and leave requests.
 */
export function countWorkingDaysInRange(startDate: Date, endDate: Date): number {
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);
  if (end < start) {
    return 0;
  }
  const days = eachDayOfInterval({ start, end });
  return days.filter((day) => !isWeekend(day)).length;
}

/**
 * Count weekday leave days that fall within [periodStart, periodEnd].
 */
export function countWorkingDaysInPeriod(
  leaveStart: Date,
  leaveEnd: Date,
  periodStart: Date,
  periodEnd: Date
): number {
  const rangeStart = startOfDay(leaveStart > periodStart ? leaveStart : periodStart);
  const rangeEnd = startOfDay(leaveEnd < periodEnd ? leaveEnd : periodEnd);
  return countWorkingDaysInRange(rangeStart, rangeEnd);
}
