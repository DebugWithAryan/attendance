import { pool } from '../db/pool.js';

export const insertClub = (name, mentorId, db = pool) =>
  db.query('insert into clubs (name, mentor_id) values ($1,$2) returning *', [name, mentorId])
    .then((r) => r.rows[0]);

export const findClub = (id, db = pool) =>
  db.query('select * from clubs where id = $1', [id]).then((r) => r.rows[0] || null);

/** HOD sees every club; a mentor sees their own. Same query, one flag. */
export const listClubs = ({ mentorId }, db = pool) =>
  db.query(
    `select cl.id, cl.name, cl.created_at, cl.mentor_id, m.name as mentor_name, m.login_id as mentor_login_id,
            coalesce(json_agg(jsonb_build_object(
              'student_id', u.id, 'name', u.name, 'login_id', u.login_id, 'roll_number', s.roll_number
            ) order by s.roll_number) filter (where u.id is not null), '[]') as members
       from clubs cl
       join users m on m.id = cl.mentor_id
       left join club_members cm on cm.club_id = cl.id
       left join users u on u.id = cm.student_id and u.status = 'active'
       left join students s on s.user_id = u.id
      where ($1::uuid is null or cl.mentor_id = $1)
      group by cl.id, m.name, m.login_id
      order by cl.name`,
    [mentorId ?? null],
  ).then((r) => r.rows);

export const addMember = (clubId, studentId, addedBy, db = pool) =>
  db.query(
    `insert into club_members (club_id, student_id, added_by) values ($1,$2,$3)
     on conflict do nothing returning *`,
    [clubId, studentId, addedBy],
  ).then((r) => r.rows[0] || null);

export const removeMember = (clubId, studentId, db = pool) =>
  db.query('delete from club_members where club_id = $1 and student_id = $2 returning *', [clubId, studentId])
    .then((r) => r.rows[0] || null);

export const isMember = (clubId, studentId, db = pool) =>
  db.query('select 1 from club_members where club_id = $1 and student_id = $2', [clubId, studentId])
    .then((r) => r.rowCount > 0);
