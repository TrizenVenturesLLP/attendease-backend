import { Request, Response } from 'express';
import { leaveTypeService } from '../services/leaveTypeService';
import { LeaveTypeStatus } from '../models/LeaveType';

export class LeaveTypeController {
  async list(req: Request, res: Response): Promise<void> {
    try {
      const activeOnly = req.query.activeOnly === 'true';
      const types = await leaveTypeService.list(req.organizationId!, activeOnly);
      res.status(200).json({ success: true, data: types });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const type = await leaveTypeService.getById(req.params.id, req.organizationId!);
      if (!type) {
        res.status(404).json({ success: false, error: 'Leave type not found' });
        return;
      }
      res.status(200).json({ success: true, data: type });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    try {
      const type = await leaveTypeService.create(req.organizationId!, req.body);
      res.status(201).json({ success: true, message: 'Leave type created', data: type });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async update(req: Request, res: Response): Promise<void> {
    try {
      const type = await leaveTypeService.update(req.params.id, req.organizationId!, req.body);
      if (!type) {
        res.status(404).json({ success: false, error: 'Leave type not found' });
        return;
      }
      res.status(200).json({ success: true, message: 'Leave type updated', data: type });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async updateStatus(req: Request, res: Response): Promise<void> {
    try {
      const { status } = req.body;
      const type = await leaveTypeService.updateStatus(
        req.params.id,
        req.organizationId!,
        status as LeaveTypeStatus
      );
      if (!type) {
        res.status(404).json({ success: false, error: 'Leave type not found' });
        return;
      }
      res.status(200).json({ success: true, message: 'Leave type status updated', data: type });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async delete(req: Request, res: Response): Promise<void> {
    try {
      await leaveTypeService.delete(req.params.id, req.organizationId!);
      res.status(200).json({ success: true, message: 'Leave type deleted' });
    } catch (error: any) {
      const status = error.statusCode === 404 ? 404 : 400;
      res.status(status).json({ success: false, error: error.message });
    }
  }
}

export const leaveTypeController = new LeaveTypeController();
