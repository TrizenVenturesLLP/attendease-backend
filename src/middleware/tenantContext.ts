import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { UnauthorizedError, ForbiddenError } from '../utils/AppError';
import { UserRole } from '../models/User';

/**
 * Tenant Context Middleware
 * Uses subdomain / tenant context and JWT to enforce tenant isolation
 * - Super Admin: Platform-level access only (no organizationId filter by default)
 * - Other roles: Must belong to the organization resolved from subdomain
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

    // Super Admin can access all organizations - platform only by default
    if (role === UserRole.SUPER_ADMIN) {
      // Super Admin requests should normally come from the platform domain.
      // For safety, we do not attach an organizationId here; Super Admin can
      // optionally override organizationId via allowOrganizationOverride on the
      // platform (e.g. ?organizationId=...).
      next();
      return;
    }

    // All other roles must have an organizationId in the token
    if (!organizationId) {
      throw new UnauthorizedError('No organization associated with user');
    }

    // Validate that organizationId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      throw new UnauthorizedError('Invalid organization ID');
    }

    // If this is a tenant subdomain request (subdomainContext resolved an org),
    // enforce that the token's org matches the subdomain's org.
    if (req.isPlatform === false) {
      if (!req.organizationId) {
        throw new ForbiddenError('No organization context for this request');
      }

      if (req.organizationId.toString() !== organizationId.toString()) {
        throw new ForbiddenError(
          'Organization mismatch between token and subdomain'
        );
      }
    }

    // Always attach org from JWT for downstream handlers (platform + tenant).
    req.organizationId = req.organizationId ?? organizationId;

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
    // Only Super Admin on the platform domain can use organization override
    if (req.user?.role !== UserRole.SUPER_ADMIN || req.isPlatform === false) {
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
