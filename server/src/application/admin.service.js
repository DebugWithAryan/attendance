import { withTransaction } from '../infra/db/pool.js';
import * as users from '../infra/repositories/user.repo.js';
import * as academic from '../infra/repositories/academic.repo.js';
import { hashPassword } from '../infra/security/password.js';
import { logActivity, notify } from '../infra/repositories/audit.repo.js';
import { rethrow } from '../shared/pgErrors.js';
import { badRequest, forbidden, notFound } from '../shared/errors.js';

const CREATABLE = {
  // Admins staff the college; students arrive through the HOD, who owns the
  // course and section they have to be placed in.
  admin: ['admin', 'hod', 'teacher', 'mentor'],
  hod: ['teacher', 'student', 'mentor'],
  teacher: ['student', 'mentor'], // only when the HOD granted authority
};

/** One lock id, held for the transaction, so the first account is made once. */
const BOOTSTRAP_LOCK = 8_100_724;

/** True while the deployment has no accounts at all. */
export const bootstrapNeeded = async () => (await users.countUsers()) === 0;

/**
 * Creates the administrator that a fresh deployment starts from.
 *
 * This is the one endpoint that cannot require a login, so the empty-database
 * check is the whole of its security: it runs inside a transaction behind an
 * advisory lock, which is what stops two people who both opened the first-run
 * page from both becoming an administrator. Once any account exists this can
 * never succeed again.
 */
export async function createFirstAdmin(input) {
  return withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK]);
    if ((await users.countUsers(tx)) > 0) {
      throw forbidden('This deployment has already been set up. Ask your administrator for an account.');
    }

    const created = await users.insertUser({
      name: input.name,
      loginId: input.loginId,
      passwordHash: await hashPassword(input.password),
      role: 'admin',
      canAddUsers: false,
      createdBy: null,
    }, tx).catch(rethrow);

    await logActivity({
      actorId: created.id,
      actorRole: 'admin',
      action: 'admin.bootstrapped',
      entity: 'user',
      targetId: created.id,
      details: { login_id: created.login_id, name: created.name },
    }, tx);

    return created;
  });
}

export async function createUser(actor, input) {
  const allowed = CREATABLE[actor.role] || [];
  if (!allowed.includes(input.role)) throw forbidden(`You cannot create ${input.role} accounts.`);
  if (actor.role === 'teacher' && !actor.canAddUsers) {
    throw forbidden('The HOD has not granted you permission to add accounts.');
  }
  if (input.role === 'student' && (!input.courseId || !input.sectionId || !input.rollNumber)) {
    throw badRequest('Students need a course, section and roll number.');
  }

  return withTransaction(async (tx) => {
    const passwordHash = await hashPassword(input.password);
    const created = await users.insertUser({
      name: input.name,
      loginId: input.loginId,
      passwordHash,
      role: input.role,
      canAddUsers: input.role === 'teacher' ? !!input.canAddUsers : false,
      createdBy: actor.id,
    }, tx).catch(rethrow);

    if (input.role === 'student') {
      await users.insertStudentProfile({
        userId: created.id,
        courseId: input.courseId,
        sectionId: input.sectionId,
        rollNumber: input.rollNumber,
      }, tx).catch(rethrow);
    }

    await logActivity({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'user.created',
      entity: 'user',
      targetId: created.id,
      details: { role: input.role, login_id: input.loginId, name: input.name },
    }, tx);

    await notify(created.id, {
      title: 'Welcome to the attendance portal',
      body: `Your account is ready. Sign in with ${input.loginId} and change your password from Profile.`,
      category: 'account',
      postedBy: actor.id,
    }, tx);

    return created;
  });
}

export async function removeUser(actor, userId) {
  const target = await users.findById(userId);
  if (!target) throw notFound('That account does not exist.');
  if (target.is_demo) throw forbidden('Demo accounts cannot be removed: other visitors are using them.');
  if (target.id === actor.id) throw badRequest('You cannot remove your own account.');
  if (actor.role === 'teacher' && !['student', 'mentor'].includes(target.role)) {
    throw forbidden('Teachers can only remove student and mentor accounts.');
  }
  if (target.role === 'admin') {
    if (actor.role !== 'admin') throw forbidden('Only an administrator can remove an administrator account.');
    // Removing the last one leaves nobody who can create accounts, and the
    // first-run page will not come back: the table is no longer empty.
    if ((await users.idsByRole('admin')).length <= 1) {
      throw badRequest('This is the only administrator account. Create another one before removing it.');
    }
  }
  if (target.role === 'hod' && !['admin', 'hod'].includes(actor.role)) {
    throw forbidden('Only an administrator or an HOD can remove an HOD account.');
  }

  return withTransaction(async (tx) => {
    const removed = await users.deactivate(userId, tx);
    await logActivity({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'user.removed',
      entity: 'user',
      targetId: userId,
      details: { role: target.role, name: target.name, login_id: target.login_id },
    }, tx);
    return removed;
  });
}

export const listUsers = (role) => users.listByRole(role);

export async function createCourse(actor, { name }) {
  const course = await academic.insertCourse(name, actor.id).catch(rethrow);
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'course.created',
    entity: 'course', targetId: course.id, details: { name },
  });
  return course;
}

export async function createSection(actor, { courseId, name }) {
  const section = await academic.insertSection(courseId, name).catch(rethrow);
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'section.created',
    entity: 'section', targetId: section.id, details: { name, course_id: courseId },
  });
  return section;
}

export async function createSubject(actor, input) {
  const subject = await academic.insertSubject(input).catch(rethrow);
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'subject.created',
    entity: 'subject', targetId: subject.id, details: { name: input.name },
  });
  return subject;
}

export const listCourses = () => academic.listCourses();
export const listSections = (courseId) => academic.listSections(courseId);
export const listSubjects = (courseId) => academic.listSubjects(courseId);

/** ALLOCATION bar: one class teacher per section, reassignment allowed and logged. */
export async function allocateClassTeacher(actor, { courseId, sectionId, teacherId }) {
  const teacher = await users.findById(teacherId);
  if (!teacher || teacher.role !== 'teacher') throw badRequest('Pick an active teacher.');

  return withTransaction(async (tx) => {
    const allocation = await academic
      .allocateClassTeacher({ courseId, sectionId, teacherId, assignedBy: actor.id }, tx)
      .catch(rethrow);
    await logActivity({
      actorId: actor.id, actorRole: actor.role, action: 'allocation.class_teacher',
      entity: 'section', targetId: sectionId,
      details: { teacher_id: teacherId, teacher_name: teacher.name },
    }, tx);
    await notify(teacherId, {
      title: 'You are now a class teacher',
      body: 'You have been allocated as class teacher for a section. Leave requests for it will reach you.',
      category: 'allocation',
      postedBy: actor.id,
    }, tx);
    return allocation;
  });
}

export async function setCriteria(actor, { courseId, percentage }) {
  const saved = await academic.setCriteria(courseId, percentage, actor.id).catch(rethrow);
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'criteria.updated',
    entity: 'course', targetId: courseId, details: { percentage },
  });
  return saved;
}


/**
 * Sets a new password for an account the actor is allowed to manage.
 * There is no reset-by-email anywhere in this system, so without this the only
 * recovery was deleting and recreating the student — losing their attendance.
 */
export async function resetPassword(actor, userId, { password }) {
  const target = await users.findById(userId);
  if (!target || target.status !== 'active') throw notFound('That account does not exist.');
  if (target.is_demo) throw forbidden('Demo accounts keep their shared password so every visitor can sign in.');
  if (actor.role === 'teacher' && !['student', 'mentor'].includes(target.role)) {
    throw forbidden('Teachers can only reset student and mentor passwords.');
  }
  if (target.role === 'hod' && !['admin', 'hod'].includes(actor.role)) {
    throw forbidden('Only an administrator or an HOD can reset an HOD password.');
  }
  if (target.role === 'admin' && actor.role !== 'admin') {
    throw forbidden('Only an administrator can reset an administrator password.');
  }
  if (String(password).length < 8) throw badRequest('Use at least 8 characters.');

  await users.updatePassword(userId, await hashPassword(password));
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'user.password_reset',
    entity: 'user', targetId: userId, details: { name: target.name, login_id: target.login_id },
  });
  await notify(userId, {
    title: 'Your password was changed',
    body: `${actor.name} set a new password for your account. If this was not expected, tell them.`,
    category: 'account',
    postedBy: actor.id,
  });
  return { id: userId, login_id: target.login_id };
}

/**
 * Bulk student import from pasted CSV: roll_number,name,login_id,password
 *
 * Typing 300 students into a form is how roll numbers get transposed. Rows are
 * validated one by one and every failure is reported with its line number, so
 * a partial file can be fixed and re-pasted — the rows that already landed are
 * simply reported as duplicates rather than silently doubled.
 */
export async function importStudents(actor, { courseId, sectionId, csv }) {
  const lines = String(csv).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw badRequest('Paste at least one row.');
  if (lines.length > 500) throw badRequest('Import up to 500 students at a time.');

  // Tolerate a header row.
  if (/^roll[_ ]?number\s*,/i.test(lines[0])) lines.shift();

  const created = [];
  const failed = [];

  for (const [index, line] of lines.entries()) {
    const [rollNumber, name, loginId, password] = line.split(',').map((c) => (c || '').trim());
    const lineNumber = index + 1;

    if (!rollNumber || !name || !loginId || !password) {
      failed.push({ line: lineNumber, value: line.slice(0, 40), reason: 'needs roll number, name, login ID and password' });
      continue;
    }
    if (password.length < 8) {
      failed.push({ line: lineNumber, value: loginId, reason: 'password must be at least 8 characters' });
      continue;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(loginId)) {
      failed.push({ line: lineNumber, value: loginId, reason: 'login ID may use letters, numbers, dot, dash, underscore' });
      continue;
    }

    // One transaction per student: a bad row on line 200 must not throw away
    // the 199 good ones before it.
    try {
      await withTransaction(async (tx) => {
        const user = await users.insertUser({
          name, loginId, passwordHash: await hashPassword(password),
          role: 'student', canAddUsers: false, createdBy: actor.id,
        }, tx).catch(rethrow);
        await users.insertStudentProfile({ userId: user.id, courseId, sectionId, rollNumber }, tx).catch(rethrow);
      });
      created.push({ rollNumber, loginId });
    } catch (err) {
      failed.push({ line: lineNumber, value: loginId, reason: err.message });
    }
  }

  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'users.imported',
    entity: 'section', targetId: sectionId,
    details: { created: created.length, failed: failed.length },
  });

  return { created: created.length, failed, sample: created.slice(0, 3) };
}
