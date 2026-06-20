import { Router } from 'express';
import { leavePolicyController } from '../controllers/leavePolicyController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';
import { UserRole } from '../models/User';

const router = Router();

router.use(authenticate);
router.use(tenantContext, allowOrganizationOverride);

router.get(
  '/',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  leavePolicyController.list.bind(leavePolicyController)
);

router.get(
  '/:id',
  authorize(
    UserRole.ADMIN,
    UserRole.HR,
    UserRole.SUPER_ADMIN,
    UserRole.EMPLOYEE,
    UserRole.SUPERVISOR
  ),
  leavePolicyController.getById.bind(leavePolicyController)
);

router.post(
  '/',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  leavePolicyController.create.bind(leavePolicyController)
);

router.put(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  leavePolicyController.update.bind(leavePolicyController)
);

router.patch(
  '/:id/default',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  leavePolicyController.setDefault.bind(leavePolicyController)
);

router.delete(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  leavePolicyController.delete.bind(leavePolicyController)
);

export default router;
