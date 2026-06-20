import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';
import notificationController from '../controllers/notificationController';

const router = Router();

router.use(authenticate);
router.use(tenantContext, allowOrganizationOverride);

router.get('/', notificationController.getNotifications.bind(notificationController));
router.post('/mark-read', notificationController.markRead.bind(notificationController));
router.post('/mark-all-read', notificationController.markAllRead.bind(notificationController));

export default router;
