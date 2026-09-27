import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function run() {
  await pool.query(`create table if not exists schema_migrations (
    filename text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await pool.query('select filename from schema_migrations')).rows.map((r) => r.filename));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations(filename) values ($1)', [file]);
      await client.query('commit');
      console.log('applied', file);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
  console.log('migrations up to date');
  await pool.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
