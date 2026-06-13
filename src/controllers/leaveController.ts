import { Request, Response } from 'express';
import { leaveService } from '../services/leaveService';
import { resolveOrganizationId } from '../utils/resolveOrganizationId';
import { ForbiddenError } from '../utils/AppError';
import { normalizeLeaveStatus } from '../utils/leaveWorkflowUtils';

export class LeaveController {
  private async getOrganizationId(req: Request): Promise<string> {
    return resolveOrganizationId(req);
  }

  private handleError(res: Response, error: unknown, fallback: string, status = 500): void {
    if (error instanceof ForbiddenError) {
      res.status(403).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const message = error instanceof Error ? error.message : fallback;
    console.error(`${fallback}:`, error);
    res.status(status).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }

  async requestLeave(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const organizationId = await this.getOrganizationId(req);
      const {
        leaveTypeId,
        startDate,
        endDate,
        reason,
        isHalfDay,
        attachmentUrl,
        otherLeaveTypeName,
      } = req.body;

      if (!leaveTypeId || !startDate || !endDate || !reason) {
        res.status(400).json({
          success: false,
          error: 'Leave type, start date, end date, and reason are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const leave = await leaveService.requestLeave(
        userId,
        organizationId,
        leaveTypeId,
        new Date(startDate),
        new Date(endDate),
        reason,
        { isHalfDay, attachmentUrl, otherLeaveTypeName }
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

  async getMyLeaves(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const organizationId = await this.getOrganizationId(req);
      const { status, startDate, endDate, page, limit } = req.query;

      const filters: any = {};
      if (status) filters.status = status as string;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);

      const result = await leaveService.getMyLeaves(
        userId,
        organizationId,
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

  async getMyBalance(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const organizationId = await this.getOrganizationId(req);
      const { year } = req.query;

      const balance = await leaveService.getMyBalance(
        userId,
        organizationId,
        year ? parseInt(year as string) : undefined
      );

      res.status(200).json({
        success: true,
        data: balance,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      this.handleError(res, error, 'Get balance error');
    }
  }

  async getPendingLeaves(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const userRole = req.user!.role;
      const organizationId = await this.getOrganizationId(req);
      const { page, limit } = req.query;

      const result = await leaveService.getPendingLeaves(
        userId,
        organizationId,
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

  async getAllLeaves(req: Request, res: Response): Promise<void> {
    try {
      const { userId, status, leaveTypeId, startDate, endDate, page, limit } = req.query;

      const filters: any = {};
      if (userId) filters.userId = userId as string;
      if (status) filters.status = status as string;
      if (leaveTypeId) filters.leaveTypeId = leaveTypeId as string;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);

      const organizationId = await this.getOrganizationId(req);

      const result = await leaveService.getAllLeaves(
        organizationId,
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

  async getTeamLeaves(req: Request, res: Response): Promise<void> {
    try {
      const requesterUserId = req.user!.userId;
      const requesterRole = req.user!.role;
      const { userId, status, leaveTypeId, startDate, endDate, page, limit } = req.query;

      const filters: any = {};
      if (userId) filters.userId = userId as string;
      if (status) filters.status = status as string;
      if (leaveTypeId) filters.leaveTypeId = leaveTypeId as string;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);

      const organizationId = await this.getOrganizationId(req);

      const result = await leaveService.getTeamLeaves(
        organizationId,
        requesterRole,
        requesterUserId,
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
        error: error.message || 'Failed to get team leaves',
        timestamp: new Date().toISOString(),
      });
    }
  }

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

      const organizationId = await this.getOrganizationId(req);

      const leaves = await leaveService.getCalendarLeaves(
        organizationId,
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

  async getLeaveApprovals(req: Request, res: Response): Promise<void> {
    try {
      const approvals = await leaveService.getLeaveApprovals(req.params.id);
      res.status(200).json({ success: true, data: approvals, timestamp: new Date().toISOString() });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get leave approvals',
        timestamp: new Date().toISOString(),
      });
    }
  }

  async approveLeave(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const reviewerId = req.user!.userId;
      const reviewerRole = req.user!.role;
      const { notes } = req.body;

      const leave = await leaveService.approveLeave(id, reviewerId, reviewerRole, notes);

      res.status(200).json({
        success: true,
        message: normalizeLeaveStatus(leave.status) === 'APPROVED'
          ? 'Leave approved successfully'
          : 'Leave advanced to next approval step',
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

  async rejectLeave(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const reviewerId = req.user!.userId;
      const reviewerRole = req.user!.role;
      const { notes } = req.body;

      if (!notes) {
        res.status(400).json({
          success: false,
          error: 'Notes are required when rejecting leave',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const leave = await leaveService.rejectLeave(id, reviewerId, reviewerRole, notes);

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

  async adjustBalance(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = await this.getOrganizationId(req);
      const { employeeId, year, leaveTypeId, allocated } = req.body;

      if (!employeeId || !year || !leaveTypeId || allocated === undefined) {
        res.status(400).json({
          success: false,
          error: 'employeeId, year, leaveTypeId, and allocated are required',
        });
        return;
      }

      const balance = await leaveService.adjustBalance(
        organizationId,
        employeeId,
        Number(year),
        leaveTypeId,
        Number(allocated)
      );

      res.status(200).json({
        success: true,
        message: 'Leave balance updated',
        data: balance,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message || 'Failed to adjust balance' });
    }
  }
}

export const leaveController = new LeaveController();
