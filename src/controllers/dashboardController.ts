import { Request, Response, NextFunction } from 'express';
import { dashboardService } from '../services/dashboardService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../utils/AppError';
import { UserRole } from '../models/User';

class DashboardController {
  /**
   * @route   GET /api/dashboard/stats
   * @desc    Get dashboard statistics (role-based)
   * @access  Private (Admin/HR/Supervisor)
   */
  async getDashboardStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const { role, userId } = req.user;
      
      // Super Admin doesn't need organizationId - they see system-wide stats
      const organizationId = role === UserRole.SUPER_ADMIN ? undefined : req.organizationId;

      const stats = await dashboardService.getDashboardStats(userId, organizationId, role as UserRole);

      const response: ApiResponse<typeof stats> = {
        success: true,
        message: 'Dashboard statistics retrieved successfully',
        data: stats,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}

export default new DashboardController();
