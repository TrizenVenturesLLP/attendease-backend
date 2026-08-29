import { Request, Response, NextFunction } from 'express';
import demoAccessService from '../services/demoAccessService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../utils/AppError';

class DemoAccessController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await demoAccessService.list({
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        page: req.query.page ? parseInt(String(req.query.page), 10) : undefined,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined,
      });
      const response: ApiResponse = {
        success: true,
        message: 'Demo access accounts retrieved',
        data: data.items,
        meta: data.meta,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async updateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.userId) throw new BadRequestError('User not authenticated');
      const employeeLimit = Number(req.body?.employeeLimit);
      const data = await demoAccessService.updateLimit(req.params.organizationId, employeeLimit);
      const response: ApiResponse = {
        success: true,
        message: 'Demo user limit updated',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async getGlobalLimit(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await demoAccessService.getGlobalLimit();
      res.status(200).json({
        success: true,
        message: 'Global demo user limit retrieved',
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  async updateGlobalLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.userId) throw new BadRequestError('User not authenticated');
      const data = await demoAccessService.updateGlobalLimit(
        Number(req.body?.employeeLimit),
        req.user.userId
      );
      res.status(200).json({
        success: true,
        message: 'Global demo user limit updated',
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.userId) throw new BadRequestError('User not authenticated');
      const data = await demoAccessService.remove(req.params.id);
      res.status(200).json({
        success: true,
        message: 'Demo access account deleted',
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new DemoAccessController();
