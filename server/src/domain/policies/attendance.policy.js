import { config } from '../../config/index.js';
import { forbidden } from '../../shared/errors.js';

/**
 * The 48-hour rule, in one function.
 * Teachers own their marks for a fixed window; after that only an HOD may
 * change history, and either way the change is logged with a reason.
 */
export function assertCanEdit(record, actor) {
  if (actor.role === 'hod') return { escalated: false };

  if (actor.role !== 'teacher') throw forbidden('Only the class teacher or the HOD can change attendance.');
  if (record.marked_by !== actor.id) {
    throw forbidden('Only the teacher who marked this class can edit it. Ask the HOD for a correction.');
  }

  const ageHours = (Date.now() - new Date(record.marked_at).getTime()) / 36e5;
  if (ageHours > config.editWindowHours) {
    throw forbidden(`The ${config.editWindowHours}-hour edit window has closed. The HOD can still correct this record.`);
  }
  return { escalated: false };
}

/**
 * Who is allowed to turn a join request into real attendance.
 * Only the account that posted the event, so two approvers cannot double-credit.
 */
export function assertCanApproveJoin(event, actor) {
  if (event.created_by !== actor.id && actor.role !== 'hod') {
    throw forbidden('Only the person who posted this event can approve join requests.');
  }
}

export function resolveMinimum(courseCriteria) {
  return courseCriteria ?? config.defaultMinAttendance;
}
