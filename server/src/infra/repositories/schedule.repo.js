import { pool } from '../db/pool.js';

export const gridForSection = (sectionId, db = pool) =>
  db.query(
    `select sl.id, sl.day_of_week, sl.period_number, sl.subject_id, sl.teacher_id,
            subj.name as subject_name, t.name as teacher_name, sl.section_id, sec.name as section_name
       from schedule_slots sl
       join subjects subj on subj.id = sl.subject_id
       join users t on t.id = sl.teacher_id
       join sections sec on sec.id = sl.section_id
      where sl.section_id = $1
      order by sl.day_of_week, sl.period_number`,
    [sectionId],
  ).then((r) => r.rows);

export const gridForCourse = (courseId, db = pool) =>
  db.query(
    `select sl.id, sl.section_id, sec.name as section_name, sl.day_of_week, sl.period_number,
            sl.subject_id, subj.name as subject_name, sl.teacher_id, t.name as teacher_name
       from schedule_slots sl
       join sections sec on sec.id = sl.section_id
       join subjects subj on subj.id = sl.subject_id
       join users t on t.id = sl.teacher_id
      where sl.course_id = $1
      order by sec.name, sl.day_of_week, sl.period_number`,
    [courseId],
  ).then((r) => r.rows);

export const upsertSlot = (s, db = pool) =>
  db.query(
    `insert into schedule_slots (course_id, section_id, day_of_week, period_number, subject_id, teacher_id)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (section_id, day_of_week, period_number)
       do update set subject_id = excluded.subject_id, teacher_id = excluded.teacher_id
     returning *`,
    [s.courseId, s.sectionId, s.dayOfWeek, s.periodNumber, s.subjectId, s.teacherId],
  ).then((r) => r.rows[0]);

export const deleteSlot = (id, db = pool) =>
  db.query('delete from schedule_slots where id = $1 returning *', [id]).then((r) => r.rows[0] || null);

export const findSlot = (sectionId, dayOfWeek, periodNumber, db = pool) =>
  db.query(
    `select sl.*, subj.name as subject_name from schedule_slots sl
       join subjects subj on subj.id = sl.subject_id
      where sl.section_id = $1 and sl.day_of_week = $2 and sl.period_number = $3`,
    [sectionId, dayOfWeek, periodNumber],
  ).then((r) => r.rows[0] || null);

export const teacherDay = (teacherId, dayOfWeek, db = pool) =>
  db.query(
    `select sl.*, subj.name as subject_name, sec.name as section_name, c.name as course_name, c.timings
       from schedule_slots sl
       join subjects subj on subj.id = sl.subject_id
       join sections sec on sec.id = sl.section_id
       join courses c on c.id = sl.course_id
      where sl.teacher_id = $1 and sl.day_of_week = $2
      order by sl.period_number`,
    [teacherId, dayOfWeek],
  ).then((r) => r.rows);

/** The latest weekday any section of this course has a class on, and where. */
export const highestDay = (courseId, db = pool) =>
  db.query(
    `select sl.period_number, sl.day_of_week, sec.name as section_name
       from schedule_slots sl join sections sec on sec.id = sl.section_id
      where sl.course_id = $1
      order by sl.day_of_week desc, sec.name, sl.period_number
      limit 1`,
    [courseId],
  ).then((r) => r.rows[0] || null);

/** The highest period any section of this course uses, and where. */
export const highestPeriod = (courseId, db = pool) =>
  db.query(
    `select sl.period_number, sl.day_of_week, sec.name as section_name
       from schedule_slots sl join sections sec on sec.id = sl.section_id
      where sl.course_id = $1
      order by sl.period_number desc, sec.name, sl.day_of_week
      limit 1`,
    [courseId],
  ).then((r) => r.rows[0] || null);

/**
 * The timetabled classes on one weekday, narrowed by any of course, section,
 * teacher and periods. This is what a cancellation targets.
 */
export const slotsForDay = ({ dayOfWeek, courseId, sectionId, teacherId, periods }, db = pool) =>
  db.query(
    `select sl.id as slot_id, sl.course_id, sl.section_id, sl.subject_id, sl.teacher_id, sl.period_number,
            sec.name as section_name, subj.name as subject_name, t.name as teacher_name, c.name as course_name
       from schedule_slots sl
       join sections sec on sec.id = sl.section_id
       join subjects subj on subj.id = sl.subject_id
       join users t on t.id = sl.teacher_id
       join courses c on c.id = sl.course_id
      where sl.day_of_week = $1
        and ($2::uuid is null or sl.course_id = $2)
        and ($3::uuid is null or sl.section_id = $3)
        and ($4::uuid is null or sl.teacher_id = $4)
        and ($5::smallint[] is null or sl.period_number = any($5::smallint[]))
      order by c.name, sec.name, sl.period_number`,
    [dayOfWeek, courseId ?? null, sectionId ?? null, teacherId ?? null, periods?.length ? periods : null],
  ).then((r) => r.rows);

/** One section's timetable for one weekday. */
export const sectionDay = (sectionId, dayOfWeek, db = pool) =>
  db.query(
    `select sl.*, subj.name as subject_name from schedule_slots sl
       join subjects subj on subj.id = sl.subject_id
      where sl.section_id = $1 and sl.day_of_week = $2 order by sl.period_number`,
    [sectionId, dayOfWeek],
  ).then((r) => r.rows);
