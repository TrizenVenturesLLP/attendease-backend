import { Router } from 'express';
import { leaveController } from '../controllers/leaveController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Apply tenant context middleware
router.use(tenantContext, allowOrganizationOverride);

// Employee routes - all authenticated users can access
router.post('/request', leaveController.requestLeave.bind(leaveController));
router.get('/my-leaves', leaveController.getMyLeaves.bind(leaveController));
router.get('/my-balance', leaveController.getMyBalance.bind(leaveController));
router.patch('/:id/cancel', leaveController.cancelLeave.bind(leaveController));
router.get('/calendar', leaveController.getCalendarLeaves.bind(leaveController));

// Supervisor/HR/Admin routes - for leave approvals
router.get(
  '/pending',
  authorize('supervisor', 'hr', 'admin', 'super_admin'),
  leaveController.getPendingLeaves.bind(leaveController)
);

router.patch(
  '/:id/approve',
  authorize('supervisor', 'hr', 'admin', 'super_admin'),
  leaveController.approveLeave.bind(leaveController)
);

router.patch(
  '/:id/reject',
  authorize('supervisor', 'hr', 'admin', 'super_admin'),
  leaveController.rejectLeave.bind(leaveController)
);

// HR/Admin only - view all leaves
router.get(
  '/all',
  authorize('hr', 'admin', 'super_admin'),
  leaveController.getAllLeaves.bind(leaveController)
);

export default router;
