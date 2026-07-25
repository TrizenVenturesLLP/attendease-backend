import { Router } from 'express';
import userController from '../controllers/userController';
import { authenticate, authorize } from '../middleware/auth';
import { tenantContext, allowOrganizationOverride } from '../middleware/tenantContext';
import { UserRole } from '../models/User';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Apply tenant context middleware (extracts organizationId from JWT)
// Allows Super Admin to override with query param
router.use(tenantContext, allowOrganizationOverride);

/**
 * @route   GET /api/users/stats
 * @desc    Get user statistics
 * @access  Private (Super Admin/Admin only)
 */
router.get(
  '/stats',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  userController.getUserStats
);

/**
 * @route   GET /api/users/department/:dept
 * @desc    Get users by department
 * @access  Private (All authenticated users)
 */
router.get('/department/:dept', userController.getUsersByDepartment);

/**
 * @route   GET /api/users/team/:supervisorId
 * @desc    Get team members
 * @access  Private (Supervisor/Admin/HR)
 */
router.get(
  '/team/:supervisorId',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR),
  userController.getTeamMembers
);

/**
 * @route   POST /api/users
 * @desc    Create new user
 * @access  Private (Super Admin/Admin/HR)
 */
router.post(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  userController.createUser
);

/**
 * @route   GET /api/users
 * @desc    Get all users with filters
 * @access  Private (Super Admin/Admin/HR only - Supervisors use /team endpoint)
 */
router.get(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR),
  userController.getAllUsers
);

/**
 * @route   GET /api/users/next-employee-id
 * @desc    Suggest next employee ID for an organization
 * @access  Private (Super Admin/Admin/HR)
 */
router.get(
  '/next-employee-id',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  userController.getNextEmployeeId
);

/**
 * @route   PATCH /api/users/:id/status
 * @desc    Activate or deactivate user account
 * @access  Private (Super Admin/Admin/HR)
 */
router.patch(
  '/:id/status',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  userController.updateUserStatus
);

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID
 * @access  Private (All authenticated users)
 */
router.get('/:id', userController.getUserById);

/**
 * @route   PATCH /api/users/:id
 * @desc    Update user
 * @access  Private (Super Admin/Admin/HR - HR can only update employees, service validates)
 */
router.patch(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  userController.updateUser
);

/**
 * @route   PATCH /api/users/:id/role
 * @desc    Update user role
 * @access  Private (Super Admin/Admin)
 */
router.patch(
  '/:id/role',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  userController.updateUserRole
);

/**
 * @route   PATCH /api/users/:id/supervisor
 * @desc    Assign supervisor
 * @access  Private (Super Admin/Admin/HR)
 */
router.patch(
  '/:id/supervisor',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  userController.assignSupervisor
);

router.patch(
  '/:id/attendance-policy',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  userController.updateUserAttendancePolicy
);

router.patch(
  '/:id/policies',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  userController.updateUserPolicies
);

/**
 * @route   POST /api/users/:id/resend-invitation
 * @desc    Resend invitation email
 * @access  Private (Super Admin/Admin)
 */
router.post(
  '/:id/resend-invitation',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  userController.resendInvitation
);

/**
 * @route   PATCH /api/users/:id/field-tracking
 * @desc    Enable or disable field location tracking for a specific user
 * @access  Private (Super Admin/Admin/HR)
 * @body    { fieldTrackingEnabled: boolean, fieldTrackingIntervalMinutes?: number }
 */
router.patch(
  '/:id/field-tracking',
  authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR),
  userController.toggleFieldTracking
);

/**
 * @route   DELETE /api/users/:id
 * @desc    Delete user
 * @access  Private (Super Admin/Admin)
 */
router.delete('/:id', authorize(UserRole.SUPER_ADMIN, UserRole.ADMIN), userController.deleteUser);

export default router;
