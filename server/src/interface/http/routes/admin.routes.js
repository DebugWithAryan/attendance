import { z } from 'zod';
import * as admin from '../../../application/admin.service.js';
import { parse } from '../../../shared/validate.js';

const newUser = z.object({
  name: z.string().trim().min(2),
  loginId: z.string().trim().min(3).regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
  role: z.enum(['admin', 'hod', 'teacher', 'student', 'mentor']),
  canAddUsers: z.boolean().optional(),
  courseId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  rollNumber: z.string().trim().min(1).optional(),
});

const firstAdmin = z.object({
  name: z.string().trim().min(2),
  loginId: z.string().trim().min(3).regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
});

export default async function adminRoutes(app) {
  // The only two routes in the app with no preHandler. They are how a fresh
  // deployment gets its first account without anyone holding a database
  // connection string; both stop working the moment an account exists.
  app.get('/bootstrap', async () => ({ needed: await admin.bootstrapNeeded() }));

  app.post('/bootstrap', async (req, reply) => {
    const created = await admin.createFirstAdmin(parse(firstAdmin, req.body));
    reply.code(201);
    return created;
  });

  const manage = { preHandler: app.requires('users.manage') };
  const courses = { preHandler: app.requires('courses.manage') };
  const authed = { preHandler: app.authenticate };

  app.post('/users', manage, async (req, reply) => {
    const created = await admin.createUser(req.actor, parse(newUser, req.body));
    reply.code(201);
    return created;
  });

  app.delete('/users/:id', manage, (req) => admin.removeUser(req.actor, req.params.id));

  // No reset-by-email exists, so an authorised human sets the new password.
  app.post('/users/:id/password', manage, (req) =>
    admin.resetPassword(req.actor, req.params.id, parse(z.object({
      password: z.string().min(8, 'Use at least 8 characters.'),
    }), req.body)));

  app.post('/users/import', manage, (req) =>
    admin.importStudents(req.actor, parse(z.object({
      courseId: z.string().uuid(),
      sectionId: z.string().uuid(),
      csv: z.string().min(3).max(200_000),
    }), req.body)));

  app.get('/users', authed, (req) => {
    const role = parse(z.object({ role: z.enum(['admin', 'teacher', 'student', 'mentor', 'hod']) }), req.query).role;
    // Students and mentors have no business listing the roll.
    if (['student', 'mentor'].includes(req.actor.role)) return [];
    return admin.listUsers(role);
  });

  app.get('/courses', authed, () => admin.listCourses());
  app.post('/courses', courses, async (req, reply) => {
    reply.code(201);
    return admin.createCourse(req.actor, parse(z.object({ name: z.string().trim().min(2) }), req.body));
  });

  app.get('/sections', authed, (req) => admin.listSections(req.query.courseId || null));
  app.post('/sections', courses, async (req, reply) => {
    reply.code(201);
    return admin.createSection(req.actor, parse(z.object({
      courseId: z.string().uuid(), name: z.string().trim().min(1),
    }), req.body));
  });

  app.get('/subjects', authed, (req) => admin.listSubjects(req.query.courseId || null));
  app.post('/subjects', courses, async (req, reply) => {
    reply.code(201);
    return admin.createSubject(req.actor, parse(z.object({
      courseId: z.string().uuid(), name: z.string().trim().min(2), code: z.string().trim().optional(),
    }), req.body));
  });

  app.post('/allocations/class-teacher', { preHandler: app.requires('allocation.manage') }, (req) =>
    admin.allocateClassTeacher(req.actor, parse(z.object({
      courseId: z.string().uuid(), sectionId: z.string().uuid(), teacherId: z.string().uuid(),
    }), req.body)));

  app.put('/criteria', { preHandler: app.requires('criteria.manage') }, (req) =>
    admin.setCriteria(req.actor, parse(z.object({
      courseId: z.string().uuid(), percentage: z.number().min(0).max(100),
    }), req.body)));
}
