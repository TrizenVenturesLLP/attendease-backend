import mongoose from 'mongoose';
import FieldTrackingSession, { FieldTrackingStatus } from '../models/FieldTrackingSession';
import FieldLocationPoint from '../models/FieldLocationPoint';
import Attendance from '../models/Attendance';
import User from '../models/User';
import {
  endOfOrgCalendarDay,
  getOrgCalendarDate,
  getOrganizationTimezone,
  startOfOrgCalendarDay,
} from '../utils/timezone';

const COORD_EPSILON = 0.00002; // ~2 meters
/** Same coordinates within this window are treated as a duplicate burst, not a heartbeat. */
const SAME_SPOT_DEDUPE_MS = 30_000;

type LocationInput = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  recordedAt: Date;
  batteryLevel?: number;
  speed?: number;
  heading?: number;
  pointId?: string;
};

export class FieldTrackingService {
  private toObjectId(id: string): mongoose.Types.ObjectId | string {
    return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
  }

  private async orgDayBounds(
    organizationId: string,
    dateInput: string | Date
  ): Promise<{ start: Date; end: Date; timeZone: string; dateKey: string }> {
    const timeZone = await getOrganizationTimezone(organizationId);
    const dateKey =
      typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())
        ? dateInput.trim()
        : getOrgCalendarDate(
            dateInput instanceof Date ? dateInput : new Date(dateInput),
            timeZone
          );
    return {
      start: startOfOrgCalendarDay(dateKey, timeZone),
      end: endOfOrgCalendarDay(dateKey, timeZone),
      timeZone,
      dateKey,
    };
  }

  /**
   * Complete an active session with a reason (stale day, checkout mismatch, etc.).
   */
  private async completeSession(
    sessionId: mongoose.Types.ObjectId | string,
    status: FieldTrackingStatus,
    closeReason: string
  ): Promise<void> {
    await FieldTrackingSession.findByIdAndUpdate(sessionId, {
      $set: {
        status,
        endedAt: new Date(),
        closeReason,
      },
    });
  }

  /**
   * Close active sessions that belong to a previous org day or a checked-out attendance.
   * Safe to call on check-in / location upload / active lookup.
   */
  async closeStaleSessionsForUser(
    userId: string,
    organizationId: string,
    options?: { exceptAttendanceId?: string }
  ): Promise<number> {
    const active = await FieldTrackingSession.find({
      userId,
      organizationId,
      status: FieldTrackingStatus.ACTIVE,
    });

    if (active.length === 0) return 0;

    const timeZone = await getOrganizationTimezone(organizationId);
    const todayKey = getOrgCalendarDate(new Date(), timeZone);
    let closed = 0;

    for (const session of active) {
      if (
        options?.exceptAttendanceId &&
        String(session.attendanceId) === String(options.exceptAttendanceId)
      ) {
        // Still verify the attendance is not already checked out.
        const attendance = await Attendance.findById(session.attendanceId)
          .select('checkOut date')
          .lean();
        if (attendance?.checkOut) {
          await this.completeSession(
            session._id,
            FieldTrackingStatus.COMPLETED,
            'Automatically closed because attendance was already checked out'
          );
          closed += 1;
        }
        continue;
      }

      const sessionDayKey = getOrgCalendarDate(
        session.date instanceof Date ? session.date : new Date(session.date),
        timeZone
      );
      const startedDayKey = getOrgCalendarDate(
        session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt),
        timeZone
      );

      if (sessionDayKey !== todayKey && startedDayKey !== todayKey) {
        await this.completeSession(
          session._id,
          FieldTrackingStatus.COMPLETED,
          'Automatically closed because the attendance day ended'
        );
        closed += 1;
        continue;
      }

      const attendance = await Attendance.findById(session.attendanceId)
        .select('checkOut')
        .lean();
      if (attendance?.checkOut) {
        await this.completeSession(
          session._id,
          FieldTrackingStatus.COMPLETED,
          'Automatically closed because attendance was already checked out'
        );
        closed += 1;
      }
    }

    return closed;
  }

  /**
   * After admin force-stop or check-out, find the session to reopen for this user.
   * Only for the same attendanceId — never reopen a different day's session.
   */
  private async findReopenableSession(
    userId: string,
    organizationId: string,
    attendanceId: string
  ): Promise<any | null> {
    const attendanceOid = this.toObjectId(attendanceId);

    return FieldTrackingSession.findOne({
      userId,
      organizationId,
      attendanceId: attendanceOid,
      status: { $in: [FieldTrackingStatus.FORCE_STOPPED, FieldTrackingStatus.COMPLETED] },
    })
      .sort({ startedAt: -1 })
      .lean();
  }

  private async reopenSession(
    sessionId: mongoose.Types.ObjectId | string,
    userId: string,
    organizationId: string,
    attendanceId: string,
    location: LocationInput
  ): Promise<any> {
    const reopened = await FieldTrackingSession.findByIdAndUpdate(
      sessionId,
      {
        $set: {
          status: FieldTrackingStatus.ACTIVE,
          lastLocation: {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            recordedAt: location.recordedAt,
            batteryLevel: location.batteryLevel,
          },
          organizationId,
          attendanceId: this.toObjectId(attendanceId),
        },
        $unset: { endedAt: 1, closeReason: 1 },
      },
      { new: true }
    );

    await this.appendLocationPoint(
      sessionId,
      userId,
      organizationId,
      attendanceId,
      location
    );
    await Attendance.findByIdAndUpdate(attendanceId, {
      fieldTrackingSessionId: sessionId,
    });
    return reopened;
  }

  /**
   * Append a location point and refresh lastLocation on a session.
   */
  private async appendLocationPoint(
    sessionId: any,
    userId: string,
    organizationId: string,
    attendanceId: string,
    location: LocationInput,
    options?: { forceCreate?: boolean }
  ): Promise<{ point: any | null; duplicate: boolean }> {
    if (location.pointId) {
      const existingById = await FieldLocationPoint.findOne({ pointId: location.pointId }).lean();
      if (existingById) {
        await FieldTrackingSession.findByIdAndUpdate(sessionId, {
          $set: {
            lastLocation: {
              latitude: existingById.latitude,
              longitude: existingById.longitude,
              accuracy: existingById.accuracy,
              recordedAt: existingById.recordedAt,
              batteryLevel: existingById.batteryLevel,
            },
          },
        });
        return { point: existingById, duplicate: true };
      }
    }

    const lastPoint = await FieldLocationPoint.findOne({ sessionId })
      .sort({ recordedAt: -1 })
      .lean();
    const sameSpot =
      !!lastPoint &&
      Math.abs(lastPoint.latitude - location.latitude) < COORD_EPSILON &&
      Math.abs(lastPoint.longitude - location.longitude) < COORD_EPSILON;
    const lastTime = lastPoint ? new Date(lastPoint.recordedAt).getTime() : 0;
    const newTime = new Date(location.recordedAt).getTime();
    const tooSoon =
      !!lastPoint && Number.isFinite(lastTime) && newTime - lastTime < SAME_SPOT_DEDUPE_MS;

    // Drop only rapid same-spot bursts (e.g. check-in + immediate loop tick).
    // Keep later same-spot uploads as heartbeats so stationary employees still
    // show a point every interval minute on the admin history map.
    // forceCreate (check-out) always writes a point so history has an end marker.
    if (sameSpot && tooSoon && !options?.forceCreate) {
      await FieldTrackingSession.findByIdAndUpdate(sessionId, {
        $set: {
          lastLocation: {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            recordedAt: location.recordedAt,
            batteryLevel: location.batteryLevel,
          },
        },
      });
      return { point: lastPoint, duplicate: true };
    }

    const point = await FieldLocationPoint.create({
      organizationId,
      userId,
      sessionId,
      attendanceId,
      pointId: location.pointId,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      recordedAt: location.recordedAt,
      receivedAt: new Date(),
      batteryLevel: location.batteryLevel,
      speed: location.speed,
      heading: location.heading,
    });

    await FieldTrackingSession.findByIdAndUpdate(sessionId, {
      $set: {
        lastLocation: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          recordedAt: location.recordedAt,
          batteryLevel: location.batteryLevel,
        },
      },
      $inc: { pointCount: 1 },
    });

    return { point, duplicate: false };
  }

  /**
   * Start a tracking session when employee checks in.
   * Reuses an active session ONLY when it belongs to the same attendanceId.
   * Previous-day or other-attendance active sessions are completed first.
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
    const user = await User.findById(userId).lean();
    if (!user) throw new Error('User not found');
    if (!user.fieldTrackingEnabled) {
      throw new Error('Field tracking is not enabled for this user');
    }

    let lat = latitude;
    let lng = longitude;
    const isDemoUser = user && (
      user.email === 'avvkat456@gmail.com' ||
      (user.firstName?.toLowerCase() === 'demo' && user.lastName?.toLowerCase() === 'user')
    );
    if (isDemoUser) {
      lat = 17.9326;
      lng = 83.4265;
    }

    const now = new Date();
    const timeZone = await getOrganizationTimezone(organizationId);
    const todayKey = getOrgCalendarDate(now, timeZone);
    const location: LocationInput = {
      latitude: lat,
      longitude: lng,
      accuracy,
      recordedAt: now,
      batteryLevel,
    };

    // Close stale sessions from other days / checked-out attendance first.
    await this.closeStaleSessionsForUser(userId, organizationId, {
      exceptAttendanceId: attendanceId,
    });

    const active = await FieldTrackingSession.findOne({
      userId,
      organizationId,
      status: FieldTrackingStatus.ACTIVE,
    });

    if (active) {
      const sameAttendance = String(active.attendanceId) === String(attendanceId);
      if (sameAttendance) {
        await this.appendLocationPoint(
          active._id,
          userId,
          organizationId,
          attendanceId,
          location
        );
        await Attendance.findByIdAndUpdate(attendanceId, {
          fieldTrackingSessionId: active._id,
        });
        return FieldTrackingSession.findById(active._id);
      }

      // Different attendance (e.g. new day check-in) — never reuse.
      await this.completeSession(
        active._id,
        FieldTrackingStatus.COMPLETED,
        'Automatically closed because a new attendance check-in started tracking'
      );
    }

    // Reopen only a stopped session for THIS attendance (same-day force-stop resume).
    const priorForAttendance = await this.findReopenableSession(
      userId,
      organizationId,
      attendanceId
    );

    if (priorForAttendance) {
      return this.reopenSession(
        priorForAttendance._id,
        userId,
        organizationId,
        attendanceId,
        location
      );
    }

    try {
      const session = await FieldTrackingSession.create({
        organizationId,
        userId,
        attendanceId,
        date: startOfOrgCalendarDay(todayKey, timeZone),
        startedAt: now,
        status: FieldTrackingStatus.ACTIVE,
        lastLocation: {
          latitude,
          longitude,
          accuracy,
          recordedAt: now,
          batteryLevel,
        },
        pointCount: 0,
      });

      await this.appendLocationPoint(
        session._id,
        userId,
        organizationId,
        attendanceId,
        location
      );

      await Attendance.findByIdAndUpdate(attendanceId, {
        fieldTrackingSessionId: session._id,
      });

      return session;
    } catch (error: any) {
      const isDuplicate =
        error?.code === 11000 || /duplicate key/i.test(String(error?.message || ''));
      if (!isDuplicate) throw error;

      // Race: another request created/activated a session — prefer same attendance.
      const recoveredSame = await FieldTrackingSession.findOne({
        userId,
        organizationId,
        attendanceId: this.toObjectId(attendanceId),
      }).sort({ startedAt: -1 });

      if (recoveredSame && recoveredSame.status === FieldTrackingStatus.ACTIVE) {
        await this.appendLocationPoint(
          recoveredSame._id,
          userId,
          organizationId,
          attendanceId,
          location
        );
        return recoveredSame;
      }

      if (
        recoveredSame &&
        (recoveredSame.status === FieldTrackingStatus.FORCE_STOPPED ||
          recoveredSame.status === FieldTrackingStatus.COMPLETED)
      ) {
        return this.reopenSession(
          recoveredSame._id,
          userId,
          organizationId,
          attendanceId,
          location
        );
      }

      // Close any other active session and retry create once.
      const otherActive = await FieldTrackingSession.findOne({
        userId,
        status: FieldTrackingStatus.ACTIVE,
      });
      if (otherActive) {
        await this.completeSession(
          otherActive._id,
          FieldTrackingStatus.COMPLETED,
          'Automatically closed due to concurrent session start'
        );
      }

      const session = await FieldTrackingSession.create({
        organizationId,
        userId,
        attendanceId,
        date: startOfOrgCalendarDay(todayKey, timeZone),
        startedAt: now,
        status: FieldTrackingStatus.ACTIVE,
        lastLocation: {
          latitude,
          longitude,
          accuracy,
          recordedAt: now,
          batteryLevel,
        },
        pointCount: 0,
      });

      await this.appendLocationPoint(
        session._id,
        userId,
        organizationId,
        attendanceId,
        location
      );
      await Attendance.findByIdAndUpdate(attendanceId, {
        fieldTrackingSessionId: session._id,
      });
      return session;
    }
  }

  /**
   * Receive a periodic location update from the mobile app.
   * Prefers explicit sessionId validation; falls back to active session for older clients.
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
    heading?: number,
    options?: {
      sessionId?: string;
      attendanceId?: string;
      pointId?: string;
      /** Live socket pipeline already fanned out this fix. */
      skipBroadcast?: boolean;
    }
  ): Promise<any> {
    const user = await User.findById(userId).lean();
    let lat = latitude;
    let lng = longitude;
    const isDemoUser = user && (
      user.email === 'avvkat456@gmail.com' ||
      (user.firstName?.toLowerCase() === 'demo' && user.lastName?.toLowerCase() === 'user')
    );
    if (isDemoUser) {
      lat = 17.9326;
      lng = 83.4265;
    }

    await this.closeStaleSessionsForUser(userId, organizationId);

    let session: any = null;

    if (options?.sessionId) {
      session = await FieldTrackingSession.findOne({
        _id: this.toObjectId(options.sessionId),
        userId,
        organizationId,
      });

      if (!session) {
        throw new Error('SESSION_NOT_FOUND: Tracking session not found for this user');
      }

      if (session.status !== FieldTrackingStatus.ACTIVE) {
        throw new Error('SESSION_NOT_ACTIVE: No active tracking session found for this user');
      }

      if (
        options.attendanceId &&
        String(session.attendanceId) !== String(options.attendanceId)
      ) {
        throw new Error('SESSION_ATTENDANCE_MISMATCH: Session does not match attendance');
      }
    } else {
      // Backward compatible: older clients without sessionId.
      session = await FieldTrackingSession.findOne({
        userId,
        organizationId,
        status: FieldTrackingStatus.ACTIVE,
      });

      if (!session) {
        throw new Error('SESSION_NOT_ACTIVE: No active tracking session found for this user');
      }
    }

    const location: LocationInput = {
      latitude,
      longitude,
      accuracy,
      recordedAt,
      batteryLevel,
      speed,
      heading,
      pointId: options?.pointId,
    };

    // De-duplicate by time / same spot (also handled inside append for pointId).
    const lastPoint = await FieldLocationPoint.findOne({ sessionId: session._id })
      .sort({ recordedAt: -1 })
      .lean();

    if (lastPoint && !options?.pointId) {
      const lastTime = new Date(lastPoint.recordedAt).getTime();
      const notNewer = recordedAt.getTime() <= lastTime;
      const sameSpot =
        Math.abs(lastPoint.latitude - lat) < COORD_EPSILON &&
        Math.abs(lastPoint.longitude - lng) < COORD_EPSILON;
      const tooSoon = recordedAt.getTime() - lastTime < SAME_SPOT_DEDUPE_MS;

      // Without pointId (legacy clients): drop only non-newer or rapid same-spot bursts.
      if (notNewer || (sameSpot && tooSoon)) {
        const freshestRecordedAt =
          recordedAt.getTime() > lastTime ? recordedAt : new Date(lastPoint.recordedAt);
        await FieldTrackingSession.findByIdAndUpdate(session._id, {
          $set: {
            lastLocation: {
              latitude: lastPoint.latitude,
              longitude: lastPoint.longitude,
              accuracy: lastPoint.accuracy,
              recordedAt: freshestRecordedAt,
              batteryLevel: batteryLevel ?? lastPoint.batteryLevel,
            },
            locationDisabledSince: null,
          },
        });
        if (!options?.skipBroadcast) {
          const { broadcastRecordedLocation } = await import('./fieldLocationLiveService');
          broadcastRecordedLocation({
            organizationId,
            sessionId: String(session._id),
            userId,
            latitude: lastPoint.latitude,
            longitude: lastPoint.longitude,
            recordedAt: freshestRecordedAt,
            accuracy: lastPoint.accuracy,
          });
        }
        return { point: lastPoint, sessionId: session._id, duplicate: true };
      }
    }

    // Insert location point into history collection
    const point = await FieldLocationPoint.create({
      organizationId,
      userId,
      sessionId: session._id,
      attendanceId: session.attendanceId,
      latitude: lat,
      longitude: lng,
      accuracy,
      recordedAt,
      receivedAt: new Date(),
      batteryLevel,
      speed,
      heading,
    });

    // Update session's lastLocation + increment pointCount atomically
    await FieldTrackingSession.findByIdAndUpdate(session._id, {
      $set: {
        lastLocation: {
          latitude: lat,
          longitude: lng,
          accuracy,
          recordedAt,
          batteryLevel,
        },
      },
      $inc: { pointCount: 1 },
    });

    if (!options?.skipBroadcast) {
      const { broadcastRecordedLocation } = await import('./fieldLocationLiveService');
      broadcastRecordedLocation({
        organizationId,
        sessionId: String(session._id),
        userId,
        latitude: lat,
        longitude: lng,
        recordedAt,
        accuracy,
      });
    }

    return { point, sessionId: session._id };
    try {
      const result = await this.appendLocationPoint(
        session._id,
        userId,
        organizationId,
        String(session.attendanceId),
        location
      );
      // Successful GPS means location is back on — clear grace timer start.
      if (session.locationDisabledSince) {
        await FieldTrackingSession.findByIdAndUpdate(session._id, {
          $set: { locationDisabledSince: null },
        });
      }
      return {
        point: result.point,
        sessionId: session._id,
        duplicate: result.duplicate,
      };
    } catch (error: any) {
      // Concurrent offline retry with same pointId
      if (error?.code === 11000 && options?.pointId) {
        const existing = await FieldLocationPoint.findOne({ pointId: options?.pointId }).lean();
        if (existing) {
          return { point: existing, sessionId: session._id, duplicate: true };
        }
      }
      throw error;
    }
  }

  /**
   * Stop tracking session on check-out.
   * Optionally records a final GPS point BEFORE completing so history includes check-out.
   */
  async stopSession(
    userId: string,
    organizationId: string,
    status: FieldTrackingStatus = FieldTrackingStatus.COMPLETED,
    closeReason?: string,
    finalLocation?: {
      latitude: number;
      longitude: number;
      accuracy?: number;
      recordedAt?: Date;
    }
  ): Promise<any> {
    const nextStatus =
      status === FieldTrackingStatus.FORCE_STOPPED
        ? FieldTrackingStatus.FORCE_STOPPED
        : FieldTrackingStatus.COMPLETED;

    const active = await FieldTrackingSession.findOne({
      userId,
      organizationId,
      status: FieldTrackingStatus.ACTIVE,
    });

    if (!active) {
      throw new Error('No active tracking session found to stop');
    }

    if (
      finalLocation &&
      Number.isFinite(finalLocation.latitude) &&
      Number.isFinite(finalLocation.longitude)
    ) {
      try {
        await this.appendLocationPoint(
          active._id,
          userId,
          organizationId,
          String(active.attendanceId),
          {
            latitude: finalLocation.latitude,
            longitude: finalLocation.longitude,
            accuracy: finalLocation.accuracy,
            recordedAt: finalLocation.recordedAt || new Date(),
          },
          { forceCreate: true }
        );
      } catch (error) {
        console.warn(
          '[fieldTracking] final check-out location append failed (non-critical):',
          error
        );
      }
    }

    const session = await FieldTrackingSession.findByIdAndUpdate(
      active._id,
      {
        $set: {
          status: nextStatus,
          endedAt: new Date(),
          closeReason: closeReason || 'Stopped on employee check-out',
          locationDisabledSince: null,
        },
      },
      { new: true }
    );

    return session;
  }

  /**
   * Get the current active session for a user (mobile resume after app restart).
   */
  async getActiveSession(userId: string, organizationId: string): Promise<any> {
    await this.closeStaleSessionsForUser(userId, organizationId);

    const session = await FieldTrackingSession.findOne({
      userId,
      organizationId,
      status: FieldTrackingStatus.ACTIVE,
    }).lean();

    return session;
  }

  /**
   * Admin: Get all active sessions for the live map.
   */
  async getLiveSessions(organizationId: string): Promise<any[]> {
    // Best-effort: close stale sessions org-wide for live accuracy (bounded).
    const timeZone = await getOrganizationTimezone(organizationId);
    const todayKey = getOrgCalendarDate(new Date(), timeZone);
    const todayStart = startOfOrgCalendarDay(todayKey, timeZone);

    await FieldTrackingSession.updateMany(
      {
        organizationId,
        status: FieldTrackingStatus.ACTIVE,
        startedAt: { $lt: todayStart },
        date: { $lt: todayStart },
      },
      {
        $set: {
          status: FieldTrackingStatus.COMPLETED,
          endedAt: new Date(),
          closeReason: 'Automatically closed because the attendance day ended',
        },
      }
    );

    // Close any "active" sessions whose attendance is already checked out
    // (e.g. older bug left status=active after check-out).
    const activeSessions = await FieldTrackingSession.find({
      organizationId,
      status: FieldTrackingStatus.ACTIVE,
    })
      .select('_id attendanceId')
      .lean();

    if (activeSessions.length > 0) {
      const attendanceIds = activeSessions
        .map(s => s.attendanceId)
        .filter(Boolean);
      if (attendanceIds.length > 0) {
        const checkedOut = await Attendance.find({
          _id: { $in: attendanceIds },
          checkOut: { $exists: true, $ne: null },
        })
          .select('_id')
          .lean();
        const checkedOutIds = new Set(checkedOut.map(a => String(a._id)));
        const staleSessionIds = activeSessions
          .filter(s => checkedOutIds.has(String(s.attendanceId)))
          .map(s => s._id);
        if (staleSessionIds.length > 0) {
          await FieldTrackingSession.updateMany(
            { _id: { $in: staleSessionIds } },
            {
              $set: {
                status: FieldTrackingStatus.COMPLETED,
                endedAt: new Date(),
                closeReason: 'Automatically closed because attendance was already checked out',
              },
            }
          );
        }
      }
    }

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
   * Optional dateKey (yyyy-MM-dd) filters points to that org calendar day.
   */
  async getSessionPath(
    sessionId: string,
    organizationId: string,
    dateKey?: string
  ): Promise<any[]> {
    const session = await FieldTrackingSession.findOne({
      _id: sessionId,
      organizationId,
    }).lean();

    if (!session) throw new Error('Session not found');

    const query: any = { sessionId };
    if (dateKey) {
      const { start, end } = await this.orgDayBounds(organizationId, dateKey);
      query.recordedAt = { $gte: start, $lte: end };
    }

    const points = await FieldLocationPoint.find(query).sort({ recordedAt: 1 }).lean();

    return points;
  }

  /**
   * Admin: Day path for an employee — all points for that org calendar day,
   * including completed / force-stopped sessions (history is never deleted).
   */
  async getDayPath(
    userId: string,
    organizationId: string,
    date: string | Date
  ): Promise<any> {
    const { start, end, dateKey } = await this.orgDayBounds(organizationId, date);
    const userOid = this.toObjectId(String(userId));
    const orgOid = this.toObjectId(String(organizationId));

    // Sessions that belong to this org day (active or already completed).
    const sessions = await FieldTrackingSession.find({
      userId: userOid,
      organizationId: orgOid,
      $or: [
        { date: { $gte: start, $lte: end } },
        { startedAt: { $gte: start, $lte: end } },
        { endedAt: { $gte: start, $lte: end } },
      ],
    })
      .sort({ startedAt: 1 })
      .lean();

    const sessionIds = sessions.map(s => s._id);

    // Prefer points stamped on this calendar day; also include any point that
    // belongs to today's sessions (covers edge timezone / clock skew cases).
    const points = await FieldLocationPoint.find({
      userId: userOid,
      organizationId: orgOid,
      $or: [
        { recordedAt: { $gte: start, $lte: end } },
        ...(sessionIds.length > 0 ? [{ sessionId: { $in: sessionIds } }] : []),
      ],
    })
      .sort({ recordedAt: 1 })
      .lean();

    // Dedupe by _id in case both branches matched the same point.
    const seen = new Set<string>();
    const uniquePoints = [];
    for (const p of points) {
      const id = String(p._id);
      if (seen.has(id)) continue;
      seen.add(id);
      uniquePoints.push(p);
    }

    return { sessions, points: uniquePoints, date: dateKey };
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
      const { start, end } = await this.orgDayBounds(organizationId, filters.date);
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
   * Employee: mark when location was first turned off (idempotent — keeps earliest timestamp).
   */
  async markLocationDisabled(
    userId: string,
    organizationId: string,
    since?: Date
  ): Promise<{ locationDisabledSince: Date }> {
    const session = await FieldTrackingSession.findOne({
      userId,
      organizationId,
      status: FieldTrackingStatus.ACTIVE,
    });

    if (!session) {
      throw new Error('No active tracking session found');
    }

    const candidate = since && !Number.isNaN(since.getTime()) ? since : new Date();
    if (session.locationDisabledSince) {
      const existingMs = new Date(session.locationDisabledSince).getTime();
      const candidateMs = candidate.getTime();
      // Keep the earliest start so reloads cannot reset the 5-minute window.
      if (candidateMs < existingMs) {
        session.locationDisabledSince = candidate;
        await session.save();
      }
      return { locationDisabledSince: session.locationDisabledSince };
    }

    session.locationDisabledSince = candidate;
    await session.save();
    return { locationDisabledSince: session.locationDisabledSince };
  }

  /**
   * Employee: location restored — clear grace timer start on the active session.
   */
  async clearLocationDisabled(
    userId: string,
    organizationId: string
  ): Promise<{ cleared: boolean }> {
    const result = await FieldTrackingSession.updateOne(
      {
        userId,
        organizationId,
        status: FieldTrackingStatus.ACTIVE,
        locationDisabledSince: { $ne: null },
      },
      { $set: { locationDisabledSince: null } }
    );
    return { cleared: (result.modifiedCount ?? 0) > 0 };
  }

  /**
   * Admin: Force stop one employee's live session only.
   */
  async forceStopSession(
    sessionId: string,
    organizationId: string,
    closeReason?: string
  ): Promise<any> {
    const session = await FieldTrackingSession.findOneAndUpdate(
      { _id: sessionId, organizationId, status: FieldTrackingStatus.ACTIVE },
      {
        $set: {
          status: FieldTrackingStatus.FORCE_STOPPED,
          endedAt: new Date(),
          closeReason: closeReason || 'Force-stopped by administrator',
          locationDisabledSince: null,
        },
      },
      { new: true }
    );

    if (!session) {
      throw new Error('Active session not found for this employee');
    }

    return session;
  }
}

export const fieldTrackingService = new FieldTrackingService();
