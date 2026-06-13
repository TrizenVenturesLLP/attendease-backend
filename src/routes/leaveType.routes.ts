import { Router } from 'express';
import { leaveTypeController } from '../controllers/leaveTypeController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';
import { UserRole } from '../models/User';

const router = Router();

router.use(authenticate);
router.use(tenantContext, allowOrganizationOverride);

router.get(
  '/',
  authorize(
    UserRole.ADMIN,
    UserRole.HR,
    UserRole.SUPER_ADMIN,
    UserRole.EMPLOYEE,
    UserRole.SUPERVISOR
  ),
  leaveTypeController.list.bind(leaveTypeController)
);

router.get(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  leaveTypeController.getById.bind(leaveTypeController)
);

router.post(
  '/',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  leaveTypeController.create.bind(leaveTypeController)
);

router.put(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  leaveTypeController.update.bind(leaveTypeController)
);

router.patch(
  '/:id/status',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  leaveTypeController.updateStatus.bind(leaveTypeController)
);

router.delete(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.HR, UserRole.SUPER_ADMIN),
  leaveTypeController.delete.bind(leaveTypeController)
);

export default router;
