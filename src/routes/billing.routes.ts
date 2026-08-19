import { Router } from 'express';
import billingController from '../controllers/billingController';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * @route   GET /api/billing/overview
 * @desc    Get billing overview, plan, trial details, and active user metrics
 * @access  Private
 */
router.get('/overview', authenticate, billingController.getOverview);

/**
 * @route   GET /api/billing/invoices
 * @desc    Get organization billing invoices
 * @access  Private
 */
router.get('/invoices', authenticate, billingController.getInvoices);

export default router;
