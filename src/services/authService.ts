import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../config';
import User, { IUser, AuthProvider, UserRole } from '../models/User';
import Organization from '../models/Organization';
import microsoftAuthService from './microsoftAuthService';
import { BadRequestError, UnauthorizedError, NotFoundError } from '../utils/AppError';
import { JwtPayload } from '../utils/ApiResponse';

export interface ClientUser {
  id: string;
  _id: string;
  organizationId?: string;
  organization?: {
    _id: string;
    name: string;
    subscriptionPlan: string;
    subdomain?: string;
  };
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: string;
  department?: string;
  employeeId?: string;
  authProvider?: string;
  isActive?: boolean;
}

export interface LoginResult {
  token: string;
  user: ClientUser;
}

class AuthService {
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private createCaseInsensitiveEmailQuery(email: string): Record<string, unknown> {
    const normalizedEmail = this.normalizeEmail(email);
    const escapedEmail = normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return {
      email: { $regex: `^${escapedEmail}$`, $options: 'i' },
    };
  }

  /**
   * Authenticate user with email and password (local auth)
   */
  async login(email: string, password: string): Promise<LoginResult> {
    if (!email || !password) {
      throw new BadRequestError('Email and password are required');
    }

    const emailQuery = this.createCaseInsensitiveEmailQuery(email);

    // Find user and include password field
    const user = await User.findOne({ ...emailQuery, isActive: true }).select('+password');

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

    const token = this.generateToken(user);
    return await this.createLoginResult(token, user);
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

    return await this.createLoginResult(token, user);
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
   * Shape user for API responses (includes organization name for tenant users).
   */
  private async formatClientUser(user: IUser | Record<string, unknown>): Promise<ClientUser> {
    const id = String((user as IUser)._id);
    const organizationId = (user as IUser).organizationId?.toString();
    const role = (user as IUser).role;

    const firstName = (user as IUser).firstName || '';
    const lastName = (user as IUser).lastName || '';
    const fullName =
      (user as IUser).fullName || `${firstName} ${lastName}`.trim() || (user as IUser).email;

    const clientUser: ClientUser = {
      id,
      _id: id,
      organizationId,
      email: (user as IUser).email,
      firstName,
      lastName,
      fullName,
      role,
      department: (user as IUser).department,
      employeeId: (user as IUser).employeeId,
      authProvider: (user as IUser).authProvider,
      isActive: (user as IUser).isActive,
    };

    if (organizationId && role !== UserRole.SUPER_ADMIN) {
      const org = await Organization.findById(organizationId)
        .select('name subscriptionPlan subdomain')
        .lean();
      if (org) {
        clientUser.organization = {
          _id: org._id.toString(),
          name: org.name,
          subscriptionPlan: org.subscriptionPlan,
          subdomain: org.subdomain,
        };
      }
    }

    return clientUser;
  }

  private async createLoginResult(token: string, user: IUser): Promise<LoginResult> {
    return {
      token,
      user: await this.formatClientUser(user),
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
   * Accept invitation — set password for a pre-created org user
   */
  async acceptInvitation(
    email: string,
    organizationId: string,
    password: string
  ): Promise<void> {
    if (!email || !organizationId || !password) {
      throw new BadRequestError('Email, organization ID, and password are required');
    }

    if (password.length < 6) {
      throw new BadRequestError('Password must be at least 6 characters');
    }

    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new BadRequestError('Invalid organization ID');
    }

    const normalizedEmail = this.normalizeEmail(email);
    const escapedEmail = normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const user = await User.findOne({
      email: { $regex: `^${escapedEmail}$`, $options: 'i' },
      organizationId,
    }).select('+password');

    if (!user) {
      throw new NotFoundError(
        'Invitation not found. Ask your administrator to send a new invite.'
      );
    }

    if (user.role === UserRole.SUPER_ADMIN) {
      throw new BadRequestError('Invalid invitation');
    }

    if (!user.isActive) {
      throw new BadRequestError('This account has been deactivated. Contact your administrator.');
    }

    user.password = password;
    await user.save();
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
  async getCurrentUser(userId: string): Promise<ClientUser> {
    const user = await User.findById(userId).lean();

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return this.formatClientUser(user as unknown as IUser);
  }
}

export default new AuthService();

