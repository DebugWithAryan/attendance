import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config/index.js';
import { authPlugin } from './interface/http/plugins/auth.plugin.js';
import { AppError } from './shared/errors.js';
import { translatePgError } from './shared/pgErrors.js';

import authRoutes from './interface/http/routes/auth.routes.js';
import adminRoutes from './interface/http/routes/admin.routes.js';
import scheduleRoutes from './interface/http/routes/schedule.routes.js';
import attendanceRoutes from './interface/http/routes/attendance.routes.js';
import leaveRoutes from './interface/http/routes/leave.routes.js';
import eventRoutes from './interface/http/routes/events.routes.js';
import clubRoutes from './interface/http/routes/clubs.routes.js';
import feedRoutes from './interface/http/routes/feed.routes.js';
import classRoutes from './interface/http/routes/classes.routes.js';
import demoRoutes from './interface/http/routes/demo.routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.env === 'production' ? 'warn' : 'info' },
    // Attendance payloads are tiny; the ceiling exists for base64 certificates,
    // which inflate by about a third over the raw file.
    bodyLimit: Math.ceil(config.maxUploadBytes * 1.4) + 65_536,
    trustProxy: true,
    // Vercel strips the /api prefix inconsistently across rewrite styles; the
    // routes own it, so keep the URL exactly as received.
    ignoreTrailingSlash: true,
  });

  // Same origin on Vercel, so CORS is only registered when a split setup needs it.
  if (config.corsOrigin.length) {
    await app.register(cors, { origin: config.corsOrigin, credentials: true });
  }

  // Nothing is served straight off the filesystem any more. Certificates are
  // health data, so they go through GET /api/leave/:id/document, which checks
  // who is asking and records the view.

  // Decorations must live on the root instance, so this is called, not registered.
  await authPlugin(app);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((error, req, reply) => {
    const err = translatePgError(error);
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err.validation) {
      return reply.code(400).send({ error: 'bad_request', message: 'Check the request body.' });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'server_error', message: 'Something went wrong on our side.' });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: 'not_found', message: `No route for ${req.method} ${req.url}` }));

  await app.register(async (api) => {
    api.get('/health', async () => ({ ok: true, env: config.env, serverless: config.serverless }));
    await api.register(authRoutes);
    await api.register(adminRoutes);
    await api.register(scheduleRoutes);
    await api.register(attendanceRoutes);
    await api.register(leaveRoutes);
    await api.register(eventRoutes);
    await api.register(clubRoutes);
    await api.register(feedRoutes);
    await api.register(classRoutes);
    await api.register(demoRoutes);
  }, { prefix: '/api' });

  // Kept outside the prefix for container health checks.
  app.get('/health', async () => ({ ok: true, env: config.env }));

  return app;
}
