import { Request, Response, NextFunction } from 'express';
import authService from '../services/authService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../utils/AppError';

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

      const result = await authService.login(email, password);

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
}

export default new AuthController();
