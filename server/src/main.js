import { buildApp } from './app.js';
import { config } from './config/index.js';
import { pool } from './infra/db/pool.js';

const app = await buildApp();

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Give in-flight requests a chance to finish, then let go of the pool.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
