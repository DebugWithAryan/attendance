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
    `select * from schedule_slots where section_id = $1 and day_of_week = $2 and period_number = $3`,
    [sectionId, dayOfWeek, periodNumber],
  ).then((r) => r.rows[0] || null);

export const teacherDay = (teacherId, dayOfWeek, db = pool) =>
  db.query(
    `select sl.*, subj.name as subject_name, sec.name as section_name, c.name as course_name
       from schedule_slots sl
       join subjects subj on subj.id = sl.subject_id
       join sections sec on sec.id = sl.section_id
       join courses c on c.id = sl.course_id
      where sl.teacher_id = $1 and sl.day_of_week = $2
      order by sl.period_number`,
    [teacherId, dayOfWeek],
  ).then((r) => r.rows);
