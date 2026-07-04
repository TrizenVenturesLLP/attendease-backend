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
   */
  async recordLocation(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { latitude, longitude, recordedAt, accuracy, batteryLevel, speed, heading } = req.body;

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
        accuracy ? parseFloat(accuracy) : undefined,
        batteryLevel ? parseFloat(batteryLevel) : undefined,
        speed ? parseFloat(speed) : undefined,
        heading ? parseFloat(heading) : undefined
      );

      res.status(200).json({
        success: true,
        message: 'Location recorded',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to record location',
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

      const points = await fieldTrackingService.getSessionPath(
        sessionId,
        req.organizationId!
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

      const result = await fieldTrackingService.getDayPath(
        userId as string,
        req.organizationId!,
        new Date(date as string)
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
          date: date ? new Date(date as string) : undefined,
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

      const session = await fieldTrackingService.forceStopSession(
        sessionId,
        req.organizationId!
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
}

export const fieldTrackingController = new FieldTrackingController();
