import { Router } from 'express';
import { attendanceController } from '../controllers/attendanceController';
import { attendanceRegularizationController } from '../controllers/attendanceRegularizationController';
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
router.get('/my-policy', attendanceController.getMyPolicy);
router.get('/my-attendance', attendanceController.getMyAttendance);
router.get('/my-stats', attendanceController.getMyStats);

// Attendance regularization
router.post(
  '/regularization',
  attendanceRegularizationController.createRequest.bind(attendanceRegularizationController)
);
router.get(
  '/regularization/my',
  attendanceRegularizationController.getMyRequests.bind(attendanceRegularizationController)
);
router.get(
  '/regularization/pending',
  authorize(UserRole.SUPERVISOR, UserRole.HR, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  attendanceRegularizationController.getPendingRequests.bind(attendanceRegularizationController)
);
router.patch(
  '/regularization/:id/approve',
  authorize(UserRole.SUPERVISOR, UserRole.HR, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  attendanceRegularizationController.approveRequest.bind(attendanceRegularizationController)
);
router.patch(
  '/regularization/:id/reject',
  authorize(UserRole.SUPERVISOR, UserRole.HR, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  attendanceRegularizationController.rejectRequest.bind(attendanceRegularizationController)
);

// Admin/HR — mark auto-absent for a past date
router.post(
  '/mark-absent',
  authorize(UserRole.HR, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  attendanceController.markAutoAbsent.bind(attendanceController)
);

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

export default router;
