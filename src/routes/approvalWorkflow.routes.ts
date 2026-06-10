import { Router } from 'express';
import { approvalWorkflowController } from '../controllers/approvalWorkflowController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';
import { UserRole } from '../models/User';

const router = Router();

router.use(authenticate);
router.use(tenantContext, allowOrganizationOverride);

router.get(
  '/',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  approvalWorkflowController.list.bind(approvalWorkflowController)
);

router.get(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  approvalWorkflowController.getById.bind(approvalWorkflowController)
);

router.post(
  '/',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  approvalWorkflowController.create.bind(approvalWorkflowController)
);

router.put(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  approvalWorkflowController.update.bind(approvalWorkflowController)
);

router.patch(
  '/:id/default',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  approvalWorkflowController.setDefault.bind(approvalWorkflowController)
);

router.delete(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  approvalWorkflowController.delete.bind(approvalWorkflowController)
);

export default router;
