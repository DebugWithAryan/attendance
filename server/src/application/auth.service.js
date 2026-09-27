import * as users from '../infra/repositories/user.repo.js';
import { pool } from '../infra/db/pool.js';
import { verifyPassword, hashPassword } from '../infra/security/password.js';
import { logActivity } from '../infra/repositories/audit.repo.js';
import { unauthorized, badRequest, forbidden, AppError } from '../shared/errors.js';
import { config } from '../config/index.js';

/**
 * Counts recent failures for this login ID. Kept in Postgres rather than in
 * memory because on Vercel consecutive attempts may hit different instances,
 * and an in-memory counter would reset on every one of them.
 */
async function assertNotLockedOut(loginId) {
  const { rows } = await pool.query(
    `select count(*) as failures
       from login_attempts
      where lower(login_id) = lower($1)
        and succeeded = false
        and attempted_at > now() - ($2 || ' minutes')::interval`,
    [loginId, config.loginWindowMinutes],
  );
  if (rows[0].failures >= config.loginMaxAttempts) {
    throw new AppError(429, 'too_many_attempts',
      `Too many failed attempts. Try again in ${config.loginWindowMinutes} minutes, or ask the department to reset your password.`);
  }
}

const recordAttempt = (loginId, succeeded) =>
  pool.query('insert into login_attempts (login_id, succeeded) values ($1,$2)', [loginId, succeeded])
    .catch(() => {}); // never fail a sign-in because the audit insert hiccupped

export async function login({ loginId, password }) {
  await assertNotLockedOut(loginId);

  const user = await users.findByLoginId(loginId);
  // Same message either way: never reveal which login IDs exist.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await recordAttempt(loginId, false);
    throw unauthorized('That login ID and password do not match.');
  }

  await recordAttempt(loginId, true);
  await logActivity({ actorId: user.id, actorRole: user.role, action: 'auth.login', entity: 'user', targetId: user.id });
  return {
    id: user.id, name: user.name, loginId: user.login_id, role: user.role, canAddUsers: user.can_add_users,
    isDemo: user.is_demo === true,
  };
}

export async function changePassword(actor, { currentPassword, newPassword }) {
  // Everyone at the demo stall signs in with the same printed password.
  if (actor.isDemo) throw forbidden('This is a shared demo account, so its password stays the same for the next visitor.');
  if (String(newPassword).length < 8) throw badRequest('Use at least 8 characters.');
  const user = await users.findById(actor.id);
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw badRequest('Your current password is not correct.');
  }
  await users.updatePassword(actor.id, await hashPassword(newPassword));
  await logActivity({ actorId: actor.id, actorRole: actor.role, action: 'auth.password_changed', entity: 'user', targetId: actor.id });
}

export async function me(actor) {
  if (actor.role === 'student') return { ...actor, profile: await users.studentProfile(actor.id) };
  if (actor.role === 'teacher') return { ...actor, profile: await users.teacherProfile(actor.id) };
  return { ...actor, profile: { id: actor.id, name: actor.name, login_id: actor.loginId } };
}
