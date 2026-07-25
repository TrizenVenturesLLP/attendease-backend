import { Request, Response } from 'express';
import { AttendanceStatus } from '../models/Attendance';
import { RegularizationRequestType, RegularizationStatus } from '../models/AttendanceRegularization';
import { attendanceRegularizationService } from '../services/attendanceRegularizationService';

export class AttendanceRegularizationController {
  async createRequest(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const {
        date,
        requestType,
        requestedCheckIn,
        requestedCheckOut,
        requestedStatus,
        reason,
      } = req.body;

      if (!date || !requestType || !reason?.trim()) {
        res.status(400).json({
          success: false,
          error: 'date, requestType, and reason are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const request = await attendanceRegularizationService.createRequest(
        userId,
        req.organizationId!,
        {
          date: new Date(date),
          requestType: requestType as RegularizationRequestType,
          requestedCheckIn,
          requestedCheckOut,
          requestedStatus: requestedStatus as AttendanceStatus | undefined,
          reason,
        }
      );

      res.status(201).json({
        success: true,
        message: 'Regularization request submitted',
        data: request,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to submit regularization request',
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getMyRequests(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const status = req.query.status as RegularizationStatus | undefined;

      const result = await attendanceRegularizationService.getMyRequests(
        userId,
        req.organizationId!,
        page,
        limit,
        status
      );

      res.status(200).json({
        success: true,
        data: result.records,
        stats: result.stats,
        pagination: result.pagination,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to load regularization requests',
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getPendingRequests(req: Request, res: Response): Promise<void> {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const statusParam = req.query.status as RegularizationStatus | undefined;
      const status =
        statusParam && Object.values(RegularizationStatus).includes(statusParam)
          ? statusParam
          : RegularizationStatus.PENDING;
      const requesterRole =
        typeof req.query.requesterRole === 'string' ? req.query.requesterRole : undefined;

      const result = await attendanceRegularizationService.getPendingRequests(
        req.organizationId!,
        req.user!.userId,
        req.user!.role,
        page,
        limit,
        status,
        requesterRole
      );

      res.status(200).json({
        success: true,
        data: result.records,
        pagination: result.pagination,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to load pending regularization requests',
        timestamp: new Date().toISOString(),
      });
    }
  }

  async approveRequest(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { notes, requestedCheckIn, requestedCheckOut, requestedStatus } = req.body;

      const request = await attendanceRegularizationService.approveRequest(
        id,
        req.user!.userId,
        req.user!.role,
        {
          notes,
          requestedCheckIn,
          requestedCheckOut,
          requestedStatus: requestedStatus as AttendanceStatus | undefined,
        }
      );

      res.status(200).json({
        success: true,
        message: 'Regularization request approved',
        data: request,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to approve regularization request',
        timestamp: new Date().toISOString(),
      });
    }
  }

  async rejectRequest(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      if (!notes?.trim()) {
        res.status(400).json({
          success: false,
          error: 'Notes are required when rejecting a request',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const request = await attendanceRegularizationService.rejectRequest(
        id,
        req.user!.userId,
        req.user!.role,
        notes
      );

      res.status(200).json({
        success: true,
        message: 'Regularization request rejected',
        data: request,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to reject regularization request',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const attendanceRegularizationController = new AttendanceRegularizationController();
