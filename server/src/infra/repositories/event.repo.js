import { pool } from '../db/pool.js';

export const insertEvent = (e, db = pool) =>
  db.query(
    `insert into events (title, description, event_date, created_by, creator_role, club_id, visibility)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [e.title, e.description ?? null, e.eventDate, e.createdBy, e.creatorRole, e.clubId ?? null, e.visibility],
  ).then((r) => r.rows[0]);

export const setCreditPeriods = async (eventId, periods, db = pool) => {
  await db.query('delete from event_credit_periods where event_id = $1', [eventId]);
  if (!periods?.length) return [];
  const rows = await db.query(
    `insert into event_credit_periods (event_id, period_number)
     select $1, p from unnest($2::smallint[]) as p returning period_number`,
    [eventId, periods],
  );
  return rows.rows.map((r) => r.period_number);
};

export const findEvent = (id, db = pool) =>
  db.query(
    `select e.*, coalesce(array_agg(cp.period_number order by cp.period_number)
              filter (where cp.period_number is not null), '{}'::smallint[]) as credit_periods
       from events e left join event_credit_periods cp on cp.event_id = e.id
      where e.id = $1 group by e.id`,
    [id],
  ).then((r) => r.rows[0] || null);

/** Visibility is enforced in SQL: a members-only event never leaves the DB for a non-member. */
export const listVisibleTo = (user, db = pool) =>
  db.query(
    `select e.*, u.name as posted_by_name, cl.name as club_name,
            coalesce(array_agg(cp.period_number order by cp.period_number)
              filter (where cp.period_number is not null), '{}'::smallint[]) as credit_periods,
            jr.status as my_request_status,
            (select count(*) from event_join_requests x where x.event_id = e.id and x.status = 'pending') as pending_count
       from events e
       join users u on u.id = e.created_by
       left join clubs cl on cl.id = e.club_id
       left join event_credit_periods cp on cp.event_id = e.id
       left join event_join_requests jr on jr.event_id = e.id and jr.student_id = $1
      where $2 in ('hod')
         or e.created_by = $1
         or e.visibility = 'all_students'
         or exists (select 1 from club_members m where m.club_id = e.club_id and m.student_id = $1)
      group by e.id, u.name, cl.name, jr.status
      order by e.event_date desc limit 100`,
    [user.id, user.role],
  ).then((r) => r.rows);

export const requestJoin = (eventId, studentId, db = pool) =>
  db.query(
    `insert into event_join_requests (event_id, student_id) values ($1,$2)
     on conflict (event_id, student_id) do nothing returning *`,
    [eventId, studentId],
  ).then((r) => r.rows[0] || null);

export const findJoinRequest = (id, db = pool) =>
  db.query(
    `select jr.*, e.created_by, e.title, e.event_date, e.club_id, s.section_id, s.course_id, u.name as student_name
       from event_join_requests jr
       join events e on e.id = jr.event_id
       join students s on s.user_id = jr.student_id
       join users u on u.id = jr.student_id
      where jr.id = $1`,
    [id],
  ).then((r) => r.rows[0] || null);

export const decideJoin = (id, status, actorId, db = pool) =>
  db.query(
    `update event_join_requests set status = $2, decided_by = $3, decided_at = now()
      where id = $1 and status = 'pending' returning *`,
    [id, status, actorId],
  ).then((r) => r.rows[0] || null);

export const listJoinRequests = (eventId, db = pool) =>
  db.query(
    `select jr.*, u.name as student_name, s.roll_number, sec.name as section_name
       from event_join_requests jr
       join users u on u.id = jr.student_id
       join students s on s.user_id = jr.student_id
       join sections sec on sec.id = s.section_id
      where jr.event_id = $1
      order by case jr.status when 'pending' then 0 else 1 end, jr.created_at`,
    [eventId],
  ).then((r) => r.rows);

export const insertCredit = (c, db = pool) =>
  db.query(
    `insert into attendance_credits
       (event_id, student_id, period_number, attendance_record_id, previous_status, was_override, credited_by)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (event_id, student_id, period_number) do nothing
     returning *`,
    [c.eventId, c.studentId, c.periodNumber, c.attendanceRecordId, c.previousStatus ?? null,
      c.wasOverride, c.creditedBy],
  ).then((r) => r.rows[0] || null);
