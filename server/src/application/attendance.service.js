import { withTransaction } from '../infra/db/pool.js';
import * as attendance from '../infra/repositories/attendance.repo.js';
import * as schedule from '../infra/repositories/schedule.repo.js';
import * as sessions from '../infra/repositories/session.repo.js';
import * as academic from '../infra/repositories/academic.repo.js';
import * as users from '../infra/repositories/user.repo.js';
import { logActivity, notify } from '../infra/repositories/audit.repo.js';
import { assertCanEdit, resolveMinimum } from '../domain/policies/attendance.policy.js';
import { badgeFor, classesNeeded, percentage, rollup } from '../domain/services/attendance.math.js';
import { isoDayOfWeek } from '../shared/dates.js';
import { toCsv } from '../shared/csv.js';
import { rethrow } from '../shared/pgErrors.js';
import { badRequest, conflict, forbidden, notFound } from '../shared/errors.js';
import { config } from '../config/index.js';

/**
 * A teacher may only touch a period that the timetable actually gives them.
 * This is the server-side gate behind the cascading dropdowns.
 */
async function resolveOwnedSlot(actor, { sectionId, classDate, periodNumber }) {
  const day = isoDayOfWeek(classDate);
  if (day === 7) throw badRequest('There are no classes on Sunday.');

  const slot = await schedule.findSlot(sectionId, day, periodNumber);
  if (!slot) throw notFound('The timetable has no class in that period for this section.');
  if (actor.role === 'teacher' && slot.teacher_id !== actor.id) {
    throw forbidden('That period belongs to another teacher.');
  }
  return slot;
}

const cancelledMessage = (session, classDate) =>
  `This class was cancelled for ${classDate}${session?.reason ? ` (${session.reason})` : ''}. `
  + 'Restore it from Schedule before taking the register.';

const describeSession = (session) => (session ? {
  status: session.status,
  reason: session.reason,
  by: session.recorded_by_name,
  at: session.created_at,
  batchId: session.batch_id,
} : null);

export async function getRoster(actor, { sectionId, classDate, periodNumber }) {
  const slot = await resolveOwnedSlot(actor, { sectionId, classDate, periodNumber });
  const [students, session] = await Promise.all([
    attendance.roster({ sectionId, classDate, periodNumber }),
    sessions.find(sectionId, classDate, periodNumber),
  ]);
  return {
    slot: {
      id: slot.id, subjectId: slot.subject_id, subjectName: slot.subject_name, periodNumber: slot.period_number,
      dayOfWeek: slot.day_of_week, classDate,
    },
    // A cancelled class has no register to take; the screen says so instead.
    session: describeSession(session),
    cancelled: session?.status === 'cancelled' ? describeSession(session) : null,
    editWindowHours: config.editWindowHours,
    students: students.map((s) => ({
      studentId: s.student_id,
      recordId: s.record_id,
      name: s.name,
      loginId: s.login_id,
      rollNumber: s.roll_number,
      // An approved leave pre-fills the row so nobody is marked absent by accident.
      status: s.status ?? (s.leave_request_id ? 'leave' : null),
      source: s.source,
      overrideNote: s.override_note,
      onApprovedLeave: !!s.leave_request_id,
      lastUpdatedAt: s.last_updated_at,
      lastUpdatedBy: s.last_updated_by_name,
      savedAt: s.marked_at,
    })),
  };
}

export async function saveRoster(actor, { sectionId, classDate, periodNumber, marks }) {
  const slot = await resolveOwnedSlot(actor, { sectionId, classDate, periodNumber });
  if (!marks?.length) throw badRequest('Mark at least one student before saving.');

  return withTransaction(async (tx) => {
    // Taking the register is what makes a class "held" for every student on
    // the roll. A cancelled class refuses, even if it was cancelled a moment
    // ago while this screen was open.
    const held = await sessions.markHeld({
      sectionId,
      courseId: slot.course_id,
      subjectId: slot.subject_id,
      slotId: slot.id,
      teacherId: slot.teacher_id,
      classDate,
      periodNumber,
      recordedBy: actor.id,
    }, tx);
    if (!held) throw conflict(cancelledMessage(await sessions.find(sectionId, classDate, periodNumber, tx), classDate));

    const saved = await attendance.saveMarks({
      marks,
      sectionId,
      subjectId: slot.subject_id,
      slotId: slot.id,
      classDate,
      periodNumber,
      teacherId: actor.id,
    }, tx).catch(rethrow);

    const tally = saved.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
    await logActivity({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'attendance.saved',
      entity: 'section',
      targetId: sectionId,
      details: { class_date: classDate, period: periodNumber, subject_id: slot.subject_id, tally },
    }, tx);

    return { saved: saved.length, tally };
  });
}

/** Edit inside the window (teacher) or any time (HOD) — always with a reason, always logged. */
export async function editMark(actor, recordId, { status, reason }) {
  const record = await attendance.findRecord(recordId);
  if (!record) throw notFound('That attendance record no longer exists.');
  if (!reason || reason.trim().length < 3) throw badRequest('Add a short reason for the change.');
  assertCanEdit(record, actor);

  return withTransaction(async (tx) => {
    const updated = await attendance.updateStatus({
      id: recordId,
      status,
      source: actor.role === 'hod' ? 'hod' : 'teacher',
      actorId: actor.id,
      reason,
    }, tx);

    await logActivity({
      actorId: actor.id,
      actorRole: actor.role,
      action: actor.role === 'hod' ? 'attendance.override' : 'attendance.edited',
      entity: 'attendance_record',
      targetId: recordId,
      reason,
      details: {
        from: record.status, to: status, class_date: record.class_date, period: record.period_number,
      },
    }, tx);

    await notify(record.student_id, {
      title: 'Your attendance was corrected',
      body: `${record.status} changed to ${status} for period ${record.period_number} on ${record.class_date}. Reason: ${reason}`,
      category: 'attendance',
      postedBy: actor.id,
    }, tx);

    // The HOD sees history; the teacher who owns the class hears about changes to it.
    if (actor.role === 'hod' && record.marked_by && record.marked_by !== actor.id) {
      await notify(record.marked_by, {
        title: 'The HOD corrected an attendance record',
        body: `Period ${record.period_number} on ${record.class_date}: ${record.status} to ${status}. Reason: ${reason}`,
        category: 'attendance',
        postedBy: actor.id,
      }, tx);
    }

    return updated;
  });
}

/**
 * One student's standing, measured against the classes their section actually
 * held: their own marks, plus any held class they were never marked for.
 */
const withStanding = (row, minimum) => {
  const conducted = row.present_count + row.absent_count + row.leave_count + row.not_marked;
  const pct = percentage(row);
  return {
    ...row,
    conducted,
    percentage: pct,
    belowMinimum: pct !== null && pct < minimum,
    badge: pct !== null && pct >= config.badgeThreshold,
  };
};

/** Everything the student dashboard needs. */
export async function studentView(studentId) {
  const profile = await users.studentProfile(studentId);
  if (!profile) throw notFound('No student profile found.');

  const [summary, heldBySubject, criteria, totals, eventCredits] = await Promise.all([
    attendance.studentSummary(studentId),
    sessions.studentSubjectStats(studentId),
    academic.criteriaFor(profile.course_id),
    sessions.sectionTotals(profile.section_id),
    attendance.eventCreditsFor(studentId),
  ]);
  const minimum = resolveMinimum(criteria);
  const held = new Map(heldBySubject.map((h) => [h.subject_id, h]));

  const subjects = summary.map((s) => withStanding({
    ...s,
    not_marked: held.get(s.subject_id)?.not_marked ?? 0,
    held_for_section: held.get(s.subject_id)?.held ?? 0,
  }, minimum));
  const overall = rollup(subjects);

  return {
    profile,
    minimum,
    badge: badgeFor(overall, config.badgeThreshold),
    // The college's own count for this section, whoever was or was not marked.
    classesHeld: { section: totals.held, cancelled: totals.cancelled },
    overall: {
      ...overall,
      belowMinimum: overall.percentage !== null && overall.percentage < minimum,
      ...classesNeeded(overall, minimum),
    },
    subjects: subjects.map((s) => ({ ...s, ...classesNeeded(s, minimum) })),
    eventCredits,
  };
}

export async function records(actor, filters) {
  if (actor.role === 'teacher' && !filters.sectionId && !filters.courseId) {
    throw badRequest('Pick a course or section first.');
  }
  const rows = await attendance.sectionRecords({
    ...filters,
    fallbackMinimum: config.defaultMinAttendance,
  });
  return rows.map((r) => withStanding(r, Number(r.minimum)));
}

export async function exportRecords(actor, filters) {
  const rows = (await records(actor, filters)).filter((r) => (filters.onlyBelow ? r.belowMinimum : true));

  await logActivity({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'records.exported',
    entity: 'export',
    details: {
      scope: filters.onlyBelow ? 'below_minimum' : 'all',
      course_id: filters.courseId ?? null,
      section_id: filters.sectionId ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
      row_count: rows.length,
    },
  });

  const csv = toCsv([
    { label: 'Roll number', get: (r) => r.roll_number },
    { label: 'Name', get: (r) => r.name },
    { label: 'Login ID', get: (r) => r.login_id },
    { label: 'Course', get: (r) => r.course_name },
    { label: 'Section', get: (r) => r.section_name },
    { label: 'Classes held for section', get: (r) => r.section_classes_held },
    { label: 'Classes held', get: (r) => r.conducted },
    { label: 'Present', get: (r) => r.present_count },
    { label: 'Absent', get: (r) => r.absent_count },
    { label: 'Not marked', get: (r) => r.not_marked },
    { label: 'Approved leave', get: (r) => r.leave_count },
    { label: 'Attendance %', get: (r) => (r.percentage === null ? '' : r.percentage) },
    { label: 'Minimum %', get: (r) => r.minimum },
    { label: 'Below minimum', get: (r) => (r.belowMinimum ? 'yes' : 'no') },
    { label: `Badge (${config.badgeThreshold}%+)`, get: (r) => (r.badge ? 'yes' : 'no') },
  ], rows);

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    csv,
    filename: `attendance-${filters.onlyBelow ? 'below-minimum' : 'full'}-${stamp}.csv`,
    rowCount: rows.length,
  };
}

export const analytics = () => attendance.courseAverages();

export const recentEdits = (limit) => attendance.recentEdits(limit);
