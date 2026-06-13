import { Request, Response } from 'express';
import { leavePolicyService } from '../services/leavePolicyService';

export class LeavePolicyController {
  async list(req: Request, res: Response): Promise<void> {
    try {
      const policies = await leavePolicyService.list(req.organizationId!);
      res.status(200).json({ success: true, data: policies });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const policy = await leavePolicyService.getById(req.params.id, req.organizationId!);
      if (!policy) {
        res.status(404).json({ success: false, error: 'Leave policy not found' });
        return;
      }
      res.status(200).json({ success: true, data: policy });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    try {
      const policy = await leavePolicyService.create(
        req.organizationId!,
        req.body,
        req.user!.userId
      );
      res.status(201).json({ success: true, message: 'Leave policy created', data: policy });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async update(req: Request, res: Response): Promise<void> {
    try {
      const policy = await leavePolicyService.update(
        req.params.id,
        req.organizationId!,
        req.body,
        req.user!.userId
      );
      if (!policy) {
        res.status(404).json({ success: false, error: 'Leave policy not found' });
        return;
      }
      res.status(200).json({ success: true, message: 'Leave policy updated', data: policy });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async setDefault(req: Request, res: Response): Promise<void> {
    try {
      const policy = await leavePolicyService.setDefault(
        req.params.id,
        req.organizationId!,
        req.user!.userId
      );
      if (!policy) {
        res.status(404).json({ success: false, error: 'Leave policy not found' });
        return;
      }
      res.status(200).json({ success: true, message: 'Default leave policy updated', data: policy });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async delete(req: Request, res: Response): Promise<void> {
    try {
      await leavePolicyService.delete(req.params.id, req.organizationId!);
      res.status(200).json({ success: true, message: 'Leave policy deleted' });
    } catch (error: any) {
      const status = error.statusCode === 404 ? 404 : 400;
      res.status(status).json({ success: false, error: error.message });
    }
  }
}

export const leavePolicyController = new LeavePolicyController();
