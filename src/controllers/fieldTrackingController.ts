import { Request, Response } from 'express';
import { fieldTrackingService } from '../services/fieldTrackingService';
import { FieldTrackingStatus } from '../models/FieldTrackingSession';

export class FieldTrackingController {
  /**
   * POST /field-tracking/session/start
   * Employee starts a tracking session manually (if not triggered automatically on check-in).
   */
  async startSession(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { attendanceId, latitude, longitude, accuracy, batteryLevel } = req.body;

      if (!attendanceId) {
        res.status(400).json({
          success: false,
          error: 'attendanceId is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (latitude === undefined || longitude === undefined) {
        res.status(400).json({
          success: false,
          error: 'latitude and longitude are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const session = await fieldTrackingService.startSession(
        userId,
        req.organizationId!,
        attendanceId,
        parseFloat(latitude),
        parseFloat(longitude),
        accuracy ? parseFloat(accuracy) : undefined,
        batteryLevel ? parseFloat(batteryLevel) : undefined
      );

      res.status(201).json({
        success: true,
        message: 'Tracking session started',
        data: session,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to start tracking session',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * POST /field-tracking/location
   * Employee sends periodic location update (every 5 minutes).
   * Prefer sessionId + optional pointId for idempotent offline retries.
   */
  async recordLocation(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const {
        latitude,
        longitude,
        recordedAt,
        accuracy,
        batteryLevel,
        speed,
        heading,
        sessionId,
        attendanceId,
        pointId,
      } = req.body;

      if (latitude === undefined || longitude === undefined) {
        res.status(400).json({
          success: false,
          error: 'latitude and longitude are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const result = await fieldTrackingService.recordLocationPoint(
        userId,
        req.organizationId!,
        parseFloat(latitude),
        parseFloat(longitude),
        recordedAt ? new Date(recordedAt) : new Date(),
        accuracy !== undefined && accuracy !== null && accuracy !== ''
          ? parseFloat(accuracy)
          : undefined,
        batteryLevel !== undefined && batteryLevel !== null && batteryLevel !== ''
          ? parseFloat(batteryLevel)
          : undefined,
        speed !== undefined && speed !== null && speed !== '' ? parseFloat(speed) : undefined,
        heading !== undefined && heading !== null && heading !== ''
          ? parseFloat(heading)
          : undefined,
        {
          sessionId: sessionId ? String(sessionId) : undefined,
          attendanceId: attendanceId ? String(attendanceId) : undefined,
          pointId: pointId ? String(pointId) : undefined,
        }
      );

      res.status(200).json({
        success: true,
        message: 'Location recorded',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      const message = error.message || 'Failed to record location';
      const isSessionInactive = /SESSION_NOT_ACTIVE|SESSION_NOT_FOUND|SESSION_ATTENDANCE/i.test(
        message
      );
      res.status(isSessionInactive ? 409 : 400).json({
        success: false,
        error: message,
        code: isSessionInactive
          ? String(message).split(':')[0] || 'SESSION_NOT_ACTIVE'
          : undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * POST /field-tracking/session/stop
   * Employee stops tracking session on check-out.
   */
  async stopSession(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;

      const session = await fieldTrackingService.stopSession(
        userId,
        req.organizationId!,
        FieldTrackingStatus.COMPLETED
      );

      res.status(200).json({
        success: true,
        message: 'Tracking session stopped',
        data: session,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to stop tracking session',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * GET /field-tracking/session/active
   * Employee: Get their own active session (useful after app restart to resume tracking).
   */
  async getActiveSession(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;

      const session = await fieldTrackingService.getActiveSession(
        userId,
        req.organizationId!
      );

      res.status(200).json({
        success: true,
        data: session,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get active session',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * GET /field-tracking/live
   * Admin/HR: Get all employees' live locations for the admin map.
   */
  async getLiveSessions(req: Request, res: Response): Promise<void> {
    try {
      const sessions = await fieldTrackingService.getLiveSessions(req.organizationId!);

      res.status(200).json({
        success: true,
        data: sessions,
        count: sessions.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get live sessions',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * GET /field-tracking/session/:sessionId/path
   * Admin/HR/Employee: Get the full GPS path for a specific tracking session.
   */
  async getSessionPath(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const date =
        typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date.trim())
          ? req.query.date.trim()
          : undefined;

      const points = await fieldTrackingService.getSessionPath(
        sessionId,
        req.organizationId!,
        date
      );

      res.status(200).json({
        success: true,
        data: points,
        count: points.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(404).json({
        success: false,
        error: error.message || 'Failed to get session path',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * GET /field-tracking/day-path?userId=...&date=...
   * Admin/HR/Supervisor: Get full day path for an employee on a specific date.
   */
  async getDayPath(req: Request, res: Response): Promise<void> {
    try {
      const { userId, date } = req.query;

      if (!userId || !date) {
        res.status(400).json({
          success: false,
          error: 'userId and date query params are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Pass YYYY-MM-DD string through — service parses as local calendar day.
      const result = await fieldTrackingService.getDayPath(
        userId as string,
        req.organizationId!,
        String(date)
      );

      res.status(200).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get day path',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * GET /field-tracking/sessions?userId=...&date=...&status=...
   * Admin/HR: List all sessions with optional filters.
   */
  async getSessions(req: Request, res: Response): Promise<void> {
    try {
      const { userId, date, status, page, limit } = req.query;

      const result = await fieldTrackingService.getSessions(
        req.organizationId!,
        {
          userId: userId as string | undefined,
          date: date ? String(date) : undefined,
          status: status as FieldTrackingStatus | undefined,
        },
        page ? parseInt(page as string) : 1,
        limit ? parseInt(limit as string) : 20
      );

      res.status(200).json({
        success: true,
        data: result.sessions,
        pagination: result.pagination,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get sessions',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * PATCH /field-tracking/session/:sessionId/force-stop
   * Admin/HR: Force stop an active session (e.g. employee forgot to check out).
   */
  async forceStopSession(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const closeReason =
        typeof req.body?.reason === 'string' && req.body.reason.trim()
          ? req.body.reason.trim().slice(0, 500)
          : undefined;

      const session = await fieldTrackingService.forceStopSession(
        sessionId,
        req.organizationId!,
        closeReason
      );

      res.status(200).json({
        success: true,
        message: 'Session force stopped',
        data: session,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to force stop session',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * POST /field-tracking/location-disabled
   * Persist when location was first turned off (survives app reload).
   */
  async markLocationDisabled(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const sinceRaw = req.body?.since;
      const since =
        typeof sinceRaw === 'string' && sinceRaw.trim()
          ? new Date(sinceRaw)
          : undefined;

      const result = await fieldTrackingService.markLocationDisabled(
        userId,
        req.organizationId!,
        since
      );

      res.status(200).json({
        success: true,
        message: 'Location-disabled timestamp saved',
        data: {
          locationDisabledSince: result.locationDisabledSince,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to save location-disabled timestamp',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * POST /field-tracking/location-restored
   * Clear location-disabled timestamp after GPS is back.
   */
  async clearLocationDisabled(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const result = await fieldTrackingService.clearLocationDisabled(
        userId,
        req.organizationId!
      );

      res.status(200).json({
        success: true,
        message: result.cleared
          ? 'Location-disabled timestamp cleared'
          : 'No location-disabled timestamp to clear',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to clear location-disabled timestamp',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * POST /field-tracking/location-disabled-checkout
   * Employee: location was off for the grace period — auto check-out + alert admins.
   */
  async locationDisabledCheckout(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { latitude, longitude } = req.body || {};

      const { locationDisabledAutoCheckout } = await import(
        '../services/fieldTrackingComplianceService'
      );

      const result = await locationDisabledAutoCheckout(
        userId,
        req.organizationId!,
        latitude !== undefined && latitude !== null && latitude !== ''
          ? parseFloat(latitude)
          : undefined,
        longitude !== undefined && longitude !== null && longitude !== ''
          ? parseFloat(longitude)
          : undefined
      );

      res.status(200).json({
        success: true,
        message: result.alreadyCheckedOut
          ? 'Already checked out; field tracking stopped'
          : 'Checked out because location was disabled',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to auto check out',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const fieldTrackingController = new FieldTrackingController();
