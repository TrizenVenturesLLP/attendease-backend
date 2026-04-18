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
  emailService: {
    url: string;
    authToken: string;
    supportEmail: string;
  };
  invitation: {
    baseUrl: string;
    expiryDays: number;
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
  emailService: {
    url: process.env.EMAIL_SERVICE_URL || 'http://localhost:3002',
    authToken: process.env.EMAIL_SERVICE_AUTH_TOKEN || '',
    supportEmail: process.env.TRIZEN_SUPPORT_EMAIL || 'support@trizenventures.com',
  },
  invitation: {
    baseUrl: process.env.INVITATION_BASE_URL || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/set-password`,
    expiryDays: parseInt(process.env.INVITATION_EXPIRY_DAYS || '7', 10),
  },
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/auth/microsoft/callback',
    authority: process.env.MICROSOFT_AUTHORITY || 'https://login.microsoftonline.com/common',
  },
};

export default config;
