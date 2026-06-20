import { Request, Response } from 'express';
import { shiftService } from '../services/shiftService';
import { ShiftStatus } from '../models/Shift';

export class ShiftController {
  async create(req: Request, res: Response): Promise<void> {
    try {
      const shift = await shiftService.createShift(
        req.organizationId!,
        req.body,
        req.user!.userId
      );
      res.status(201).json({ success: true, message: 'Shift created', data: shift });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async list(req: Request, res: Response): Promise<void> {
    try {
      const status = req.query.status as ShiftStatus | undefined;
      const shifts = await shiftService.getAllShifts(req.organizationId!, status);
      res.status(200).json({ success: true, data: shifts });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const shift = await shiftService.getShiftById(req.params.id, req.organizationId!);
      if (!shift) {
        res.status(404).json({ success: false, error: 'Shift not found' });
        return;
      }
      res.status(200).json({ success: true, data: shift });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async update(req: Request, res: Response): Promise<void> {
    try {
      const shift = await shiftService.updateShift(
        req.params.id,
        req.organizationId!,
        req.body,
        req.user!.userId
      );
      if (!shift) {
        res.status(404).json({ success: false, error: 'Shift not found' });
        return;
      }
      res.status(200).json({ success: true, message: 'Shift updated', data: shift });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async updateStatus(req: Request, res: Response): Promise<void> {
    try {
      const { status } = req.body;
      if (!status || !Object.values(ShiftStatus).includes(status)) {
        res.status(400).json({ success: false, error: 'Valid status required (ACTIVE / INACTIVE)' });
        return;
      }
      const shift = await shiftService.updateStatus(
        req.params.id,
        req.organizationId!,
        status,
        req.user!.userId
      );
      if (!shift) {
        res.status(404).json({ success: false, error: 'Shift not found' });
        return;
      }
      res.status(200).json({ success: true, message: 'Shift status updated', data: shift });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
}

export const shiftController = new ShiftController();
