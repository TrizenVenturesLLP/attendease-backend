import { startOfDay } from 'date-fns';
import FieldTrackingSession, { FieldTrackingStatus } from '../models/FieldTrackingSession';
import FieldLocationPoint from '../models/FieldLocationPoint';
import Attendance from '../models/Attendance';
import User from '../models/User';

/**
 * Parse a calendar day for history queries.
 * Avoid `new Date('YYYY-MM-DD')` (UTC midnight) which can miss local-day sessions.
 */
function dayBoundsFromDateInput(dateInput: string | Date): { start: Date; end: Date } {
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    const [y, m, d] = dateInput.trim().split('-').map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const end = new Date(y, m - 1, d, 23, 59, 59, 999);
    return { start, end };
  }

  const base = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const start = startOfDay(base);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export class FieldTrackingService {
  /**
   * Start a tracking session when employee checks in.
   * Called automatically from attendanceService.checkIn (for fieldTrackingEnabled users).
   * Also exposed as a standalone API in case the app needs to call it separately.
   */
  async startSession(
    userId: string,
    organizationId: string,
    attendanceId: string,
    latitude: number,
    longitude: number,
    accuracy?: number,
    batteryLevel?: number
  ): Promise<any> {
    // Only start if user has fieldTrackingEnabled
    const user = await User.findById(userId).lean();
    if (!user) throw new Error('User not found');
    if (!user.fieldTrackingEnabled) {
      throw new Error('Field tracking is not enabled for this user');
    }

    // Prevent duplicate active sessions
    const existing = await FieldTrackingSession.findOne({
      userId,
      status: FieldTrackingStatus.ACTIVE,
    });
    if (existing) {
      throw new Error('An active tracking session already exists. Please stop it before starting a new one.');
    }

    const now = new Date();
    const session = await FieldTrackingSession.create({
      organizationId,
      userId,
      attendanceId,
      date: startOfDay(now),
      startedAt: now,
      status: FieldTrackingStatus.ACTIVE,
      lastLocation: {
        latitude,
        longitude,
        accuracy,
        recordedAt: now,
        batteryLevel,
      },
      pointCount: 1,
    });

    // Immediately save the first location point
    await FieldLocationPoint.create({
      organizationId,
      userId,
      sessionId: session._id,
      attendanceId,
      latitude,
      longitude,
      accuracy,
      recordedAt: now,
      receivedAt: now,
      batteryLevel,
    });

    // Link session to attendance record
    await Attendance.findByIdAndUpdate(attendanceId, {
      fieldTrackingSessionId: session._id,
    });

    return session;
  }

  /**
   * Receive a periodic location update (every 5 minutes from the mobile app).
   * Inserts a FieldLocationPoint and updates lastLocation on the active session.
   */
  async recordLocationPoint(
    userId: string,
    organizationId: string,
    latitude: number,
    longitude: number,
    recordedAt: Date,
    accuracy?: number,
    batteryLevel?: number,
    speed?: number,
    heading?: number
  ): Promise<any> {
    // Find the user's active session
    const session = await FieldTrackingSession.findOne({
      userId,
      organizationId,
      status: FieldTrackingStatus.ACTIVE,
    });

    if (!session) {
      throw new Error('No active tracking session found for this user');
    }

    const receivedAt = new Date();

    // Insert location point into history collection
    const point = await FieldLocationPoint.create({
      organizationId,
      userId,
      sessionId: session._id,
      attendanceId: session.attendanceId,
      latitude,
      longitude,
      accuracy,
      recordedAt,
      receivedAt,
      batteryLevel,
      speed,
      heading,
    });

    // Update session's lastLocation + increment pointCount atomically
    await FieldTrackingSession.findByIdAndUpdate(session._id, {
      $set: {
        lastLocation: {
          latitude,
          longitude,
          accuracy,
          recordedAt,
          batteryLevel,
        },
      },
      $inc: { pointCount: 1 },
    });

    return { point, sessionId: session._id };
  }

  /**
   * Stop tracking session on check-out.
   * Called automatically from attendanceService.checkOut (for fieldTrackingEnabled users).
   */
  async stopSession(
    userId: string,
    organizationId: string,
    status: FieldTrackingStatus = FieldTrackingStatus.COMPLETED
  ): Promise<any> {
    const session = await FieldTrackingSession.findOneAndUpdate(
      { userId, organizationId, status: FieldTrackingStatus.ACTIVE },
      {
        $set: {
          status,
          endedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!session) {
      throw new Error('No active tracking session found to stop');
    }

    return session;
  }

  /**
   * Get the current active session for a user (mobile can call this to resume tracking after app restart).
   */
  async getActiveSession(userId: string, organizationId: string): Promise<any> {
    const session = await FieldTrackingSession.findOne({
      userId,
      organizationId,
      status: FieldTrackingStatus.ACTIVE,
    }).lean();

    return session;
  }

  /**
   * Admin: Get all active sessions for the live map.
   * Returns sessions with lastLocation for all field employees currently tracked.
   */
  async getLiveSessions(organizationId: string): Promise<any[]> {
    const sessions = await FieldTrackingSession.find({
      organizationId,
      status: FieldTrackingStatus.ACTIVE,
    })
      .populate('userId', 'firstName lastName employeeId department')
      .lean();

    return sessions;
  }

  /**
   * Admin/Employee: Get the full path history for a specific session.
   */
  async getSessionPath(sessionId: string, organizationId: string): Promise<any[]> {
    const session = await FieldTrackingSession.findOne({
      _id: sessionId,
      organizationId,
    }).lean();

    if (!session) throw new Error('Session not found');

    const points = await FieldLocationPoint.find({ sessionId })
      .sort({ recordedAt: 1 })
      .lean();

    return points;
  }

  /**
   * Admin/Employee: Get the day path history for a specific user and date.
   * Includes force_stopped / completed sessions — history is never deleted on stop.
   */
  async getDayPath(
    userId: string,
    organizationId: string,
    date: string | Date
  ): Promise<any> {
    const { start, end } = dayBoundsFromDateInput(date);

    // Match by session.date or startedAt so timezone edge cases still return history.
    const sessions = await FieldTrackingSession.find({
      userId,
      organizationId,
      $or: [
        { date: { $gte: start, $lte: end } },
        { startedAt: { $gte: start, $lte: end } },
      ],
    })
      .sort({ startedAt: 1 })
      .lean();

    if (sessions.length === 0) return { sessions: [], points: [] };

    const sessionIds = sessions.map((s: any) => s._id);

    // All points for those sessions (do not re-filter by recordedAt — force-stop must not hide history).
    const points = await FieldLocationPoint.find({
      sessionId: { $in: sessionIds },
    })
      .sort({ recordedAt: 1 })
      .lean();

    return { sessions, points };
  }

  /**
   * Admin: Get sessions list with filters (history view).
   */
  async getSessions(
    organizationId: string,
    filters: {
      userId?: string;
      date?: string | Date;
      status?: FieldTrackingStatus;
    },
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    const query: any = { organizationId };

    if (filters.userId) query.userId = filters.userId;
    if (filters.status) query.status = filters.status;
    if (filters.date) {
      const { start, end } = dayBoundsFromDateInput(filters.date);
      query.$or = [
        { date: { $gte: start, $lte: end } },
        { startedAt: { $gte: start, $lte: end } },
      ];
    }

    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      FieldTrackingSession.find(query)
        .populate('userId', 'firstName lastName employeeId department')
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      FieldTrackingSession.countDocuments(query),
    ]);

    return {
      sessions,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Admin: Force stop a running session (e.g. if employee forgot to check out).
   */
  async forceStopSession(sessionId: string, organizationId: string): Promise<any> {
    const session = await FieldTrackingSession.findOneAndUpdate(
      { _id: sessionId, organizationId, status: FieldTrackingStatus.ACTIVE },
      { $set: { status: FieldTrackingStatus.FORCE_STOPPED, endedAt: new Date() } },
      { new: true }
    );

    if (!session) throw new Error('Active session not found');

    return session;
  }
}

export const fieldTrackingService = new FieldTrackingService();
