/** Month (1–12) and day (1–31) for the server-local calendar date. */
export function getTodayMonthDay(reference = new Date()): { month: number; day: number; dayKey: string } {
  const month = reference.getMonth() + 1;
  const day = reference.getDate();
  const dayKey = reference.toISOString().slice(0, 10);
  return { month, day, dayKey };
}

/** MongoDB filter: users whose dateOfBirth falls on today's month/day. */
export function birthdayTodayFilter(reference = new Date()) {
  const { month, day } = getTodayMonthDay(reference);
  return {
    isActive: true,
    dateOfBirth: { $exists: true, $ne: null },
    $expr: {
      $and: [
        { $eq: [{ $month: '$dateOfBirth' }, month] },
        { $eq: [{ $dayOfMonth: '$dateOfBirth' }, day] },
      ],
    },
  };
}

export function formatUserDisplayName(user: {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}): string {
  const fromParts = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return user.fullName?.trim() || fromParts || user.email || 'A colleague';
}

/** True when an ISO date key (YYYY-MM-DD) falls on today's calendar day (server local). */
export function dateKeyIsToday(dateKey: string, reference = new Date()): boolean {
  const normalized = dateKey.length >= 10 ? dateKey.slice(0, 10) : dateKey;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return false;
  }
  const [, month, day] = normalized.split('-').map(Number);
  const { month: todayMonth, day: todayDay } = getTodayMonthDay(reference);
  return month === todayMonth && day === todayDay;
}

/** True when the given date of birth falls on today's calendar day (server local time). */
export function isBirthdayToday(dateOfBirth: Date, reference = new Date()): boolean {
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) {
    return false;
  }
  return dob.getMonth() === reference.getMonth() && dob.getDate() === reference.getDate();
}
