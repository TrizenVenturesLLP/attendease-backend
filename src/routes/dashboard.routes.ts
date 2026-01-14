import { Router } from 'express';
import dashboardController from '../controllers/dashboardController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';
import { UserRole } from '../models/User';

const router = Router();

// All dashboard routes require authentication
router.use(authenticate);

// Apply tenant context middleware
router.use(tenantContext, allowOrganizationOverride);

/**
 * @route   GET /api/dashboard/stats
 * @desc    Get dashboard statistics (role-based)
 * @access  Private (Admin/HR/Supervisor)
 */
router.get(
  '/stats',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR),
  dashboardController.getDashboardStats.bind(dashboardController)
);

export default router;


