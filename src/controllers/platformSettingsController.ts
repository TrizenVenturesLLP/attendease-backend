import { Request, Response, NextFunction } from 'express';
import platformSettingsService from '../services/platformSettingsService';
import { ApiResponse } from '../utils/ApiResponse';

class PlatformSettingsController {
  async getDemoInvitationDefaults(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const data = await platformSettingsService.getDemoInvitationDefaults();
      const response: ApiResponse = {
        success: true,
        message: 'Demo invitation defaults retrieved',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async updateDemoInvitationDefaults(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user?.userId) {
        res.status(401).json({
          success: false,
          message: 'User not authenticated',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const data = await platformSettingsService.updateDemoInvitationDefaults(
        req.body,
        req.user.userId
      );

      const response: ApiResponse = {
        success: true,
        message: 'Demo invitation defaults updated',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}

export default new PlatformSettingsController();
