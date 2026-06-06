import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';
import platformSettingsController from '../controllers/platformSettingsController';
import demoInvitationController from '../controllers/demoInvitationController';

const router = Router();

router.use(authenticate, authorize(UserRole.SUPER_ADMIN));

router.get(
  '/settings/demo-invitations',
  platformSettingsController.getDemoInvitationDefaults.bind(platformSettingsController)
);
router.patch(
  '/settings/demo-invitations',
  platformSettingsController.updateDemoInvitationDefaults.bind(platformSettingsController)
);

router.get('/demo-invites', demoInvitationController.list.bind(demoInvitationController));
router.post('/demo-invites', demoInvitationController.create.bind(demoInvitationController));
router.get('/demo-invites/:id', demoInvitationController.getById.bind(demoInvitationController));
router.post('/demo-invites/:id/revoke', demoInvitationController.revoke.bind(demoInvitationController));
router.post('/demo-invites/:id/suspend', demoInvitationController.suspend.bind(demoInvitationController));
router.post('/demo-invites/:id/restore', demoInvitationController.restore.bind(demoInvitationController));
router.post('/demo-invites/:id/resend', demoInvitationController.resend.bind(demoInvitationController));

export default router;
