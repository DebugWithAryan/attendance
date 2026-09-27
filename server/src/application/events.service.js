import { withTransaction } from '../infra/db/pool.js';
import * as events from '../infra/repositories/event.repo.js';
import * as clubs from '../infra/repositories/club.repo.js';
import * as attendance from '../infra/repositories/attendance.repo.js';
import * as schedule from '../infra/repositories/schedule.repo.js';
import * as users from '../infra/repositories/user.repo.js';
import { logActivity, notify } from '../infra/repositories/audit.repo.js';
import { assertCanApproveJoin } from '../domain/policies/attendance.policy.js';
import { isoDayOfWeek } from '../shared/dates.js';
import { badRequest, forbidden, notFound } from '../shared/errors.js';

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
    const periods = await events.setCreditPeriods(event.id, input.creditPeriods ?? [], tx);

    await logActivity({
      actorId: actor.id, actorRole: actor.role, action: 'event.created',
      entity: 'event', targetId: event.id,
      details: { title: event.title, date: input.eventDate, credit_periods: periods, visibility: input.visibility },
    }, tx);

    return { ...event, credit_periods: periods };
  });
}

export const list = (actor) => events.listVisibleTo(actor);

export async function joinRequests(actor, eventId) {
  const event = await events.findEvent(eventId);
  if (!event) throw notFound('That event does not exist.');
  if (event.created_by !== actor.id && actor.role !== 'hod') {
    throw forbidden('Only the person who posted this event can see its join requests.');
  }
  return events.listJoinRequests(eventId);
}

export async function requestJoin(actor, eventId) {
  const event = await events.findEvent(eventId);
  if (!event) throw notFound('That event does not exist.');

  if (event.visibility === 'members_only') {
    const [club] = await clubs.listClubs({ mentorId: null }).then((all) => all.filter((c) => c.id === event.club_id));
    const isMember = club?.members?.some((m) => m.student_id === actor.id);
    if (!isMember) throw forbidden('This event is open to club members only.');
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
 * The cross-cutting flow. Approving a join request can rewrite attendance, so
 * it: (1) only honours the poster's approval, (2) records what the mark was
 * before, (3) leaves a human-readable note on the record instead of a silent
 * overwrite, (4) tells the affected teacher, (5) lands in the audit trail.
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

    const credits = [];
    if (status === 'approved') {
      const day = isoDayOfWeek(event.event_date);
      for (const period of event.credit_periods) {
        const slot = day === 7 ? null : await schedule.findSlot(request.section_id, day, period, tx);
        if (!slot) {
          credits.push({ period, skipped: 'no class scheduled in this period' });
          continue;
        }

        const existing = await attendance.findRecordByKey({
          studentId: request.student_id,
          classDate: event.event_date,
          periodNumber: period,
        }, tx);

        const note = `Marked present — credited via "${event.title}" by ${actor.name}`;
        let record;
        let wasOverride = false;

        if (!existing) {
          record = await attendance.insertRecord({
            studentId: request.student_id,
            sectionId: request.section_id,
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
          studentId: request.student_id,
          periodNumber: period,
          attendanceRecordId: record.id,
          previousStatus: existing?.status ?? null,
          wasOverride,
          creditedBy: actor.id,
        }, tx);

        credits.push({ period, previousStatus: existing?.status ?? null, wasOverride });

        await notify(slot.teacher_id, {
          title: wasOverride ? 'Your attendance mark was overridden' : 'Attendance credited for your class',
          body: `${request.student_name} was marked present for period ${period} on ${event.event_date} through "${event.title}"${wasOverride ? `, replacing your mark of ${existing.status}` : ''}.`,
          category: 'attendance',
          postedBy: actor.id,
        }, tx);

        await logActivity({
          actorId: actor.id,
          actorRole: actor.role,
          action: wasOverride ? 'attendance.credit_override' : 'attendance.credited',
          entity: 'attendance_record',
          targetId: record.id,
          reason: `Event credit: ${event.title}`,
          details: {
            event: event.title, student: request.student_name, period,
            class_date: event.event_date,
            previous_status: existing?.status ?? 'none',
          },
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
        ? `You are in for "${event.title}". Credited periods: ${event.credit_periods.join(', ') || 'none'}.`
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

    return { ...decided, credits };
  });
}
