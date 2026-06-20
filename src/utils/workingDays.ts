import { eachDayOfInterval, startOfDay } from 'date-fns';
import Holiday, { HolidayType, IHoliday } from '../models/Holiday';
import Organization, { WeeklyOffPattern } from '../models/Organization';

const DEFAULT_WEEKLY_OFF_PATTERN = WeeklyOffPattern.MON_FRI;

/** National and company holidays are non-working; optional holidays are not auto-offs. */
const NON_WORKING_HOLIDAY_TYPES = new Set<HolidayType>([
  HolidayType.NATIONAL,
  HolidayType.COMPANY,
]);

export async function getOrganizationWeeklyOffPattern(
  organizationId: string
): Promise<WeeklyOffPattern> {
  const org = await Organization.findById(organizationId)
    .select('settings.workingDays')
    .lean();

  return org?.settings?.workingDays?.weeklyOffPattern ?? DEFAULT_WEEKLY_OFF_PATTERN;
}

export function isSecondOrFourthSaturday(date: Date): boolean {
  if (date.getDay() !== 6) {
    return false;
  }
  const weekOfMonth = Math.ceil(date.getDate() / 7);
  return weekOfMonth === 2 || weekOfMonth === 4;
}

export function isWeeklyOff(date: Date, pattern: WeeklyOffPattern): boolean {
  const day = date.getDay();

  switch (pattern) {
    case WeeklyOffPattern.MON_SAT:
      return day === 0;
    case WeeklyOffPattern.SECOND_FOURTH_SAT:
      if (day === 0) return true;
      if (day === 6) return isSecondOrFourthSaturday(date);
      return false;
    case WeeklyOffPattern.MON_FRI:
    default:
      return day === 0 || day === 6;
  }
}

export function toDateKey(date: Date): string {
  return startOfDay(date).toDateString();
}

/**
 * Expand stored holidays (including recurring) into calendar dates within [start, end].
 */
export function expandHolidaysInRange(
  holidays: Pick<IHoliday, 'date' | 'type' | 'isRecurring'>[],
  rangeStart: Date,
  rangeEnd: Date
): Date[] {
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);
  const dates: Date[] = [];

  for (const holiday of holidays) {
    if (!NON_WORKING_HOLIDAY_TYPES.has(holiday.type)) {
      continue;
    }

    if (!holiday.isRecurring) {
      const holidayDate = startOfDay(new Date(holiday.date));
      if (holidayDate >= start && holidayDate <= end) {
        dates.push(holidayDate);
      }
      continue;
    }

    const template = new Date(holiday.date);
    const month = template.getMonth();
    const day = template.getDate();

    for (let year = start.getFullYear(); year <= end.getFullYear(); year++) {
      const occurrence = startOfDay(new Date(year, month, day));
      if (occurrence >= start && occurrence <= end) {
        dates.push(occurrence);
      }
    }
  }

  return dates;
}

export async function getNonWorkingHolidayDateKeys(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<Set<string>> {
  const holidays = await Holiday.find({ organizationId }).select('date type isRecurring').lean();
  const expanded = expandHolidaysInRange(holidays, rangeStart, rangeEnd);
  return new Set(expanded.map(toDateKey));
}

export function isOrgWorkingDay(
  date: Date,
  weeklyOffPattern: WeeklyOffPattern,
  holidayDateKeys: Set<string>
): boolean {
  const day = startOfDay(date);
  if (isWeeklyOff(day, weeklyOffPattern)) {
    return false;
  }
  if (holidayDateKeys.has(toDateKey(day))) {
    return false;
  }
  return true;
}

export function countOrgWorkingDaysInRange(
  startDate: Date,
  endDate: Date,
  weeklyOffPattern: WeeklyOffPattern,
  holidayDateKeys: Set<string>
): number {
  const start = startOfDay(startDate);
  const end = startOfDay(endDate);
  if (end < start) {
    return 0;
  }

  const days = eachDayOfInterval({ start, end });
  return days.filter((day) => isOrgWorkingDay(day, weeklyOffPattern, holidayDateKeys)).length;
}

export async function countOrganizationWorkingDaysInRange(
  organizationId: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const pattern = await getOrganizationWeeklyOffPattern(organizationId);
  const holidayKeys = await getNonWorkingHolidayDateKeys(organizationId, startDate, endDate);
  return countOrgWorkingDaysInRange(startDate, endDate, pattern, holidayKeys);
}

export async function countOrganizationWorkingDaysInPeriod(
  organizationId: string,
  leaveStart: Date,
  leaveEnd: Date,
  periodStart: Date,
  periodEnd: Date
): Promise<number> {
  const rangeStart = startOfDay(leaveStart > periodStart ? leaveStart : periodStart);
  const rangeEnd = startOfDay(leaveEnd < periodEnd ? leaveEnd : periodEnd);
  return countOrganizationWorkingDaysInRange(organizationId, rangeStart, rangeEnd);
}

export async function countOrganizationWorkingDaysInMonth(
  organizationId: string,
  month: number,
  year: number
): Promise<number> {
  const start = startOfDay(new Date(year, month - 1, 1));
  const end = startOfDay(new Date(year, month, 0));
  return countOrganizationWorkingDaysInRange(organizationId, start, end);
}
