import * as schedule from '../infra/repositories/schedule.repo.js';
import * as users from '../infra/repositories/user.repo.js';
import { logActivity } from '../infra/repositories/audit.repo.js';
import { rethrow } from '../shared/pgErrors.js';
import { isoDayOfWeek, todayIso } from '../shared/dates.js';
import { badRequest, notFound } from '../shared/errors.js';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The grid every role reads, with one difference: `mine` is computed per viewer,
 * which is what drives "own classes in colour, everything else muted".
 */
export async function courseGrid(actor, courseId) {
  if (!courseId) throw badRequest('Pick a course.');
  const slots = await schedule.gridForCourse(courseId);
  return {
    days: DAYS,
    slots: slots.map((s) => ({ ...s, mine: s.teacher_id === actor.id })),
  };
}

export async function myGrid(actor) {
  const profile = await users.studentProfile(actor.id);
  if (!profile) throw notFound('No section assigned yet.');
  const slots = await schedule.gridForSection(profile.section_id);
  return { days: DAYS, section: profile.section_name, course: profile.course_name, slots };
}

export async function upsertSlot(actor, input) {
  const slot = await schedule.upsertSlot(input).catch(rethrow);
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'schedule.slot_saved',
    entity: 'schedule_slot', targetId: slot.id,
    details: { section_id: input.sectionId, day: input.dayOfWeek, period: input.periodNumber },
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

/** Overview bar: what a teacher is teaching today. */
export const todayForTeacher = (teacherId) => {
  const day = isoDayOfWeek(todayIso());
  return day === 7 ? Promise.resolve([]) : schedule.teacherDay(teacherId, day);
};
