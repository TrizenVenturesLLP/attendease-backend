import { Request, Response } from 'express';
import { leaveService } from '../services/leaveService';
import { LeaveType, LeaveStatus } from '../models/Leave';

export class LeaveController {
  /**
   * Request new leave
   */
  async requestLeave(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { leaveType, startDate, endDate, reason } = req.body;

      // Validation
      if (!leaveType || !startDate || !endDate || !reason) {
        res.status(400).json({
          success: false,
          error: 'Leave type, start date, end date, and reason are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const leave = await leaveService.requestLeave(
        userId,
        req.organizationId!,
        leaveType as LeaveType,
        new Date(startDate),
        new Date(endDate),
        reason
      );

      res.status(201).json({
        success: true,
        message: 'Leave request submitted successfully',
        data: leave,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to request leave',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get current user's leaves
   */
  async getMyLeaves(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { status, startDate, endDate, page, limit } = req.query;

      const filters: any = {};
      if (status) filters.status = status as LeaveStatus;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);

      const result = await leaveService.getMyLeaves(
        userId,
        req.organizationId!,
        filters,
        page ? parseInt(page as string) : undefined,
        limit ? parseInt(limit as string) : undefined
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
        error: error.message || 'Failed to get leaves',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get current user's leave balance
   */
  async getMyBalance(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { year } = req.query;

      const balance = await leaveService.getMyBalance(
        userId,
        req.organizationId!,
        year ? parseInt(year as string) : undefined
      );

      res.status(200).json({
        success: true,
        data: balance,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Get balance error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get leave balance',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get pending leaves (Supervisor/HR/Admin)
   */
  async getPendingLeaves(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const userRole = req.user!.role;
      const { page, limit } = req.query;

      const result = await leaveService.getPendingLeaves(
        userId,
        req.organizationId!,
        userRole,
        page ? parseInt(page as string) : undefined,
        limit ? parseInt(limit as string) : undefined
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
        error: error.message || 'Failed to get pending leaves',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get all leaves with filters (HR/Admin)
   */
  async getAllLeaves(req: Request, res: Response): Promise<void> {
    try {
      const { userId, status, leaveType, startDate, endDate, page, limit } = req.query;

      const filters: any = {};
      if (userId) filters.userId = userId as string;
      if (status) filters.status = status as LeaveStatus;
      if (leaveType) filters.leaveType = leaveType as LeaveType;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);

      const result = await leaveService.getAllLeaves(
        req.organizationId!,
        filters,
        page ? parseInt(page as string) : undefined,
        limit ? parseInt(limit as string) : undefined
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
        error: error.message || 'Failed to get leaves',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get leaves for calendar view
   */
  async getCalendarLeaves(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const userRole = req.user!.role;
      const { month, year, filterUserId } = req.query;

      if (!month || !year) {
        res.status(400).json({
          success: false,
          error: 'Month and year are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      let targetUserId: string | undefined;
      let supervisorId: string | undefined;

      if (userRole === 'employee') {
        targetUserId = userId;
      } else if (userRole === 'supervisor') {
        supervisorId = userId;
      } else if (filterUserId) {
        targetUserId = filterUserId as string;
      }

      const leaves = await leaveService.getCalendarLeaves(
        req.organizationId!,
        parseInt(month as string),
        parseInt(year as string),
        targetUserId,
        supervisorId
      );

      res.status(200).json({
        success: true,
        data: leaves,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get calendar leaves',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Approve leave
   */
  async approveLeave(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const reviewerId = req.user!.userId;
      const { notes } = req.body;

      const leave = await leaveService.approveLeave(id, reviewerId, notes);

      res.status(200).json({
        success: true,
        message: 'Leave approved successfully',
        data: leave,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to approve leave',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Reject leave
   */
  async rejectLeave(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const reviewerId = req.user!.userId;
      const { notes } = req.body;

      if (!notes) {
        res.status(400).json({
          success: false,
          error: 'Notes are required when rejecting leave',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const leave = await leaveService.rejectLeave(id, reviewerId, notes);

      res.status(200).json({
        success: true,
        message: 'Leave rejected',
        data: leave,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to reject leave',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Cancel leave (by employee)
   */
  async cancelLeave(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.userId;

      const leave = await leaveService.cancelLeave(id, userId);

      res.status(200).json({
        success: true,
        message: 'Leave cancelled successfully',
        data: leave,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to cancel leave',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const leaveController = new LeaveController();
