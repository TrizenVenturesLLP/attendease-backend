import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { subdomainContext } from './middleware/subdomainContext';

const createApp = (): Application => {
  const app = express();

  // Security middleware
  app.use(helmet());

  // CORS configuration
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, postman)
        if (!origin) return callback(null, true);

        const allowedOrigins = Array.isArray(config.corsOrigin) 
          ? config.corsOrigin 
          : [config.corsOrigin];

        // Normalize origins by removing trailing slashes for comparison
        const normalizedOrigin = origin.replace(/\/$/, '');

        // Try to parse the origin to extract hostname
        let originHost: string | null = null;
        try {
          const url = new URL(normalizedOrigin);
          originHost = url.hostname.toLowerCase();
        } catch {
          // If parsing fails, fall back to exact string comparison only
        }

        // Explicit allow-list check (existing behavior)
        const isAllowedExplicit = allowedOrigins.some((allowed) => {
          const normalizedAllowed = allowed.replace(/\/$/, '');
          return normalizedAllowed === normalizedOrigin;
        });

        // Allow any subdomain of configured frontend root domains (e.g. *.trizenhr.in, *.lvh.me)
        // Supports comma-separated FRONTEND_URL values for local + deployed environments.
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

        // Local subdomain testing convenience in non-production:
        // allow *.lvh.me (e.g. google.org.lvh.me:3000) and lvh.me root.
        const isAllowedLocalDevHost =
          config.nodeEnv !== 'production' &&
          Boolean(
            originHost &&
              (originHost === 'lvh.me' || originHost.endsWith('.lvh.me'))
          );

        if (isAllowedExplicit || isAllowedByRootDomain || isAllowedLocalDevHost) {
          callback(null, true);
        } else {
          console.warn(`CORS blocked origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
      exposedHeaders: ['Content-Range', 'X-Content-Range'],
      maxAge: 86400, // 24 hours
    })
  );

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Subdomain / tenant resolution - MUST run before API routes and auth
  app.use(subdomainContext);

  // API routes
  app.use('/api', routes);

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
