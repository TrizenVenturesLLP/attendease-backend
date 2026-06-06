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
 * @route   POST /api/auth/accept-invitation
 * @desc    Complete invite by setting password
 * @access  Public
 */
router.post('/accept-invitation', authController.acceptInvitation);

router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

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
 * @route   PATCH /api/auth/me/platform-preferences
 * @desc    Update System Admin platform preferences
 * @access  Private (System Admin)
 */
router.patch(
  '/me/platform-preferences',
  authenticate,
  authController.updatePlatformPreferences
);

/**
 * @route   POST /api/auth/change-password
 * @desc    Change password
 * @access  Private
 */
router.post('/change-password', authenticate, authController.changePassword);

/**
 * @route   GET /api/auth/me/profile-photo
 * @desc    Download profile photo (authenticated — for mobile Image)
 * @access  Private
 */
router.get('/me/profile-photo', authenticate, authController.getProfilePhoto);

/**
 * @route   POST /api/auth/me/profile-photo
 * @desc    Upload or replace profile photo
 * @access  Private
 */
router.post('/me/profile-photo', authenticate, authController.updateProfilePhoto);

/**
 * @route   DELETE /api/auth/me/profile-photo
 * @desc    Remove profile photo
 * @access  Private
 */
router.delete('/me/profile-photo', authenticate, authController.removeProfilePhoto);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', authenticate, authController.logout);

export default router;

