import config from '../config';

/**
 * Build tenant origin for invite/set-password links (mirrors frontend host.ts).
 * e.g. acme.org.trizenhr.com or acme.localhost:3000
 */
export function buildTenantOrigin(subdomain: string): string {
  const slug = subdomain.replace(/\./g, '').toLowerCase().trim();
  if (!slug) {
    return '';
  }

  const root = config.invitation.appDomain;
  const useTenantSegment =
    Boolean(config.invitation.tenantSubdomain) && root !== 'localhost';
  const hostLabel = useTenantSegment
    ? `${slug}.${config.invitation.tenantSubdomain}`
    : slug;
  const host = `${hostLabel}.${root}`;

  const protocol =
    root === 'localhost'
      ? config.invitation.frontendProtocol || 'http'
      : config.invitation.frontendProtocol || 'https';
  const port =
    root === 'localhost' && config.invitation.frontendPort
      ? `:${config.invitation.frontendPort}`
      : '';

  return `${protocol}://${host}${port}`;
}

export function buildSetPasswordBaseUrl(subdomain?: string | null): string {
  const path = '/auth/set-password';
  if (subdomain?.trim()) {
    const origin = buildTenantOrigin(subdomain);
    if (origin) {
      return `${origin}${path}`;
    }
  }
  return config.invitation.baseUrl;
}

export function buildDemoInviteLink(rawToken: string, subdomain?: string | null): string {
  const base = buildSetPasswordBaseUrl(subdomain);
  const url = new URL(base);
  url.searchParams.set('token', rawToken);
  url.searchParams.set('flow', 'demo');
  return url.toString();
}
