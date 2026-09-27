import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * One lock id for every migration run. Each file is applied inside a
 * transaction that first takes this lock and then checks the file has not been
 * applied meanwhile, so two runs at once (two deployments building, or someone
 * migrating by hand during a deploy) queue up instead of colliding. A
 * transaction-scoped lock works through a transaction-mode pooler, where a
 * session lock would not.
 */
const MIGRATION_LOCK = 8_100_725;

async function locked(client) {
  await client.query('begin');
  await client.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
  // A backfill on a year of registers can outlast the app's 15-second limit.
  await client.query('set local statement_timeout = 0');
}

async function run() {
  const client = await pool.connect();
  try {
    await locked(client);
    await client.query(`create table if not exists schema_migrations (
      filename text primary key, applied_at timestamptz not null default now())`);
    await client.query('commit');

    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      await locked(client);
      const done = await client.query('select 1 from schema_migrations where filename = $1', [file]);
      if (done.rowCount) {
        await client.query('rollback');
        continue;
      }
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('insert into schema_migrations(filename) values ($1)', [file]);
        await client.query('commit');
        console.log('applied', file);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    client.release();
  }
  console.log('migrations up to date');
  await pool.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
