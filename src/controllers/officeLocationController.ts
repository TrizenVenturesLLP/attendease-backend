import { Request, Response, NextFunction } from 'express';
import { officeLocationService } from '../services/officeLocationService';

export class OfficeLocationController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const location = await officeLocationService.create(
        req.organizationId!,
        req.body,
        req.user?.userId
      );
      res.status(201).json({
        success: true,
        message: 'Office location created successfully',
        data: location,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const activeOnly = req.query.activeOnly === 'true';
      const locations = await officeLocationService.list(req.organizationId!, activeOnly);
      res.status(200).json({
        success: true,
        data: locations,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      const location = await officeLocationService.update(id, req.organizationId!, req.body);
      res.status(200).json({
        success: true,
        message: 'Office location updated successfully',
        data: location,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  async deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params as { id: string };
      await officeLocationService.deactivate(id, req.organizationId!);
      res.status(200).json({
        success: true,
        message: 'Office location deactivated successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
}

export const officeLocationController = new OfficeLocationController();
