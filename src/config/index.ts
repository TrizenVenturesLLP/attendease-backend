import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface MicrosoftConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authority: string;
}

interface Config {
  port: number;
  nodeEnv: string;
  mongoUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigin: string | string[];
  frontendUrl: string;
  /** Optional fixed subdomain for tenants (e.g. "org" -> abc.org.trizenhr.com). Empty = tenant at first label (abc.trizenhr.com). */
  tenantSubdomainSegment: string;
  emailService: {
    url: string;
    authToken: string;
    supportEmail: string;
  };
  invitation: {
    baseUrl: string;
    expiryDays: number;
    appDomain: string;
    tenantSubdomain: string;
    frontendPort: string;
    frontendProtocol: string;
  };
  microsoft: MicrosoftConfig;
}

const config: Config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGO_URI!,
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
    : ['http://localhost:3000'],
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  tenantSubdomainSegment: (process.env.TENANT_SUBDOMAIN_SEGMENT || '').trim().toLowerCase(),
  emailService: {
    url: process.env.EMAIL_SERVICE_URL || 'http://localhost:4007',
    authToken: process.env.EMAIL_SERVICE_AUTH_TOKEN || '',
    supportEmail: process.env.TRIZEN_SUPPORT_EMAIL || 'support@trizenventures.com',
  },
  invitation: (() => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    let appDomain = process.env.APP_DOMAIN || '';
    let frontendProtocol = process.env.FRONTEND_PROTOCOL || 'https';

    if (!appDomain) {
      try {
        const parsed = new URL(frontendUrl);
        appDomain = parsed.hostname;
        frontendProtocol = parsed.protocol.replace(':', '') || frontendProtocol;
      } catch {
        appDomain = 'localhost';
        frontendProtocol = 'http';
      }
    }

    if (appDomain === 'localhost' || appDomain === '127.0.0.1') {
      frontendProtocol = 'http';
    }

    return {
      baseUrl:
        process.env.INVITATION_BASE_URL || `${frontendUrl.replace(/\/$/, '')}/auth/set-password`,
      expiryDays: parseInt(process.env.INVITATION_EXPIRY_DAYS || '7', 10),
      appDomain,
      tenantSubdomain: (process.env.TENANT_SUBDOMAIN || 'org').trim().toLowerCase(),
      frontendPort: process.env.FRONTEND_PORT || '3000',
      frontendProtocol,
    };
  })(),
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/auth/microsoft/callback',
    authority: process.env.MICROSOFT_AUTHORITY || 'https://login.microsoftonline.com/common',
  },
};

export default config;
