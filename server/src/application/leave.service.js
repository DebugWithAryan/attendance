import { withTransaction } from '../infra/db/pool.js';
import * as leave from '../infra/repositories/leave.repo.js';
import * as attendance from '../infra/repositories/attendance.repo.js';
import * as academic from '../infra/repositories/academic.repo.js';
import * as users from '../infra/repositories/user.repo.js';
import * as schedule from '../infra/repositories/schedule.repo.js';
import { logActivity, notify } from '../infra/repositories/audit.repo.js';
import { saveCertificate, readCertificate } from '../infra/storage/index.js';
import { badRequest, forbidden, notFound } from '../shared/errors.js';

export async function apply(actor, { fromDate, toDate, reason, certificate }) {
  if (new Date(toDate) < new Date(fromDate)) throw badRequest('The end date cannot be before the start date.');
  const profile = await users.studentProfile(actor.id);
  if (!profile) throw notFound('No student profile found.');

  // Stored before the transaction opens: an upload should not hold a database
  // connection open, and an orphaned file costs nothing if the insert fails.
  const document = certificate ? await saveCertificate(certificate) : null;

  return withTransaction(async (tx) => {
    const request = await leave.insertRequest({
      studentId: actor.id, fromDate, toDate, reason,
      documentRef: document?.ref, documentMime: document?.mime,
    }, tx);

    const hodIds = await users.idsByRole('hod', tx);
    const recipients = [profile.class_teacher_id, ...hodIds];
    await notify(recipients, {
      title: 'New leave request',
      body: `${profile.name} (${profile.roll_number}) has applied for leave from ${fromDate} to ${toDate}.`,
      category: 'leave',
      postedBy: actor.id,
    }, tx);

    await logActivity({
      actorId: actor.id, actorRole: actor.role, action: 'leave.applied',
      entity: 'leave_request', targetId: request.id,
      details: { from: fromDate, to: toDate, has_document: !!document },
    }, tx);

    return request;
  });
}

export async function queue(actor, { status }) {
  // A teacher sees the sections they are class teacher for; the HOD sees everything.
  if (actor.role === 'hod') return leave.listForReview({ status });
  const profile = await users.teacherProfile(actor.id);
  const sections = profile?.class_teacher_of || [];
  if (!sections.length) return [];
  const lists = await Promise.all(sections.map((sectionId) => leave.listForReview({ status, sectionId })));
  return lists.flat();
}

export const mine = (actor) => leave.listMine(actor.id);
export const history = (actor) => leave.listDecisionsBy(actor.id);

/**
 * Approval is not just a status flip: it writes 'leave' rows over the affected
 * periods so the register, the percentage and the teacher's roster all agree.
 */
export async function decide(actor, id, { status, note }) {
  const request = await leave.findById(id);
  if (!request) throw notFound('That leave request no longer exists.');
  if (request.status !== 'pending') throw badRequest('This request has already been decided.');

  return withTransaction(async (tx) => {
    const decided = await leave.decide({
      id, status, actorId: actor.id, actorRole: actor.role, note,
    }, tx);
    if (!decided) throw badRequest('This request has already been decided.');

    let appliedDays = [];
    if (status === 'approved') {
      appliedDays = await attendance.applyLeaveDays({
        studentId: request.student_id,
        sectionId: request.section_id,
        fromDate: request.from_date,
        toDate: request.to_date,
        actorId: actor.id,
      }, tx);
    }

    const classTeacherId = await academic.classTeacherOf(request.section_id, tx);
    const subjectTeachers = (await schedule.gridForSection(request.section_id, tx)).map((s) => s.teacher_id);
    const hodIds = await users.idsByRole('hod', tx);

    await notify([request.student_id], {
      title: `Leave ${status}`,
      body: note
        ? `Your leave from ${request.from_date} to ${request.to_date} was ${status}. Note: ${note}`
        : `Your leave from ${request.from_date} to ${request.to_date} was ${status}.`,
      category: 'leave',
      postedBy: actor.id,
    }, tx);

    if (status === 'approved') {
      await notify([classTeacherId, ...subjectTeachers, ...hodIds], {
        title: 'Approved leave affects your roster',
        body: `${request.student_name} (${request.roll_number}) is on approved leave from ${request.from_date} to ${request.to_date}. ${appliedDays.length} periods are marked as leave.`,
        category: 'leave',
        postedBy: actor.id,
      }, tx);
    }

    await logActivity({
      actorId: actor.id, actorRole: actor.role,
      action: status === 'approved' ? 'leave.approved' : 'leave.rejected',
      entity: 'leave_request', targetId: id, reason: note,
      details: {
        student: request.student_name, roll_number: request.roll_number,
        from: request.from_date, to: request.to_date, periods_marked: appliedDays.length,
      },
    }, tx);

    return { ...decided, periodsMarked: appliedDays.length };
  });
}


/**
 * Serves the certificate bytes to someone entitled to see them.
 *
 * This is health data about a student, so the check is narrow — the student
 * themselves, the class teacher of their section, or an HOD — and every view
 * lands in the audit trail. The storage reference never leaves the server.
 */
export async function document(actor, id) {
  const request = await leave.findById(id);
  if (!request) throw notFound('That leave request no longer exists.');
  if (!request.document_ref) throw notFound('No certificate was attached to this request.');

  const classTeacherId = await academic.classTeacherOf(request.section_id);
  const allowed = actor.id === request.student_id
    || actor.role === 'hod'
    || (actor.role === 'teacher' && actor.id === classTeacherId);
  if (!allowed) throw forbidden('Only this student, their class teacher and the HOD can open this certificate.');

  const bytes = await readCertificate(request.document_ref);

  // Viewing someone's medical certificate is itself worth recording.
  await logActivity({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'leave.document_viewed',
    entity: 'leave_request',
    targetId: id,
    details: { student: request.student_name, roll_number: request.roll_number },
  });

  return { bytes, mime: request.document_mime || 'application/octet-stream' };
}

/**
 * Reverses a decision that was already made — the History tab's edit.
 *
 * Approving then rejecting has to undo what the approval wrote, or the student
 * keeps leave days they were not granted. Only rows this system created from
 * the approval are removed; a teacher's later mark or an event credit stays.
 */
export async function revise(actor, id, { status, reason }) {
  const request = await leave.findById(id);
  if (!request) throw notFound('That leave request no longer exists.');
  if (request.status === 'pending') throw badRequest('This request has not been decided yet.');
  if (request.status === status) throw badRequest(`This request is already ${status}.`);
  if (actor.role !== 'hod' && request.decided_by !== actor.id) {
    throw forbidden('Only the approver who made this decision, or the HOD, can change it.');
  }

  return withTransaction(async (tx) => {
    const revised = await leave.reviseDecision({
      id, status, actorId: actor.id, actorRole: actor.role, note: reason,
    }, tx);
    if (!revised) throw badRequest('This request could not be changed.');

    let touched = [];
    if (status === 'approved') {
      touched = await attendance.applyLeaveDays({
        studentId: request.student_id,
        sectionId: request.section_id,
        fromDate: request.from_date,
        toDate: request.to_date,
        actorId: actor.id,
      }, tx);
    } else {
      touched = await attendance.removeLeaveDays({
        studentId: request.student_id,
        fromDate: request.from_date,
        toDate: request.to_date,
      }, tx);
    }

    const classTeacherId = await academic.classTeacherOf(request.section_id, tx);
    const hodIds = await users.idsByRole('hod', tx);

    await notify([request.student_id], {
      title: `Leave decision changed to ${status}`,
      body: `Your leave from ${request.from_date} to ${request.to_date} is now ${status}. Reason: ${reason}`,
      category: 'leave',
      postedBy: actor.id,
    }, tx);

    await notify([classTeacherId, ...hodIds], {
      title: 'A leave decision was changed',
      body: `${request.student_name} (${request.roll_number}): ${request.status} changed to ${status}. ${status === 'approved' ? `${touched.length} periods marked as leave.` : `${touched.length} leave periods removed.`} Reason: ${reason}`,
      category: 'leave',
      postedBy: actor.id,
    }, tx);

    await logActivity({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'leave.decision_revised',
      entity: 'leave_request',
      targetId: id,
      reason,
      details: {
        student: request.student_name,
        from_status: request.status,
        to_status: status,
        periods_changed: touched.length,
      },
    }, tx);

    return { ...revised, periodsChanged: touched.length };
  });
}
