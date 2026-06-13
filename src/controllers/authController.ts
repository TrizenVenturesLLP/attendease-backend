import { Request, Response, NextFunction } from 'express';
import authService from '../services/authService';
import demoRequestService from '../services/demoRequestService';
import { DemoRequestSource } from '../models/DemoRequest';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError, ForbiddenError } from '../utils/AppError';

class AuthController {
  /**
   * @route   POST /api/auth/login
   * @desc    Login user and return JWT token (local auth)
   * @access  Public
   */
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        throw new BadRequestError('Email and password are required');
      }

      // Subdomain-aware guard:
      // - Super Admin should only log in via the platform domain
      // - Non-Super Admin users must belong to the organization resolved from subdomain
      const isPlatform = req.isPlatform !== false;
      const result = await authService.login(
        email,
        password,
        isPlatform ? undefined : req.organizationId
      );
      const userRole = result.user.role;
      const userOrgId = result.user.organizationId;

      if (!isPlatform) {
        // Tenant subdomain (e.g. acme.trizenhr.com)
        if (userRole === 'super_admin') {
          throw new ForbiddenError(
            'Super Admin can only log in from the main platform domain'
          );
        }

        if (!req.organizationId || !userOrgId) {
          throw new ForbiddenError('Organization context is missing for this login');
        }

        if (req.organizationId.toString() !== userOrgId.toString()) {
          throw new ForbiddenError(
            'This account does not belong to this organization. Please use your own company URL.'
          );
        }
      }

      const response: ApiResponse<typeof result> = {
        success: true,
        message: 'Login successful',
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/auth/microsoft/url
   * @desc    Get Microsoft OAuth authorization URL
   * @access  Public
   */
  async getMicrosoftAuthUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Optional state parameter for CSRF protection
      const state = req.query.state as string | undefined;
      
      const authUrl = await authService.getMicrosoftAuthUrl(state);

      const response: ApiResponse<{ authUrl: string }> = {
        success: true,
        message: 'Microsoft authorization URL generated',
        data: { authUrl },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   POST /api/auth/microsoft/callback
   * @desc    Handle Microsoft OAuth callback and authenticate user
   * @access  Public
   */
  async microsoftCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code } = req.body;

      if (!code) {
        throw new BadRequestError('Authorization code is required');
      }

      const result = await authService.loginWithMicrosoft(code);

      const response: ApiResponse<typeof result> = {
        success: true,
        message: 'Microsoft login successful',
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/auth/me
   * @desc    Get current user info
   * @access  Private
   */
  async getCurrentUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const user = await authService.getCurrentUser(req.user.userId);

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
   * @route   PATCH /api/auth/me/platform-preferences
   * @desc    System Admin platform UI preferences
   * @access  Private (System Admin)
   */
  async updatePlatformPreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const user = await authService.updatePlatformPreferences(
        req.user.userId,
        req.user.role,
        { notifications: (req.body?.notifications as Record<string, unknown>) || {} }
      );

      const response: ApiResponse<typeof user> = {
        success: true,
        message: 'Preferences updated',
        data: user,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/auth/demo-invite/validate
   * @desc    Validate demo invitation token before set-password
   * @access  Public
   */
  async validateDemoInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = String(req.query.token || '');
      const data = await authService.validateDemoInviteToken(token);

      const response: ApiResponse = {
        success: true,
        message: 'Demo invitation is valid',
        data,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/auth/invitation/validate
   * @desc    Validate organization invitation link before set-password
   * @access  Public
   */
  async validateOrgInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const email = String(req.query.email || '');
      const organizationId = String(req.query.organizationId || '');
      const data = await authService.validateOrgInvitation(email, organizationId);

      const response: ApiResponse = {
        success: true,
        message: 'Invitation is valid',
        data,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   POST /api/auth/accept-invitation
   * @desc    Set password from email invitation link
   * @access  Public
   */
  async acceptInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, organizationId, password, token } = req.body;

      if (token) {
        await authService.acceptInvitation({ token, password });
      } else {
        await authService.acceptInvitation({ email, organizationId, password });
      }

      const response: ApiResponse = {
        success: true,
        message: 'Password set successfully. You can now log in.',
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   POST /api/auth/change-password
   * @desc    Change user password
   * @access  Private
   */
  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const { oldPassword, newPassword } = req.body;

      await authService.changePassword(req.user.userId, oldPassword, newPassword);

      const response: ApiResponse = {
        success: true,
        message: 'Password changed successfully',
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   GET /api/auth/me/profile-photo
   * @desc    Download current user's profile photo
   * @access  Private
   */
  async getProfilePhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const { buffer, contentType } = await authService.getProfilePhotoBuffer(req.user.userId);
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'private, max-age=300');
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   POST /api/auth/me/profile-photo
   * @desc    Upload or replace profile photo
   * @access  Private
   */
  async updateProfilePhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const { photoData } = req.body;
      const user = await authService.updateProfilePhoto(req.user.userId, photoData);

      const response: ApiResponse<typeof user> = {
        success: true,
        message: 'Profile photo updated',
        data: user,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   DELETE /api/auth/me/profile-photo
   * @desc    Remove profile photo
   * @access  Private
   */
  async removeProfilePhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new BadRequestError('User not authenticated');
      }

      const user = await authService.removeProfilePhoto(req.user.userId);

      const response: ApiResponse<typeof user> = {
        success: true,
        message: 'Profile photo removed',
        data: user,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   POST /api/auth/logout
   * @desc    Logout user (client-side token removal)
   * @access  Private
   */
  async logout(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // For JWT, logout is typically handled client-side by removing the token
      // This endpoint is here for consistency and can be extended for token blacklisting

      const response: ApiResponse = {
        success: true,
        message: 'Logout successful',
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   POST /api/auth/forgot-password
   * @desc    Request password reset email
   * @access  Public
   */
  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;

      await authService.forgotPassword(email);

      const response: ApiResponse = {
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.',
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   POST /api/auth/reset-password
   * @desc    Reset password using token
   * @access  Public
   */
  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, password } = req.body;

      await authService.resetPassword(token, password);

      const response: ApiResponse = {
        success: true,
        message: 'Password has been reset successfully.',
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * @route   POST /api/auth/demo-request
   * @desc    Submit a public demo booking request
   * @access  Public
   */
  async requestDemo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, email, company, phone, message, source } = req.body;
      const normalizedSource =
        source === DemoRequestSource.MOBILE ? DemoRequestSource.MOBILE : DemoRequestSource.WEB;

      const data = await demoRequestService.create({
        name,
        email,
        company,
        phone,
        message,
        source: normalizedSource,
      });

      const response: ApiResponse = {
        success: true,
        message: 'Demo request received. Our team will contact you within 24 hours.',
        data,
        timestamp: new Date().toISOString(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }
}

export default new AuthController();
