import { z } from 'zod';
import { config } from '../../../config/index.js';
import * as users from '../../../infra/repositories/user.repo.js';
import { logActivity } from '../../../infra/repositories/audit.repo.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../../shared/demo.js';
import { parse } from '../../../shared/validate.js';
import { notFound } from '../../../shared/errors.js';

/**
 * One-tap demo sign-in, for a public demonstration only.
 *
 * Both routes are public, like the first-run bootstrap, and both do nothing
 * unless DEMO_MODE is switched on for the deployment. Even then they only ever
 * reach accounts flagged as demo accounts by `npm run seed:demo`, never a real
 * person's.
 */
export default async function demoRoutes(app) {
  app.get('/demo', async () => {
    if (!config.demoMode) return { enabled: false, accounts: [] };
    const rows = await users.demoAccounts(DEMO_ACCOUNTS.map((a) => a.loginId));
    const byLogin = new Map(rows.map((r) => [r.login_id, r]));
    return {
      enabled: true,
      password: DEMO_PASSWORD,
      accounts: DEMO_ACCOUNTS
        .filter((a) => byLogin.has(a.loginId))
        .map((a) => ({ ...a, name: byLogin.get(a.loginId).name })),
    };
  });

  app.post('/demo/login', async (req) => {
    if (!config.demoMode) throw notFound('Demo sign-in is switched off on this deployment.');
    const { loginId } = parse(z.object({ loginId: z.string().trim().min(1) }), req.body);
    const featured = DEMO_ACCOUNTS.find((a) => a.loginId === loginId.toLowerCase());
    const user = featured ? await users.findByLoginId(featured.loginId) : null;
    if (!user || !user.is_demo) throw notFound('That demo account is not set up yet. Run npm run seed:demo.');

    const token = app.jwt.sign({ sub: user.id, role: user.role });
    await logActivity({
      actorId: user.id, actorRole: user.role, action: 'auth.demo_login', entity: 'user', targetId: user.id,
    });
    return {
      token,
      user: {
        id: user.id, name: user.name, loginId: user.login_id, role: user.role,
        canAddUsers: user.can_add_users, isDemo: true,
      },
    };
  });
}
