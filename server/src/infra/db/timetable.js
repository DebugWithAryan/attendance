import { randomBytes } from 'node:crypto';
import { hashPassword } from '../security/password.js';

/**
 * Loads a class routine — a JSON file like timetables/d2-bba.json — into the
 * database: the course and section, their subjects, the teachers, the week's
 * allocations and the printed timings. `npm run timetable:import` uses it for
 * a real college; seed:demo uses it to build the demo college's week.
 *
 * It is idempotent: importing the same routine twice changes nothing the
 * second time. The section's timetable is made to match the file exactly, so
 * a period the file leaves empty is cleared; registers already taken in it
 * keep their marks.
 */

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dayNumber = (day) => {
  if (Number.isInteger(day) && day >= 1 && day <= 6) return day;
  const n = DAYS.findIndex((d) => d.toLowerCase() === String(day).trim().toLowerCase()) + 1;
  return n || null;
};

/** Checks the file before touching the database, and says exactly what is wrong. */
export function validateRoutine(routine) {
  const problems = [];
  const need = (cond, message) => { if (!cond) problems.push(message); };
  need(typeof routine.course === 'string' && routine.course.trim().length >= 2, 'course: give the course name.');
  need(typeof routine.section === 'string' && routine.section.trim().length >= 1, 'section: give the section name.');
  const days = routine.daysPerWeek ?? 6;
  const periods = routine.periodsPerDay ?? 8;
  need(Number.isInteger(days) && days >= 1 && days <= 6, 'daysPerWeek: between 1 and 6.');
  need(Number.isInteger(periods) && periods >= 1 && periods <= 12, 'periodsPerDay: between 1 and 12.');
  need(Array.isArray(routine.slots) && routine.slots.length > 0, 'slots: the routine has no classes.');

  const seen = new Set();
  for (const [i, slot] of (routine.slots || []).entries()) {
    const where = `slots[${i}]`;
    const day = dayNumber(slot.day);
    need(!!day, `${where}: "${slot.day}" is not a day from Monday to Saturday.`);
    need(!day || day <= days, `${where}: ${DAYS[(day || 1) - 1]} is past the ${days}-day week.`);
    need(Number.isInteger(slot.period) && slot.period >= 1 && slot.period <= periods,
      `${where}: period ${slot.period} is outside 1 to ${periods}.`);
    need(typeof slot.subject === 'string' && slot.subject.trim().length >= 2, `${where}: needs a subject.`);
    need(slot.teacher === null || slot.teacher === undefined || !!routine.teachers?.[slot.teacher],
      `${where}: teacher "${slot.teacher}" is not listed under teachers.`);
    const key = `${day}:${slot.period}`;
    need(!seen.has(key), `${where}: ${DAYS[(day || 1) - 1]} period ${slot.period} appears twice.`);
    seen.add(key);
  }
  if (problems.length) {
    const err = new Error(`The routine file has problems:\n  - ${problems.join('\n  - ')}`);
    err.problems = problems;
    throw err;
  }
}

/** Timings as the course stores them: day names become day numbers. */
function normaliseTimings(timings) {
  if (!timings) return null;
  const afterHours = {};
  for (const [day, text] of Object.entries(timings.afterHours || {})) {
    const n = dayNumber(Number.isNaN(Number(day)) ? day : Number(day));
    if (n && String(text).trim()) afterHours[n] = String(text).trim();
  }
  return {
    periods: (timings.periods || []).map((p) => String(p).trim()),
    breakAfter: timings.breakAfter ?? null,
    breakTime: timings.breakTime ?? null,
    afterHoursTime: timings.afterHoursTime ?? null,
    afterHours,
  };
}

const randomPassword = () => randomBytes(9).toString('base64url');

/**
 * @param tx       a client inside a transaction
 * @param routine  the parsed routine file
 * @param options  createdBy     user id recorded as creating new rows (required)
 *                 loginFor      initials -> login ID (default faculty.<initials>)
 *                 password      one password for every new teacher (default: a random one each)
 *                 isDemo        flag new teacher accounts as demo accounts
 *                 placeholder   { name, loginId } to stand in for a class with no teacher;
 *                               without it such a class is left out and reported
 */
export async function importRoutine(tx, routine, options) {
  validateRoutine(routine);
  const {
    createdBy, loginFor = (initials) => `faculty.${initials.toLowerCase()}`,
    password, isDemo = false, placeholder = null,
  } = options;
  if (!createdBy) throw new Error('importRoutine needs createdBy: the HOD or administrator doing the import.');

  const report = {
    course: routine.course.trim(),
    section: routine.section.trim(),
    created: { course: false, section: false, subjects: [], teachers: [] },
    slots: { added: 0, changed: 0, unchanged: 0, cleared: 0 },
    unassigned: [],
  };
  const days = routine.daysPerWeek ?? 6;
  const periods = routine.periodsPerDay ?? 8;

  // ---- course and section ------------------------------------------------
  let course = (await tx.query('select * from courses where lower(name) = lower($1)', [report.course])).rows[0];
  if (!course) {
    course = (await tx.query('insert into courses (name, created_by) values ($1,$2) returning *', [report.course, createdBy])).rows[0];
    report.created.course = true;
  }
  let section = (await tx.query(
    'select * from sections where course_id = $1 and lower(name) = lower($2)', [course.id, report.section],
  )).rows[0];
  if (!section) {
    section = (await tx.query('insert into sections (course_id, name) values ($1,$2) returning *', [course.id, report.section])).rows[0];
    report.created.section = true;
  }

  // Another section of the course may already use a longer week or day.
  const { rows: [widest] } = await tx.query(
    `select max(period_number) as period, max(day_of_week) as day from schedule_slots
      where course_id = $1 and section_id <> $2`,
    [course.id, section.id],
  );
  if ((widest.period && widest.period > periods) || (widest.day && widest.day > days)) {
    throw new Error(`Another section of ${course.name} has classes beyond ${days} days of ${periods} periods. `
      + 'Import it into its own course, or widen the routine.');
  }
  await tx.query(
    'update courses set periods_per_day = $2, days_per_week = $3, timings = $4 where id = $1',
    [course.id, periods, days, JSON.stringify(normaliseTimings(routine.timings))],
  );

  // ---- subjects -------------------------------------------------------------
  const subjects = new Map();
  for (const name of [...new Set(routine.slots.map((s) => s.subject.trim()))]) {
    let subject = (await tx.query(
      'select * from subjects where course_id = $1 and lower(name) = lower($2)', [course.id, name],
    )).rows[0];
    if (!subject) {
      subject = (await tx.query('insert into subjects (course_id, name) values ($1,$2) returning *', [course.id, name])).rows[0];
      report.created.subjects.push(name);
    }
    subjects.set(name, subject);
  }

  // ---- teachers -------------------------------------------------------------
  const teacherAccount = async (name, loginId) => {
    const found = (await tx.query('select * from users where lower(login_id) = lower($1)', [loginId])).rows[0];
    if (found) {
      if (found.role !== 'teacher' || found.status !== 'active') {
        throw new Error(`The login ID ${loginId} belongs to an account that is not an active teacher. Give this teacher another loginId in the file.`);
      }
      return found;
    }
    const plain = password || randomPassword();
    const created = (await tx.query(
      `insert into users (name, login_id, password_hash, role, created_by, is_demo)
       values ($1,$2,$3,'teacher',$4,$5) returning *`,
      [name, loginId, await hashPassword(plain), createdBy, isDemo],
    )).rows[0];
    report.created.teachers.push({ name, loginId, password: password ? null : plain });
    return created;
  };

  const teachers = new Map();
  for (const initials of [...new Set(routine.slots.map((s) => s.teacher).filter(Boolean))]) {
    const entry = routine.teachers[initials];
    teachers.set(initials, await teacherAccount(entry.name || initials, entry.loginId || loginFor(initials)));
  }
  const stand = placeholder && routine.slots.some((s) => !s.teacher)
    ? await teacherAccount(placeholder.name, placeholder.loginId)
    : null;

  // ---- the week ---------------------------------------------------------------
  const existing = new Map((await tx.query('select * from schedule_slots where section_id = $1', [section.id]))
    .rows.map((s) => [`${s.day_of_week}:${s.period_number}`, s]));
  const wanted = new Set();

  for (const slot of routine.slots) {
    const day = dayNumber(slot.day);
    const teacher = slot.teacher ? teachers.get(slot.teacher) : stand;
    if (!teacher) {
      report.unassigned.push({ day: DAYS[day - 1], period: slot.period, subject: slot.subject });
      continue;
    }
    const subject = subjects.get(slot.subject.trim());
    const key = `${day}:${slot.period}`;
    wanted.add(key);
    const before = existing.get(key);
    if (before && before.subject_id === subject.id && before.teacher_id === teacher.id) {
      report.slots.unchanged += 1;
      continue;
    }
    try {
      await tx.query(
        `insert into schedule_slots (course_id, section_id, day_of_week, period_number, subject_id, teacher_id)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (section_id, day_of_week, period_number)
           do update set subject_id = excluded.subject_id, teacher_id = excluded.teacher_id`,
        [course.id, section.id, day, slot.period, subject.id, teacher.id],
      );
    } catch (err) {
      if (err.code === '23505') {
        throw new Error(`${teacher.name} already teaches another section on ${DAYS[day - 1]} in period ${slot.period}, `
          + `so ${section.name} cannot have them then too.`);
      }
      throw err;
    }
    report.slots[before ? 'changed' : 'added'] += 1;
  }

  // Periods the routine leaves empty are cleared, so the grid matches the paper.
  for (const [key, slot] of existing) {
    if (wanted.has(key)) continue;
    await tx.query('delete from schedule_slots where id = $1', [slot.id]);
    report.slots.cleared += 1;
  }

  await tx.query(
    `insert into activity_log (actor_id, actor_role, action_type, target_entity, target_id, details)
     values ($1, (select role from users where id = $1), 'timetable.imported', 'section', $2, $3)`,
    [createdBy, section.id, JSON.stringify({
      title: routine.title ?? null, course: course.name, section: section.name,
      days_per_week: days, periods_per_day: periods, ...report.slots,
      teachers_created: report.created.teachers.length, unassigned: report.unassigned.length,
    })],
  );

  return { ...report, courseId: course.id, sectionId: section.id };
}
