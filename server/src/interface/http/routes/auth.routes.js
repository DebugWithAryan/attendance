import { z } from 'zod';
import * as auth from '../../../application/auth.service.js';
import { parse } from '../../../shared/validate.js';

const loginSchema = z.object({
  loginId: z.string().trim().min(1, 'Enter your login ID.'),
  password: z.string().min(1, 'Enter your password.'),
});

export default async function authRoutes(app) {
  app.post('/auth/login', async (req) => {
    const body = parse(loginSchema, req.body);
    const user = await auth.login(body);
    const token = app.jwt.sign({ sub: user.id, role: user.role });
    return { token, user };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, (req) => auth.me(req.actor));

  app.post('/auth/password', { preHandler: app.authenticate }, async (req) => {
    const body = parse(z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'Use at least 8 characters.'),
    }), req.body);
    await auth.changePassword(req.actor, body);
    return { ok: true };
  });
}
