import jwt from 'jsonwebtoken';
import config from '../config';
import User, { IUser, AuthProvider } from '../models/User';
import microsoftAuthService from './microsoftAuthService';
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
    authProvider?: string;
  };
}

class AuthService {
  /**
   * Authenticate user with email and password (local auth)
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

    // Check if user uses Microsoft auth only
    if (user.authProvider === AuthProvider.MICROSOFT && !user.password) {
      throw new UnauthorizedError('This account uses Microsoft login. Please sign in with Microsoft.');
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Generate JWT token
    const token = this.generateToken(user);

    // Return user data without password
    return this.createLoginResult(token, user);
  }

  /**
   * Authenticate user with Microsoft OAuth
   */
  async loginWithMicrosoft(code: string): Promise<LoginResult> {
    if (!code) {
      throw new BadRequestError('Authorization code is required');
    }

    // Exchange code for tokens
    const tokens = await microsoftAuthService.exchangeCodeForTokens(code);

    // Get user profile from Microsoft
    const profile = await microsoftAuthService.getUserProfile(tokens.accessToken);
    const email = (profile.mail || profile.userPrincipalName).toLowerCase();

    // Find organization by tenant ID or email domain
    let organization = await microsoftAuthService.findOrganizationByTenant(tokens.account.tenantId);
    
    if (!organization) {
      // Try to find by email domain
      organization = await microsoftAuthService.findOrganizationByDomain(email);
    }

    if (!organization) {
      throw new UnauthorizedError(
        'Your organization is not registered for Microsoft login. Please contact your administrator.'
      );
    }

    // Validate tenant if organization has tenant configured
    if (organization.microsoftAuth?.tenantId && 
        !microsoftAuthService.validateTenant(tokens.account.tenantId, organization)) {
      throw new UnauthorizedError(
        'Your Microsoft account is not authorized for this organization.'
      );
    }

    // Find or create user
    const user = await microsoftAuthService.findOrCreateUser(
      profile,
      organization._id.toString()
    );

    if (!user.isActive) {
      throw new UnauthorizedError('Your account has been deactivated. Please contact your administrator.');
    }

    // Generate JWT token
    const token = this.generateToken(user);

    return this.createLoginResult(token, user);
  }

  /**
   * Get Microsoft authorization URL
   */
  async getMicrosoftAuthUrl(state?: string): Promise<string> {
    return microsoftAuthService.getAuthorizationUrl(state);
  }

  /**
   * Generate JWT token for user
   * Super Admin: Token without organizationId (can access all orgs)
   * Other roles: Token includes organizationId for tenant isolation
   */
  generateToken(user: IUser): string {
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
   * Create standardized login result
   */
  private createLoginResult(token: string, user: IUser): LoginResult {
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
        authProvider: user.authProvider,
      },
    };
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

    // Check if user can change password (only local auth users)
    if (user.authProvider === AuthProvider.MICROSOFT && !user.password) {
      throw new BadRequestError('Microsoft authenticated users cannot change password here. Please use Microsoft account settings.');
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
      .populate('organizationId', 'name subscriptionPlan microsoftAuth')
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

