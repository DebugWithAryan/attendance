import { z } from 'zod';
import * as classesService from '../../../application/classes.service.js';
import { parse } from '../../../shared/validate.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

/** Cancelling classes in advance, and undoing it. */
export default async function classRoutes(app) {
  const canceller = { preHandler: app.requires('classes.cancel') };
  const authed = { preHandler: app.authenticate };

  // One tap: every matching class on the timetable for that date. The service
  // narrows a teacher to their own periods whatever the body asks for.
  app.post('/classes/cancel', canceller, (req) => classesService.cancel(req.actor, parse(z.object({
    date: isoDate,
    courseId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    periods: z.array(z.number().int().min(1).max(12)).max(12).optional(),
    reason: z.string().trim().max(200, 'Keep the reason under 200 characters.').optional(),
    eventId: z.string().uuid().optional(),
  }), req.body)));

  app.get('/classes/cancellations', authed, (req) => classesService.list(req.actor, parse(z.object({
    from: isoDate.optional(),
  }), req.query)));

  app.delete('/classes/cancellations/:batchId', canceller, (req) =>
    classesService.restore(req.actor, parse(z.object({ batchId: z.string().uuid() }), req.params).batchId));
}
