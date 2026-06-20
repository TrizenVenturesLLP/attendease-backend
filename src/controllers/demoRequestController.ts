import { Request, Response, NextFunction } from 'express';
import demoRequestService from '../services/demoRequestService';
import { DemoRequestSource, DemoRequestStatus } from '../models/DemoRequest';
import { UserRole } from '../models/User';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../utils/AppError';

class DemoRequestController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.userId) {
        throw new BadRequestError('User not authenticated');
      }

      const { name, email, company, phone, message, sendInvitation, role, invitationEmail } = req.body;
      const data = await demoRequestService.createAsAdmin(
        {
          name,
          email,
          company,
          phone,
          message,
          sendInvitation,
          role,
          invitationEmail,
        },
        req.user.userId
      );

      const response: ApiResponse = {
        success: true,
        message:
          sendInvitation === false
            ? 'Demo request created successfully'
            : 'Demo request created and invitation sent successfully',
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
      const status = req.query.status as DemoRequestStatus | undefined;
      const source = req.query.source as DemoRequestSource | undefined;
      const email = req.query.email as string | undefined;
      const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

      const data = await demoRequestService.list({
        status,
        source,
        email,
        page,
        limit,
      });

      const response: ApiResponse = {
        success: true,
        message: 'Demo requests retrieved',
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
      const data = await demoRequestService.getById(req.params.id);
      const response: ApiResponse = {
        success: true,
        message: 'Demo request retrieved',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status } = req.body;
      const data = await demoRequestService.updateStatus(req.params.id, status);
      const response: ApiResponse = {
        success: true,
        message: 'Demo request status updated',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async sendInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.userId) {
        throw new BadRequestError('User not authenticated');
      }

      const role = (req.body?.role as UserRole | undefined) ?? UserRole.ADMIN;
      const email = typeof req.body?.email === 'string' ? req.body.email : undefined;
      const data = await demoRequestService.sendInvitation(
        req.params.id,
        req.user.userId,
        role,
        { email }
      );

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

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await demoRequestService.remove(req.params.id);
      const response: ApiResponse = {
        success: true,
        message: 'Demo request deleted',
        data,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}

export default new DemoRequestController();
