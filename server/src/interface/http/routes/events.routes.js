import { z } from 'zod';
import * as eventsService from '../../../application/events.service.js';
import { parse } from '../../../shared/validate.js';

export default async function eventRoutes(app) {
  const poster = { preHandler: app.requires('events.post') };
  const joiner = { preHandler: app.requires('events.join') };
  const authed = { preHandler: app.authenticate };

  app.get('/events', authed, (req) => eventsService.list(req.actor));

  app.post('/events', poster, async (req, reply) => {
    reply.code(201);
    return eventsService.create(req.actor, parse(z.object({
      title: z.string().trim().min(3),
      description: z.string().trim().max(2000).optional(),
      eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      visibility: z.enum(['all_students', 'members_only']).default('all_students'),
      clubId: z.string().uuid().optional(),
      creditPeriods: z.array(z.number().int().min(1).max(12)).max(12).default([]),
    }), req.body));
  });

  app.get('/events/:id/requests', authed, (req) => eventsService.joinRequests(req.actor, req.params.id));

  app.post('/events/:id/join', joiner, (req) => eventsService.requestJoin(req.actor, req.params.id));

  // The organiser records who took part, by login ID, and the credit applies at once.
  app.post('/events/:id/attendance', poster, (req) =>
    eventsService.addAttendance(req.actor, parse(z.object({ id: z.string().uuid() }), req.params).id, parse(z.object({
      loginIds: z.array(z.string().trim().min(1).max(64)).min(1, 'Enter at least one student login ID.')
        .max(300, 'Add up to 300 students at a time.'),
    }), req.body)));

  app.patch('/events/requests/:id', poster, (req) =>
    eventsService.decideJoin(req.actor, req.params.id, parse(z.object({
      status: z.enum(['approved', 'rejected']),
    }), req.body)));
}
