// Helper note: This file adds organizationId parameter to methods for multi-tenant support
// Key changes:
// 1. CreateUserData includes organizationId
// 2. All queries filter by organizationId when provided
// 3. Email/employeeId uniqueness is per-organization
// 4. Supervisor validation checks same organization

import User, { IUser, UserRole } from '../models/User';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../utils/AppError';
import mongoose from 'mongoose';

export interface CreateUserData {
  organizationId?: string; // Optional for Super Admin (platform-level), required for others
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  department?: string;
  supervisorId?: string;
  employeeId?: string;
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  department?: string;
  supervisorId?: string;
  employeeId?: string;
}

export interface UserFilters {
  role?: UserRole;
  department?: string;
  isActive?: boolean;
  search?: string;
}

class UserService {
  /**
   * Create a new user (Super Admin/Admin/HR only)
   */
  async createUser(userData: CreateUserData, createdByUserId: string): Promise<IUser> {
    // Special handling for Super Admin
    if (userData.role === UserRole.SUPER_ADMIN) {
      // Only Super Admin can create another Super Admin
      const createdBy = await User.findById(createdByUserId);
      if (!createdBy || createdBy.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenError('Only Super Admin can create other Super Admin users');
      }

      // Super Admin should NOT have organizationId
      if (userData.organizationId) {
        throw new BadRequestError('Super Admin users should not have an organization ID');
      }

      // Check if email already exists globally for Super Admin
      const existingSuperAdmin = await User.findOne({ 
        email: userData.email,
        role: UserRole.SUPER_ADMIN
      });
      if (existingSuperAdmin) {
        throw new ConflictError('Super Admin with this email already exists');
      }

      // Create Super Admin (no organization-related validations needed)
      const superAdmin = new User({
        email: userData.email,
        password: userData.password,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: UserRole.SUPER_ADMIN,
        createdBy: createdByUserId,
      });

      await superAdmin.save();
      return superAdmin;
    }

    // For non-Super Admin users, organizationId is required
    if (!userData.organizationId) {
      throw new BadRequestError('Organization ID is required for non-Super Admin users');
    }

    // Check if email already exists within the same organization
    const existingUser = await User.findOne({ 
      email: userData.email,
      organizationId: userData.organizationId 
    });
    if (existingUser) {
      throw new ConflictError('Email already in use in this organization');
    }

    // Check if employeeId already exists within the same organization (if provided)
    if (userData.employeeId) {
      const existingEmployee = await User.findOne({ 
        employeeId: userData.employeeId,
        organizationId: userData.organizationId
      });
      if (existingEmployee) {
        throw new ConflictError('Employee ID already in use in this organization');
      }
    }

    // Validate supervisor if provided (must be in same organization)
    if (userData.supervisorId) {
      const supervisor = await User.findOne({
        _id: userData.supervisorId,
        organizationId: userData.organizationId
      });
      if (!supervisor) {
        throw new NotFoundError('Supervisor not found in this organization');
      }
      if (supervisor.role !== UserRole.SUPERVISOR && supervisor.role !== UserRole.ADMIN) {
        throw new BadRequestError('Assigned supervisor must have supervisor or admin role');
      }
    }

    // Create user
    const user = new User({
      ...userData,
      createdBy: createdByUserId,
    });

    await user.save();

    return user;
  }

  /**
   * Get all users with optional filters (role-based access)
   * organizationId is required for non-Super Admin users
   */
  async getAllUsers(filters?: UserFilters, organizationId?: string): Promise<IUser[]> {
    const query: any = {};

    // Add organization filter (required for non-Super Admin)
    if (organizationId) {
      query.organizationId = organizationId;
    }

    // Apply filters
    if (filters?.role) {
      query.role = filters.role;
    }

    if (filters?.department) {
      query.department = filters.department;
    }

    if (filters?.isActive !== undefined) {
      query.isActive = filters.isActive;
    }

    // Search by name or email
    if (filters?.search) {
      query.$or = [
        { firstName: { $regex: filters.search, $options: 'i' } },
        { lastName: { $regex: filters.search, $options: 'i' } },
        { email: { $regex: filters.search, $options: 'i' } },
        { employeeId: { $regex: filters.search, $options: 'i' } },
      ];
    }

    const users = await User.find(query)
      .populate('supervisorId', 'firstName lastName email role')
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 });

    return users;
  }

  /**
   * Get users by department
   */
  async getUsersByDepartment(department: string, organizationId?: string): Promise<IUser[]> {
    const query: any = { department, isActive: true };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const users = await User.find(query)
      .populate('supervisorId', 'firstName lastName email')
      .sort({ firstName: 1 });

    return users;
  }

  /**
   * Get team members for a supervisor
   */
  async getTeamMembers(supervisorId: string, organizationId?: string): Promise<IUser[]> {
    const query: any = { supervisorId, isActive: true };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const users = await User.find(query)
      .populate('supervisorId', 'firstName lastName email')
      .sort({ firstName: 1 });

    return users;
  }

  /**
   * Get user by ID
   * organizationId is used to verify user belongs to organization (if provided)
   */
  async getUserById(userId: string, organizationId?: string): Promise<IUser> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user ID');
    }

    const query: any = { _id: userId };
    if (organizationId) {
      query.organizationId = organizationId;
    }

    const user = await User.findOne(query)
      .populate('supervisorId', 'firstName lastName email role department')
      .populate('createdBy', 'firstName lastName email');

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  /**
   * Update user role (Super Admin/Admin only)
   */
  async updateUserRole(userId: string, newRole: UserRole): Promise<IUser> {
    const user = await User.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Prevent changing super admin role (extra safety)
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Cannot change super admin role');
    }

    user.role = newRole;
    await user.save();

    return user;
  }

  /**
   * Assign supervisor to user
   */
  async assignSupervisor(userId: string, supervisorId: string): Promise<IUser> {
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const supervisor = await User.findOne({
      _id: supervisorId,
      organizationId: user.organizationId // Must be in same organization
    });
    if (!supervisor) {
      throw new NotFoundError('Supervisor not found in this organization');
    }

    if (supervisor.role !== UserRole.SUPERVISOR && supervisor.role !== UserRole.ADMIN) {
      throw new BadRequestError('Assigned user must have supervisor or admin role');
    }

    user.supervisorId = new mongoose.Types.ObjectId(supervisorId);
    await user.save();

    return user;
  }

  /**
   * Update user information
   */
  async updateUser(userId: string, updates: UpdateUserData): Promise<IUser> {
    const user = await User.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Check if employeeId is being changed and if it's already in use within organization
    if (updates.employeeId && updates.employeeId !== user.employeeId) {
      const existing = await User.findOne({ 
        employeeId: updates.employeeId,
        organizationId: user.organizationId
      });
      if (existing) {
        throw new ConflictError('Employee ID already in use in this organization');
      }
    }

    // Validate supervisor if being updated (must be in same organization)
    if (updates.supervisorId) {
      const supervisor = await User.findOne({
        _id: updates.supervisorId,
        organizationId: user.organizationId
      });
      if (!supervisor) {
        throw new NotFoundError('Supervisor not found in this organization');
      }
      if (supervisor.role !== UserRole.SUPERVISOR && supervisor.role !== UserRole.ADMIN) {
        throw new BadRequestError('Assigned supervisor must have supervisor or admin role');
      }
    }

    // Update fields
    Object.assign(user, updates);
    await user.save();

    return user;
  }

  /**
   * Delete user (soft delete by setting isActive to false)
   */
  async deleteUser(userId: string): Promise<void> {
    const user = await User.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Prevent deleting super admin
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Cannot delete super admin');
    }

    user.isActive = false;
    await user.save();
  }

  /**
   * Get user statistics
   * organizationId filters stats to specific organization
   */
  async getUserStats(organizationId?: string): Promise<any> {
    const matchStage: any = {};
    if (organizationId) {
      matchStage.organizationId = new mongoose.Types.ObjectId(organizationId);
    }

    const stats = await User.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 },
        },
      },
    ]);

    const totalQuery: any = { isActive: true };
    const inactiveQuery: any = { isActive: false };
    if (organizationId) {
      totalQuery.organizationId = organizationId;
      inactiveQuery.organizationId = organizationId;
    }

    const totalUsers = await User.countDocuments(totalQuery);
    const totalInactive = await User.countDocuments(inactiveQuery);

    return {
      totalUsers,
      totalInactive,
      byRole: stats,
    };
  }
}

export default new UserService();
