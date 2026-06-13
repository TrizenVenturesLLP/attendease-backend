import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { subdomainContext } from './middleware/subdomainContext';
import { requestLogger } from './middleware/requestLogger';

/** Tenant dev URLs: http://acme.localhost:3000 (see frontend host.ts) */
function isTenantLocalhostOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return hostname === 'localhost' || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

const createApp = (): Application => {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);

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
          Boolean(
            originHost &&
              (originHost === 'lvh.me' || originHost.endsWith('.lvh.me'))
          );

        if (
          isAllowedExplicit ||
          isAllowedTenantLocalhost ||
          isAllowedByRootDomain ||
          isAllowedLocalDevHost
        ) {
          callback(null, true);
        } else {
          console.warn(`CORS blocked origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'X-Tenant-Host',
        'X-Forwarded-Host',
      ],
      exposedHeaders: ['Content-Range', 'X-Content-Range'],
      maxAge: 86400,
    })
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use(subdomainContext);
  app.use('/api', requestLogger);
  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
