import { Request, Response, NextFunction } from 'express';
import demoInvitationService from '../services/demoInvitationService';
import { DemoInvitationStatus } from '../models/DemoInvitation';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../utils/AppError';

class DemoInvitationController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.userId) {
        throw new BadRequestError('User not authenticated');
      }

      const { companyName, email, role, notes, inviteLinkTtlHours, demoAccessTtlDays, createDemoTenant, demoTenantId } =
        req.body;

      const data = await demoInvitationService.create({
        companyName,
        email,
        role,
        notes,
        inviteLinkTtlHours,
        demoAccessTtlDays,
        createDemoTenant,
        demoTenantId,
        invitedByUserId: req.user.userId,
      });

      const response: ApiResponse = {
        success: true,
        message: 'Demo invitation sent successfully',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = req.query.status as DemoInvitationStatus | undefined;
      const email = req.query.email as string | undefined;
      const demoTenantId = req.query.demoTenantId as string | undefined;
      const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

      const data = await demoInvitationService.list({
        status,
        email,
        demoTenantId,
        page,
        limit,
      });

      const response: ApiResponse = {
        success: true,
        message: 'Demo invitations retrieved',
        data: data.items,
        meta: data.meta,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await demoInvitationService.getById(req.params.id);
      const response: ApiResponse = {
        success: true,
        message: 'Demo invitation retrieved',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async revoke(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await demoInvitationService.revoke(req.params.id);
      const response: ApiResponse = {
        success: true,
        message: 'Demo invitation access revoked',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async suspend(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await demoInvitationService.suspendAccess(req.params.id);
      const response: ApiResponse = {
        success: true,
        message: 'Demo access suspended',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async restore(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await demoInvitationService.restoreAccess(req.params.id);
      const response: ApiResponse = {
        success: true,
        message: 'Demo access restored',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async resend(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.userId) {
        throw new BadRequestError('User not authenticated');
      }

      const data = await demoInvitationService.resend(req.params.id, req.user.userId);
      const response: ApiResponse = {
        success: true,
        message: 'Demo invitation resent',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}

export default new DemoInvitationController();
