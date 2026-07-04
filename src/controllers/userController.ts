import { Request, Response, NextFunction } from 'express';
import userService, { CreateUserData, UpdateUserData, UserFilters } from '../services/userService';
import emailNotificationService from '../services/emailNotificationService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError, ForbiddenError } from '../utils/AppError';
import { UserRole } from '../models/User';
import { resolveOrganizationId } from '../utils/resolveOrganizationId';
import { logger } from '../utils/logger';

class UserController {
  /**
   * @route   POST /api/users
   * @desc    Create a new user
   * @access  Private (Super Admin/Admin/HR)
   */
  async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      let organizationId = req.organizationId || req.body.organizationId;
      if (req.body.role !== UserRole.SUPER_ADMIN && !organizationId) {
        organizationId = await resolveOrganizationId(req);
      } else if (organizationId && !req.organizationId) {
        req.organizationId = organizationId;
      }

      const userData: CreateUserData = {
        ...req.body,
        organizationId,
      };

      // Role-based validation: prevent lower roles from creating higher roles
      if (req.user.role === UserRole.HR && userData.role !== UserRole.EMPLOYEE) {
        throw new ForbiddenError('HR can only create employees');
      }

      if (
        req.user.role === UserRole.ADMIN &&
        (userData.role === UserRole.SUPER_ADMIN || userData.role === UserRole.ADMIN)
      ) {
        throw new ForbiddenError('Admin cannot create super admin or other admin users');
      }

      // Super Admin creating another Super Admin doesn't need organizationId
      // Super Admin creating organization Admin DOES need organizationId
      if (req.user.role === UserRole.SUPER_ADMIN) {
        if (userData.role !== UserRole.SUPER_ADMIN && !userData.organizationId) {
          throw new BadRequestError(
            'Organization ID is required when creating organization users'
          );
        }
        if (userData.role === UserRole.SUPER_ADMIN && userData.organizationId) {
          // Prevent creating platform-level System Admin from organization-scoped flow
          throw new BadRequestError(
            'System Admin cannot be created with organization context. Use the system admin creation flow.'
          );
        }
      }

      logger.info('Create user request', {
        email: userData.email,
        role: userData.role,
        organizationId: userData.organizationId,
        createdBy: req.user.userId,
      });

      const user = await userService.createUser(userData, req.user.userId);
      const inviteRole = (userData.role || user.role) as UserRole;

      logger.info('User created, triggering invitation email', {
        userId: user._id,
        email: user.email,
        requestedRole: userData.role,
        savedRole: user.role,
        inviteRole,
        organizationId: user.organizationId?.toString(),
        createdBy: req.user.userId,
      });

      let invitationEmailSent = false;
      let invitationEmailError: string | undefined;

      try {
        await emailNotificationService.sendRoleInvitation({
          email: user.email,
          role: inviteRole,
          organizationId:
            user.organizationId?.toString() ||
            userData.organizationId ||
            req.organizationId ||
            undefined,
          invitedByUserId: req.user.userId,
          firstName: user.firstName,
          lastName: user.lastName,
        });
        invitationEmailSent = true;
      } catch (emailError: any) {
        invitationEmailError =
          emailError?.response?.data?.error ||
          emailError?.response?.data?.message ||
          emailError?.message ||
          'Email service error';
        logger.error('Invitation email failed after user create', {
          email: user.email,
          error: invitationEmailError,
        });
      }

      const response: ApiResponse<typeof user> = {
        success: true,
        message: invitationEmailSent
          ? 'User created successfully. Invitation email queued.'
          : `User created, but invitation email failed: ${invitationEmailError}. Check backend and email-service logs.`,
        data: user,
        timestamp: new Date().toISOString(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/users
   * @desc    Get all users with filters
   * @access  Private (role-based)
   */
  async getAllUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const filters: UserFilters = {
        role: req.query.role as UserRole | undefined,
        department: req.query.department as string | undefined,
        isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
        search: req.query.search as string | undefined,
      };

      // Pass organizationId, requester role, and requester ID for permission filtering
      const users = await userService.getAllUsers(
        filters, 
        req.organizationId,
        req.user.role as UserRole
      );

      const response: ApiResponse<typeof users> = {
        success: true,
        message: 'Users retrieved successfully',
        data: users,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/users/department/:dept
   * @desc    Get users by department
   * @access  Private
   */
  async getUsersByDepartment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { dept } = req.params;

      const users = await userService.getUsersByDepartment(dept, req.organizationId);

      const response: ApiResponse<typeof users> = {
        success: true,
        message: 'Department users retrieved successfully',
        data: users,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/users/team/:supervisorId
   * @desc    Get team members for a supervisor
   * @access  Private
   */
  async getTeamMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { supervisorId } = req.params;

      const users = await userService.getTeamMembers(supervisorId, req.organizationId);

      const response: ApiResponse<typeof users> = {
        success: true,
        message: 'Team members retrieved successfully',
        data: users,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/users/:id
   * @desc    Get user by ID
   * @access  Private
   */
  async getUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }
      const { id } = req.params;

      const user = await userService.getUserById(
        id, 
        req.organizationId,
        req.user.role as UserRole,
        req.user.userId
      );

      const response: ApiResponse<typeof user> = {
        success: true,
        message: 'User retrieved successfully',
        data: user,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   PATCH /api/users/:id
   * @desc    Update user information
   * @access  Private
   */
  async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const { id } = req.params;
      const updates: UpdateUserData = req.body;

      // Pass requester role and ID for permission validation
      const user = await userService.updateUser(
        id, 
        updates, 
        req.user.role as UserRole,
        req.user.userId
      );

      const response: ApiResponse<typeof user> = {
        success: true,
        message: 'User updated successfully',
        data: user,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/users/next-employee-id
   * @desc    Suggest next employee ID for an organization
   * @access  Private (Super Admin/Admin/HR)
   */
  async getNextEmployeeId(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId =
        (req.organizationId as string | undefined) ||
        (req.query.organizationId as string | undefined);

      if (!organizationId) {
        throw new BadRequestError('Organization ID is required');
      }

      const role = (req.query.role as string | undefined) as UserRole | undefined;
      const department = req.query.department as string | undefined;

      const result = await userService.getNextEmployeeId(organizationId, role, department);

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   PATCH /api/users/:id/role
   * @desc    Update user role
   * @access  Private (Super Admin/Admin)
   */
  async updateUserRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const { id } = req.params;
      const { role } = req.body;

      if (!role) {
        throw new BadRequestError('Role is required');
      }

      const user = await userService.updateUserRole(id, role as UserRole);

      const response: ApiResponse<typeof user> = {
        success: true,
        message: 'User role updated successfully',
        data: user,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   PATCH /api/users/:id/supervisor
   * @desc    Assign supervisor to user
   * @access  Private (Admin/HR)
   */
  async assignSupervisor(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { supervisorId } = req.body;

      if (!supervisorId) {
        throw new BadRequestError('Supervisor ID is required');
      }

      const user = await userService.assignSupervisor(id, supervisorId);

      const response: ApiResponse<typeof user> = {
        success: true,
        message: 'Supervisor assigned successfully',
        data: user,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   POST /api/users/:id/resend-invitation
   * @desc    Resend invitation email to an existing user
   * @access  Private (Super Admin/Admin)
   */
  async resendInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const { id } = req.params;
      const user = await userService.getUserById(id, req.organizationId);

      if (user.role === UserRole.SUPER_ADMIN) {
        throw new ForbiddenError('Cannot send invitation to super admin');
      }

      logger.info('Resending invitation email', {
        userId: id,
        email: user.email,
        role: user.role,
      });

      await userService.resetInvitationForResend(id, req.organizationId);

      await emailNotificationService.sendRoleInvitation({
        email: user.email,
        role: user.role as UserRole,
        organizationId:
          user.organizationId?.toString() || req.organizationId || undefined,
        invitedByUserId: req.user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
      });

      const response: ApiResponse = {
        success: true,
        message: 'Invitation email sent successfully',
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   DELETE /api/users/:id
   * @desc    Permanently delete user (removes email from DB)
   * @access  Private (Super Admin/Admin)
   */
  async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const { id } = req.params;

      await userService.deleteUser(
        id,
        req.user.userId,
        req.user.role as UserRole,
        req.organizationId
      );

      const response: ApiResponse = {
        success: true,
        message: 'User permanently deleted',
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/users/stats
   * @desc    Get user statistics
   * @access  Private (Super Admin/Admin/HR)
   */
  async getUserStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = await userService.getUserStats(req.organizationId);

      const response: ApiResponse<typeof stats> = {
        success: true,
        message: 'User statistics retrieved successfully',
        data: stats,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  async updateUserAttendancePolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { attendancePolicyId } = req.body;
      if (!attendancePolicyId) {
        throw new BadRequestError('attendancePolicyId is required');
      }
      const user = await userService.updateUserAttendancePolicy(
        id,
        attendancePolicyId,
        req.organizationId!
      );
      res.status(200).json({
        success: true,
        message: 'Attendance policy updated',
        data: user,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUserPolicies(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const user = await userService.updateUserPolicies(id, req.organizationId!, req.body);
      res.status(200).json({
        success: true,
        message: 'Policies updated',
        data: user,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   PATCH /api/users/:id/field-tracking
   * @desc    Enable or disable field tracking for a user
   * @access  Private (Super Admin/Admin/HR)
   * @body    { fieldTrackingEnabled: boolean, fieldTrackingIntervalMinutes?: number }
   */
  async toggleFieldTracking(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { fieldTrackingEnabled, fieldTrackingIntervalMinutes } = req.body;

      if (typeof fieldTrackingEnabled !== 'boolean') {
        throw new BadRequestError('fieldTrackingEnabled must be a boolean (true or false)');
      }

      const updates: UpdateUserData = { fieldTrackingEnabled };

      if (fieldTrackingIntervalMinutes !== undefined) {
        const interval = parseInt(fieldTrackingIntervalMinutes);
        if (isNaN(interval) || interval < 1 || interval > 60) {
          throw new BadRequestError('fieldTrackingIntervalMinutes must be a number between 1 and 60');
        }
        updates.fieldTrackingIntervalMinutes = interval;
      }

      const user = await userService.updateUser(id, updates, req.user!.role as UserRole);

      const response: ApiResponse<typeof user> = {
        success: true,
        message: `Field tracking ${fieldTrackingEnabled ? 'enabled' : 'disabled'} for user`,
        data: user,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}

export default new UserController();
