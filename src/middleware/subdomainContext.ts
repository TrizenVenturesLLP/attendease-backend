import { NextFunction, Request, Response } from 'express';
import Organization from '../models/Organization';
import config from '../config';
import { ForbiddenError, NotFoundError } from '../utils/AppError';

// Helper to extract the root domain (e.g. "trizenhr.com") from FRONTEND_URL
function getRootDomain(): string | null {
  try {
    const url = new URL(config.frontendUrl);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Subdomain / Tenant Resolution Middleware
 *
 * Responsibilities:
 * - Determine whether the request is for the platform (main domain) or a tenant (subdomain)
 * - For tenant requests, resolve the organization by subdomain and attach organizationId to the request
 *
 * URL patterns (controlled by TENANT_SUBDOMAIN_SEGMENT):
 * - When set (e.g. "org"): tenant URLs are abc.org.trizenhr.com; org.trizenhr.com is platform.
 * - When empty: tenant URLs are abc.trizenhr.com (first label = tenant slug).
 *
 * Examples (with TENANT_SUBDOMAIN_SEGMENT=org):
 * - trizenhr.com, www.trizenhr.com, org.trizenhr.com -> platform
 * - abc.org.trizenhr.com, company1.org.trizenhr.com   -> tenant (slug = abc, company1)
 *
 * Notes:
 * - In development (localhost), all requests are treated as platform-level.
 * - This middleware MUST run before auth / tenantContext so that downstream code
 *   can rely on req.isPlatform / req.organizationId.
 */
export async function subdomainContext(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rootDomain = getRootDomain();

    // Determine host: prefer X-Forwarded-Host (behind proxy) then req.hostname
    const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0];
    let host = (forwardedHost || req.hostname || '').toLowerCase();

    // Strip port if present
    if (host.includes(':')) {
      host = host.split(':')[0];
    }

    // Default: treat as platform if we cannot determine host or rootDomain
    if (!host || !rootDomain) {
      req.isPlatform = true;
      return next();
    }

    // Local development: localhost / 127.0.0.1 -> platform
    if (host === 'localhost' || host.startsWith('localhost.') || host === '127.0.0.1') {
      req.isPlatform = true;
      return next();
    }

    // If host exactly matches root domain or www.<root>, it's the platform
    if (host === rootDomain || host === `www.${rootDomain}`) {
      req.isPlatform = true;
      return next();
    }

    // If host does not end with the root domain, treat as platform (e.g. separate API host)
    if (!host.endsWith(rootDomain)) {
      req.isPlatform = true;
      return next();
    }

    // At this point, host is something like "<sub>.<rootDomain>"
    const suffix = `.${rootDomain}`;
    const subdomainPart = host.slice(0, -suffix.length); // remove ".rootDomain"

    // If nothing before the root, treat as platform (safety)
    if (!subdomainPart) {
      req.isPlatform = true;
      return next();
    }

    const segment = config.tenantSubdomainSegment;

    let primarySubdomain: string;
    if (segment) {
      // Tenant URLs: <slug>.org.trizenhr.com → subdomainPart = "slug.org"
      if (subdomainPart === segment) {
        req.isPlatform = true;
        return next();
      }
      if (!subdomainPart.endsWith(`.${segment}`)) {
        req.isPlatform = true;
        return next();
      }
      primarySubdomain = subdomainPart.slice(0, -(segment.length + 1)); // part before ".org"
      if (!primarySubdomain) {
        req.isPlatform = true;
        return next();
      }
    } else {
      primarySubdomain = subdomainPart.split('.')[0];
    }

    // Lookup organization by subdomain
    const organization = await Organization.findOne({
      subdomain: primarySubdomain.toLowerCase(),
    });

    if (!organization) {
      throw new NotFoundError('Organization not found for this subdomain');
    }

    if (!organization.isActive) {
      throw new ForbiddenError(
        'Organization is inactive. Please contact support.'
      );
    }

    // Attach tenant context
    req.isPlatform = false;
    req.organizationId = organization._id.toString();

    next();
  } catch (error) {
    next(error);
  }
}

