import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Organization from '../models/Organization';
import { UnauthorizedError, ForbiddenError } from '../utils/AppError';
import { UserRole } from '../models/User';

/**
 * Tenant Context Middleware
 * Extracts organizationId from JWT and validates organization
 * - Super Admin: Can access all organizations (no organizationId filter)
 * - Other roles: Must have organizationId and organization must be active
 */
export const tenantContext = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // User must be authenticated before this middleware
    if (!req.user) {
      throw new UnauthorizedError('Not authenticated');
    }

    const { role, organizationId } = req.user;

    // Super Admin can access all organizations - skip organization check
    if (role === UserRole.SUPER_ADMIN) {
      req.organizationId = undefined; // Super Admin has no organization filter
      next();
      return;
    }

    // All other roles must have an organizationId
    if (!organizationId) {
      throw new UnauthorizedError('No organization associated with user');
    }

    // Validate that organizationId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new UnauthorizedError('Invalid organization ID');
    }

    // Check if organization exists and is active
    const organization = await Organization.findById(organizationId);

    if (!organization) {
      throw new ForbiddenError('Organization not found');
    }

    if (!organization.isActive) {
      throw new ForbiddenError(
        'Organization is inactive. Please contact support.'
      );
    }

    // Attach organizationId to request for use in services
    req.organizationId = organizationId;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Organization Override Middleware (Super Admin only)
 * Allows Super Admin to specify which organization to operate on via query param
 * Usage: GET /api/users?organizationId=123
 */
export const allowOrganizationOverride = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  try {
    // Only Super Admin can use organization override
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      next();
      return;
    }

    // Check for organizationId in query params
    const queryOrgId = req.query.organizationId as string;

    if (queryOrgId) {
      if (!mongoose.Types.ObjectId.isValid(queryOrgId)) {
        throw new UnauthorizedError('Invalid organization ID in query');
      }
      req.organizationId = queryOrgId;
    }

    next();
  } catch (error) {
    next(error);
  }
};
