export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function computeExpectedHoursFromTimes(
  startTime?: string,
  endTime?: string,
  isNightShift = false
): number | undefined {
  if (!startTime || !endTime) {
    return undefined;
  }
  const start = parseTimeToMinutes(startTime);
  let end = parseTimeToMinutes(endTime);
  if (end <= start) {
    if (!isNightShift) {
      return undefined;
    }
    end += 24 * 60;
  }
  const rawHours = (end - start) / 60;
  return Math.round(rawHours * 100) / 100;
}

export function validateShiftTimes(
  startTime: string,
  endTime: string,
  isNightShift: boolean
): void {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (!isNightShift && end <= start) {
    throw new Error('endTime must be after startTime for day shifts');
  }
  if (isNightShift && end > start) {
    throw new Error('Night shifts must have endTime earlier than startTime (e.g. 22:00 to 06:00)');
  }
}
