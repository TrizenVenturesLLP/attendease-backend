import { Request, Response, NextFunction } from 'express';
import organizationService from '../services/organizationService';
import { ApiResponse } from '../utils/ApiResponse';

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
      const organization = await organizationService.createOrganization({
        ...req.body,
        createdBy: req.user?.userId,
      });

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
