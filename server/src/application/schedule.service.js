import * as schedule from '../infra/repositories/schedule.repo.js';
import * as academic from '../infra/repositories/academic.repo.js';
import * as sessions from '../infra/repositories/session.repo.js';
import * as users from '../infra/repositories/user.repo.js';
import { logActivity } from '../infra/repositories/audit.repo.js';
import { rethrow } from '../shared/pgErrors.js';
import { isoDayOfWeek, todayIso } from '../shared/dates.js';
import { badRequest, notFound } from '../shared/errors.js';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The grid every role reads, with one difference: `mine` is computed per viewer,
 * which is what drives "own classes in colour, everything else muted".
 * `periodsPerDay` is how wide the course's day is, so the grid can show empty
 * periods to fill rather than only the ones already filled.
 */
const week = (course) => ({
  days: DAYS.slice(0, course?.days_per_week ?? 6),
  daysPerWeek: course?.days_per_week ?? 6,
  periodsPerDay: course?.periods_per_day ?? 8,
  timings: course?.timings ?? null,
});

export async function courseGrid(actor, courseId) {
  if (!courseId) throw badRequest('Pick a course.');
  const course = await academic.findCourse(courseId);
  if (!course) throw notFound('That course does not exist.');
  const slots = await schedule.gridForCourse(courseId);
  return {
    ...week(course),
    course: { id: course.id, name: course.name },
    slots: slots.map((s) => ({ ...s, mine: s.teacher_id === actor.id })),
  };
}

export async function myGrid(actor) {
  const profile = await users.studentProfile(actor.id);
  if (!profile) throw notFound('No section assigned yet.');
  const [slots, course] = await Promise.all([
    schedule.gridForSection(profile.section_id),
    academic.findCourse(profile.course_id),
  ]);
  return {
    ...week(course),
    section: profile.section_name,
    sectionId: profile.section_id,
    course: profile.course_name,
    slots,
  };
}

/**
 * Allocating a class to a period. Everything the form sends is checked against
 * the course it claims to belong to: a section or subject from another course,
 * a student's id in the teacher field, or a period past the end of the day
 * would otherwise land in the timetable and break marking later.
 */
export async function upsertSlot(actor, input) {
  const [course, section, subject, teacher] = await Promise.all([
    academic.findCourse(input.courseId),
    academic.findSection(input.sectionId),
    academic.findSubject(input.subjectId),
    users.findById(input.teacherId),
  ]);
  if (!course) throw notFound('That course does not exist.');
  if (!section || section.course_id !== course.id) throw badRequest('That section is not part of this course.');
  if (!subject || subject.course_id !== course.id) throw badRequest('That subject is not part of this course.');
  if (!teacher || teacher.role !== 'teacher' || teacher.status !== 'active') throw badRequest('Pick an active teacher.');
  if (input.periodNumber > course.periods_per_day) {
    throw badRequest(`${course.name} runs ${course.periods_per_day} periods a day. Raise the number of periods before filling period ${input.periodNumber}.`);
  }
  if (input.dayOfWeek > course.days_per_week) {
    throw badRequest(`${course.name} teaches Monday to ${DAYS[course.days_per_week - 1]}. Add ${DAYS[input.dayOfWeek - 1]} to its week first.`);
  }

  const slot = await schedule.upsertSlot(input).catch(rethrow);
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'schedule.slot_saved',
    entity: 'schedule_slot', targetId: slot.id,
    details: {
      section_id: input.sectionId, section: section.name, day: input.dayOfWeek, period: input.periodNumber,
      subject: subject.name, teacher: teacher.name,
    },
  });
  return slot;
}

export async function deleteSlot(actor, id) {
  const removed = await schedule.deleteSlot(id);
  if (!removed) throw notFound('That period is already empty.');
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'schedule.slot_removed',
    entity: 'schedule_slot', targetId: id,
    details: { section_id: removed.section_id, day: removed.day_of_week, period: removed.period_number },
  });
  return removed;
}

/** Blank strings out, and nothing at all when nothing was given. */
function cleanTimings(timings) {
  if (!timings) return null;
  const periods = (timings.periods || []).map((p) => p.trim());
  const afterHours = Object.fromEntries(Object.entries(timings.afterHours || {})
    .map(([day, text]) => [day, text.trim()]).filter(([, text]) => text));
  const clean = {
    periods: periods.some(Boolean) ? periods : [],
    breakAfter: timings.breakAfter ?? null,
    breakTime: timings.breakTime?.trim() || null,
    afterHoursTime: timings.afterHoursTime?.trim() || null,
    afterHours,
  };
  const empty = !clean.periods.length && !clean.breakAfter && !clean.afterHoursTime && !Object.keys(afterHours).length;
  return empty ? null : clean;
}

/**
 * The shape of the course's week: how many days, how many periods, and the
 * times printed on its routine. Shrinking the week is refused while a class
 * still sits in a day or period that would disappear, rather than hiding it.
 */
export async function updateSettings(actor, courseId, { periodsPerDay, daysPerWeek, timings }) {
  const course = await academic.findCourse(courseId);
  if (!course) throw notFound('That course does not exist.');
  const days = daysPerWeek ?? course.days_per_week;

  const [highest, latest] = await Promise.all([schedule.highestPeriod(courseId), schedule.highestDay(courseId)]);
  if (highest && highest.period_number > periodsPerDay) {
    throw badRequest(
      `Period ${highest.period_number} still has a class (${highest.section_name}, ${DAYS[highest.day_of_week - 1]}). `
      + `Clear every class after period ${periodsPerDay} first.`,
    );
  }
  if (latest && latest.day_of_week > days) {
    throw badRequest(
      `${DAYS[latest.day_of_week - 1]} still has a class (${latest.section_name}, period ${latest.period_number}). `
      + `Clear ${DAYS[latest.day_of_week - 1]} before shortening the week.`,
    );
  }

  const nextTimings = timings === undefined ? course.timings : cleanTimings(timings);
  const updated = await academic.setWeek(courseId, { periodsPerDay, daysPerWeek: days, timings: nextTimings });
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'schedule.settings_updated',
    entity: 'course', targetId: courseId,
    details: {
      course: course.name,
      periods_per_day: { from: course.periods_per_day, to: periodsPerDay },
      days_per_week: { from: course.days_per_week, to: days },
      timings_changed: timings !== undefined,
    },
  });
  return {
    id: updated.id, name: updated.name,
    periodsPerDay: updated.periods_per_day, daysPerWeek: updated.days_per_week, timings: updated.timings,
  };
}

/** Flags each of today's classes that has been cancelled, or whose register is already taken. */
async function withTodayState(slots, today) {
  const bySession = await sessions.onDate([...new Set(slots.map((s) => s.section_id))], today);
  return slots.map((s) => {
    const session = bySession.get(`${s.section_id}:${s.period_number}`);
    return {
      ...s,
      cancelled: session?.status === 'cancelled',
      cancel_reason: session?.status === 'cancelled' ? session.reason : null,
      register_taken: session?.status === 'held',
    };
  });
}

/** Overview bar: what a teacher is teaching today, in the college's timezone. */
export async function todayForTeacher(teacherId) {
  const today = todayIso();
  const day = isoDayOfWeek(today);
  if (day === 7) return [];
  return withTodayState(await schedule.teacherDay(teacherId, day), today);
}

/** A student's classes today. The server's UTC day is not the college's day. */
export async function todayForStudent(grid) {
  const today = todayIso();
  const day = isoDayOfWeek(today);
  if (day === 7) return [];
  return withTodayState(grid.slots.filter((s) => s.day_of_week === day), today);
}
