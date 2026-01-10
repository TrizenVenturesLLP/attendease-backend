import { Request, Response, NextFunction } from 'express';
import authService from '../services/authService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../utils/AppError';

class AuthController {
  /**
   * @route   POST /api/auth/login
   * @desc    Login user and return JWT token
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
