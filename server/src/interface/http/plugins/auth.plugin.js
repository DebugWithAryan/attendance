import jwt from '@fastify/jwt';
import { config } from '../../../config/index.js';
import { can } from '../../../domain/rbac.js';
import { forbidden, unauthorized } from '../../../shared/errors.js';
import * as users from '../../../infra/repositories/user.repo.js';

/**
 * Registers JWT verification plus two guards used by every route:
 *   { preHandler: app.authenticate }
 *   { preHandler: app.requires('attendance.mark') }
 *
 * The guard checks the token AND re-reads the account, so a removed user loses
 * access immediately rather than when their token expires.
 */
export async function authPlugin(app) {
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.jwtTtl },
  });

  app.decorate('authenticate', async (req) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized();
    }
    const fresh = await users.findById(req.user.sub);
    if (!fresh || fresh.status !== 'active') throw unauthorized('This account is no longer active.');
    req.actor = {
      id: fresh.id,
      name: fresh.name,
      loginId: fresh.login_id,
      role: fresh.role,
      canAddUsers: fresh.can_add_users,
    };
  });

  app.decorate('requires', (capability) => async function guard(req) {
    await app.authenticate(req);
    if (!can(req.actor, capability)) {
      throw forbidden('Your role does not have access to this action.');
    }
  });
}

export default authPlugin;
