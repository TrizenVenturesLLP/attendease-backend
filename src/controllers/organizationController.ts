import { Request, Response, NextFunction } from 'express';
import organizationService from '../services/organizationService';
import userService from '../services/userService';
import emailNotificationService from '../services/emailNotificationService';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../utils/AppError';
import { UserRole } from '../models/User';
import { logger } from '../utils/logger';
import { ConflictError } from '../utils/AppError';

class OrganizationController {
  /**
   * Create a new organization (Super Admin only)
   * POST /api/organizations
   */
  async createOrganization(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const {
        companyAdminEmail,
        companyAdminName,
        ...organizationPayload
      } = req.body;

      const organization = await organizationService.createOrganization({
        ...organizationPayload,
        createdBy: req.user?.userId,
      });

      if (companyAdminEmail) {
        const normalizedEmail = String(companyAdminEmail).trim().toLowerCase();
        if (!req.user?.userId) {
          throw new BadRequestError('Authenticated user required to invite company admin');
        }

        const nameParts = String(companyAdminName || 'Company Admin').trim().split(/\s+/);
        const firstName = nameParts[0] || 'Company';
        const lastName = nameParts.slice(1).join(' ') || 'Admin';

        let adminUserExists = false;
        try {
          await userService.createUser(
            {
              organizationId: organization._id.toString(),
              email: normalizedEmail,
              firstName,
              lastName,
              role: UserRole.ADMIN,
            },
            req.user.userId
          );
          logger.info('Company admin user created for new organization', {
            organizationId: organization._id.toString(),
            email: normalizedEmail,
          });
        } catch (userError) {
          if (userError instanceof ConflictError) {
            adminUserExists = true;
            logger.warn('Company admin already exists — will still try onboarding email', {
              email: normalizedEmail,
              organizationId: organization._id.toString(),
            });
          } else {
            throw userError;
          }
        }

        try {
          await emailNotificationService.sendOrganizationCreatedFlow({
            organizationId: organization._id.toString(),
            organizationName: organization.name,
            companyAdminEmail: normalizedEmail,
            companyAdminName,
            createdByUserId: req.user.userId,
          });
          logger.info('Organization onboarding email dispatched', {
            email: normalizedEmail,
          });
        } catch (emailError) {
          logger.error('Organization onboarding email failed', {
            email: normalizedEmail,
            adminUserExists,
          });
        }
      }

      const response: ApiResponse<typeof organization> = {
        success: true,
        message: 'Organization created successfully',
        data: organization,
        timestamp: new Date().toISOString(),
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all organizations (Super Admin only)
   * GET /api/organizations
   */
  async getAllOrganizations(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const organizations = await organizationService.getAllOrganizations();

      const response: ApiResponse<typeof organizations> = {
        success: true,
        message: 'Organizations retrieved successfully',
        data: organizations,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get organization by ID
   * GET /api/organizations/:id
   */
  async getOrganizationById(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const organization = await organizationService.getOrganizationById(
        req.params.id
      );

      const response: ApiResponse<typeof organization> = {
        success: true,
        message: 'Organization retrieved successfully',
        data: organization,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update organization
   * PUT /api/organizations/:id
   */
  async updateOrganization(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const organization = await organizationService.updateOrganization(
        req.params.id,
        req.body
      );

      const response: ApiResponse<typeof organization> = {
        success: true,
        message: 'Organization updated successfully',
        data: organization,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete organization
   * DELETE /api/organizations/:id
   */
  async deleteOrganization(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      await organizationService.deleteOrganization(req.params.id);

      const response: ApiResponse = {
        success: true,
        message: 'Organization deleted successfully',
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get organization statistics
   * GET /api/organizations/:id/stats
   */
  async getOrganizationStats(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const stats = await organizationService.getOrganizationStats(
        req.params.id
      );

      const response: ApiResponse<typeof stats> = {
        success: true,
        message: 'Organization statistics retrieved successfully',
        data: stats,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get organization settings
   * GET /api/organizations/:id/settings
   */
  async getOrganizationSettings(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const settings = await organizationService.getOrganizationSettings(
        req.params.id
      );

      const response: ApiResponse<typeof settings> = {
        success: true,
        message: 'Organization settings retrieved successfully',
        data: settings,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current user's organization settings (Admin/HR)
   * GET /api/organizations/my/settings
   */
  async getMyOrganizationSettings(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.organizationId) {
        throw new Error('No organization associated with user');
      }

      const settings = await organizationService.getOrganizationSettings(
        req.organizationId
      );

      const response: ApiResponse<typeof settings> = {
        success: true,
        message: 'Organization settings retrieved successfully',
        data: settings,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update current user's organization settings (Admin/HR)
   * PUT /api/organizations/my/settings
   */
  async updateMyOrganizationSettings(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.organizationId) {
        throw new Error('No organization associated with user');
      }

      const organization = await organizationService.updateOrganization(
        req.organizationId,
        {
          settings: req.body.settings,
        }
      );

      const response: ApiResponse<typeof organization> = {
        success: true,
        message: 'Organization settings updated successfully',
        data: organization,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}

export default new OrganizationController();
