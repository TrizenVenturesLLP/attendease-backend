import { Request, Response, NextFunction } from 'express';
import subscriptionService from '../services/subscriptionService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../utils/AppError';

class BillingController {
  /**
   * GET /api/billing/overview
   * Fetch current organization billing overview, trial status, and active user metrics
   */
  async getOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.organizationId || req.user?.organizationId;
      if (!organizationId) {
        throw new BadRequestError('Organization context required');
      }

      const overview = await subscriptionService.getBillingOverview(organizationId.toString());

      const response: ApiResponse<typeof overview> = {
        success: true,
        message: 'Billing overview retrieved successfully',
        data: overview,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/billing/invoices
   * Fetch billing invoices history
   */
  async getInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.organizationId || req.user?.organizationId;
      if (!organizationId) {
        throw new BadRequestError('Organization context required');
      }

      const overview = await subscriptionService.getBillingOverview(organizationId.toString());
      
      const invoices = [
        {
          id: `INV-${Date.now().toString().slice(-6)}`,
          date: new Date().toISOString().split('T')[0],
          amount: overview.currentMonthEstimate,
          status: 'Trial Period (₹0 due now)',
          pdfUrl: '#',
        },
      ];

      const response: ApiResponse<typeof invoices> = {
        success: true,
        message: 'Invoices retrieved successfully',
        data: invoices,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}

export default new BillingController();
