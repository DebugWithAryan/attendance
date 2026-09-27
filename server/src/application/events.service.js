import { withTransaction } from '../infra/db/pool.js';
import * as events from '../infra/repositories/event.repo.js';
import * as clubs from '../infra/repositories/club.repo.js';
import * as attendance from '../infra/repositories/attendance.repo.js';
import * as schedule from '../infra/repositories/schedule.repo.js';
import * as sessions from '../infra/repositories/session.repo.js';
import * as users from '../infra/repositories/user.repo.js';
import { logActivity, notify } from '../infra/repositories/audit.repo.js';
import { assertCanApproveJoin } from '../domain/policies/attendance.policy.js';
import { isoDayOfWeek, periodsText, prettyDate } from '../shared/dates.js';
import { badRequest, forbidden, notFound } from '../shared/errors.js';

/** Why a credit period did not turn into attendance, in words a student understands. */
export const SKIPPED = {
  sunday: 'no classes on Sunday',
  noClass: 'no class scheduled in this period',
  cancelled: 'class cancelled',
};

export async function create(actor, input) {
  if (input.visibility === 'members_only') {
    if (!input.clubId) throw badRequest('A members-only event needs a club.');
    const club = await clubs.findClub(input.clubId);
    if (!club) throw notFound('That club does not exist.');
    if (actor.role === 'mentor' && club.mentor_id !== actor.id) {
      throw forbidden('You can only post events for your own club.');
    }
  }

  return withTransaction(async (tx) => {
    const event = await events.insertEvent({ ...input, createdBy: actor.id, creatorRole: actor.role }, tx);
    const periods = await events.setCreditPeriods(event.id, [...new Set(input.creditPeriods ?? [])], tx);

    await logActivity({
      actorId: actor.id, actorRole: actor.role, action: 'event.created',
      entity: 'event', targetId: event.id,
      details: { title: event.title, date: input.eventDate, credit_periods: periods, visibility: input.visibility },
    }, tx);

    return { ...event, credit_periods: periods };
  });
}

/**
 * Explains, for one section, each credit period that produced no attendance:
 * a Sunday, a period with no class on the timetable, or a cancelled class.
 * Computed on read, so the explanation matches the timetable as it is now.
 */
async function explainMissing(event, sectionId, creditedPeriods) {
  const missing = (event.credit_periods || []).filter((p) => !creditedPeriods.includes(p));
  if (!missing.length) return [];
  const day = isoDayOfWeek(event.event_date);
  if (day === 7) return missing.map((period) => ({ period, reason: SKIPPED.sunday }));
  const [slots, cancelled] = await Promise.all([
    schedule.sectionDay(sectionId, day),
    sessions.cancelledPeriods(sectionId, event.event_date),
  ]);
  return missing.map((period) => {
    if (cancelled.some((c) => c.period_number === period)) return { period, reason: SKIPPED.cancelled };
    if (!slots.some((s) => s.period_number === period)) return { period, reason: SKIPPED.noClass };
    return { period, reason: 'not credited' };
  });
}

/**
 * Events visible to the viewer. A student with an approved request also gets
 * what the event did to their register: the periods now marked present, and
 * for any period that was not, the reason.
 */
export async function list(actor) {
  const rows = await events.listVisibleTo(actor);
  if (actor.role !== 'student') return rows;

  const profile = await users.studentProfile(actor.id);
  return Promise.all(rows.map(async (e) => {
    if (e.my_request_status !== 'approved' || !profile) return { ...e, my_not_credited: [] };
    const credited = e.my_credits.map((c) => c.period);
    return { ...e, my_not_credited: await explainMissing(e, profile.section_id, credited) };
  }));
}

export async function joinRequests(actor, eventId) {
  const event = await events.findEvent(eventId);
  if (!event) throw notFound('That event does not exist.');
  if (event.created_by !== actor.id && actor.role !== 'hod') {
    throw forbidden('Only the person who posted this event can see its join requests.');
  }
  const rows = await events.listJoinRequests(eventId);
  // One explanation per section, not per student: everyone in a section shares a timetable.
  const bySection = new Map();
  return Promise.all(rows.map(async (r) => {
    if (r.status !== 'approved') return { ...r, not_credited: [] };
    const credited = r.credits.map((c) => c.period);
    const key = `${r.section_id}:${credited.join(',')}`;
    if (!bySection.has(key)) bySection.set(key, explainMissing(event, r.section_id, credited));
    return { ...r, not_credited: await bySection.get(key) };
  }));
}

export async function requestJoin(actor, eventId) {
  const event = await events.findEvent(eventId);
  if (!event) throw notFound('That event does not exist.');

  if (event.visibility === 'members_only' && !(await clubs.isMember(event.club_id, actor.id))) {
    throw forbidden('This event is open to club members only.');
  }

  const created = await events.requestJoin(eventId, actor.id);
  if (!created) throw badRequest('You have already asked to join this event.');

  await notify(event.created_by, {
    title: 'New join request',
    body: `A student has asked to join "${event.title}".`,
    category: 'event',
    postedBy: actor.id,
  });
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'event.join_requested',
    entity: 'event', targetId: eventId, details: { title: event.title },
  });
  return created;
}

/**
 * Turns one student's place at an event into attendance, period by period,
 * inside the caller's transaction. It: (1) records what the mark was before,
 * (2) leaves a human-readable note on the record instead of a silent
 * overwrite, (3) writes an audit row per period, and (4) says, for any period
 * it could not credit, why. Notifying teachers is left to the caller, which
 * knows whether this is one student or a whole list.
 */
async function creditStudent(tx, { event, student, actor }) {
  const day = isoDayOfWeek(event.event_date);
  const cancelled = day === 7 ? [] : (await sessions.cancelledPeriods(student.section_id, event.event_date, tx))
    .map((c) => c.period_number);
  const credits = [];

  for (const period of event.credit_periods) {
    if (day === 7) { credits.push({ period, skipped: SKIPPED.sunday }); continue; }
    if (cancelled.includes(period)) { credits.push({ period, skipped: SKIPPED.cancelled }); continue; }
    const slot = await schedule.findSlot(student.section_id, day, period, tx);
    if (!slot) { credits.push({ period, skipped: SKIPPED.noClass }); continue; }

    const existing = await attendance.findRecordByKey({
      studentId: student.id,
      classDate: event.event_date,
      periodNumber: period,
    }, tx);

    const note = `Marked present — credited via "${event.title}" by ${actor.name}`;
    let record;
    let wasOverride = false;

    if (!existing) {
      record = await attendance.insertRecord({
        studentId: student.id,
        sectionId: student.section_id,
        subjectId: slot.subject_id,
        slotId: slot.id,
        classDate: event.event_date,
        periodNumber: period,
        status: 'present',
        source: 'event_credit',
        actorId: actor.id,
        overrideNote: note,
      }, tx);
    } else if (existing.status === 'present') {
      record = existing; // already present: credit is recorded, nothing to change
    } else {
      wasOverride = existing.source === 'teacher';
      record = await attendance.updateStatus({
        id: existing.id,
        status: 'present',
        source: 'event_credit',
        actorId: actor.id,
        reason: `Event credit: ${event.title}`,
        overrideNote: wasOverride
          ? `${note}, overriding the teacher's original mark of ${existing.status}`
          : note,
      }, tx);
    }

    await events.insertCredit({
      eventId: event.id,
      studentId: student.id,
      periodNumber: period,
      attendanceRecordId: record.id,
      previousStatus: existing?.status ?? null,
      wasOverride,
      creditedBy: actor.id,
    }, tx);

    await logActivity({
      actorId: actor.id,
      actorRole: actor.role,
      action: wasOverride ? 'attendance.credit_override' : 'attendance.credited',
      entity: 'attendance_record',
      targetId: record.id,
      reason: `Event credit: ${event.title}`,
      details: {
        event: event.title, student: student.name, period,
        class_date: event.event_date,
        previous_status: existing?.status ?? 'none',
      },
    }, tx);

    credits.push({
      period,
      subject: slot.subject_name,
      teacherId: slot.teacher_id,
      previousStatus: existing?.status ?? null,
      wasOverride,
    });
  }
  return credits;
}

/** "Attendance credited for period 2 (Databases). Not credited: period 7 — no class scheduled in this period." */
export function describeCredits(credits) {
  const done = credits.filter((c) => !c.skipped);
  const skipped = credits.filter((c) => c.skipped);
  const parts = [];
  if (done.length) {
    parts.push(`Attendance credited for ${done.map((c) => `period ${c.period}${c.subject ? ` (${c.subject})` : ''}`).join(', ')}.`);
  }
  if (skipped.length) {
    parts.push(`Not credited: ${skipped.map((c) => `period ${c.period} — ${c.skipped}`).join('; ')}.`);
  }
  if (!credits.length) parts.push('This event does not credit any class periods.');
  return parts.join(' ');
}

// What the API reports per credit; the teacher id is internal.
const publicCredit = ({ teacherId, ...rest }) => rest;

/**
 * Approving a join request can rewrite attendance, so it only honours the
 * poster's approval, credits through creditStudent, tells the affected teacher
 * and the HOD, and lands in the audit trail.
 */
export async function decideJoin(actor, requestId, { status }) {
  const request = await events.findJoinRequest(requestId);
  if (!request) throw notFound('That join request no longer exists.');
  if (request.status !== 'pending') throw badRequest('This request has already been decided.');

  const event = await events.findEvent(request.event_id);
  assertCanApproveJoin(event, actor);

  return withTransaction(async (tx) => {
    const decided = await events.decideJoin(requestId, status, actor.id, tx);
    if (!decided) throw badRequest('This request has already been decided.');

    let credits = [];
    if (status === 'approved') {
      credits = await creditStudent(tx, {
        event,
        student: { id: request.student_id, name: request.student_name, section_id: request.section_id },
        actor,
      });

      for (const credit of credits.filter((c) => !c.skipped)) {
        await notify(credit.teacherId, {
          title: credit.wasOverride ? 'Your attendance mark was overridden' : 'Attendance credited for your class',
          body: `${request.student_name} was marked present for period ${credit.period} on ${event.event_date} through "${event.title}"${credit.wasOverride ? `, replacing your mark of ${credit.previousStatus}` : ''}.`,
          category: 'attendance',
          postedBy: actor.id,
        }, tx);
      }

      const hodIds = await users.idsByRole('hod', tx);
      await notify(hodIds, {
        title: 'Event attendance credited',
        body: `${request.student_name} received credit for ${credits.filter((c) => !c.skipped).length} period(s) through "${event.title}".`,
        category: 'attendance',
        postedBy: actor.id,
      }, tx);
    }

    await notify(request.student_id, {
      title: `Join request ${status}`,
      body: status === 'approved'
        ? `You are in for "${event.title}". ${describeCredits(credits)}`
        : `Your request to join "${event.title}" was not approved.`,
      category: 'event',
      postedBy: actor.id,
    }, tx);

    if (status === 'rejected') {
      await logActivity({
        actorId: actor.id, actorRole: actor.role, action: 'event.join_rejected',
        entity: 'event', targetId: event.id, details: { student: request.student_name, title: event.title },
      }, tx);
    }

    return { ...decided, credits: credits.map(publicCredit) };
  });
}

/**
 * The organiser adds attendance for students who took part, by login ID, in
 * one step: no join request to wait for, the credit applied immediately.
 *
 * Each student is their own transaction, like the bulk student import: one
 * unknown login ID must not throw away the thirty good ones before it. Teachers
 * get one summary per event instead of one message per student.
 */
export async function addAttendance(actor, eventId, { loginIds }) {
  const event = await events.findEvent(eventId);
  if (!event) throw notFound('That event does not exist.');
  assertCanApproveJoin(event, actor);

  const wanted = [...new Map(loginIds.map((l) => String(l).trim()).filter(Boolean)
    .map((l) => [l.toLowerCase(), l])).values()];
  if (!wanted.length) throw badRequest('Enter at least one student login ID.');

  const results = [];
  const teachers = new Map(); // teacherId -> { students: Set, overrides: n, periods: Set }

  for (const loginId of wanted) {
    const student = await users.findByLoginId(loginId);
    if (!student || student.role !== 'student') {
      results.push({ loginId, status: 'failed', reason: 'No active student has that login ID.' });
      continue;
    }
    if (event.visibility === 'members_only' && !(await clubs.isMember(event.club_id, student.id))) {
      results.push({ loginId, name: student.name, status: 'failed', reason: 'Not a member of this event’s club.' });
      continue;
    }
    const profile = await users.studentProfile(student.id);
    if (!profile) {
      results.push({ loginId, name: student.name, status: 'failed', reason: 'This student is not placed in a section.' });
      continue;
    }

    try {
      const outcome = await withTransaction(async (tx) => {
        const approved = await events.approveDirectly(event.id, student.id, actor.id, tx);
        if (!approved) return { already: true };
        const credits = await creditStudent(tx, {
          event, student: { id: student.id, name: student.name, section_id: profile.section_id }, actor,
        });
        await notify(student.id, {
          title: `Attendance added for "${event.title}"`,
          body: `${actor.name} recorded that you took part. ${describeCredits(credits)}`,
          category: 'event',
          postedBy: actor.id,
        }, tx);
        return { credits };
      });

      if (outcome.already) {
        results.push({ loginId: student.login_id, name: student.name, status: 'already', reason: 'Already approved for this event.' });
        continue;
      }
      for (const c of outcome.credits.filter((x) => !x.skipped)) {
        const t = teachers.get(c.teacherId) || { students: new Set(), overrides: 0, periods: new Set() };
        t.students.add(student.name);
        t.periods.add(c.period);
        if (c.wasOverride) t.overrides += 1;
        teachers.set(c.teacherId, t);
      }
      results.push({
        loginId: student.login_id, name: student.name, status: 'added',
        credits: outcome.credits.map(publicCredit),
      });
    } catch (err) {
      results.push({ loginId, name: student.name, status: 'failed', reason: err.message });
    }
  }

  const added = results.filter((r) => r.status === 'added');
  const creditedPeriods = added.reduce((n, r) => n + r.credits.filter((c) => !c.skipped).length, 0);

  for (const [teacherId, t] of teachers) {
    await notify(teacherId, {
      title: t.overrides ? 'Event attendance overrode some of your marks' : 'Attendance credited for your class',
      body: `${t.students.size} student(s) were marked present for ${periodsText([...t.periods])} on ${prettyDate(event.event_date)} through "${event.title}"`
        + `${t.overrides ? `, replacing ${t.overrides} of your marks` : ''}.`,
      category: 'attendance',
      postedBy: actor.id,
    });
  }
  if (added.length) {
    await notify(await users.idsByRole('hod'), {
      title: 'Event attendance added',
      body: `${actor.name} added attendance for ${added.length} student(s) at "${event.title}": ${creditedPeriods} period(s) credited.`,
      category: 'attendance',
      postedBy: actor.id,
    });
  }
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'event.attendance_added',
    entity: 'event', targetId: event.id,
    details: {
      title: event.title, added: added.length, credited_periods: creditedPeriods,
      already: results.filter((r) => r.status === 'already').length,
      failed: results.filter((r) => r.status === 'failed').length,
    },
  });

  return {
    added: added.length,
    creditedPeriods,
    already: results.filter((r) => r.status === 'already').length,
    failed: results.filter((r) => r.status === 'failed'),
    results,
  };
}
