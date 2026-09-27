import { z } from 'zod';
import * as attendanceService from '../../../application/attendance.service.js';
import { parse } from '../../../shared/validate.js';
import { forbidden } from '../../../shared/errors.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

export default async function attendanceRoutes(app) {
  const marker = { preHandler: app.requires('attendance.mark') };
  const records = { preHandler: app.requires('records.view') };
  const authed = { preHandler: app.authenticate };

  app.get('/attendance/roster', marker, (req) => attendanceService.getRoster(req.actor, parse(z.object({
    sectionId: z.string().uuid(),
    classDate: isoDate,
    periodNumber: z.coerce.number().int().min(1).max(12),
  }), req.query)));

  app.post('/attendance/roster', marker, (req) => attendanceService.saveRoster(req.actor, parse(z.object({
    sectionId: z.string().uuid(),
    classDate: isoDate,
    periodNumber: z.number().int().min(1).max(12),
    marks: z.array(z.object({
      student_id: z.string().uuid(),
      status: z.enum(['present', 'absent', 'leave']),
    })).min(1),
  }), req.body)));

  // Teachers inside the window, HOD any time. The policy decides, not the route.
  app.patch('/attendance/record/:id', authed, (req) => {
    if (!['teacher', 'hod'].includes(req.actor.role)) throw forbidden();
    return attendanceService.editMark(req.actor, req.params.id, parse(z.object({
      status: z.enum(['present', 'absent', 'leave']),
      reason: z.string().trim().min(3, 'Add a short reason.'),
    }), req.body));
  });

  // A student sees only their own numbers; staff may look up any student.
  app.get('/attendance/student/:id', authed, (req) => {
    if (req.actor.role === 'student' && req.params.id !== req.actor.id) throw forbidden();
    if (req.actor.role === 'mentor') throw forbidden('Mentors do not have access to attendance data.');
    return attendanceService.studentView(req.params.id);
  });

  app.get('/records', records, (req) => attendanceService.records(req.actor, parse(z.object({
    courseId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  }), req.query)));

  app.get('/records/export', { preHandler: app.requires('records.export') }, async (req, reply) => {
    const filters = parse(z.object({
      courseId: z.string().uuid().optional(),
      sectionId: z.string().uuid().optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      onlyBelow: z.enum(['true', 'false']).optional(),
    }), req.query);

    const { csv, filename, rowCount } = await attendanceService.exportRecords(req.actor, {
      ...filters, onlyBelow: filters.onlyBelow === 'true',
    });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    reply.header('x-row-count', String(rowCount));
    return csv;
  });

  app.get('/analytics/courses', { preHandler: app.requires('analytics.view') }, (req) => {
    if (req.actor.role === 'student') throw forbidden();
    return attendanceService.analytics();
  });
}
