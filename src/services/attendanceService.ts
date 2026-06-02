import Attendance, { AttendanceStatus } from '../models/Attendance';
import Leave, { LeaveStatus } from '../models/Leave';
import User, { UserRole } from '../models/User';
import { startOfDay, endOfDay } from 'date-fns';
import { checkInMinioStorage } from '../utils/storage/MinIOStorage';
import { getOrganizationWorkingHours, parseTimeOnDate } from '../utils/organizationSettings';
import {
  getNonWorkingHolidayDateKeys,
  getOrganizationWeeklyOffPattern,
  isOrgWorkingDay,
} from '../utils/workingDays';

const CHECKIN_PHOTO_TTL_SEC = 86400;

async function enrichAttendancePhoto<T extends Record<string, unknown>>(record: T | null): Promise<T | null> {
  if (!record) return record;

  const key = record.photoKey as string | undefined;
  if (!key) return record;

  try {
    const photoUrl = await checkInMinioStorage.getPresignedUrl(key, CHECKIN_PHOTO_TTL_SEC);
    return { ...record, photoUrl, hasCheckInPhoto: true };
  } catch (error) {
    console.warn('Could not generate check-in photo URL:', (error as Error).message);
    return record;
  }
}

async function enrichAttendancePhotos<T extends Record<string, unknown>>(records: T[]): Promise<T[]> {
  return Promise.all(records.map(r => enrichAttendancePhoto(r).then(x => x ?? r)));
}

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
    const workingHours = await getOrganizationWorkingHours(organizationId);
    const workStartTime = parseTimeOnDate(today, workingHours.startTime);

    // Determine status based on check-in time
    const status = now > workStartTime ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

    // Upload photo to MinIO if provided
    let photoKey: string | undefined;
    if (photoData) {
      try {
        // Convert base64 to buffer
        const base64Data = photoData.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const maxSize = 5 * 1024 * 1024;
        if (imageBuffer.length > maxSize) {
          throw new Error('Check-in photo must be under 5MB');
        }

        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const folder = `org-${organizationId}/${year}/${month}/${day}`;

        const fileName = `${userId}_checkin_${now.getTime()}.jpg`;
        const result = await checkInMinioStorage.uploadFile(
          imageBuffer,
          fileName,
          'image/jpeg',
          folder,
          { userId, type: 'checkin', date: today.toISOString() }
        );

        photoKey = result.key;
      } catch (uploadError: any) {
        console.error('Failed to upload check-in photo:', uploadError.message);
        photoKey = undefined;
      }
    }

    const attendance = await Attendance.create({
      userId,
      organizationId,
      date: today,
      checkIn: now,
      status,
      photoKey,
    });

    return enrichAttendancePhoto(attendance.toObject() as unknown as Record<string, unknown>);
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

    return enrichAttendancePhoto(
      attendance ? (attendance.toObject() as unknown as Record<string, unknown>) : null,
    );
  }

  /**
   * Get attendance history for a user
   */
  async getUserAttendance(
    userId: string,
    organizationId: string,
    startDate?: Date,
    endDate?: Date,
    status?: AttendanceStatus,
    page: number = 1,
    limit: number = 30
  ): Promise<any> {
    const query: any = { userId, organizationId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startOfDay(startDate);
      if (endDate) query.date.$lte = endOfDay(endDate);
    }

    if (status) {
      query.status = status;
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
      records: await enrichAttendancePhotos(records as unknown as Record<string, unknown>[]),
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
        records.length > 0
          ? records.reduce((sum, r) => sum + (r.workingHours || 0), 0) / records.length
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

    // Department filter: Attendance doesn't store department directly,
    // so resolve matching user IDs from User collection first.
    if (filters.department) {
      const departmentUsers = await User.find({
        organizationId,
        department: filters.department,
      }).select('_id');

      query.userId = { $in: departmentUsers.map((u) => u._id) };
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
      records: await enrichAttendancePhotos(records as unknown as Record<string, unknown>[]),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Mark absent for active users on a working day with no punch, leave, or existing record.
   */
  async markAutoAbsent(
    organizationId: string,
    targetDate: Date
  ): Promise<{ marked: number; skipped: number; notWorkingDay: boolean }> {
    const date = startOfDay(targetDate);
    const today = startOfDay(new Date());

    if (date >= today) {
      throw new Error('Auto absent can only be run for past dates');
    }

    const weeklyOffPattern = await getOrganizationWeeklyOffPattern(organizationId);
    const holidayDateKeys = await getNonWorkingHolidayDateKeys(organizationId, date, date);

    if (!isOrgWorkingDay(date, weeklyOffPattern, holidayDateKeys)) {
      return { marked: 0, skipped: 0, notWorkingDay: true };
    }

    const users = await User.find({
      organizationId,
      isActive: true,
      role: {
        $in: [UserRole.EMPLOYEE, UserRole.SUPERVISOR, UserRole.HR, UserRole.ADMIN],
      },
    }).select('_id');

    let marked = 0;
    let skipped = 0;

    for (const user of users) {
      const userId = user._id.toString();
      const existing = await Attendance.findOne({ organizationId, userId, date });
      if (existing) {
        skipped += 1;
        continue;
      }

      const onApprovedLeave = await Leave.exists({
        organizationId,
        userId,
        status: LeaveStatus.APPROVED,
        startDate: { $lte: endOfDay(date) },
        endDate: { $gte: date },
      });
      if (onApprovedLeave) {
        skipped += 1;
        continue;
      }

      await Attendance.create({
        organizationId,
        userId,
        date,
        status: AttendanceStatus.ABSENT,
        isApproved: true,
      });
      marked += 1;
    }

    return { marked, skipped, notWorkingDay: false };
  }
}

export const attendanceService = new AttendanceService();
