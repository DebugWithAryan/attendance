import { z } from 'zod';
import * as clubsService from '../../../application/clubs.service.js';
import { parse } from '../../../shared/validate.js';
import { forbidden } from '../../../shared/errors.js';

export default async function clubRoutes(app) {
  const mentor = { preHandler: app.requires('clubs.manage') };
  const authed = { preHandler: app.authenticate };

  // Mentors manage their own; the HOD reads them all. Nobody else sees this bar.
  app.get('/clubs', authed, (req) => {
    if (!['hod', 'mentor'].includes(req.actor.role)) throw forbidden();
    return clubsService.list(req.actor);
  });

  app.post('/clubs', mentor, async (req, reply) => {
    reply.code(201);
    return clubsService.create(req.actor, parse(z.object({ name: z.string().trim().min(2) }), req.body));
  });

  app.post('/clubs/:id/members', mentor, (req) =>
    clubsService.addMember(req.actor, req.params.id, parse(z.object({
      loginId: z.string().trim().min(3),
    }), req.body)));

  app.delete('/clubs/:id/members/:studentId', mentor, (req) =>
    clubsService.removeMember(req.actor, req.params.id, req.params.studentId));
}
