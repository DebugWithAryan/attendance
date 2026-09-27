import { readFileSync, existsSync } from 'node:fs';

// Minimal .env loader for local runs. On Vercel the real environment already
// carries these, and the file will not exist.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

// Vercel sets VERCEL=1. Serverless changes three things that matter:
// one connection per instance, no writable disk, and no long-lived process.
const serverless = process.env.VERCEL === '1' || process.env.SERVERLESS === '1';

export const config = {
  serverless,
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),

  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  // Serverless spawns an instance per concurrent request, and each would hold
  // its own connections. One apiece, with the provider's pooler doing the real
  // pooling, is what keeps Postgres from running out of clients.
  pgPoolMax: num(process.env.PG_POOL_MAX, serverless ? 1 : 8),

  jwtSecret: process.env.JWT_SECRET,
  jwtTtl: process.env.JWT_TTL || '12h',

  // 'blob' on Vercel, 'local' on a container or a laptop.
  storageDriver: process.env.STORAGE_DRIVER || (serverless ? 'blob' : 'local'),
  uploadDir: process.env.UPLOAD_DIR || './var/uploads',
  // Vercel Blob's free tier allows 1 GB and 2,000 uploads a month, so keep
  // certificates small rather than discovering the ceiling in exam week.
  maxUploadBytes: num(process.env.MAX_UPLOAD_BYTES, 2 * 1024 * 1024),

  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${num(process.env.PORT, 4000)}`,
  // Same origin on Vercel (the frontend and /api share a domain), so CORS is
  // only needed for the split local setup.
  corsOrigin: (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),

  // Every "today" in the system resolves in the college's timezone, not the
  // server's. A UTC server would put an early-morning IST class on yesterday.
  timezone: process.env.COLLEGE_TIMEZONE || 'Asia/Kolkata',

  editWindowHours: num(process.env.EDIT_WINDOW_HOURS, 48),
  defaultMinAttendance: num(process.env.DEFAULT_MIN_ATTENDANCE, 75),
  // Students at or above this overall percentage earn the attendance badge.
  badgeThreshold: num(process.env.BADGE_THRESHOLD, 90),

  // Public demonstrations (a tech fest stall). Turns on one-tap sign-in for
  // the accounts `npm run seed:demo` creates. Never set it on a real college's
  // deployment: anyone who opens the site can then sign in as a demo HOD.
  demoMode: /^(1|true|yes|on)$/i.test(process.env.DEMO_MODE || ''),

  loginMaxAttempts: num(process.env.LOGIN_MAX_ATTEMPTS, 8),
  loginWindowMinutes: num(process.env.LOGIN_WINDOW_MINUTES, 15),
};

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required. Copy server/.env.example to server/.env, or set it in the Vercel dashboard.');
}

if (!config.jwtSecret) {
  if (config.env === 'production') {
    throw new Error('JWT_SECRET is required in production. Generate one with: openssl rand -hex 32');
  }
  config.jwtSecret = 'dev-only-secret-not-for-production';
}
