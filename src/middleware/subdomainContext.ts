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

function stripPort(host: string): string {
  return host.includes(':') ? host.split(':')[0] : host;
}

function parseHostFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Resolve the browser tenant host for local dev and reverse-proxy setups.
 * Priority: X-Tenant-Host → X-Forwarded-Host → Origin → Referer → req.hostname
 */
function resolveRequestHost(req: Request): string {
  const tenantHost = req.headers['x-tenant-host'] as string | undefined;
  if (tenantHost) {
    return stripPort(tenantHost.toLowerCase());
  }

  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0];
  if (forwardedHost) {
    return stripPort(forwardedHost.toLowerCase());
  }

  const originHost = parseHostFromUrl(req.headers.origin as string | undefined);
  if (originHost) {
    return originHost;
  }

  const refererHost = parseHostFromUrl(req.headers.referer as string | undefined);
  if (refererHost) {
    return refererHost;
  }

  return stripPort((req.hostname || '').toLowerCase());
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
 * - Local dev: tenant is resolved from Origin (e.g. acme.localhost:3000 → API on :5000).
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
    const host = resolveRequestHost(req);

    // Default: treat as platform if we cannot determine host or rootDomain
    if (!host || !rootDomain) {
      req.isPlatform = true;
      return next();
    }

    // Platform host (no tenant subdomain)
    if (host === rootDomain || host === `www.${rootDomain}` || host === '127.0.0.1') {
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

