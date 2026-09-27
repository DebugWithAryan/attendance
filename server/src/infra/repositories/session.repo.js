import { pool } from '../db/pool.js';

/**
 * class_sessions: one row per class that was held (its register was taken) or
 * cancelled in advance. The unique (section, date, period) key is what makes a
 * class unable to be both, even when a teacher saves a register at the same
 * moment the HOD cancels the day.
 */

export const find = (sectionId, classDate, periodNumber, db = pool) =>
  db.query(
    `select cs.*, u.name as recorded_by_name
       from class_sessions cs left join users u on u.id = cs.recorded_by
      where cs.section_id = $1 and cs.class_date = $2 and cs.period_number = $3`,
    [sectionId, classDate, periodNumber],
  ).then((r) => r.rows[0] || null);

/**
 * Records that a register was taken. Returns null when the class is
 * cancelled: the conditional update refuses to turn a cancellation into a
 * held class, so the caller can stop the save.
 */
export const markHeld = (s, db = pool) =>
  db.query(
    `insert into class_sessions
       (section_id, course_id, subject_id, slot_id, teacher_id, class_date, period_number, status, recorded_by)
     values ($1,$2,$3,$4,$5,$6,$7,'held',$8)
     on conflict (section_id, class_date, period_number) do update
        set subject_id = excluded.subject_id, slot_id = excluded.slot_id,
            teacher_id = excluded.teacher_id, updated_at = now()
      where class_sessions.status = 'held'
     returning *`,
    [s.sectionId, s.courseId, s.subjectId, s.slotId, s.teacherId, s.classDate, s.periodNumber, s.recordedBy],
  ).then((r) => r.rows[0] || null);

/** Every session for these sections on one date, keyed by `${section}:${period}`. */
export const onDate = async (sectionIds, classDate, db = pool) => {
  if (!sectionIds.length) return new Map();
  const { rows } = await db.query(
    `select * from class_sessions where section_id = any($1::uuid[]) and class_date = $2`,
    [sectionIds, classDate],
  );
  return new Map(rows.map((r) => [`${r.section_id}:${r.period_number}`, r]));
};

/** Inserts cancellations; a class that is already held or cancelled is left alone. */
export const insertCancelled = (classes, meta, db = pool) =>
  db.query(
    `insert into class_sessions
       (section_id, course_id, subject_id, slot_id, teacher_id, class_date, period_number,
        status, reason, batch_id, event_id, recorded_by)
     select c.section_id, c.course_id, c.subject_id, c.slot_id, c.teacher_id, $2::date, c.period_number,
            'cancelled', $3, $4, $5, $6
       from jsonb_to_recordset($1::jsonb)
         as c(section_id uuid, course_id uuid, subject_id uuid, slot_id uuid, teacher_id uuid, period_number smallint)
     on conflict (section_id, class_date, period_number) do nothing
     returning *`,
    [JSON.stringify(classes), meta.classDate, meta.reason ?? null, meta.batchId, meta.eventId ?? null, meta.actorId],
  ).then((r) => r.rows);

export const batch = (batchId, db = pool) =>
  db.query(
    `select * from class_sessions where batch_id = $1 and status = 'cancelled'`,
    [batchId],
  ).then((r) => r.rows);

export const deleteBatch = (batchId, db = pool) =>
  db.query(
    `delete from class_sessions where batch_id = $1 and status = 'cancelled' returning *`,
    [batchId],
  ).then((r) => r.rows);

/**
 * Cancellations grouped by the action that made them, newest first. Scope
 * narrows it for a student (their section) or a teacher (their classes, or
 * the ones they cancelled themselves).
 */
export const listCancellations = ({ from, sectionId, teacherId, limit = 50 }, db = pool) =>
  db.query(
    `select cs.batch_id, cs.class_date, cs.reason, cs.event_id, e.title as event_title,
            min(cs.created_at) as cancelled_at, cs.recorded_by, u.name as cancelled_by_name,
            count(*) as classes,
            count(distinct cs.section_id) as sections,
            array_agg(distinct cs.period_number order by cs.period_number) as periods,
            array_agg(distinct sec.name order by sec.name) as section_names,
            bool_or(cs.teacher_id = $3) as affects_me
       from class_sessions cs
       join sections sec on sec.id = cs.section_id
       left join users u on u.id = cs.recorded_by
       left join events e on e.id = cs.event_id
      where cs.status = 'cancelled'
        and ($1::date is null or cs.class_date >= $1)
        and ($2::uuid is null or cs.section_id = $2)
        and ($3::uuid is null or cs.teacher_id = $3 or cs.recorded_by = $3)
      group by cs.batch_id, cs.class_date, cs.reason, cs.event_id, e.title, cs.recorded_by, u.name
      order by cs.class_date, min(cs.created_at) desc
      limit $4`,
    [from ?? null, sectionId ?? null, teacherId ?? null, limit],
  ).then((r) => r.rows);

/** Periods cancelled for one section on one date. */
export const cancelledPeriods = (sectionId, classDate, db = pool) =>
  db.query(
    `select period_number, reason from class_sessions
      where section_id = $1 and class_date = $2 and status = 'cancelled'`,
    [sectionId, classDate],
  ).then((r) => r.rows);

/**
 * Per subject, for one student: the held classes that count for them and how
 * many of those they have no mark for. A held class counts when the student
 * has a mark in it, or when its register was taken after they joined — a
 * student added in week six is not absent from week one.
 */
export const studentSubjectStats = (studentId, db = pool) =>
  db.query(
    `select cs.subject_id,
            count(*) as held,
            count(*) filter (where r.id is null) as not_marked
       from students st
       join users u on u.id = st.user_id
       join class_sessions cs on cs.section_id = st.section_id and cs.status = 'held'
       left join attendance_records r
              on r.student_id = st.user_id and r.class_date = cs.class_date and r.period_number = cs.period_number
      where st.user_id = $1
        and (r.id is not null or cs.created_at >= u.created_at)
      group by cs.subject_id`,
    [studentId],
  ).then((r) => r.rows);

/** Held and cancelled class counts for one section: the college's own totals. */
export const sectionTotals = (sectionId, db = pool) =>
  db.query(
    `select count(*) filter (where status = 'held') as held,
            count(*) filter (where status = 'cancelled') as cancelled
       from class_sessions where section_id = $1`,
    [sectionId],
  ).then((r) => r.rows[0]);

/**
 * College-wide totals for the HOD and administrator: every class held so far,
 * how many today, and the cancellations still ahead.
 */
export const collegeTotals = (today, db = pool) =>
  db.query(
    `select count(*) filter (where status = 'held') as held,
            count(*) filter (where status = 'held' and class_date = $1) as held_today,
            count(*) filter (where status = 'cancelled') as cancelled,
            count(*) filter (where status = 'cancelled' and class_date >= $1) as cancelled_upcoming
       from class_sessions`,
    [today],
  ).then((r) => r.rows[0]);
