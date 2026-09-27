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
 */
export const saveMarks = (batch, db = pool) =>
  db.query(
    `insert into attendance_records
       (student_id, section_id, subject_id, slot_id, class_date, period_number,
        status, source, marked_by, marked_at, last_updated_by)
     select m.student_id, $2, $3, $4, $5, $6, m.status, 'teacher', $7, now(), $7
       from jsonb_to_recordset($1::jsonb) as m(student_id uuid, status text)
     on conflict (student_id, class_date, period_number) do update
        set status = excluded.status,
            subject_id = excluded.subject_id,
            slot_id = excluded.slot_id,
            edited_by = case when attendance_records.status <> excluded.status then $7 else attendance_records.edited_by end,
            edited_at = case when attendance_records.status <> excluded.status then now() else attendance_records.edited_at end,
            source = 'teacher',
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

/** Marks approved leave days without clobbering periods that already exist. */
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
     on conflict (student_id, class_date, period_number) do update
        set status = 'leave', source = 'leave_approval',
            edited_by = $5, edited_at = now(),
            override_note = 'Changed to approved leave',
            last_updated_by = $5
        where attendance_records.source <> 'event_credit'
     returning id, class_date, period_number`,
    [studentId, sectionId, fromDate, toDate, actorId],
  ).then((r) => r.rows);

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

/** Section/course register used by Records, HOD live view and exports. */
export const sectionRecords = ({ courseId, sectionId, from, to, fallbackMinimum }, db = pool) =>
  db.query(
    `with facts as (
       select r.student_id,
              count(*) filter (where r.status in ('present','absent','leave')) as conducted,
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
     )
     select u.id as student_id, u.name, u.login_id, s.roll_number,
            c.name as course_name, sec.name as section_name, s.course_id, s.section_id,
            coalesce(f.conducted,0) as conducted,
            coalesce(f.present_count,0) as present_count,
            coalesce(f.absent_count,0)  as absent_count,
            coalesce(f.leave_count,0)   as leave_count,
            case when coalesce(f.present_count,0) + coalesce(f.absent_count,0) = 0 then null
                 else round(100.0 * f.present_count / (f.present_count + f.absent_count), 2) end as percentage,
            coalesce(ac.percentage, $5) as minimum
       from students s
       join users u on u.id = s.user_id and u.status = 'active'
       join courses c on c.id = s.course_id
       join sections sec on sec.id = s.section_id
       left join attendance_criteria ac on ac.course_id = s.course_id
       left join facts f on f.student_id = s.user_id
      where ($1::uuid is null or s.course_id = $1)
        and ($2::uuid is null or s.section_id = $2)
      order by c.name, sec.name, s.roll_number`,
    [courseId ?? null, sectionId ?? null, from ?? null, to ?? null, fallbackMinimum ?? null],
  ).then((r) => r.rows);

/** Course-level averages for Analytics. */
export const courseAverages = (db = pool) =>
  db.query(
    `select c.id as course_id, c.name as course_name, sec.name as section_name,
            round(avg(case when s.present_count + s.absent_count = 0 then null
                      else 100.0 * s.present_count / (s.present_count + s.absent_count) end), 2) as avg_percentage,
            count(distinct s.student_id) as students
       from attendance_summary s
       join students st on st.user_id = s.student_id
       join courses c on c.id = st.course_id
       join sections sec on sec.id = st.section_id
      group by c.id, c.name, sec.name
      order by c.name, sec.name`,
  ).then((r) => r.rows);

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
