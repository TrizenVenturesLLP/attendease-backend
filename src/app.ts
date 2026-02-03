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

        // Allow any subdomain of the frontend root domain (e.g. *.trizenhr.com)
        let isAllowedByRootDomain = false;
        try {
          const frontendUrl = new URL(config.frontendUrl);
          const rootDomain = frontendUrl.hostname.toLowerCase();

          if (originHost) {
            if (originHost === rootDomain || originHost.endsWith(`.${rootDomain}`)) {
              isAllowedByRootDomain = true;
            }
          }
        } catch {
          // If frontendUrl is not a valid URL, skip root-domain based CORS
        }

        if (isAllowedExplicit || isAllowedByRootDomain) {
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
