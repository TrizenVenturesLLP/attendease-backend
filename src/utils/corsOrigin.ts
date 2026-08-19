import config from '../config';

/** Tenant dev URLs: http://acme.localhost:3000 (see frontend host.ts) */
export function isTenantLocalhostOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return hostname === 'localhost' || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;

  const allowedOrigins = Array.isArray(config.corsOrigin)
    ? config.corsOrigin
    : [config.corsOrigin];

  const normalizedOrigin = origin.replace(/\/$/, '');

  let originHost: string | null = null;
  try {
    const url = new URL(normalizedOrigin);
    originHost = url.hostname.toLowerCase();
  } catch {
    // fall back to exact match only
  }

  const isAllowedExplicit = allowedOrigins.some((allowed) => {
    const normalizedAllowed = allowed.replace(/\/$/, '');
    return normalizedAllowed === normalizedOrigin;
  });

  const isAllowedTenantLocalhost = isTenantLocalhostOrigin(normalizedOrigin);

  let isAllowedByRootDomain = false;
  if (originHost) {
    const frontendCandidates = String(config.frontendUrl)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const rootDomains = frontendCandidates
      .map((candidate) => {
        try {
          return new URL(candidate).hostname.toLowerCase();
        } catch {
          return null;
        }
      })
      .filter((h): h is string => Boolean(h));

    isAllowedByRootDomain = rootDomains.some((rootDomain) => {
      return originHost === rootDomain || originHost.endsWith(`.${rootDomain}`);
    });
  }

  const isAllowedLocalDevHost =
    config.nodeEnv !== 'production' &&
    Boolean(originHost && (originHost === 'lvh.me' || originHost.endsWith('.lvh.me')));

  return (
    isAllowedExplicit ||
    isAllowedTenantLocalhost ||
    isAllowedByRootDomain ||
    isAllowedLocalDevHost
  );
}
