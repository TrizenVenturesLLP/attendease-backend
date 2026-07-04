import mongoose from 'mongoose';
import Attendance, { AttendanceStatus, LocationStatus } from '../models/Attendance';
import AttendancePolicy, { GeofenceEnforcementMode } from '../models/AttendancePolicy';
import AttendanceRegularization, {
  RegularizationRequestType,
  RegularizationStatus,
} from '../models/AttendanceRegularization';
import OfficeLocation from '../models/OfficeLocation';
import Leave, { LeaveStatus } from '../models/Leave';
import User, { UserRole } from '../models/User';
import { startOfDay, endOfDay, format } from 'date-fns';
import { checkInMinioStorage } from '../utils/storage/MinIOStorage';
import { parseTimeOnDate } from '../utils/organizationSettings';
import { getNonWorkingHolidayDateKeys } from '../utils/workingDays';
import { haversineDistance } from '../utils/geoUtils';
import { BadRequestError } from '../utils/AppError';
import {
  buildImpliedAbsentRecords,
  computeUserAttendanceStats,
  isPolicyWorkingDay,
} from '../utils/attendanceAbsence';
import { attendanceResolver, mapResolvedToAttendanceStatus } from './attendanceResolver';
import { shiftService } from './shiftService';
import { FieldTrackingService } from './fieldTrackingService';

const fieldTrackingService = new FieldTrackingService();

type GeoPoint = {
  latitude: number;
  longitude: number;
};

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

async function resolveAttendancePolicy(
  organizationId: string
): Promise<{ policy: any; nearestOffice: any; distance: number } | null> {
  const policy = await AttendancePolicy.findOne({
    organizationId,
    status: 'ACTIVE',
    isDefault: true,
  }).lean();

  return policy ? { policy, nearestOffice: null, distance: 0 } : null;
}

async function processGeofence(
  organizationId: string,
  geoPoint: GeoPoint | undefined
): Promise<{
  locationStatus: LocationStatus;
  officeLocationId?: mongoose.Types.ObjectId;
  distance?: number;
}> {
  const result = await resolveAttendancePolicy(organizationId);
  if (!result) {
    return { locationStatus: LocationStatus.NOT_APPLICABLE };
  }

  const { policy } = result;
  const geofence = policy.geofence;

  if (!geofence || !geofence.enabled) {
    return { locationStatus: LocationStatus.NOT_APPLICABLE };
  }

  if (!geoPoint) {
    if (geofence.enforcementMode === GeofenceEnforcementMode.BLOCK) {
      throw new BadRequestError('Location data is required for check-in');
    }
    return { locationStatus: LocationStatus.NOT_CAPTURED };
  }

  let targetLocations: any[];
  if (geofence.officeLocationIds && geofence.officeLocationIds.length > 0) {
    targetLocations = await OfficeLocation.find({
      _id: { $in: geofence.officeLocationIds },
      organizationId,
      isActive: true,
    }).lean();
  } else {
    targetLocations = await OfficeLocation.find({
      organizationId,
      isActive: true,
    }).sort({ name: 1 }).lean();
  }

  if (targetLocations.length === 0) {
    return { locationStatus: LocationStatus.NOT_APPLICABLE };
  }

  let nearest: any = targetLocations[0];
  let minDistance = haversineDistance(
    geoPoint.latitude,
    geoPoint.longitude,
    nearest.latitude,
    nearest.longitude
  );

  for (let i = 1; i < targetLocations.length; i++) {
    const loc = targetLocations[i];
    const d = haversineDistance(geoPoint.latitude, geoPoint.longitude, loc.latitude, loc.longitude);
    if (d < minDistance) {
      minDistance = d;
      nearest = loc;
    }
  }

  const withinRadius = minDistance <= nearest.radiusMeters;

  if (withinRadius) {
    return {
      locationStatus: LocationStatus.VERIFIED,
      officeLocationId: nearest._id,
      distance: Math.round(minDistance),
    };
  }

  if (geofence.enforcementMode === GeofenceEnforcementMode.BLOCK) {
    throw new BadRequestError(
      `You are outside the allowed office location (${Math.round(minDistance)}m from "${nearest.name}", max ${nearest.radiusMeters}m)`
    );
  }

  return {
    locationStatus: LocationStatus.OUT_OF_RANGE,
    officeLocationId: nearest._id,
    distance: Math.round(minDistance),
  };
}

export class AttendanceService {
  async checkIn(
    userId: string,
    organizationId: string,
    photoData?: string,
    latitude?: number,
    longitude?: number
  ): Promise<any> {
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

    const geoPoint: GeoPoint | undefined =
      latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined;

    const geofenceResult = await processGeofence(organizationId, geoPoint);

    const attendance = await Attendance.create({
      userId,
      organizationId,
      date: today,
      checkIn: now,
      status,
      photoKey,
      officeLocationId: geofenceResult.officeLocationId,
      checkInLat: geoPoint?.latitude,
      checkInLng: geoPoint?.longitude,
      checkInDistance: geofenceResult.distance,
      locationStatus: geofenceResult.locationStatus,
    });

    if (geofenceResult.locationStatus === LocationStatus.OUT_OF_RANGE) {
      try {
        await AttendanceRegularization.create({
          organizationId,
          userId,
          date: today,
          requestType: RegularizationRequestType.LOCATION_OUT_OF_RANGE,
          requestedStatus: AttendanceStatus.PRESENT,
          reason: `Check-in location is ${geofenceResult.distance}m from the nearest office location`,
          status: RegularizationStatus.PENDING,
          flaggedDistance: geofenceResult.distance,
          flaggedLat: geoPoint?.latitude,
          flaggedLng: geoPoint?.longitude,
          isSystemGenerated: true,
        });
      } catch (regError: any) {
        console.error('Failed to create regularization request:', regError.message);
      }
    }

    const enriched = await enrichAttendancePhoto(attendance.toObject() as unknown as Record<string, unknown>);

    // Auto-start field tracking session if enabled for this user
    let fieldTrackingStarted = false;
    if (geoPoint) {
      try {
        const trackingUser = await User.findById(userId).select('fieldTrackingEnabled').lean();
        if (trackingUser?.fieldTrackingEnabled) {
          await fieldTrackingService.startSession(
            userId,
            organizationId,
            (attendance._id as any).toString(),
            geoPoint.latitude,
            geoPoint.longitude
          );
          fieldTrackingStarted = true;
        }
      } catch (trackingError: any) {
        // Tracking failure must never block check-in
        console.error('Auto field tracking start failed (non-critical):', trackingError.message);
      }
    }

    return { ...((enriched ?? {}) as object), fieldTrackingStarted };
  }

  async checkOut(
    userId: string,
    organizationId: string,
    latitude?: number,
    longitude?: number
  ): Promise<any> {
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

    if (latitude !== undefined && longitude !== undefined) {
      attendance.checkOutLat = latitude;
      attendance.checkOutLng = longitude;

      if (attendance.officeLocationId) {
        const office = await OfficeLocation.findById(attendance.officeLocationId).lean();
        if (office) {
          const dist = haversineDistance(latitude, longitude, office.latitude, office.longitude);
          attendance.checkOutDistance = Math.round(dist);
        }
      }
    }

    await attendance.save();

    const resolved = await attendanceResolver.resolve(userId, today);
    attendance.status = mapResolvedToAttendanceStatus(resolved.attendanceStatus);
    await attendance.save();

    // Auto-stop field tracking session if one is active
    let fieldTrackingStopped = false;
    try {
      const trackingUser = await User.findById(userId).select('fieldTrackingEnabled').lean();
      if (trackingUser?.fieldTrackingEnabled) {
        await fieldTrackingService.stopSession(userId, organizationId);
        fieldTrackingStopped = true;
      }
    } catch (trackingError: any) {
      // Tracking failure must never block check-out
      console.error('Auto field tracking stop failed (non-critical):', trackingError.message);
    }

    return { ...attendance.toObject(), fieldTrackingStopped };
  }

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
      User.findById(userId).select('attendancePolicyId organizationId department').lean(),
    ]);

    if (!user?.organizationId) {
      return resolved;
    }

    const { resolveUserAttendancePolicy } = await import('../utils/resolveUserAttendancePolicy');
    const policy = await resolveUserAttendancePolicy(user);

    let shift: {
      shiftName: string;
      startTime: string;
      endTime: string;
      expectedHours: number;
    } | null = null;

    if (policy?.shiftId) {
      const shiftDoc = await shiftService.getShiftById(
        policy.shiftId.toString(),
        user.organizationId.toString()
      );
      if (shiftDoc) {
        shift = {
          shiftName: shiftDoc.shiftName,
          startTime: shiftDoc.startTime,
          endTime: shiftDoc.endTime,
          expectedHours: shiftDoc.expectedHours,
        };
      }
    }

    return {
      ...resolved,
      policyName: policy?.policyName ?? resolved.policyName,
      weekRules: policy?.weekRules ?? [],
      shiftId: policy?.shiftId?.toString?.() ?? resolved.shiftId,
      shift,
    };
  }

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

  async getAllAttendance(
    organizationId: string,
    filters: {
      date?: Date;
      startDate?: Date;
      endDate?: Date;
      status?: AttendanceStatus;
      department?: string;
      attendancePolicyId?: string;
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

    // Department / policy filter via User lookup
    const userFilter: Record<string, unknown> = { organizationId };
    if (filters.department) userFilter.department = filters.department;
    if (filters.attendancePolicyId) userFilter.attendancePolicyId = filters.attendancePolicyId;

    if (filters.department || filters.attendancePolicyId) {
      const matchedUsers = await User.find(userFilter).select('_id');
      query.userId = { $in: matchedUsers.map((u) => u._id) };
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
