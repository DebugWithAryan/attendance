import { pool } from '../db/pool.js';

export const listCourses = (db = pool) =>
  db.query(`select c.*, ac.percentage as min_attendance,
                   (select count(*) from sections s where s.course_id = c.id) as section_count
              from courses c left join attendance_criteria ac on ac.course_id = c.id
             order by c.name`).then((r) => r.rows);

export const findCourse = (id, db = pool) =>
  db.query('select * from courses where id = $1', [id]).then((r) => r.rows[0] || null);

export const findSection = (id, db = pool) =>
  db.query('select * from sections where id = $1', [id]).then((r) => r.rows[0] || null);

export const findSubject = (id, db = pool) =>
  db.query('select * from subjects where id = $1', [id]).then((r) => r.rows[0] || null);

/** The shape of the course's week: days, periods, and the printed timings. */
export const setWeek = (courseId, { periodsPerDay, daysPerWeek, timings }, db = pool) =>
  db.query(
    `update courses set periods_per_day = $2, days_per_week = $3, timings = $4
      where id = $1 returning *`,
    [courseId, periodsPerDay, daysPerWeek, timings === null ? null : JSON.stringify(timings)],
  ).then((r) => r.rows[0] || null);

export const insertCourse = (name, createdBy, db = pool) =>
  db.query('insert into courses (name, created_by) values ($1,$2) returning *', [name, createdBy])
    .then((r) => r.rows[0]);

export const listSections = (courseId, db = pool) =>
  db.query(
    `select s.*, cta.teacher_id as class_teacher_id, t.name as class_teacher_name,
            (select count(*) from students st where st.section_id = s.id) as student_count
       from sections s
       left join class_teacher_allocations cta on cta.section_id = s.id
       left join users t on t.id = cta.teacher_id
      where ($1::uuid is null or s.course_id = $1)
      order by s.name`,
    [courseId ?? null],
  ).then((r) => r.rows);

export const insertSection = (courseId, name, db = pool) =>
  db.query('insert into sections (course_id, name) values ($1,$2) returning *', [courseId, name])
    .then((r) => r.rows[0]);

export const listSubjects = (courseId, db = pool) =>
  db.query(
    `select * from subjects where ($1::uuid is null or course_id = $1) order by name`,
    [courseId ?? null],
  ).then((r) => r.rows);

export const insertSubject = (s, db = pool) =>
  db.query('insert into subjects (course_id, name, code) values ($1,$2,$3) returning *',
    [s.courseId, s.name, s.code ?? null]).then((r) => r.rows[0]);

export const allocateClassTeacher = (a, db = pool) =>
  db.query(
    `insert into class_teacher_allocations (section_id, course_id, teacher_id, assigned_by)
     values ($1,$2,$3,$4)
     on conflict (section_id) do update set teacher_id = excluded.teacher_id,
       assigned_by = excluded.assigned_by, assigned_at = now()
     returning *`,
    [a.sectionId, a.courseId, a.teacherId, a.assignedBy],
  ).then((r) => r.rows[0]);

export const setCriteria = (courseId, percentage, setBy, db = pool) =>
  db.query(
    `insert into attendance_criteria (course_id, percentage, set_by) values ($1,$2,$3)
     on conflict (course_id) do update set percentage = excluded.percentage,
       set_by = excluded.set_by, updated_at = now() returning *`,
    [courseId, percentage, setBy],
  ).then((r) => r.rows[0]);

export const criteriaFor = (courseId, db = pool) =>
  db.query('select percentage from attendance_criteria where course_id = $1', [courseId])
    .then((r) => (r.rows[0] ? Number(r.rows[0].percentage) : null));

export const classTeacherOf = (sectionId, db = pool) =>
  db.query('select teacher_id from class_teacher_allocations where section_id = $1', [sectionId])
    .then((r) => r.rows[0]?.teacher_id ?? null);

/**
 * One row telling the HOD's overview how far the department has been set up.
 * A fresh deployment is not usable until a timetable exists, and the order of
 * these steps is forced by the schema, so the overview walks them in order.
 */
export const setupCounts = (db = pool) =>
  db.query(
    `select
       (select count(*) from courses)                                   as courses,
       (select count(*) from sections)                                  as sections,
       (select count(*) from subjects)                                  as subjects,
       (select count(*) from users where role = 'teacher' and status = 'active') as teachers,
       (select count(*) from users where role = 'student' and status = 'active') as students,
       (select count(*) from schedule_slots)                            as slots,
       (select count(*) from class_teacher_allocations)                 as allocations,
       (select count(*) from attendance_criteria)                       as criteria,
       (select count(*) from sections s
          where not exists (select 1 from class_teacher_allocations a where a.section_id = s.id))
                                                                        as sections_without_teacher,
       (select count(*) from sections s
          where not exists (select 1 from schedule_slots sl where sl.section_id = s.id))
                                                                        as sections_without_timetable`,
  ).then((r) => r.rows[0]);
