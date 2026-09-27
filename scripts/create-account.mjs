/**
 * The break-glass account, for when nobody can get in.
 *
 * Normally you never need this: a new deployment creates its administrator from
 * the first-run page, and every account after that is made inside the app. But
 * the first-run page only appears while the users table is EMPTY, so if every
 * administrator password is lost there is otherwise no way back in. This is that
 * way back in, and it needs the database connection string, which is the point.
 *
 *   DATABASE_URL="<pooled connection string>" node scripts/create-account.mjs admin "Name" login-id
 *
 * The password is read from stdin rather than taken as an argument, so it stays
 * out of shell history and out of the process list.
 */
import { createInterface } from 'node:readline';
import { hashPassword } from '../server/src/infra/security/password.js';
import { pool } from '../server/src/infra/db/pool.js';

const ROLES = ['admin', 'hod'];
const [role, name, loginId] = process.argv.slice(2);

if (!ROLES.includes(role) || !name || !loginId) {
  console.error('usage: node scripts/create-account.mjs <admin|hod> "<name>" <login-id>');
  console.error('  Teachers, mentors and students are created inside the app, not here.');
  process.exit(1);
}

function askPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
  if (process.stdin.isTTY) rl._writeToOutput = () => {}; // don't echo the password
  return new Promise((resolve) => rl.question('Password: ', (answer) => {
    rl.close();
    if (process.stdin.isTTY) process.stderr.write('\n');
    resolve(answer.trim());
  }));
}

const password = await askPassword();
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  await pool.end();
  process.exit(1);
}

const existing = await pool.query('select 1 from users where lower(login_id) = lower($1)', [loginId]);
if (existing.rowCount) {
  console.error(`A user with login ID "${loginId}" already exists. Nothing was changed.`);
  await pool.end();
  process.exit(1);
}

const { rows } = await pool.query(
  `insert into users (name, login_id, password_hash, role)
   values ($1, $2, $3, $4) returning id, name, login_id, role`,
  [name, loginId, await hashPassword(password), role],
);
await pool.end();
console.log(`Created ${rows[0].role} "${rows[0].name}" with login ID "${rows[0].login_id}".`);
