import { Request, Response, NextFunction } from 'express';
import { notificationService } from '../services/notificationService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../utils/AppError';

class NotificationController {
  async getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await notificationService.listForRequest(req);
      const response: ApiResponse<typeof data> = {
        success: true,
        message: 'Notifications loaded',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new BadRequestError('Not authenticated');
      }
      const keys = (req.body?.keys as string[]) || [];
      if (!Array.isArray(keys) || keys.length === 0) {
        throw new BadRequestError('keys array is required');
      }
      const safeKeys = keys
        .filter((k) => typeof k === 'string' && k.length > 0 && k.length <= 256)
        .slice(0, 100);
      await notificationService.markRead(userId, safeKeys);
      const data = await notificationService.listForRequest(req);
      const response: ApiResponse<typeof data> = {
        success: true,
        message: 'Marked as read',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new BadRequestError('Not authenticated');
      }
      await notificationService.markAllReadForRequest(req);
      const data = await notificationService.listForRequest(req);
      const response: ApiResponse<typeof data> = {
        success: true,
        message: 'All notifications marked as read',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}

export default new NotificationController();
