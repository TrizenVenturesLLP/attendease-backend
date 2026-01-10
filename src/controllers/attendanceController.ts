import { Request, Response } from 'express';
import { attendanceService } from '../services/attendanceService';
import { AttendanceStatus } from '../models/Attendance';

export class AttendanceController {
  /**
   * Mark check-in
   */
  async checkIn(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { photoData } = req.body;

      const attendance = await attendanceService.checkIn(
        userId,
        req.organizationId!,
        photoData
      );

      res.status(200).json({
        success: true,
        message: 'Checked in successfully',
        data: attendance,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to check in',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Mark check-out
   */
  async checkOut(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;

      const attendance = await attendanceService.checkOut(userId, req.organizationId!);

      res.status(200).json({
        success: true,
        message: 'Checked out successfully',
        data: attendance,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to check out',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get today's attendance status
   */
  async getTodayStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;

      const status = await attendanceService.getTodayStatus(userId, req.organizationId!);

      res.status(200).json({
        success: true,
        data: status,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get status',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get user's attendance history
   */
  async getMyAttendance(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { startDate, endDate, page, limit } = req.query;

      const result = await attendanceService.getUserAttendance(
        userId,
        req.organizationId!,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined,
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
        error: error.message || 'Failed to get attendance',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get user's attendance statistics
   */
  async getMyStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const { month, year } = req.query;

      const stats = await attendanceService.getUserStats(
        userId,
        req.organizationId!,
        month ? parseInt(month as string) : undefined,
        year ? parseInt(year as string) : undefined
      );

      res.status(200).json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get statistics',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get all attendance records (Admin/HR)
   */
  async getAllAttendance(req: Request, res: Response): Promise<void> {
    try {
      const { date, startDate, endDate, status, department, page, limit } = req.query;

      const filters: any = {};
      if (date) filters.date = new Date(date as string);
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      if (status) filters.status = status as AttendanceStatus;
      if (department) filters.department = department as string;

      const result = await attendanceService.getAllAttendance(
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
        error: error.message || 'Failed to get attendance',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get specific user's attendance (Admin/HR/Supervisor)
   */
  async getUserAttendance(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { startDate, endDate, page, limit } = req.query;

      const result = await attendanceService.getUserAttendance(
        userId,
        req.organizationId!,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined,
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
        error: error.message || 'Failed to get attendance',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const attendanceController = new AttendanceController();
