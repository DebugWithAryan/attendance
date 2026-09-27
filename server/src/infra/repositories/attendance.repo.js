import { pool } from '../db/pool.js';

export const roster = ({ sectionId, classDate, periodNumber }, db = pool) =>
  db.query(
    `select u.id as student_id, u.name, u.login_id, s.roll_number,
            r.id as record_id, r.status, r.source, r.override_note, r.marked_at,
            r.last_updated_at, lu.name as last_updated_by_name,
            lr.id as leave_request_id
       from students s
       join users u on u.id = s.user_id and u.status = 'active'
       left join attendance_records r
              on r.student_id = s.user_id and r.class_date = $2 and r.period_number = $3
       left join users lu on lu.id = r.last_updated_by
       left join leave_requests lr
              on lr.student_id = s.user_id and lr.status = 'approved'
             and $2::date between lr.from_date and lr.to_date
      where s.section_id = $1
      order by s.roll_number`,
    [sectionId, classDate, periodNumber],
  ).then((r) => r.rows);

/**
 * Saves a whole roster in one statement. Postgres does the fan-out, so marking
 * 120 students costs one round trip and one array in Node's heap.
 *
 * Only students of this section can land in its register. Re-saving leaves an
 * unchanged mark's provenance alone: an event credit or an approved leave the
 * teacher confirmed by saving is still a credit or a leave, so it keeps its
 * tint on the register and a later reversal of that leave still finds it.
 */
export const saveMarks = (batch, db = pool) =>
  db.query(
    `insert into attendance_records
       (student_id, section_id, subject_id, slot_id, class_date, period_number,
        status, source, marked_by, marked_at, last_updated_by)
     select m.student_id, $2, $3, $4, $5, $6, m.status, 'teacher', $7, now(), $7
       from jsonb_to_recordset($1::jsonb) as m(student_id uuid, status text)
       join students st on st.user_id = m.student_id and st.section_id = $2
     on conflict (student_id, class_date, period_number) do update
        set status = excluded.status,
            subject_id = excluded.subject_id,
            slot_id = excluded.slot_id,
            edited_by = case when attendance_records.status <> excluded.status then $7 else attendance_records.edited_by end,
            edited_at = case when attendance_records.status <> excluded.status then now() else attendance_records.edited_at end,
            source = case when attendance_records.status = excluded.status then attendance_records.source else 'teacher' end,
            override_note = case when attendance_records.status = excluded.status then attendance_records.override_note else null end,
            last_updated_by = $7
     returning id, student_id, status`,
    [JSON.stringify(batch.marks), batch.sectionId, batch.subjectId, batch.slotId,
      batch.classDate, batch.periodNumber, batch.teacherId],
  ).then((r) => r.rows);

export const findRecord = (id, db = pool) =>
  db.query('select * from attendance_records where id = $1', [id]).then((r) => r.rows[0] || null);

export const findRecordByKey = ({ studentId, classDate, periodNumber }, db = pool) =>
  db.query(
    `select * from attendance_records where student_id = $1 and class_date = $2 and period_number = $3`,
    [studentId, classDate, periodNumber],
  ).then((r) => r.rows[0] || null);

export const updateStatus = (r, db = pool) =>
  db.query(
    `update attendance_records
        set status = $2, source = $3, edited_by = $4, edited_at = now(),
            edit_reason = $5, override_note = coalesce($6, override_note), last_updated_by = $4
      where id = $1 returning *`,
    [r.id, r.status, r.source ?? 'teacher', r.actorId, r.reason ?? null, r.overrideNote ?? null],
  ).then((r2) => r2.rows[0]);

export const insertRecord = (r, db = pool) =>
  db.query(
    `insert into attendance_records
       (student_id, section_id, subject_id, slot_id, class_date, period_number,
        status, source, marked_by, override_note, last_updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9) returning *`,
    [r.studentId, r.sectionId, r.subjectId, r.slotId ?? null, r.classDate, r.periodNumber,
      r.status, r.source, r.actorId, r.overrideNote ?? null],
  ).then((r2) => r2.rows[0]);

/**
 * Marks approved leave days without clobbering event credits. A class that was
 * cancelled is skipped: it will never be held, so there is nothing to excuse.
 */
export const applyLeaveDays = ({ studentId, sectionId, fromDate, toDate, actorId }, db = pool) =>
  db.query(
    `insert into attendance_records
       (student_id, section_id, subject_id, slot_id, class_date, period_number,
        status, source, marked_by, override_note, last_updated_by)
     select $1, $2, sl.subject_id, sl.id, d::date, sl.period_number,
            'leave', 'leave_approval', $5,
            'Marked as approved leave', $5
       from generate_series($3::date, $4::date, interval '1 day') d
       join schedule_slots sl
         on sl.section_id = $2
        and sl.day_of_week = case when extract(isodow from d) = 7 then null else extract(isodow from d) end
      where not exists (
              select 1 from class_sessions cs
               where cs.section_id = $2 and cs.class_date = d::date
                 and cs.period_number = sl.period_number and cs.status = 'cancelled')
     on conflict (student_id, class_date, period_number) do update
        set status = 'leave', source = 'leave_approval',
            edited_by = $5, edited_at = now(),
            override_note = 'Changed to approved leave',
            last_updated_by = $5
        where attendance_records.source <> 'event_credit'
     returning id, class_date, period_number`,
    [studentId, sectionId, fromDate, toDate, actorId],
  ).then((r) => r.rows);

/** Classes on one date whose register a teacher or the HOD has already marked. */
export const markedClasses = async (sectionIds, classDate, db = pool) => {
  if (!sectionIds.length) return new Set();
  const { rows } = await db.query(
    `select distinct section_id, period_number from attendance_records
      where class_date = $1 and section_id = any($2::uuid[]) and source in ('teacher', 'hod')`,
    [classDate, sectionIds],
  );
  return new Set(rows.map((r) => `${r.section_id}:${r.period_number}`));
};

/**
 * When a class is cancelled, the rows the system wrote ahead of it (approved
 * leave, event credits) no longer describe anything that will happen.
 */
export const removeSystemRows = async (classes, classDate, db = pool) => {
  if (!classes.length) return [];
  const { rows } = await db.query(
    `delete from attendance_records r
      using jsonb_to_recordset($1::jsonb) as c(section_id uuid, period_number smallint)
      where r.section_id = c.section_id and r.period_number = c.period_number
        and r.class_date = $2 and r.source in ('leave_approval', 'event_credit')
     returning r.id, r.student_id, r.source`,
    [JSON.stringify(classes.map((c) => ({ section_id: c.section_id, period_number: c.period_number }))), classDate],
  );
  return rows;
};

/**
 * Restoring cancelled classes writes approved leave back into just those
 * classes, and nowhere else: a mark made since is never overwritten.
 */
export const restoreLeaveFor = async (classes, classDate, actorId, db = pool) => {
  if (!classes.length) return [];
  const { rows } = await db.query(
    `insert into attendance_records
       (student_id, section_id, subject_id, slot_id, class_date, period_number,
        status, source, marked_by, override_note, last_updated_by)
     select lr.student_id, c.section_id, c.subject_id, c.slot_id, $2::date, c.period_number,
            'leave', 'leave_approval', coalesce(lr.decided_by, $3), 'Marked as approved leave', coalesce(lr.decided_by, $3)
       from jsonb_to_recordset($1::jsonb) as c(section_id uuid, subject_id uuid, slot_id uuid, period_number smallint)
       join students st on st.section_id = c.section_id
       join users u on u.id = st.user_id and u.status = 'active'
       join leave_requests lr on lr.student_id = st.user_id and lr.status = 'approved'
                             and $2::date between lr.from_date and lr.to_date
     on conflict (student_id, class_date, period_number) do nothing
     returning id`,
    [JSON.stringify(classes.map((c) => ({
      section_id: c.section_id, subject_id: c.subject_id, slot_id: c.slot_id, period_number: c.period_number,
    }))), classDate, actorId],
  );
  return rows;
};

/**
 * Undoes what a leave approval wrote, for when an approver reverses their own
 * decision. Only rows this system created from that approval are removed, so a
 * teacher's mark or an event credit made since is left alone.
 */
export const removeLeaveDays = ({ studentId, fromDate, toDate }, db = pool) =>
  db.query(
    `delete from attendance_records
      where student_id = $1 and class_date between $2 and $3
        and source = 'leave_approval'
      returning id, class_date, period_number`,
    [studentId, fromDate, toDate],
  ).then((r) => r.rows);

/** Per-subject rollup for one student — reads the summary table, not the facts. */
export const studentSummary = (studentId, db = pool) =>
  db.query(
    `select sub.id as subject_id, sub.name as subject_name,
            coalesce(s.conducted,0) as conducted, coalesce(s.present_count,0) as present_count,
            coalesce(s.absent_count,0) as absent_count, coalesce(s.leave_count,0) as leave_count,
            s.percentage
       from students st
       join subjects sub on sub.course_id = st.course_id
       left join attendance_summary s on s.student_id = st.user_id and s.subject_id = sub.id
      where st.user_id = $1
      order by sub.name`,
    [studentId],
  ).then((r) => r.rows);

/**
 * Section/course register used by Records, HOD live view and exports.
 *
 * Alongside each student's own marks it counts the held classes they have no
 * mark for, and how many classes their section held in the range: the
 * college's total, which is what the percentage is measured against.
 */
export const sectionRecords = ({ courseId, sectionId, from, to, fallbackMinimum }, db = pool) =>
  db.query(
    `with facts as (
       select r.student_id,
              count(*) filter (where r.status = 'present') as present_count,
              count(*) filter (where r.status = 'absent')  as absent_count,
              count(*) filter (where r.status = 'leave')   as leave_count
         from attendance_records r
         join students s on s.user_id = r.student_id
        where ($1::uuid is null or s.course_id = $1)
          and ($2::uuid is null or s.section_id = $2)
          and ($3::date is null or r.class_date >= $3)
          and ($4::date is null or r.class_date <= $4)
        group by r.student_id
     ),
     unmarked as (
       select st.user_id as student_id, count(*) as not_marked
         from students st
         join users u on u.id = st.user_id and u.status = 'active'
         join class_sessions cs on cs.section_id = st.section_id and cs.status = 'held'
        where ($1::uuid is null or st.course_id = $1)
          and ($2::uuid is null or st.section_id = $2)
          and ($3::date is null or cs.class_date >= $3)
          and ($4::date is null or cs.class_date <= $4)
          and cs.created_at >= u.created_at
          and not exists (select 1 from attendance_records r
                           where r.student_id = st.user_id and r.class_date = cs.class_date
                             and r.period_number = cs.period_number)
        group by st.user_id
     ),
     held as (
       select cs.section_id, count(*) as classes_held
         from class_sessions cs
        where cs.status = 'held'
          and ($1::uuid is null or cs.course_id = $1)
          and ($2::uuid is null or cs.section_id = $2)
          and ($3::date is null or cs.class_date >= $3)
          and ($4::date is null or cs.class_date <= $4)
        group by cs.section_id
     )
     select u.id as student_id, u.name, u.login_id, s.roll_number,
            c.name as course_name, sec.name as section_name, s.course_id, s.section_id,
            coalesce(f.present_count,0) as present_count,
            coalesce(f.absent_count,0)  as absent_count,
            coalesce(f.leave_count,0)   as leave_count,
            coalesce(nm.not_marked,0)   as not_marked,
            coalesce(h.classes_held,0)  as section_classes_held,
            coalesce(ac.percentage, $5) as minimum
       from students s
       join users u on u.id = s.user_id and u.status = 'active'
       join courses c on c.id = s.course_id
       join sections sec on sec.id = s.section_id
       left join attendance_criteria ac on ac.course_id = s.course_id
       left join facts f on f.student_id = s.user_id
       left join unmarked nm on nm.student_id = s.user_id
       left join held h on h.section_id = s.section_id
      where ($1::uuid is null or s.course_id = $1)
        and ($2::uuid is null or s.section_id = $2)
      order by c.name, sec.name, s.roll_number`,
    [courseId ?? null, sectionId ?? null, from ?? null, to ?? null, fallbackMinimum ?? null],
  ).then((r) => r.rows);

/**
 * Per-section figures for Analytics and the HOD overview: the average of each
 * student's overall percentage (held-but-unmarked classes included), and the
 * classes the section has held and had cancelled.
 */
export const courseAverages = (db = pool) =>
  db.query(
    `with per_student as (
       select st.user_id, st.section_id,
              coalesce(sum(s.present_count), 0) as present,
              coalesce(sum(s.absent_count), 0)  as absent,
              count(s.student_id) > 0           as has_marks
         from students st
         join users u on u.id = st.user_id and u.status = 'active'
         left join attendance_summary s on s.student_id = st.user_id
        group by st.user_id, st.section_id
     ),
     unmarked as (
       select st.user_id, count(*) as not_marked
         from students st
         join users u on u.id = st.user_id and u.status = 'active'
         join class_sessions cs on cs.section_id = st.section_id and cs.status = 'held'
        where cs.created_at >= u.created_at
          and not exists (select 1 from attendance_records r
                           where r.student_id = st.user_id and r.class_date = cs.class_date
                             and r.period_number = cs.period_number)
        group by st.user_id
     ),
     sessions as (
       select section_id,
              count(*) filter (where status = 'held')      as held,
              count(*) filter (where status = 'cancelled') as cancelled
         from class_sessions group by section_id
     )
     select c.id as course_id, c.name as course_name, sec.id as section_id, sec.name as section_name,
            round(avg(case when p.present + p.absent + coalesce(nm.not_marked, 0) = 0 then null
                      else 100.0 * p.present / (p.present + p.absent + coalesce(nm.not_marked, 0)) end), 2)
              as avg_percentage,
            count(p.user_id) as students,
            coalesce(max(ss.held), 0)      as classes_held,
            coalesce(max(ss.cancelled), 0) as classes_cancelled
       from sections sec
       join courses c on c.id = sec.course_id
       left join per_student p on p.section_id = sec.id
       left join unmarked nm on nm.user_id = p.user_id
       left join sessions ss on ss.section_id = sec.id
      group by c.id, c.name, sec.id, sec.name
     having coalesce(bool_or(p.has_marks), false) or coalesce(max(ss.held), 0) > 0
      order by c.name, sec.name`,
  ).then((r) => r.rows);

/** Every event credit a student has received, newest event first. */
export const eventCreditsFor = (studentId, db = pool) =>
  db.query(
    `select ac.id, ac.period_number, ac.was_override, ac.previous_status, ac.created_at,
            e.id as event_id, e.title as event_title, e.event_date,
            sub.name as subject_name, ar.status as current_status,
            (ar.status = 'present') as counted, u.name as credited_by_name
       from attendance_credits ac
       join events e on e.id = ac.event_id
       left join attendance_records ar on ar.id = ac.attendance_record_id
       left join subjects sub on sub.id = ar.subject_id
       left join users u on u.id = ac.credited_by
      where ac.student_id = $1
      order by e.event_date desc, ac.period_number
      limit 100`,
    [studentId],
  ).then((r) => r.rows.map((row) => ({ ...row, counted: !!row.counted })));

export const recentEdits = (limit = 20, db = pool) =>
  db.query(
    `select r.id, r.class_date, r.period_number, r.status, r.source, r.override_note,
            r.edited_at, e.name as edited_by_name, u.name as student_name, sub.name as subject_name
       from attendance_records r
       join users u on u.id = r.student_id
       join subjects sub on sub.id = r.subject_id
       left join users e on e.id = r.edited_by
      where r.edited_at is not null
      order by r.edited_at desc limit $1`,
    [limit],
  ).then((r) => r.rows);
