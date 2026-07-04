import jwt from 'jsonwebtoken';
import config from '../config';
import User, { IUser, AuthProvider, UserRole } from '../models/User';
import Organization from '../models/Organization';
import microsoftAuthService from './microsoftAuthService';
import emailNotificationService from './emailNotificationService';
import crypto from 'crypto';
import {
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../utils/AppError';
import { JwtPayload } from '../utils/ApiResponse';
import { profileMinioStorage } from '../utils/storage/MinIOStorage';
import demoInvitationService from './demoInvitationService';
import { birthdayNotificationService } from './birthdayNotificationService';
import { dateKeyIsToday } from '../utils/birthdayUtils';
import { logger } from '../utils/logger';
import {
  validateOrgInvitation as validateOrgInvitationLink,
  markInvitationAccepted,
} from './invitationValidationService';

function resolveProfileComplete(user: IUser): boolean {
  if (user.profileComplete === true) {
    return true;
  }
  if (user.profileComplete === false) {
    return false;
  }
  // Invite accepted but personal details were never saved
  if (user.invitationAcceptedAt && (!user.dateOfBirth || !user.gender || !user.phone)) {
    return false;
  }
  return true;
}

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
  profilePhotoUrl?: string;
  hasProfilePhoto?: boolean;
  createdAt?: string;
  dateOfBirth?: string;
  gender?: string;
  phone?: string;
  profileComplete?: boolean;
  /** Admin-set: field staff live tracking after check-in */
  fieldTrackingEnabled?: boolean;
  /** Minutes between location uploads (default 5) */
  fieldTrackingIntervalMinutes?: number;
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
  async login(
    email: string,
    password: string,
    organizationId?: string
  ): Promise<LoginResult> {
    if (!email || !password) {
      throw new BadRequestError('Email and password are required');
    }

    const emailQuery = this.createCaseInsensitiveEmailQuery(email);
    let user: IUser | null = null;

    if (organizationId) {
      // Tenant-scoped login: resolve user only within this organization
      user = await User.findOne({
        ...emailQuery,
        isActive: true,
        organizationId,
      }).select('+password');
    } else {
      // Platform login: if email exists in multiple orgs, require tenant URL
      const candidates = await User.find({ ...emailQuery, isActive: true })
        .select('+password')
        .limit(3);
      if (candidates.length > 1) {
        throw new UnauthorizedError(
          'Multiple accounts found for this email. Please log in using your organization URL.'
        );
      }
      user = candidates[0] || null;
    }

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

    if (user.demoAccessExpiresAt && user.demoAccessExpiresAt < new Date()) {
      throw new UnauthorizedError(
        'Your demo access has expired. Contact Trizen HR for an extension.'
      );
    }

    if (user.organizationId) {
      const org = await Organization.findById(user.organizationId).select(
        'isDemoTenant demoExpiresAt isActive name subdomain'
      );
      if (org?.isDemoTenant) {
        if (!org.isActive) {
          throw new UnauthorizedError('This demo environment is no longer available.');
        }
        const isSharedDemoOrg =
          org.subdomain?.toLowerCase() === 'demoorg' || org.name === 'DemoOrg';
        if (!isSharedDemoOrg && org.demoExpiresAt && org.demoExpiresAt < new Date()) {
          throw new UnauthorizedError('This demo environment has expired.');
        }
      }
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
    const resolveOrganizationId = (): string | undefined => {
      const orgRef: any = user.organizationId as any;
      if (!orgRef) return undefined;
      if (typeof orgRef === 'string') return orgRef;
      if (typeof orgRef === 'object') {
        if (orgRef._id) {
          return orgRef._id.toString();
        }
        // ObjectId instance path
        if (typeof orgRef.toString === 'function') {
          const val = orgRef.toString();
          // Guard against accidental "[object Object]" in token payload
          return val && val !== '[object Object]' ? val : undefined;
        }
      }
      return undefined;
    };

    const payload: JwtPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    // Only include organizationId for non-Super Admin users
    if (user.role !== 'super_admin') {
      const organizationId = resolveOrganizationId();
      if (organizationId) {
        payload.organizationId = organizationId;
      }
    }

    return jwt.sign(payload, config.jwtSecret as string, {
      expiresIn: config.jwtExpiresIn as string,
    } as jwt.SignOptions);
  }

  private async formatClientUser(user: IUser | Record<string, unknown>): Promise<ClientUser> {
    const id = String((user as IUser)._id);
    const organizationId = (user as IUser).organizationId?.toString();
    const role = (user as IUser).role;

    const firstName = (user as IUser).firstName || '';
    const lastName = (user as IUser).lastName || '';
    const fullName =
      (user as IUser).fullName || `${firstName} ${lastName}`.trim() || (user as IUser).email;

    const intervalMinutes = (user as IUser).fieldTrackingIntervalMinutes;
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
      createdAt: (user as IUser).createdAt
        ? new Date((user as IUser).createdAt as Date).toISOString()
        : undefined,
      dateOfBirth: (user as IUser).dateOfBirth
        ? new Date((user as IUser).dateOfBirth as Date).toISOString().slice(0, 10)
        : undefined,
      gender: (user as IUser).gender,
      phone: (user as IUser).phone,
      profileComplete: resolveProfileComplete(user as IUser),
      fieldTrackingEnabled: (user as IUser).fieldTrackingEnabled === true,
      fieldTrackingIntervalMinutes:
        typeof intervalMinutes === 'number' && intervalMinutes > 0 ? intervalMinutes : 5,
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

    const profilePhotoKey = (user as IUser).profilePhotoKey;
    if (profilePhotoKey) {
      clientUser.hasProfilePhoto = true;
      try {
        clientUser.profilePhotoUrl = await profileMinioStorage.getPresignedUrl(
          profilePhotoKey,
          86400
        );
      } catch (error) {
        console.warn('Could not generate profile photo URL:', (error as Error).message);
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
   * Validate org invitation link (public — for set-password page).
   */
  async validateOrgInvitation(email: string, organizationId: string) {
    return validateOrgInvitationLink(email, organizationId);
  }

  /**
   * Validate a demo invitation token (public — for set-password page).
   */
  async validateDemoInviteToken(rawToken: string) {
    return demoInvitationService.validateToken(rawToken);
  }

  /**
   * Accept invitation — set password for a pre-created org user, or via demo token.
   */
  async acceptInvitation(
    payload:
      | { email: string; organizationId: string; password: string; token?: never }
      | { token: string; password: string; email?: never; organizationId?: never }
  ): Promise<LoginResult | void> {
    if ('token' in payload && payload.token) {
      await demoInvitationService.acceptByToken(payload.token, payload.password);
      return;
    }

    const { email, organizationId, password } = payload;

    if (!email || !organizationId || !password) {
      throw new BadRequestError('Email, organization ID, and password are required');
    }

    if (password.length < 6) {
      throw new BadRequestError('Password must be at least 6 characters');
    }

    const validation = await validateOrgInvitationLink(email, organizationId);

    if (validation.status === 'profile_incomplete') {
      throw new BadRequestError(
        'Your password is already set. Sign in to complete your profile.'
      );
    }

    if (validation.status === 'already_onboarded') {
      throw new ConflictError(
        'This invitation link has already been used. Please sign in with your account.'
      );
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
    user.profileComplete = false;
    await markInvitationAccepted(user);

    const token = this.generateToken(user);
    return this.createLoginResult(token, user);
  }

  /**
   * Complete onboarding profile after invitation password setup.
   */
  async completeProfile(
    userId: string,
    data: { dateOfBirth: string; gender: string; phone: string }
  ): Promise<ClientUser> {
    if (!data.dateOfBirth?.trim()) {
      throw new BadRequestError('Date of birth is required');
    }

    const dob = new Date(data.dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      throw new BadRequestError('Invalid date of birth');
    }

    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (dob > today) {
      throw new BadRequestError('Date of birth cannot be in the future');
    }

    if (!data.gender?.trim()) {
      throw new BadRequestError('Gender is required');
    }

    const validGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
    if (!validGenders.includes(data.gender.trim())) {
      throw new BadRequestError('Invalid gender value');
    }

    const phone = data.phone?.trim();
    if (!phone) {
      throw new BadRequestError('Phone number is required');
    }
    if (phone.length < 6) {
      throw new BadRequestError('Enter a valid phone number');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    user.dateOfBirth = dob;
    user.gender = data.gender.trim() as IUser['gender'];
    user.phone = phone;
    user.profileComplete = true;
    await user.save();

    if (dateKeyIsToday(data.dateOfBirth)) {
      void birthdayNotificationService.sendBirthdayEmailForUser(userId).catch((error) => {
        logger.error('Birthday email after profile completion failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return this.formatClientUser(user);
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
    const user = await User.findById(userId)
      .populate('supervisorId', 'firstName lastName email')
      .lean();

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return this.formatClientUser(user as unknown as IUser);
  }

  /**
   * Upload or replace the current user's profile photo.
   */
  async updateProfilePhoto(userId: string, photoData: string): Promise<ClientUser> {
    if (!photoData?.trim()) {
      throw new BadRequestError('Photo data is required');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const base64Data = photoData.replace(/^data:image\/\w+;base64,/, '');
    if (!base64Data) {
      throw new BadRequestError('Invalid photo data');
    }

    const imageBuffer = Buffer.from(base64Data, 'base64');
    const maxSize = 5 * 1024 * 1024;
    if (imageBuffer.length > maxSize) {
      throw new BadRequestError('Photo must be under 5MB');
    }

    const orgPart = user.organizationId ? `org-${user.organizationId}` : 'platform';
    const folder = `${orgPart}/users/${userId}`;
    const fileName = `profile_${Date.now()}.jpg`;

    if (user.profilePhotoKey) {
      try {
        await profileMinioStorage.deleteFile(user.profilePhotoKey);
      } catch (error) {
        console.warn('Could not delete old profile photo:', (error as Error).message);
      }
    }

    const result = await profileMinioStorage.uploadFile(
      imageBuffer,
      fileName,
      'image/jpeg',
      folder,
      { userId, type: 'profile' }
    );

    user.profilePhotoKey = result.key;
    await user.save();

    return this.formatClientUser(user);
  }

  /**
   * Stream profile photo bytes for authenticated clients (mobile app).
   */
  async getProfilePhotoBuffer(userId: string): Promise<{ buffer: Buffer; contentType: string }> {
    const user = await User.findById(userId).select('profilePhotoKey');
    if (!user?.profilePhotoKey) {
      throw new NotFoundError('Profile photo not found');
    }

    return profileMinioStorage.getObjectBuffer(user.profilePhotoKey);
  }

  /**
   * Remove the current user's profile photo.
   */
  async removeProfilePhoto(userId: string): Promise<ClientUser> {
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.profilePhotoKey) {
      try {
        await profileMinioStorage.deleteFile(user.profilePhotoKey);
      } catch (error) {
        console.warn('Could not delete profile photo:', (error as Error).message);
      }
    }

    user.profilePhotoKey = undefined;
    await user.save();

    return this.formatClientUser(user);
  }

  /**
   * Update platform-level UI preferences (System Admin only).
   */
  async updatePlatformPreferences(
    userId: string,
    role: string,
    patch: { notifications?: Record<string, unknown> }
  ): Promise<any> {
    if (role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Only System Admins can update platform preferences');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const prev = (user.platformPreferences as any)?.notifications || {};
    const incoming = patch.notifications || {};
    const next: Record<string, unknown> = { ...prev, ...incoming };

    if (next.pollIntervalSec != null) {
      const n = Number(next.pollIntervalSec);
      if (Number.isFinite(n)) {
        next.pollIntervalSec = Math.min(300, Math.max(15, Math.round(n)));
      } else {
        delete next.pollIntervalSec;
      }
    }

    user.set('platformPreferences', {
      ...(user.get('platformPreferences') || {}),
      notifications: next,
    });
    await user.save();

    return this.getCurrentUser(userId);
  }

  /**
   * Request password reset
   */
  async forgotPassword(email: string): Promise<void> {
    if (!email) {
      throw new BadRequestError('Email is required');
    }

    const user = await User.findOne({ email: email.toLowerCase(), isActive: true });

    if (!user) {
      // For security reasons, don't reveal if user exists or not
      // Just return success even if user not found
      return;
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Token expires in 1 hour
    const resetPasswordExpires = new Date(Date.now() + 3600000);

    user.resetPasswordToken = resetPasswordToken;
    user.resetPasswordExpires = resetPasswordExpires;
    await user.save();

    // Build reset link - using frontendUrl instead of invitation baseUrl
    const resetLink = `${config.frontendUrl}/reset-password?token=${resetToken}`;

    // Send email
    await emailNotificationService.sendPasswordReset(
      user.email,
      user.fullName,
      resetLink,
      resetPasswordExpires
    );
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token || !newPassword) {
      throw new BadRequestError('Token and new password are required');
    }

    if (newPassword.length < 6) {
      throw new BadRequestError('Password must be at least 6 characters');
    }

    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpires: { $gt: new Date() },
      isActive: true,
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      throw new BadRequestError('Token is invalid or has expired');
    }

    // Update password
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
  }
}

export default new AuthService();

