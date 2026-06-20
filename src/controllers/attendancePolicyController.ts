import { Request, Response } from 'express';
import { attendancePolicyService } from '../services/attendancePolicyService';
import { PolicyStatus } from '../models/AttendancePolicy';

export class AttendancePolicyController {
  async create(req: Request, res: Response): Promise<void> {
    try {
      const policy = await attendancePolicyService.createPolicy(
        req.organizationId!,
        req.body,
        req.user!.userId
      );
      res.status(201).json({
        success: true,
        message: 'Attendance policy created',
        data: policy,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async list(req: Request, res: Response): Promise<void> {
    try {
      const status = req.query.status as PolicyStatus | undefined;
      const policies = await attendancePolicyService.getAllPolicies(req.organizationId!, status);
      res.status(200).json({ success: true, data: policies });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const policy = await attendancePolicyService.getPolicyById(req.params.id, req.organizationId!);
      if (!policy) {
        res.status(404).json({ success: false, error: 'Policy not found' });
        return;
      }
      res.status(200).json({ success: true, data: policy });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async update(req: Request, res: Response): Promise<void> {
    try {
      const policy = await attendancePolicyService.updatePolicy(
        req.params.id,
        req.organizationId!,
        req.body,
        req.user!.userId
      );
      if (!policy) {
        res.status(404).json({ success: false, error: 'Policy not found' });
        return;
      }
      res.status(200).json({ success: true, message: 'Policy updated', data: policy });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async updateStatus(req: Request, res: Response): Promise<void> {
    try {
      const { status } = req.body;
      if (!status || !Object.values(PolicyStatus).includes(status)) {
        res.status(400).json({ success: false, error: 'Valid status required (ACTIVE / INACTIVE)' });
        return;
      }
      const policy = await attendancePolicyService.updateStatus(
        req.params.id,
        req.organizationId!,
        status,
        req.user!.userId
      );
      if (!policy) {
        res.status(404).json({ success: false, error: 'Policy not found' });
        return;
      }
      res.status(200).json({ success: true, message: 'Policy status updated', data: policy });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async setDefault(req: Request, res: Response): Promise<void> {
    try {
      const policy = await attendancePolicyService.setDefault(
        req.params.id,
        req.organizationId!,
        req.user!.userId
      );
      if (!policy) {
        res.status(404).json({ success: false, error: 'Policy not found' });
        return;
      }
      res.status(200).json({ success: true, message: 'Default policy updated', data: policy });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async delete(req: Request, res: Response): Promise<void> {
    try {
      await attendancePolicyService.deletePolicy(req.params.id, req.organizationId!);
      res.status(200).json({ success: true, message: 'Attendance policy deleted' });
    } catch (error: any) {
      const status = error.statusCode === 404 ? 404 : 400;
      res.status(status).json({ success: false, error: error.message });
    }
  }
}

export const attendancePolicyController = new AttendancePolicyController();
