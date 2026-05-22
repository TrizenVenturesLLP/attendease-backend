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
import crypto from 'crypto';
import { deleteUsersAndRelatedData } from './userCascadeDelete';

export interface CreateUserData {
  organizationId?: string; // Optional for Super Admin (platform-level), required for others
  email: string;
  /** Omitted when inviting — a random password is set until accept-invitation */
  password?: string;
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
    // Get the creator user to check permissions
    const createdBy = await User.findById(createdByUserId);
    if (!createdBy) {
      throw new NotFoundError('Creator user not found');
    }

    // Enforce role-based user creation restrictions
    if (createdBy.role === UserRole.HR) {
      if (userData.role !== UserRole.EMPLOYEE) {
        throw new ForbiddenError('HR can only create Employee users');
      }
    }

    if (createdBy.role === UserRole.ADMIN) {
      if (userData.role === UserRole.SUPER_ADMIN || userData.role === UserRole.ADMIN) {
        throw new ForbiddenError('Admin cannot create Super Admin or other Admin users');
      }
    }

    // SUPERVISORS and EMPLOYEES cannot create any users
    if (createdBy.role === UserRole.SUPERVISOR || createdBy.role === UserRole.EMPLOYEE) {
      throw new ForbiddenError('Insufficient permissions to create users');
    }

    // Special handling for Super Admin
    if (userData.role === UserRole.SUPER_ADMIN) {
      // Only Super Admin can create another Super Admin
      if (createdBy.role !== UserRole.SUPER_ADMIN) {
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

      if (!userData.password?.trim()) {
        throw new BadRequestError('Password is required when creating a Super Admin');
      }

      // Create Super Admin (no organization-related validations needed)
      const superAdmin = new User({
        email: userData.email,
        password: userData.password.trim(),
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

    // Invite flow: no password in request — user sets it via email link
    const password =
      userData.password?.trim() ||
      crypto.randomBytes(32).toString('hex');

    const user = new User({
      ...userData,
      password,
      createdBy: createdByUserId,
    });

    await user.save();

    return user;
  }

  /**
   * Get all users with optional filters (role-based access)
   * organizationId is required for non-Super Admin users
   * requesterRole and requesterId are used to enforce supervisor team-only access
   */
  async getAllUsers(
    filters?: UserFilters, 
    organizationId?: string, 
    requesterRole?: UserRole, 
    requesterId?: string
  ): Promise<IUser[]> {
    const query: any = {};

    // Add organization filter (required for non-Super Admin)
    if (organizationId) {
      query.organizationId = organizationId;
    }

    // SUPERVISORS can only see their own team
    if (requesterRole === UserRole.SUPERVISOR && requesterId) {
      query.supervisorId = requesterId;
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
   * requesterRole is used to enforce HR can only update Employees
   */
  async updateUser(userId: string, updates: UpdateUserData, requesterRole?: UserRole): Promise<IUser> {
    const user = await User.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // HR can only update EMPLOYEE roles
    if (requesterRole === UserRole.HR) {
      if (user.role !== UserRole.EMPLOYEE) {
        throw new ForbiddenError('HR can only update Employee users');
      }
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
   * Permanently delete user and related records (frees email for re-invite).
   */
  async deleteUser(userId: string, organizationId?: string): Promise<void> {
    const user = await User.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Cannot delete super admin');
    }

    if (
      organizationId &&
      user.organizationId?.toString() !== organizationId
    ) {
      throw new ForbiddenError('User does not belong to your organization');
    }

    const deleted = await deleteUsersAndRelatedData([user._id]);
    if (deleted === 0) {
      throw new NotFoundError('User not found');
    }
  }

  /**
   * Suggest the next employee ID for an organization (e.g. EMP006).
   */
  async getNextEmployeeId(
    organizationId: string
  ): Promise<{ nextEmployeeId: string; existingSample: string[] }> {
    if (!organizationId) {
      throw new BadRequestError('Organization ID is required');
    }

    const users = await User.find({
      organizationId,
      employeeId: { $exists: true, $nin: [null, ''] },
    })
      .select('employeeId')
      .limit(500);

    const existing = users
      .map((u) => u.employeeId)
      .filter((id): id is string => Boolean(id));

    let maxNum = 0;
    for (const id of existing) {
      const empMatch = id.match(/^EMP(\d+)$/i);
      const digitMatch = id.match(/^(\d+)$/);
      const num = empMatch
        ? parseInt(empMatch[1], 10)
        : digitMatch
          ? parseInt(digitMatch[1], 10)
          : 0;
      if (num > maxNum) {
        maxNum = num;
      }
    }

    const nextEmployeeId = `EMP${String(maxNum + 1).padStart(3, '0')}`;

    return {
      nextEmployeeId,
      existingSample: existing.slice(0, 8),
    };
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
