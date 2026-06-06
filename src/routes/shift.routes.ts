import { Router } from 'express';
import { shiftController } from '../controllers/shiftController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';
import { UserRole } from '../models/User';

const router = Router();

router.use(authenticate);
router.use(tenantContext, allowOrganizationOverride);

router.get(
  '/',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  shiftController.list.bind(shiftController)
);

router.get(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  shiftController.getById.bind(shiftController)
);

router.post(
  '/',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  shiftController.create.bind(shiftController)
);

router.put(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  shiftController.update.bind(shiftController)
);

router.patch(
  '/:id/status',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  shiftController.updateStatus.bind(shiftController)
);

export default router;
