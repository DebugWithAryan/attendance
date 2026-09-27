import { z } from 'zod';
import * as scheduleService from '../../../application/schedule.service.js';
import { parse } from '../../../shared/validate.js';

const courseParam = z.object({ courseId: z.string().uuid('Pick a course.') });

export default async function scheduleRoutes(app) {
  const viewAll = { preHandler: app.requires('schedule.viewAll') };
  const manage = { preHandler: app.requires('schedule.manage') };

  // HOD and teachers: the whole course grid, with `mine` flagged per viewer.
  app.get('/schedule/course/:courseId', viewAll, (req) =>
    scheduleService.courseGrid(req.actor, parse(courseParam, req.params).courseId));

  // Students: their own section only.
  app.get('/schedule/mine', { preHandler: app.authenticate }, (req) => scheduleService.myGrid(req.actor));

  // The shape of the course's week: days, periods, and the times on its routine.
  app.put('/schedule/course/:courseId/settings', manage, (req) =>
    scheduleService.updateSettings(req.actor, parse(courseParam, req.params).courseId, parse(z.object({
      periodsPerDay: z.number().int().min(1, 'A day needs at least one period.').max(12, 'Up to 12 periods a day.'),
      daysPerWeek: z.number().int().min(1).max(6, 'The college week runs Monday to Saturday at most.').optional(),
      timings: z.object({
        periods: z.array(z.string().max(40)).max(12).default([]),
        breakAfter: z.number().int().min(1).max(11).nullable().optional(),
        breakTime: z.string().max(40).nullable().optional(),
        afterHoursTime: z.string().max(40).nullable().optional(),
        afterHours: z.record(z.string().regex(/^[1-6]$/), z.string().max(80)).optional(),
      }).nullable().optional(),
    }), req.body)));

  app.put('/schedule/slot', manage, (req) => scheduleService.upsertSlot(req.actor, parse(z.object({
    courseId: z.string().uuid(),
    sectionId: z.string().uuid(),
    dayOfWeek: z.number().int().min(1).max(6),
    periodNumber: z.number().int().min(1).max(12),
    subjectId: z.string().uuid(),
    teacherId: z.string().uuid(),
  }), req.body)));

  app.delete('/schedule/slot/:id', manage, (req) =>
    scheduleService.deleteSlot(req.actor, parse(z.object({ id: z.string().uuid() }), req.params).id));
}
