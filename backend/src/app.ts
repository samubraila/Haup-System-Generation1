import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { config } from './config/index.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiRateLimit } from './middleware/rate-limit.js';
import { analyticsRouter } from './modules/analytics.routes.js';
import { authRouter } from './modules/auth.routes.js';
import { automationRouter } from './modules/automation.routes.js';
import { calendarRouter } from './modules/calendar.routes.js';
import { dashboardRouter } from './modules/dashboard.routes.js';
import { ideasRouter } from './modules/ideas.routes.js';
import { internalRouter } from './modules/internal.routes.js';
import { jobsRouter } from './modules/jobs.routes.js';
import { mediaRouter } from './modules/media.routes.js';
import { projectsRouter } from './modules/projects.routes.js';
import { socialRouter } from './modules/social.routes.js';
import { systemRouter } from './modules/system.routes.js';
import { videosRouter } from './modules/videos.routes.js';
import { openApiDocument } from './openapi.js';
import { logger } from './utils/logger.js';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.COOKIE_SECURE ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} ist nicht erlaubt`));
      },
      credentials: true,
      allowedHeaders: ['content-type', 'x-csrf-token', 'x-api-key', 'x-worker-id', 'authorization', 'range'],
      exposedHeaders: ['content-range', 'accept-ranges', 'content-length'],
    }),
  );

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === '/api/system/health' || req.url === '/api/system/events',
      },
      customLogLevel(_req, res, err) {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'debug';
      },
    }),
  );

  app.use('/api/internal', internalRouter);

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(cookieParser());
  app.use(csrfProtection);
  app.use('/api', apiRateLimit);

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: 'AI Content Factory API' }));
  app.get('/api/openapi.json', (_req, res) => res.json(openApiDocument));

  app.use('/api/auth', authRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/ideas', ideasRouter);
  app.use('/api/videos', videosRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/social', socialRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/automation', automationRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
