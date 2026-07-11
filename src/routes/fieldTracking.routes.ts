import { Router } from 'express';
import { fieldTrackingController } from '../controllers/fieldTrackingController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';
import { UserRole } from '../models/User';

const router = Router();

// All field tracking routes require authentication
router.use(authenticate);
router.use(tenantContext, allowOrganizationOverride);

// ─────────────────────────────────────────────
// Employee Routes (field staff)
// ─────────────────────────────────────────────

// Start a tracking session (called on check-in for field employees)
router.post('/session/start', fieldTrackingController.startSession);

// Send periodic location point every 5 minutes
router.post('/location', fieldTrackingController.recordLocation);

// Stop tracking session (called on check-out)
router.post('/session/stop', fieldTrackingController.stopSession);

// Persist / clear when location is turned off (grace countdown source of truth)
router.post('/location-disabled', fieldTrackingController.markLocationDisabled);
router.post('/location-restored', fieldTrackingController.clearLocationDisabled);

// Location was off for grace period — auto check-out + notify admins
router.post(
  '/location-disabled-checkout',
  fieldTrackingController.locationDisabledCheckout
);

// Get own active session (useful after app restart to resume tracking)
router.get('/session/active', fieldTrackingController.getActiveSession);

// ─────────────────────────────────────────────
// Admin / HR / Supervisor Routes
// ─────────────────────────────────────────────

// Live map — all currently active employee locations
router.get(
  '/live',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR),
  fieldTrackingController.getLiveSessions
);

// List all sessions with filters (userId, date, status)
router.get(
  '/sessions',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR),
  fieldTrackingController.getSessions
);

// Get a specific session's full GPS path
router.get(
  '/session/:sessionId/path',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR),
  fieldTrackingController.getSessionPath
);

// Get full day path for a specific employee on a date
router.get(
  '/day-path',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR),
  fieldTrackingController.getDayPath
);

// Force stop an active session
router.patch(
  '/session/:sessionId/force-stop',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  fieldTrackingController.forceStopSession
);

export default router;
