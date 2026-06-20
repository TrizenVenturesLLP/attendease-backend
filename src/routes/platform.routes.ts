import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';
import platformSettingsController from '../controllers/platformSettingsController';
import demoInvitationController from '../controllers/demoInvitationController';
import demoRequestController from '../controllers/demoRequestController';

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

router.get('/demo-requests', demoRequestController.list.bind(demoRequestController));
router.post('/demo-requests', demoRequestController.create.bind(demoRequestController));
router.get('/demo-requests/:id', demoRequestController.getById.bind(demoRequestController));
router.patch('/demo-requests/:id/status', demoRequestController.updateStatus.bind(demoRequestController));
router.post(
  '/demo-requests/:id/send-invitation',
  demoRequestController.sendInvitation.bind(demoRequestController)
);
router.delete('/demo-requests/:id', demoRequestController.remove.bind(demoRequestController));

export default router;
