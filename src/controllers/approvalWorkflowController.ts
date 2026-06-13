import { Request, Response } from 'express';
import { approvalWorkflowService } from '../services/approvalWorkflowService';

export class ApprovalWorkflowController {
  async list(req: Request, res: Response): Promise<void> {
    try {
      const workflows = await approvalWorkflowService.list(req.organizationId!);
      res.status(200).json({ success: true, data: workflows });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const workflow = await approvalWorkflowService.getById(req.params.id, req.organizationId!);
      if (!workflow) {
        res.status(404).json({ success: false, error: 'Workflow not found' });
        return;
      }
      res.status(200).json({ success: true, data: workflow });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    try {
      const workflow = await approvalWorkflowService.create(req.organizationId!, req.body);
      res.status(201).json({ success: true, message: 'Workflow created', data: workflow });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async update(req: Request, res: Response): Promise<void> {
    try {
      const workflow = await approvalWorkflowService.update(
        req.params.id,
        req.organizationId!,
        req.body
      );
      if (!workflow) {
        res.status(404).json({ success: false, error: 'Workflow not found' });
        return;
      }
      res.status(200).json({ success: true, message: 'Workflow updated', data: workflow });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async setDefault(req: Request, res: Response): Promise<void> {
    try {
      const workflow = await approvalWorkflowService.setDefault(req.params.id, req.organizationId!);
      if (!workflow) {
        res.status(404).json({ success: false, error: 'Workflow not found' });
        return;
      }
      res.status(200).json({ success: true, message: 'Default workflow updated', data: workflow });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async delete(req: Request, res: Response): Promise<void> {
    try {
      await approvalWorkflowService.delete(req.params.id, req.organizationId!);
      res.status(200).json({ success: true, message: 'Workflow deleted' });
    } catch (error: any) {
      const status = error.statusCode === 404 ? 404 : 400;
      res.status(status).json({ success: false, error: error.message });
    }
  }
}

export const approvalWorkflowController = new ApprovalWorkflowController();
