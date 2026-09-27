import { z } from 'zod';
import * as audit from '../../../infra/repositories/audit.repo.js';
import * as attendanceService from '../../../application/attendance.service.js';
import * as scheduleService from '../../../application/schedule.service.js';
import * as leaveService from '../../../application/leave.service.js';
import * as classesService from '../../../application/classes.service.js';
import * as sessions from '../../../infra/repositories/session.repo.js';
import { todayIso } from '../../../shared/dates.js';
import { parse } from '../../../shared/validate.js';

/** Notifications, the HOD audit trail, and the per-role Overview brief. */
export default async function feedRoutes(app) {
  const authed = { preHandler: app.authenticate };

  app.get('/notifications', authed, (req) => audit.listNotifications(req.actor.id));

  app.post('/notifications/read', authed, async (req) => {
    await audit.markNotificationsRead(req.actor.id);
    return { ok: true };
  });

  app.post('/notifications', { preHandler: app.requires('notifications.post') }, async (req) => {
    const body = parse(z.object({
      title: z.string().trim().min(3),
      message: z.string().trim().max(2000).optional(),
      audience: z.enum(['all_students', 'teachers', 'mentors', 'everyone']),
    }), req.body);

    const roles = {
      all_students: ['student'], teachers: ['teacher'], mentors: ['mentor'],
      everyone: ['student', 'teacher', 'mentor', 'hod', 'admin'],
    }[body.audience];

    const users = await import('../../../infra/repositories/user.repo.js');
    const ids = (await Promise.all(roles.map((r) => users.idsByRole(r)))).flat();
    await audit.notify(ids, {
      title: body.title, body: body.message, category: 'announcement', postedBy: req.actor.id,
    });
    await audit.logActivity({
      actorId: req.actor.id, actorRole: req.actor.role, action: 'notification.posted',
      entity: 'notification', details: { title: body.title, audience: body.audience, recipients: ids.length },
    });
    return { sent: ids.length };
  });

  // ACTIVITIES bar: one query over one table, HOD only.
  app.get('/activity', { preHandler: app.requires('activity.view') }, (req) => audit.listActivity(parse(z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    action: z.string().optional(),
    actorId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  }), req.query)));

  app.get('/overview', authed, async (req) => {
    const { actor } = req;
    if (actor.role === 'student') {
      const view = await attendanceService.studentView(actor.id);
      const grid = await scheduleService.myGrid(actor);
      return {
        role: 'student',
        attendance: view.overall,
        minimum: view.minimum,
        badge: view.badge,
        classesHeld: view.classesHeld,
        section: grid.section,
        timings: grid.timings,
        subjectCount: view.subjects.length,
        todayClasses: await scheduleService.todayForStudent(grid),
        upcomingCancellations: (await classesService.list(actor, {})).slice(0, 5),
        pendingLeave: (await leaveService.mine(actor)).filter((l) => l.status === 'pending').length,
      };
    }
    if (actor.role === 'teacher') {
      return {
        role: 'teacher',
        todayClasses: await scheduleService.todayForTeacher(actor.id),
        upcomingCancellations: (await classesService.list(actor, {})).slice(0, 5),
        pendingLeave: (await leaveService.queue(actor, { status: 'pending' })).length,
      };
    }
    if (actor.role === 'hod') {
      const academic = await import('../../../infra/repositories/academic.repo.js');
      const counts = await academic.setupCounts();
      return {
        role: 'hod',
        setup: {
          ...counts,
          // What still stands between an empty deployment and a usable one.
          complete: counts.courses > 0 && counts.subjects > 0 && counts.teachers > 0
            && counts.students > 0 && counts.sections_without_timetable === 0
            && counts.sections_without_teacher === 0 && counts.criteria > 0,
        },
        courseAverages: await attendanceService.analytics(),
        classStats: await sessions.collegeTotals(todayIso()),
        upcomingCancellations: (await classesService.list(actor, {})).slice(0, 5),
        pendingLeave: (await leaveService.queue(actor, { status: 'pending' })).length,
        recentActivity: await audit.listActivity({ limit: 12, withoutSignIns: true }),
        recentEdits: await attendanceService.recentEdits(8),
      };
    }
    if (actor.role === 'admin') {
      const users = await import('../../../infra/repositories/user.repo.js');
      const academic = await import('../../../infra/repositories/academic.repo.js');
      const [admins, hods, teachers, mentors] = await Promise.all(
        ['admin', 'hod', 'teacher', 'mentor'].map((r) => users.idsByRole(r)),
      );
      const counts = await academic.setupCounts();
      return {
        role: 'admin',
        accounts: {
          admins: admins.length,
          hods: hods.length,
          teachers: teachers.length,
          mentors: mentors.length,
          students: counts.students,
        },
        classStats: await sessions.collegeTotals(todayIso()),
        recentActivity: await audit.listActivity({ limit: 12 }),
      };
    }
    return { role: 'mentor' };
  });
}
