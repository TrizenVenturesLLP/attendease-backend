export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function computeExpectedHoursFromTimes(
  startTime?: string,
  endTime?: string,
): number | undefined {
  if (!startTime || !endTime) {
    return undefined;
  }
  const start = parseTimeToMinutes(startTime);
  let end = parseTimeToMinutes(endTime);
  if (end <= start) {
    end += 24 * 60;
  }
  const rawHours = (end - start) / 60;
  return Math.round(rawHours * 100) / 100;
}

export function validateShiftTimes(
  startTime: string,
  endTime: string,
): void {
  if (!startTime || !endTime) {
    throw new Error('startTime and endTime are required');
  }
}
