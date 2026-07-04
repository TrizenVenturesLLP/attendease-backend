import mongoose from 'mongoose';
import Attendance, { AttendanceStatus, LocationStatus } from '../models/Attendance';
import AttendancePolicy, { GeofenceEnforcementMode } from '../models/AttendancePolicy';
import AttendanceRegularization, {
  RegularizationRequestType,
  RegularizationStatus,
} from '../models/AttendanceRegularization';
import OfficeLocation from '../models/OfficeLocation';
import { startOfDay, endOfDay } from 'date-fns';
import { minioStorage } from '../utils/storage/MinIOStorage';
import { haversineDistance } from '../utils/geoUtils';
import { BadRequestError } from '../utils/AppError';

type GeoPoint = {
  latitude: number;
  longitude: number;
};

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

    const now = new Date();
    const workStartTime = new Date(today);
    workStartTime.setHours(9, 0, 0);

    const status = now > workStartTime ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

    let photoUrl: string | undefined;
    if (photoData) {
      try {
        const base64Data = photoData.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const folder = `attendance-photos/${year}/${month}/${day}`;

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
        photoUrl = undefined;
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
      photoUrl,
      officeLocationId: geofenceResult.officeLocationId,
      checkInLat: geoPoint?.latitude,
      checkInLng: geoPoint?.longitude,
      checkInDistance: geofenceResult.distance,
      locationStatus: geofenceResult.locationStatus,
    });

    if (
      geofenceResult.locationStatus === LocationStatus.OUT_OF_RANGE
    ) {
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

    return attendance;
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

    return attendance;
  }

  async getTodayStatus(userId: string, organizationId: string): Promise<any> {
    const today = startOfDay(new Date());

    const attendance = await Attendance.findOne({
      userId,
      organizationId,
      date: today,
    });

    return attendance;
  }

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

  async getUserStats(userId: string, organizationId: string, month?: number, year?: number): Promise<any> {
    const now = new Date();
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
