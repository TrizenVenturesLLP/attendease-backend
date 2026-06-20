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
