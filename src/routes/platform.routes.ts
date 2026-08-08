import { Router } from 'express';
import { authenticate, authorize, authorizeEmail } from '../middleware/auth';
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

// Restricted to demo@trizenventures.com
const demoRequestAuth = authorizeEmail('demo@trizenventures.com');

router.get('/demo-requests', demoRequestAuth, demoRequestController.list.bind(demoRequestController));
router.post('/demo-requests', demoRequestAuth, demoRequestController.create.bind(demoRequestController));
router.get('/demo-requests/:id', demoRequestAuth, demoRequestController.getById.bind(demoRequestController));
router.patch('/demo-requests/:id/status', demoRequestAuth, demoRequestController.updateStatus.bind(demoRequestController));
router.post(
  '/demo-requests/:id/send-invitation',
  demoRequestAuth,
  demoRequestController.sendInvitation.bind(demoRequestController)
);
router.delete('/demo-requests/:id', demoRequestAuth, demoRequestController.remove.bind(demoRequestController));

export default router;
