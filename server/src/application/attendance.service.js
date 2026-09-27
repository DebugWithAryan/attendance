import { withTransaction } from '../infra/db/pool.js';
import * as attendance from '../infra/repositories/attendance.repo.js';
import * as schedule from '../infra/repositories/schedule.repo.js';
import * as academic from '../infra/repositories/academic.repo.js';
import * as users from '../infra/repositories/user.repo.js';
import { logActivity, notify } from '../infra/repositories/audit.repo.js';
import { assertCanEdit, resolveMinimum } from '../domain/policies/attendance.policy.js';
import { classesNeeded, rollup } from '../domain/services/attendance.math.js';
import { isoDayOfWeek } from '../shared/dates.js';
import { toCsv } from '../shared/csv.js';
import { rethrow } from '../shared/pgErrors.js';
import { badRequest, forbidden, notFound } from '../shared/errors.js';
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

export async function getRoster(actor, { sectionId, classDate, periodNumber }) {
  const slot = await resolveOwnedSlot(actor, { sectionId, classDate, periodNumber });
  const students = await attendance.roster({ sectionId, classDate, periodNumber });
  return {
    slot: {
      id: slot.id, subjectId: slot.subject_id, periodNumber: slot.period_number,
      dayOfWeek: slot.day_of_week, classDate,
    },
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

/** Everything the student dashboard needs, in two indexed reads. */
export async function studentView(studentId) {
  const profile = await users.studentProfile(studentId);
  if (!profile) throw notFound('No student profile found.');

  const subjects = await attendance.studentSummary(studentId);
  const overall = rollup(subjects);
  const minimum = resolveMinimum(await academic.criteriaFor(profile.course_id));

  return {
    profile,
    minimum,
    overall: {
      ...overall,
      belowMinimum: overall.percentage !== null && overall.percentage < minimum,
      ...classesNeeded(overall, minimum),
    },
    subjects: subjects.map((s) => ({
      ...s,
      belowMinimum: s.percentage !== null && s.percentage < minimum,
      ...classesNeeded(s, minimum),
    })),
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
  return rows.map((r) => ({
    ...r,
    belowMinimum: r.percentage !== null && r.percentage < Number(r.minimum),
  }));
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
    { label: 'Classes held', get: (r) => r.conducted },
    { label: 'Present', get: (r) => r.present_count },
    { label: 'Absent', get: (r) => r.absent_count },
    { label: 'Approved leave', get: (r) => r.leave_count },
    { label: 'Attendance %', get: (r) => (r.percentage === null ? '' : r.percentage) },
    { label: 'Minimum %', get: (r) => r.minimum },
    { label: 'Below minimum', get: (r) => (r.belowMinimum ? 'yes' : 'no') },
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
