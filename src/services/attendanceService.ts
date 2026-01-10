import Attendance, { AttendanceStatus } from '../models/Attendance';
import { startOfDay, endOfDay } from 'date-fns';
import { minioStorage } from '../utils/storage/MinIOStorage';

export class AttendanceService {
  /**
   * Mark check-in for a user
   */
  async checkIn(userId: string, organizationId: string, photoData?: string): Promise<any> {
    const today = startOfDay(new Date());

    // Check if already checked in today
    const existingAttendance = await Attendance.findOne({
      userId,
      organizationId,
      date: today,
    });

    if (existingAttendance) {
      throw new Error('Already checked in today');
    }

    const now = new Date();
    const workStartTime = new Date(today);
    workStartTime.setHours(9, 0, 0); // 9:00 AM

    // Determine status based on check-in time
    const status = now > workStartTime ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

    // Upload photo to MinIO if provided
    let photoUrl: string | undefined;
    if (photoData) {
      try {
        // Convert base64 to buffer
        const base64Data = photoData.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        // Create folder structure: attendance-photos/YYYY/MM/DD
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const folder = `attendance-photos/${year}/${month}/${day}`;
        
        // Upload to MinIO
        const fileName = `${userId}_checkin_${now.getTime()}.jpg`;
        const result = await minioStorage.uploadFile(
          imageBuffer,
          fileName,
          'image/jpeg',
          folder,
          { userId, type: 'checkin', date: today.toISOString() }
        );
        
        photoUrl = result.url;
      } catch (uploadError: any) {
        console.error('Failed to upload photo:', uploadError.message);
        // Don't fail check-in if photo upload fails
        photoUrl = undefined;
      }
    }

    const attendance = await Attendance.create({
      userId,
      organizationId,
      date: today,
      checkIn: now,
      status,
      photoUrl,
    });

    return attendance;
  }

  /**
   * Mark check-out for a user
   */
  async checkOut(userId: string, organizationId: string): Promise<any> {
    const today = startOfDay(new Date());

    const attendance = await Attendance.findOne({
      userId,
      organizationId,
      date: today,
    });

    if (!attendance) {
      throw new Error('No check-in found for today');
    }

    if (attendance.checkOut) {
      throw new Error('Already checked out today');
    }

    attendance.checkOut = new Date();
    await attendance.save(); // Pre-save hook will calculate working hours

    return attendance;
  }

  /**
   * Get today's attendance status for a user
   */
  async getTodayStatus(userId: string, organizationId: string): Promise<any> {
    const today = startOfDay(new Date());

    const attendance = await Attendance.findOne({
      userId,
      organizationId,
      date: today,
    });

    return attendance;
  }

  /**
   * Get attendance history for a user
   */
  async getUserAttendance(
    userId: string,
    organizationId: string,
    startDate?: Date,
    endDate?: Date,
    page: number = 1,
    limit: number = 30
  ): Promise<any> {
    const query: any = { userId, organizationId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startOfDay(startDate);
      if (endDate) query.date.$lte = endOfDay(endDate);
    }

    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      Attendance.find(query)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Attendance.countDocuments(query),
    ]);

    return {
      records,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get attendance statistics for a user
   */
  async getUserStats(userId: string, organizationId: string, month?: number, year?: number): Promise<any> {
    const now = new Date();
    // Month is 1-indexed from API (1 = January), convert to 0-indexed for Date constructor
    const targetMonth = month ? month - 1 : now.getMonth();
    const targetYear = year ?? now.getFullYear();

    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0);

    const records = await Attendance.find({
      userId,
      organizationId,
      date: { $gte: startDate, $lte: endDate },
    });

    const stats = {
      totalDays: records.length,
      presentDays: records.filter((r) => r.status === AttendanceStatus.PRESENT).length,
      lateDays: records.filter((r) => r.status === AttendanceStatus.LATE).length,
      absentDays: records.filter((r) => r.status === AttendanceStatus.ABSENT).length,
      halfDays: records.filter((r) => r.status === AttendanceStatus.HALF_DAY).length,
      leaveDays: records.filter((r) => r.status === AttendanceStatus.ON_LEAVE).length,
      totalWorkingHours: records.reduce((sum, r) => sum + (r.workingHours || 0), 0),
      averageWorkingHours:
        records.filter((r) => r.workingHours).length > 0
          ? records.reduce((sum, r) => sum + (r.workingHours || 0), 0) /
            records.filter((r) => r.workingHours).length
          : 0,
    };

    return stats;
  }

  /**
   * Get all attendance records (for admin/HR)
   */
  async getAllAttendance(
    organizationId: string,
    filters: {
      date?: Date;
      startDate?: Date;
      endDate?: Date;
      status?: AttendanceStatus;
      department?: string;
    },
    page: number = 1,
    limit: number = 50
  ): Promise<any> {
    const query: any = { organizationId };

    if (filters.date) {
      query.date = {
        $gte: startOfDay(filters.date),
        $lte: endOfDay(filters.date),
      };
    } else if (filters.startDate || filters.endDate) {
      query.date = {};
      if (filters.startDate) query.date.$gte = startOfDay(filters.startDate);
      if (filters.endDate) query.date.$lte = endOfDay(filters.endDate);
    }

    if (filters.status) {
      query.status = filters.status;
    }

    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      Attendance.find(query)
        .populate('userId', 'firstName lastName email employeeId department')
        .sort({ date: -1, checkIn: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Attendance.countDocuments(query),
    ]);

    return {
      records,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }
}

export const attendanceService = new AttendanceService();
