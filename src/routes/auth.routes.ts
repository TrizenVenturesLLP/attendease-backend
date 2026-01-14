import { Router } from 'express';
import authController from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * @route   POST /api/auth/login
 * @desc    Login user (local auth with email/password)
 * @access  Public
 */
router.post('/login', authController.login);

/**
 * @route   GET /api/auth/microsoft/url
 * @desc    Get Microsoft OAuth authorization URL
 * @access  Public
 */
router.get('/microsoft/url', authController.getMicrosoftAuthUrl);

/**
 * @route   POST /api/auth/microsoft/callback
 * @desc    Handle Microsoft OAuth callback
 * @access  Public
 */
router.post('/microsoft/callback', authController.microsoftCallback);

/**
 * @route   GET /api/auth/me
 * @desc    Get current user info
 * @access  Private
 */
router.get('/me', authenticate, authController.getCurrentUser);

/**
 * @route   POST /api/auth/change-password
 * @desc    Change password
 * @access  Private
 */
router.post('/change-password', authenticate, authController.changePassword);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', authenticate, authController.logout);

export default router;

