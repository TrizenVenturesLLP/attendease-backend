import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import attendanceRoutes from './attendance.routes';
import leaveRoutes from './leave.routes';
import holidayRoutes from './holiday.routes';
import departmentRoutes from './department.routes';
import organizationRoutes from './organization.routes';
import dashboardRoutes from './dashboard.routes';
import healthRoutes from './health.routes';
import payrollRoutes from './payroll.routes';
import notificationRoutes from './notification.routes';
import attendancePolicyRoutes from './attendancePolicy.routes';
import shiftRoutes from './shift.routes';
import leaveTypeRoutes from './leaveType.routes';
import leavePolicyRoutes from './leavePolicy.routes';
import approvalWorkflowRoutes from './approvalWorkflow.routes';
import platformRoutes from './platform.routes';
import fieldTrackingRoutes from './fieldTracking.routes';

const router = Router();

// Health check route (public, no auth required)
router.use('/health', healthRoutes);

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/leaves', leaveRoutes);
router.use('/holidays', holidayRoutes);
router.use('/departments', departmentRoutes);
router.use('/organizations', organizationRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/payroll', payrollRoutes);
router.use('/notifications', notificationRoutes);
router.use('/attendance-policies', attendancePolicyRoutes);
router.use('/shifts', shiftRoutes);
router.use('/leave-types', leaveTypeRoutes);
router.use('/leave-policies', leavePolicyRoutes);
router.use('/approval-workflows', approvalWorkflowRoutes);
router.use('/platform', platformRoutes);
router.use('/field-tracking', fieldTrackingRoutes);

export default router;
