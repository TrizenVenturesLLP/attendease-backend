import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
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
        const isAllowed =
          allowedOrigins.some((allowed) => {
            const normalizedAllowed = allowed.replace(/\/$/, '');
            return normalizedAllowed === normalizedOrigin;
          }) || isTenantLocalhostOrigin(normalizedOrigin);

        if (isAllowed) {
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

  app.use('/api', requestLogger);

  // API routes
  app.use('/api', routes);

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
