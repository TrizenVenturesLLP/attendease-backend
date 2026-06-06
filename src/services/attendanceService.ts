import Attendance, { AttendanceStatus } from '../models/Attendance';
import AttendancePolicy from '../models/AttendancePolicy';
import Leave, { LeaveStatus } from '../models/Leave';
import User, { UserRole } from '../models/User';
import { startOfDay, endOfDay, format } from 'date-fns';
import { checkInMinioStorage } from '../utils/storage/MinIOStorage';
import { parseTimeOnDate } from '../utils/organizationSettings';
import { getNonWorkingHolidayDateKeys } from '../utils/workingDays';
import {
  buildImpliedAbsentRecords,
  computeUserAttendanceStats,
  isPolicyWorkingDay,
} from '../utils/attendanceAbsence';
import { attendanceResolver, mapResolvedToAttendanceStatus } from './attendanceResolver';
import { attendancePolicyService } from './attendancePolicyService';

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
  const withKeys = records.map((record) => {
    if (record.date && !record.dateKey) {
      return {
        ...record,
        dateKey: format(startOfDay(new Date(record.date as string | Date)), 'yyyy-MM-dd'),
      };
    }
    return record;
  });
  return Promise.all(withKeys.map(r => enrichAttendancePhoto(r).then(x => x ?? r)));
}

export class AttendanceService {
  /**
   * Mark check-in for a user
   */
  async checkIn(userId: string, organizationId: string, photoData?: string): Promise<any> {
    const today = startOfDay(new Date());

    const existingAttendance = await Attendance.findOne({
      userId,
      organizationId,
      date: today,
    });

    if (existingAttendance) {
      throw new Error('Already checked in today');
    }

    const resolved = await attendanceResolver.resolve(userId, today);
    if (!resolved.isWorkingDay) {
      if (resolved.isHoliday) {
        throw new Error('Today is a holiday — check-in is not required');
      }
      if (resolved.isWeeklyOff) {
        throw new Error('Today is a weekly off — check-in is not required');
      }
      if (resolved.hasLeave) {
        throw new Error('You are on approved leave today');
      }
    }

    const now = new Date();
    const workStartTime = resolved.startTime
      ? parseTimeOnDate(today, resolved.startTime)
      : parseTimeOnDate(today, '09:00');
    const graceMinutes = resolved.graceMinutes ?? 15;
    const graceEnd = new Date(workStartTime.getTime() + graceMinutes * 60 * 1000);

    const status = now > graceEnd ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

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

    const resolved = await attendanceResolver.resolve(userId, today);
    attendance.status = mapResolvedToAttendanceStatus(resolved.attendanceStatus);
    await attendance.save();

    return attendance;
  }

  /**
   * Get today's attendance status for a user
   */
  async getTodayStatus(userId: string, organizationId: string): Promise<any> {
    const today = startOfDay(new Date());

    const [attendance, resolved] = await Promise.all([
      Attendance.findOne({ userId, organizationId, date: today }),
      attendanceResolver.resolve(userId, today),
    ]);

    const enriched = attendance
      ? await enrichAttendancePhoto(attendance.toObject() as unknown as Record<string, unknown>)
      : null;

    return {
      record: enriched,
      policy: resolved,
    };
  }

  async getResolvedAttendance(
    userId: string,
    date?: Date
  ): Promise<any> {
    return attendanceResolver.resolve(userId, date ?? startOfDay(new Date()));
  }

  async getMyPolicySummary(userId: string): Promise<any> {
    const [resolved, user] = await Promise.all([
      attendanceResolver.resolveToday(userId),
      User.findById(userId).select('attendancePolicyId organizationId').lean(),
    ]);

    if (!user?.organizationId) {
      return resolved;
    }

    const organizationId = user.organizationId.toString();
    const assignedPolicy = user.attendancePolicyId
      ? await AttendancePolicy.findOne({
          _id: user.attendancePolicyId,
          organizationId,
          status: 'ACTIVE',
        }).lean()
      : null;

    const policy =
      assignedPolicy ?? (await attendancePolicyService.getDefaultPolicy(organizationId));

    return {
      ...resolved,
      weekRules: policy?.weekRules ?? [],
      defaultFullDayRule: policy?.defaultFullDayRule,
    };
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
    const user = await User.findById(userId).select('createdAt joiningDate').lean();
    if (!user) {
      throw new Error('User not found');
    }

    const joinDate = user.joiningDate ?? user.createdAt;

    const query: any = { userId, organizationId };
    const rangeStart = startDate ? startOfDay(startDate) : undefined;
    const rangeEnd = endDate ? startOfDay(endDate) : undefined;

    if (rangeStart || rangeEnd) {
      query.date = {};
      if (rangeStart) query.date.$gte = rangeStart;
      if (rangeEnd) query.date.$lte = endOfDay(rangeEnd);
    }

    const dbQuery = { ...query };
    if (status && status !== AttendanceStatus.ABSENT) {
      dbQuery.status = status;
    } else if (status === AttendanceStatus.ABSENT) {
      // Fetch all statuses in range — implied absents merged below
      delete dbQuery.status;
    }

    const dbRecords = await Attendance.find(dbQuery).sort({ date: -1 }).lean();

    type AttendanceRow = Record<string, unknown>;
    let merged: AttendanceRow[] = dbRecords as unknown as AttendanceRow[];

    const shouldIncludeImplied =
      !status || status === AttendanceStatus.ABSENT;

    if (shouldIncludeImplied && rangeStart && rangeEnd) {
      const implied = await buildImpliedAbsentRecords(
        userId,
        organizationId,
        rangeStart,
        rangeEnd,
        joinDate,
        dbRecords
      );
      merged = [...merged, ...(implied as unknown as AttendanceRow[])];
      if (status === AttendanceStatus.ABSENT) {
        merged = merged.filter((r) => r.status === AttendanceStatus.ABSENT);
      }
    } else if (status) {
      merged = dbRecords.filter((r) => r.status === status) as unknown as AttendanceRow[];
    }

    merged.sort(
      (a, b) => new Date(b.date as Date).getTime() - new Date(a.date as Date).getTime()
    );

    const total = merged.length;
    const skip = (page - 1) * limit;
    const paged = merged.slice(skip, skip + limit);

    return {
      records: await enrichAttendancePhotos(paged),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Get attendance statistics for a user
   */
  async getUserStats(userId: string, organizationId: string, month?: number, year?: number): Promise<any> {
    const user = await User.findById(userId).select('createdAt joiningDate').lean();
    if (!user) {
      throw new Error('User not found');
    }

    const joinDate = user.joiningDate ?? user.createdAt;

    const now = new Date();
    const targetMonth = month ? month - 1 : now.getMonth();
    const targetYear = year ?? now.getFullYear();

    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0);

    return computeUserAttendanceStats(
      userId,
      organizationId,
      startDate,
      endDate,
      joinDate
    );
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
      userId?: string;
      attendancePolicyId?: string;
      shiftId?: string;
      dayType?: string;
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

    // Department / policy / shift filter via User lookup
    const userFilter: Record<string, unknown> = { organizationId };
    if (filters.department) userFilter.department = filters.department;
    if (filters.attendancePolicyId) userFilter.attendancePolicyId = filters.attendancePolicyId;
    if (filters.shiftId) userFilter.shiftId = filters.shiftId;

    let matchedUserIds: string[] | null = null;
    if (filters.department || filters.attendancePolicyId || filters.shiftId) {
      const matchedUsers = await User.find(userFilter).select('_id');
      matchedUserIds = matchedUsers.map((u) => u._id.toString());
    }

    if (filters.userId) {
      if (matchedUserIds) {
        query.userId = matchedUserIds.includes(filters.userId) ? filters.userId : { $in: [] };
      } else {
        query.userId = filters.userId;
      }
    } else if (matchedUserIds) {
      query.userId = { $in: matchedUserIds };
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

    const holidayDateKeys = await getNonWorkingHolidayDateKeys(organizationId, date, date);

    const users = await User.find({
      organizationId,
      isActive: true,
      role: {
        $in: [UserRole.EMPLOYEE, UserRole.SUPERVISOR, UserRole.HR, UserRole.ADMIN],
      },
    }).select('_id createdAt joiningDate attendancePolicyId');

    let marked = 0;
    let skipped = 0;
    let anyWorkingDay = false;

    for (const user of users) {
      const userId = user._id.toString();
      const joined = startOfDay(new Date(user.joiningDate ?? user.createdAt));
      if (date < joined) {
        skipped += 1;
        continue;
      }

      const workingDay = await isPolicyWorkingDay(userId, organizationId, date, holidayDateKeys);
      if (!workingDay) {
        skipped += 1;
        continue;
      }
      anyWorkingDay = true;

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

    if (!anyWorkingDay && marked === 0) {
      return { marked: 0, skipped, notWorkingDay: true };
    }

    return { marked, skipped, notWorkingDay: false };
  }
}

export const attendanceService = new AttendanceService();
