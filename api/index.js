/**
 * The entire API as one Vercel function.
 *
 * Hobby allows 12 functions per deployment, and every extra function is
 * another cold start and another database connection, so the whole Fastify app
 * is mounted behind this single catch-all instead of one file per route.
 *
 * The app is built once per warm instance and reused; `emit('request')` hands
 * Vercel's Node req/res straight to Fastify's router.
 */
import { buildApp } from '../server/src/app.js';

let ready;

const getApp = () => {
  if (!ready) {
    ready = buildApp().then(async (app) => {
      await app.ready();
      return app;
    }).catch((err) => {
      // Let the next invocation retry instead of caching a broken boot.
      ready = undefined;
      throw err;
    });
  }
  return ready;
};

export default async function handler(req, res) {
  try {
    const app = await getApp();
    app.server.emit('request', req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'server_error', message: 'The API failed to start.' }));
    console.error('boot failed', err);
  }
}
