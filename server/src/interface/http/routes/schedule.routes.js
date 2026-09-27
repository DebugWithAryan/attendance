import { z } from 'zod';
import * as scheduleService from '../../../application/schedule.service.js';
import { parse } from '../../../shared/validate.js';

export default async function scheduleRoutes(app) {
  const viewAll = { preHandler: app.requires('schedule.viewAll') };
  const manage = { preHandler: app.requires('schedule.manage') };

  // HOD and teachers: the whole course grid, with `mine` flagged per viewer.
  app.get('/schedule/course/:courseId', viewAll, (req) =>
    scheduleService.courseGrid(req.actor, req.params.courseId));

  // Students: their own section only.
  app.get('/schedule/mine', { preHandler: app.authenticate }, (req) => scheduleService.myGrid(req.actor));

  app.put('/schedule/slot', manage, (req) => scheduleService.upsertSlot(req.actor, parse(z.object({
    courseId: z.string().uuid(),
    sectionId: z.string().uuid(),
    dayOfWeek: z.number().int().min(1).max(6),
    periodNumber: z.number().int().min(1).max(12),
    subjectId: z.string().uuid(),
    teacherId: z.string().uuid(),
  }), req.body)));

  app.delete('/schedule/slot/:id', manage, (req) => scheduleService.deleteSlot(req.actor, req.params.id));
}
