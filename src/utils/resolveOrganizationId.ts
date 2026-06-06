import { Request } from 'express';
import User, { UserRole } from '../models/User';
import { ForbiddenError } from './AppError';

/**
 * Resolve the organization ID for the current request.
 * Order: subdomain/override (req.organizationId) → JWT → user record (stale tokens).
 */
export async function resolveOrganizationId(req: Request): Promise<string> {
  if (req.organizationId) {
    return req.organizationId;
  }

  if (req.user?.organizationId) {
    req.organizationId = req.user.organizationId;
    return req.organizationId;
  }

  const bodyOrgId =
    typeof req.body?.organizationId === 'string' ? req.body.organizationId.trim() : '';
  if (bodyOrgId && req.user?.role === UserRole.SUPER_ADMIN) {
    req.organizationId = bodyOrgId;
    return bodyOrgId;
  }

  if (req.user?.role === UserRole.SUPER_ADMIN) {
    throw new ForbiddenError(
      'Organization context required. Use a tenant URL or pass ?organizationId= for platform access.'
    );
  }

  if (req.user?.userId) {
    const user = await User.findById(req.user.userId).select('organizationId');
    if (user?.organizationId) {
      req.organizationId = user.organizationId.toString();
      return req.organizationId;
    }
  }

  throw new ForbiddenError('No organization associated with this account');
}
