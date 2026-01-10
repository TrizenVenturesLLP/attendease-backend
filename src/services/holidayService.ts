import Holiday, { IHoliday, HolidayType } from '../models/Holiday';
import { startOfDay, endOfDay } from 'date-fns';

export class HolidayService {
  /**
   * Create a new holiday
   */
  async createHoliday(
    name: string,
    date: Date,
    type: HolidayType,
    createdBy: string,
    organizationId: string,
    description?: string,
    isRecurring: boolean = false
  ): Promise<IHoliday> {
    const holiday = await Holiday.create({
      name,
      date: startOfDay(date),
      type,
      description,
      isRecurring,
      createdBy,
      organizationId,
    });

    return holiday;
  }

  /**
   * Get all holidays with optional filters
   */
  async getAllHolidays(organizationId: string, filters?: {
    year?: number;
    type?: HolidayType;
    startDate?: Date;
    endDate?: Date;
  }): Promise<IHoliday[]> {
    const query: any = { organizationId };

    if (filters?.year) {
      const startDate = new Date(filters.year, 0, 1);
      const endDate = new Date(filters.year, 11, 31);
      query.date = { $gte: startDate, $lte: endDate };
    }

    if (filters?.type) {
      query.type = filters.type;
    }

    if (filters?.startDate || filters?.endDate) {
      query.date = {};
      if (filters.startDate) query.date.$gte = startOfDay(filters.startDate);
      if (filters.endDate) query.date.$lte = endOfDay(filters.endDate);
    }

    const holidays = await Holiday.find(query)
      .populate('createdBy', 'firstName lastName')
      .sort({ date: 1 })
      .lean();

    return holidays;
  }

  /**
   * Get holiday by ID
   */
  async getHolidayById(id: string, organizationId: string): Promise<IHoliday | null> {
    const holiday = await Holiday.findOne({ _id: id, organizationId })
      .populate('createdBy', 'firstName lastName')
      .lean();
    return holiday;
  }

  /**
   * Update holiday
   */
  async updateHoliday(
    id: string,
    organizationId: string,
    updates: {
      name?: string;
      date?: Date;
      type?: HolidayType;
      description?: string;
      isRecurring?: boolean;
    }
  ): Promise<IHoliday | null> {
    const updateData: any = { ...updates };
    
    if (updates.date) {
      updateData.date = startOfDay(updates.date);
    }

    const holiday = await Holiday.findOneAndUpdate(
      { _id: id, organizationId },
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'firstName lastName');

    return holiday;
  }

  /**
   * Delete holiday
   */
  async deleteHoliday(id: string, organizationId: string): Promise<boolean> {
    const result = await Holiday.findOneAndDelete({ _id: id, organizationId });
    return !!result;
  }

  /**
   * Get holidays by date range (for calendar)
   */
  async getHolidaysByDateRange(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<IHoliday[]> {
    const holidays = await Holiday.find({
      organizationId,
      date: {
        $gte: startOfDay(startDate),
        $lte: endOfDay(endDate),
      },
    })
      .sort({ date: 1 })
      .lean();

    return holidays;
  }

  /**
   * Check if a specific date is a holiday
   */
  async isHoliday(date: Date, organizationId: string): Promise<IHoliday | null> {
    const holiday = await Holiday.findOne({
      organizationId,
      date: startOfDay(date),
    }).lean();

    return holiday;
  }

  /**
   * Get upcoming holidays
   */
  async getUpcomingHolidays(organizationId: string, limit: number = 5): Promise<IHoliday[]> {
    const today = startOfDay(new Date());
    
    const holidays = await Holiday.find({
      organizationId,
      date: { $gte: today },
    })
      .sort({ date: 1 })
      .limit(limit)
      .lean();

    return holidays;
  }

  /**
   * Bulk create holidays
   */
  async bulkCreateHolidays(
    holidays: Array<{
      name: string;
      date: Date;
      type: HolidayType;
      description?: string;
      isRecurring?: boolean;
    }>,
    createdBy: string,
    organizationId: string
  ): Promise<{ created: IHoliday[]; errors: Array<{ row: number; error: string }> }> {
    const created: IHoliday[] = [];
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < holidays.length; i++) {
      const holidayData = holidays[i];
      try {
        // Check for duplicate date
        const existing = await Holiday.findOne({
          organizationId,
          date: startOfDay(holidayData.date),
        });

        if (existing) {
          errors.push({
            row: i + 1,
            error: `Holiday already exists for date ${holidayData.date.toISOString().split('T')[0]}`,
          });
          continue;
        }

        const holiday = await Holiday.create({
          name: holidayData.name,
          date: startOfDay(holidayData.date),
          type: holidayData.type,
          description: holidayData.description,
          isRecurring: holidayData.isRecurring || false,
          createdBy,
          organizationId,
        });

        created.push(holiday);
      } catch (error: any) {
        errors.push({
          row: i + 1,
          error: error.message || 'Failed to create holiday',
        });
      }
    }

    return { created, errors };
  }
}

export const holidayService = new HolidayService();
