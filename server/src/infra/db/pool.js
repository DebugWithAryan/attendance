import pg from 'pg';
import { config } from '../../config/index.js';

// Return numerics as numbers instead of strings — percentages travel as JSON.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// count(*) is bigint, which pg returns as a string. Class counts never come
// near 2^53, so parse them as numbers — otherwise every caller has to remember.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// Keep DATE columns as plain 'YYYY-MM-DD' strings. A JS Date here would drag
// the server's timezone into every class date and shift days across a border.
pg.types.setTypeParser(1082, (v) => v);

// Hosted Postgres (Neon, Supabase, RDS) speaks TLS; a local docker box does not.
const needsSsl = /sslmode=require|neon\.tech|supabase\.|amazonaws\.com/.test(config.databaseUrl);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.pgPoolMax,
  // On a serverless instance an idle connection is dead weight held against the
  // provider's limit; release it quickly.
  idleTimeoutMillis: config.serverless ? 5_000 : 30_000,
  connectionTimeoutMillis: 10_000,
  // Neon's free tier suspends on idle, so the first query after a quiet spell
  // wakes the database. Allow for that rather than failing the request.
  statement_timeout: 15_000,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

// A dropped idle connection must never take the process down with it.
pool.on('error', (err) => {
  console.error('idle postgres client error', err.message);
});

export const query = (text, params) => pool.query(text, params);

export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;

export const many = async (text, params) => (await pool.query(text, params)).rows;

/**
 * Run a unit of work in a transaction. Every use case that touches more than
 * one table goes through this, so an audit row can never be orphaned from the
 * change it describes.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
