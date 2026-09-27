import { randomUUID } from 'node:crypto';
import { withTransaction } from '../infra/db/pool.js';
import * as schedule from '../infra/repositories/schedule.repo.js';
import * as sessions from '../infra/repositories/session.repo.js';
import * as attendance from '../infra/repositories/attendance.repo.js';
import * as events from '../infra/repositories/event.repo.js';
import * as users from '../infra/repositories/user.repo.js';
import { logActivity, notify } from '../infra/repositories/audit.repo.js';
import { isoDayOfWeek, periodsText, prettyDate, todayIso } from '../shared/dates.js';
import { badRequest, forbidden, notFound } from '../shared/errors.js';

/**
 * Calling classes off in advance: a holiday, a strike, exam day, a college
 * fest. One action cancels every matching class on the timetable for a date;
 * one more restores all of them.
 *
 * A cancelled class is never held: it cannot be marked, it does not count
 * towards anyone's percentage, leave approval skips it and event credits
 * ignore it. A class whose register was already taken happened, so it is
 * never cancelled from here; that is a correction to the register instead.
 */

const keyOf = (c) => `${c.section_id}:${c.period_number}`;
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const groupBy = (rows, field) => rows.reduce((map, row) => {
  const list = map.get(row[field]) || [];
  list.push(row);
  return map.set(row[field], list);
}, new Map());

const describe = (slot, why) => ({
  sectionName: slot.section_name,
  periodNumber: slot.period_number,
  subjectName: slot.subject_name,
  teacherName: slot.teacher_name,
  ...(why ? { reason: why } : {}),
});

export async function cancel(actor, { date, courseId, sectionId, periods, reason, eventId }) {
  const day = isoDayOfWeek(date);
  if (day === 7) throw badRequest('There are no classes on Sunday to cancel.');

  let event = null;
  if (eventId) {
    event = await events.findEvent(eventId);
    if (!event) throw notFound('That event does not exist.');
  }
  const why = reason?.trim() || event?.title || null;

  // A teacher's cancellation reaches only their own periods, whatever else is asked for.
  const slots = await schedule.slotsForDay({
    dayOfWeek: day,
    courseId,
    sectionId,
    teacherId: actor.role === 'teacher' ? actor.id : null,
    periods,
  });
  if (!slots.length) {
    const inPeriods = periods?.length ? ` in ${periodsText(periods)}` : '';
    throw badRequest(actor.role === 'teacher'
      ? `You have no classes on the timetable on ${prettyDate(date)}${inPeriods}.`
      : `No classes on the timetable match that on ${prettyDate(date)}${inPeriods}.`);
  }

  return withTransaction(async (tx) => {
    const sectionIds = [...new Set(slots.map((s) => s.section_id))];
    const [existing, marked] = await Promise.all([
      sessions.onDate(sectionIds, date, tx),
      attendance.markedClasses(sectionIds, date, tx),
    ]);

    const skipped = [];
    const candidates = [];
    for (const slot of slots) {
      const session = existing.get(keyOf(slot));
      if (session?.status === 'cancelled') skipped.push(describe(slot, 'already cancelled'));
      else if (session?.status === 'held' || marked.has(keyOf(slot))) skipped.push(describe(slot, 'register already taken'));
      else candidates.push(slot);
    }

    const batchId = randomUUID();
    const inserted = candidates.length
      ? await sessions.insertCancelled(candidates, {
        classDate: date, reason: why, batchId, eventId: event?.id, actorId: actor.id,
      }, tx)
      : [];
    // Anything the insert skipped was taken or cancelled by someone else a moment ago.
    const insertedKeys = new Set(inserted.map(keyOf));
    const cancelled = candidates.filter((s) => insertedKeys.has(keyOf(s)));
    for (const slot of candidates.filter((s) => !insertedKeys.has(keyOf(s)))) {
      skipped.push(describe(slot, 'register taken or cancelled meanwhile'));
    }

    if (!cancelled.length) {
      return { batchId: null, date, reason: why, cancelled: [], skipped, recordsRemoved: 0 };
    }

    // Leave and event credits written ahead of these classes describe nothing now.
    const removed = await attendance.removeSystemRows(cancelled, date, tx);

    for (const [sid, list] of groupBy(cancelled, 'section_id')) {
      await notify(await users.studentIdsInSection(sid, tx), {
        title: `Classes cancelled on ${prettyDate(date)}`,
        body: `${capital(periodsText(list.map((s) => s.period_number)))} for ${list[0].section_name} will not be held`
          + `${why ? `: ${why}` : ''}. Nothing will be marked, and ${list.length === 1 ? 'it does' : 'they do'} not count towards attendance.`,
        category: 'schedule',
        postedBy: actor.id,
      }, tx);
    }

    for (const [tid, list] of groupBy(cancelled.filter((s) => s.teacher_id !== actor.id), 'teacher_id')) {
      await notify(tid, {
        title: `${list.length === 1 ? 'Your class' : `${list.length} of your classes`} on ${prettyDate(date)} ${list.length === 1 ? 'is' : 'are'} cancelled`,
        body: `${list.map((s) => `Period ${s.period_number} · ${s.section_name} · ${s.subject_name}`).join('; ')}.`
          + `${why ? ` Reason: ${why}` : ''}`,
        category: 'schedule',
        postedBy: actor.id,
      }, tx);
    }

    // A teacher calling off their own class is something the HOD should hear about.
    if (actor.role === 'teacher') {
      await notify(await users.idsByRole('hod', tx), {
        title: 'A teacher cancelled a class',
        body: `${actor.name} cancelled ${cancelled.map((s) => `period ${s.period_number} (${s.section_name}, ${s.subject_name})`).join(', ')} `
          + `on ${prettyDate(date)}${why ? `. Reason: ${why}` : '.'}`,
        category: 'schedule',
        postedBy: actor.id,
      }, tx);
    }

    await logActivity({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'class.cancelled',
      entity: 'class_cancellation',
      targetId: batchId,
      reason: why,
      details: {
        date,
        classes: cancelled.length,
        sections: [...new Set(cancelled.map((s) => s.section_name))],
        periods: [...new Set(cancelled.map((s) => s.period_number))].sort((a, b) => a - b),
        event: event?.title ?? null,
        records_removed: removed.length,
        skipped: skipped.length,
      },
    }, tx);

    return {
      batchId,
      date,
      reason: why,
      cancelled: cancelled.map((s) => describe(s)),
      skipped,
      recordsRemoved: removed.length,
    };
  });
}

/** Cancellations the viewer should know about, from today on unless asked otherwise. */
export async function list(actor, { from }) {
  const since = from || todayIso();
  if (actor.role === 'student') {
    const profile = await users.studentProfile(actor.id);
    return profile ? sessions.listCancellations({ from: since, sectionId: profile.section_id }) : [];
  }
  if (actor.role === 'teacher') return sessions.listCancellations({ from: since, teacherId: actor.id });
  if (['hod', 'admin'].includes(actor.role)) return sessions.listCancellations({ from: since });
  return [];
}

/**
 * Undoes one cancellation action. Approved leave covering those classes is
 * written back, so a student on leave is not left looking unmarked.
 */
export async function restore(actor, batchId) {
  const rows = await sessions.batch(batchId);
  if (!rows.length) throw notFound('Those classes are no longer cancelled.');
  if (actor.role === 'teacher' && rows.some((r) => r.recorded_by !== actor.id)) {
    throw forbidden('Only whoever cancelled these classes, or the HOD, can restore them.');
  }

  return withTransaction(async (tx) => {
    const restored = await sessions.deleteBatch(batchId, tx);
    if (!restored.length) throw notFound('Those classes are no longer cancelled.');
    const date = restored[0].class_date;
    const leaveRows = await attendance.restoreLeaveFor(restored, date, actor.id, tx);

    for (const [sid, list] of groupBy(restored, 'section_id')) {
      await notify(await users.studentIdsInSection(sid, tx), {
        title: `Classes back on ${prettyDate(date)}`,
        body: `${capital(periodsText(list.map((s) => s.period_number)))} will be held after all.`,
        category: 'schedule',
        postedBy: actor.id,
      }, tx);
    }
    for (const [tid, list] of groupBy(restored.filter((s) => s.teacher_id && s.teacher_id !== actor.id), 'teacher_id')) {
      await notify(tid, {
        title: `Your class on ${prettyDate(date)} is back on`,
        body: `${capital(periodsText(list.map((s) => s.period_number)))} will be held after all. Take the register as usual.`,
        category: 'schedule',
        postedBy: actor.id,
      }, tx);
    }

    await logActivity({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'class.restored',
      entity: 'class_cancellation',
      targetId: batchId,
      details: { date, classes: restored.length, leave_periods_restored: leaveRows.length },
    }, tx);

    return { restored: restored.length, date, leavePeriodsRestored: leaveRows.length };
  });
}
