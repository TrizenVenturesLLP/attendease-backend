import { Request, Response, NextFunction } from 'express';
import userService, { CreateUserData, UpdateUserData, UserFilters } from '../services/userService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError, ForbiddenError } from '../utils/AppError';
import { UserRole } from '../models/User';

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

      const userData: CreateUserData = {
        ...req.body,
        // Use organizationId from tenant middleware or from body (for Super Admin)
        organizationId: req.organizationId || req.body.organizationId,
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

      // Super Admin must provide organizationId
      if (req.user.role === UserRole.SUPER_ADMIN && !userData.organizationId) {
        throw new BadRequestError('Organization ID is required for Super Admin');
      }

      const user = await userService.createUser(userData, req.user.userId);

      const response: ApiResponse<typeof user> = {
        success: true,
        message: 'User created successfully',
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
        req.user.role as UserRole,
        req.user.userId
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
      const { id } = req.params;

      const user = await userService.getUserById(id, req.organizationId);

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

      // Pass requester role for permission validation
      const user = await userService.updateUser(id, updates, req.user.role as UserRole);

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
   * @route   DELETE /api/users/:id
   * @desc    Delete user (soft delete)
   * @access  Private (Super Admin/Admin)
   */
  async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      await userService.deleteUser(id);

      const response: ApiResponse = {
        success: true,
        message: 'User deleted successfully',
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
}

export default new UserController();
