import { z } from 'zod';
import * as leaveService from '../../../application/leave.service.js';
import { parse } from '../../../shared/validate.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

export default async function leaveRoutes(app) {
  const student = { preHandler: app.requires('leave.apply') };
  const approver = { preHandler: app.requires('leave.decide') };
  const authed = { preHandler: app.authenticate };

  // The certificate travels with the request, as a data URL from the camera or
  // the file picker. One call, no orphaned uploads, and the storage reference
  // never reaches the browser.
  app.post('/leave', student, async (req, reply) => {
    reply.code(201);
    return leaveService.apply(req.actor, parse(z.object({
      fromDate: isoDate,
      toDate: isoDate,
      reason: z.string().trim().min(5, 'Say why you need leave.'),
      certificate: z.string().startsWith('data:').max(11_000_000).optional(),
    }), req.body));
  });

  app.get('/leave/mine', student, (req) => leaveService.mine(req.actor));

  app.get('/leave/queue', approver, (req) => leaveService.queue(req.actor, {
    status: req.query.status || null,
  }));

  app.get('/leave/history', approver, (req) => leaveService.history(req.actor));

  /** Medical certificates are health data: authorised viewers only, every view logged. */
  app.get('/leave/:id/document', authed, async (req, reply) => {
    const { bytes, mime } = await leaveService.document(req.actor, req.params.id);
    reply.header('content-type', mime);
    reply.header('content-disposition', 'inline');
    reply.header('cache-control', 'private, no-store');
    return reply.send(bytes);
  });

  app.patch('/leave/:id', approver, (req) => leaveService.decide(req.actor, req.params.id, parse(z.object({
    status: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(500).optional(),
  }), req.body)));

  /** Changing a decision already made — always with a reason. */
  app.patch('/leave/:id/decision', approver, (req) =>
    leaveService.revise(req.actor, req.params.id, parse(z.object({
      status: z.enum(['approved', 'rejected']),
      reason: z.string().trim().min(3, 'Say why the decision is changing.').max(500),
    }), req.body)));
}
