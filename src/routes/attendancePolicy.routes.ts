import { Router } from 'express';
import { attendancePolicyController } from '../controllers/attendancePolicyController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';
import { UserRole } from '../models/User';

const router = Router();

router.use(authenticate);
router.use(tenantContext, allowOrganizationOverride);

router.get(
  '/',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  attendancePolicyController.list.bind(attendancePolicyController)
);

router.get(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN, UserRole.EMPLOYEE, UserRole.SUPERVISOR),
  attendancePolicyController.getById.bind(attendancePolicyController)
);

router.post(
  '/',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  attendancePolicyController.create.bind(attendancePolicyController)
);

router.put(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  attendancePolicyController.update.bind(attendancePolicyController)
);

router.patch(
  '/:id/status',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  attendancePolicyController.updateStatus.bind(attendancePolicyController)
);

router.patch(
  '/:id/default',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  attendancePolicyController.setDefault.bind(attendancePolicyController)
);

router.delete(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  attendancePolicyController.delete.bind(attendancePolicyController)
);

export default router;
