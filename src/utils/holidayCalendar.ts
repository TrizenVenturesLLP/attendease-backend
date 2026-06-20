import { startOfDay } from 'date-fns';
import { HolidayType, IHoliday } from '../models/Holiday';

export type CalendarHolidayRecord = {
  _id: string;
  name: string;
  date: Date;
  type: HolidayType;
  isRecurring: boolean;
  description?: string;
};

/** Expand stored holidays (including recurring) into dated records for calendar display. */
export function expandHolidayRecordsInRange(
  holidays: Array<
    Pick<IHoliday, '_id' | 'name' | 'date' | 'type' | 'isRecurring' | 'description'>
  >,
  rangeStart: Date,
  rangeEnd: Date
): CalendarHolidayRecord[] {
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);
  const results: CalendarHolidayRecord[] = [];

  for (const holiday of holidays) {
    if (!holiday.isRecurring) {
      const holidayDate = startOfDay(new Date(holiday.date));
      if (holidayDate >= start && holidayDate <= end) {
        results.push({
          _id: String(holiday._id),
          name: holiday.name,
          date: holidayDate,
          type: holiday.type,
          isRecurring: false,
          description: holiday.description,
        });
      }
      continue;
    }

    const template = new Date(holiday.date);
    const month = template.getMonth();
    const day = template.getDate();

    for (let year = start.getFullYear(); year <= end.getFullYear(); year++) {
      const occurrence = startOfDay(new Date(year, month, day));
      if (occurrence >= start && occurrence <= end) {
        results.push({
          _id: `${String(holiday._id)}-${year}-${month + 1}-${day}`,
          name: holiday.name,
          date: occurrence,
          type: holiday.type,
          isRecurring: true,
          description: holiday.description,
        });
      }
    }
  }

  return results.sort((a, b) => a.date.getTime() - b.date.getTime());
}
