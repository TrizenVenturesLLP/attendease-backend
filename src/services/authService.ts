import jwt from 'jsonwebtoken';
import config from '../config';
import User, { IUser } from '../models/User';
import { BadRequestError, UnauthorizedError, NotFoundError } from '../utils/AppError';
import { JwtPayload } from '../utils/ApiResponse';

export interface LoginResult {
  token: string;
  user: {
    id: string;
    organizationId?: string;
    email: string;
    firstName: string;
    lastName: string;
    fullName: string;
    role: string;
    department?: string;
    employeeId?: string;
  };
}

class AuthService {
  /**
   * Authenticate user and generate JWT token
   */
  async login(email: string, password: string): Promise<LoginResult> {
    if (!email || !password) {
      throw new BadRequestError('Email and password are required');
    }

    // Find user and include password field
    const user = await User.findOne({ email, isActive: true }).select('+password');

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Generate JWT token
    const token = this.generateToken(user);

    // Return user data without password
    return {
      token,
      user: {
        id: user._id.toString(),
        organizationId: user.organizationId?.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        role: user.role,
        department: user.department,
        employeeId: user.employeeId,
      },
    };
  }

  /**
   * Generate JWT token for user
   * Super Admin: Token without organizationId (can access all orgs)
   * Other roles: Token includes organizationId for tenant isolation
   */
  private generateToken(user: IUser): string {
    const payload: JwtPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    // Only include organizationId for non-Super Admin users
    if (user.role !== 'super_admin') {
      payload.organizationId = user.organizationId?.toString();
    }

    return jwt.sign(payload, config.jwtSecret as string, {
      expiresIn: config.jwtExpiresIn as string,
    } as jwt.SignOptions);
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, config.jwtSecret) as JwtPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Token has expired');
      }
      throw new UnauthorizedError('Invalid token');
    }
  }

  /**
   * Change user password
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<void> {
    if (!oldPassword || !newPassword) {
      throw new BadRequestError('Old password and new password are required');
    }

    if (newPassword.length < 6) {
      throw new BadRequestError('New password must be at least 6 characters');
    }

    // Find user with password
    const user = await User.findById(userId).select('+password');

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify old password
    const isPasswordValid = await user.comparePassword(oldPassword);

    if (!isPasswordValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // Update password
    user.password = newPassword;
    await user.save();
  }

  /**
   * Get current user info
   */
  async getCurrentUser(userId: string): Promise<any> {
    const user = await User.findById(userId)
      .populate('supervisorId', 'firstName lastName email')
      .populate('organizationId', 'name subscriptionPlan')
      .lean();

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Transform organizationId to organization if populated
    const response: any = { ...user };
    if (user.organizationId && typeof user.organizationId === 'object') {
      response.organization = user.organizationId;
      response.organizationId = (user.organizationId as any)._id?.toString();
    }

    return response;
  }
}

export default new AuthService();
