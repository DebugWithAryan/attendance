import { pool } from '../db/pool.js';

/** Used only by the first-run check: is this deployment still empty? */
export const countUsers = (db = pool) =>
  db.query('select count(*)::int as n from users').then((r) => r.rows[0].n);

export const findByLoginId = (loginId, db = pool) =>
  db.query(`select * from users where lower(login_id) = lower($1) and status = 'active'`, [loginId])
    .then((r) => r.rows[0] || null);

export const findById = (id, db = pool) =>
  db.query('select * from users where id = $1', [id]).then((r) => r.rows[0] || null);

export const insertUser = (u, db = pool) =>
  db.query(
    `insert into users (name, login_id, password_hash, role, can_add_users, created_by)
     values ($1,$2,$3,$4,$5,$6) returning id, name, login_id, role, can_add_users, created_at`,
    [u.name, u.loginId, u.passwordHash, u.role, u.canAddUsers ?? false, u.createdBy],
  ).then((r) => r.rows[0]);

export const insertStudentProfile = (s, db = pool) =>
  db.query(
    `insert into students (user_id, course_id, section_id, roll_number) values ($1,$2,$3,$4) returning *`,
    [s.userId, s.courseId, s.sectionId, s.rollNumber],
  ).then((r) => r.rows[0]);

export const deactivate = (id, db = pool) =>
  db.query(`update users set status = 'removed' where id = $1 returning id, name, role`, [id])
    .then((r) => r.rows[0] || null);

export const updatePassword = (id, passwordHash, db = pool) =>
  db.query('update users set password_hash = $2 where id = $1', [id, passwordHash]);

export const listByRole = (role, db = pool) =>
  db.query(
    `select u.id, u.name, u.login_id, u.role, u.can_add_users, u.created_at,
            s.roll_number, c.name as course_name, sec.name as section_name,
            s.course_id, s.section_id
       from users u
       left join students s on s.user_id = u.id
       left join courses c  on c.id = s.course_id
       left join sections sec on sec.id = s.section_id
      where u.role = $1 and u.status = 'active'
      order by c.name nulls first, sec.name nulls first, s.roll_number nulls first, u.name`,
    [role],
  ).then((r) => r.rows);

export const studentProfile = (userId, db = pool) =>
  db.query(
    `select u.id, u.name, u.login_id, s.roll_number, s.course_id, s.section_id,
            c.name as course_name, sec.name as section_name,
            ct.teacher_id as class_teacher_id, t.name as class_teacher_name
       from users u
       join students s on s.user_id = u.id
       join courses c on c.id = s.course_id
       join sections sec on sec.id = s.section_id
       left join class_teacher_allocations ct on ct.section_id = s.section_id
       left join users t on t.id = ct.teacher_id
      where u.id = $1`,
    [userId],
  ).then((r) => r.rows[0] || null);

export const teacherProfile = (userId, db = pool) =>
  db.query(
    `select u.id, u.name, u.login_id,
            coalesce(json_agg(distinct jsonb_build_object(
              'course', c.name, 'section', sec.name, 'subject', subj.name
            )) filter (where sl.id is not null), '[]') as assignments,
            coalesce(json_agg(distinct cta.section_id) filter (where cta.section_id is not null), '[]') as class_teacher_of
       from users u
       left join schedule_slots sl on sl.teacher_id = u.id
       left join courses c    on c.id = sl.course_id
       left join sections sec on sec.id = sl.section_id
       left join subjects subj on subj.id = sl.subject_id
       left join class_teacher_allocations cta on cta.teacher_id = u.id
      where u.id = $1
      group by u.id`,
    [userId],
  ).then((r) => r.rows[0] || null);

/** Active students of one section: who hears about a change to its classes. */
export const studentIdsInSection = (sectionId, db = pool) =>
  db.query(
    `select s.user_id from students s join users u on u.id = s.user_id and u.status = 'active'
      where s.section_id = $1`,
    [sectionId],
  ).then((r) => r.rows.map((x) => x.user_id));

export const idsByRole = (role, db = pool) =>
  db.query(`select id from users where role = $1 and status = 'active'`, [role])
    .then((r) => r.rows.map((x) => x.id));

/**
 * Returns the row after counting this failure, rolling the window over and
 * setting the lock in one statement so two concurrent instances cannot each
 * decide the counter is still at zero.
 */
export const recordLoginFailure = (loginId, maxFailures, lockMinutes, db = pool) =>
  db.query(
    `insert into login_attempts (login_id, failures, window_started)
     values (lower($1), 1, now())
     on conflict (login_id) do update set
       failures = case when login_attempts.window_started < now() - ($3 || ' minutes')::interval
                       then 1 else login_attempts.failures + 1 end,
       window_started = case when login_attempts.window_started < now() - ($3 || ' minutes')::interval
                            then now() else login_attempts.window_started end,
       locked_until = case when (case when login_attempts.window_started < now() - ($3 || ' minutes')::interval
                                      then 1 else login_attempts.failures + 1 end) >= $2
                           then now() + ($3 || ' minutes')::interval else null end
     returning failures, locked_until`,
    [loginId, maxFailures, String(lockMinutes)],
  ).then((r) => r.rows[0]);

export const loginLockedUntil = (loginId, db = pool) =>
  db.query('select locked_until from login_attempts where login_id = lower($1)', [loginId])
    .then((r) => {
      const until = r.rows[0]?.locked_until;
      return until && new Date(until) > new Date() ? new Date(until) : null;
    });

export const clearLoginFailures = (loginId, db = pool) =>
  db.query('delete from login_attempts where login_id = lower($1)', [loginId]);

/** The featured demo accounts that exist and are active, for the sign-in page. */
export const demoAccounts = (loginIds, db = pool) =>
  db.query(
    `select id, name, login_id, role from users
      where is_demo and status = 'active' and login_id = any($1::text[])`,
    [loginIds],
  ).then((r) => r.rows);
