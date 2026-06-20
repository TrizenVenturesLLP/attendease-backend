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
router.get('/preview-days', leaveController.previewLeaveDays.bind(leaveController));
router.get('/calendar', leaveController.getCalendarLeaves.bind(leaveController));
router.get('/:id/attachment', leaveController.getLeaveAttachment.bind(leaveController));
router.get('/:id/approvals', leaveController.getLeaveApprovals.bind(leaveController));
router.patch('/:id/cancel', leaveController.cancelLeave.bind(leaveController));

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

// Supervisor/HR/Admin - view team leaves (supervisor gets only their team)
router.get(
  '/team',
  authorize('supervisor', 'hr', 'admin', 'super_admin'),
  leaveController.getTeamLeaves.bind(leaveController)
);

router.patch(
  '/balances/adjust',
  authorize('hr', 'admin', 'super_admin'),
  leaveController.adjustBalance.bind(leaveController)
);

export default router;
