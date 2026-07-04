import { Router } from 'express';
import { attendanceController } from '../controllers/attendanceController';
import { officeLocationController } from '../controllers/officeLocationController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';
import { UserRole } from '../models/User';

const router = Router();

// All attendance routes require authentication
router.use(authenticate);

// Apply tenant context middleware
router.use(tenantContext, allowOrganizationOverride);

// Personal attendance routes
router.post('/check-in', attendanceController.checkIn);
router.post('/check-out', attendanceController.checkOut);
router.get('/today', attendanceController.getTodayStatus);
router.get('/my-attendance', attendanceController.getMyAttendance);
router.get('/my-stats', attendanceController.getMyStats);

// Admin/HR routes - view all attendance
router.get(
  '/all',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  attendanceController.getAllAttendance
);

// Supervisor/Admin/HR - view specific user attendance
router.get(
  '/user/:userId',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR),
  attendanceController.getUserAttendance
);

// Office Locations CRUD (Admin/HR)
router.post(
  '/office-locations',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  officeLocationController.create
);
router.get(
  '/office-locations',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  officeLocationController.list
);
router.patch(
  '/office-locations/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  officeLocationController.update
);
router.patch(
  '/office-locations/:id/deactivate',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  officeLocationController.deactivate
);

export default router;
