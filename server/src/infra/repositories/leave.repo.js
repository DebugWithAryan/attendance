import { pool } from '../db/pool.js';

export const insertRequest = (r, db = pool) =>
  db.query(
    `insert into leave_requests (student_id, from_date, to_date, reason, document_ref, document_mime)
     values ($1,$2,$3,$4,$5,$6)
     returning id, student_id, from_date, to_date, reason, status, created_at,
               (document_ref is not null) as has_document`,
    [r.studentId, r.fromDate, r.toDate, r.reason, r.documentRef ?? null, r.documentMime ?? null],
  ).then((x) => x.rows[0]);

export const findById = (id, db = pool) =>
  db.query(
    `select lr.*, s.section_id, s.course_id, s.roll_number, u.name as student_name
       from leave_requests lr
       join students s on s.user_id = lr.student_id
       join users u on u.id = lr.student_id
      where lr.id = $1`,
    [id],
  ).then((x) => x.rows[0] || null);

export const decide = (d, db = pool) =>
  db.query(
    `update leave_requests
        set status = $2, decided_by = $3, decider_role = $4, decided_at = now(), decision_note = $5
      where id = $1 and status = 'pending'
      returning *`,
    [d.id, d.status, d.actorId, d.actorRole, d.note ?? null],
  ).then((x) => x.rows[0] || null);

/** Queue for Teacher/HOD. A class teacher sees their own section by default. */
export const listForReview = ({ status, sectionId, limit = 100 }, db = pool) =>
  db.query(
    `select lr.id, lr.student_id, lr.from_date, lr.to_date, lr.reason, lr.status,
            lr.decided_by, lr.decider_role, lr.decided_at, lr.decision_note, lr.created_at,
            (lr.document_ref is not null) as has_document,
            u.name as student_name, s.roll_number, sec.name as section_name, c.name as course_name
       from leave_requests lr
       join users u on u.id = lr.student_id
       join students s on s.user_id = lr.student_id
       join sections sec on sec.id = s.section_id
       join courses c on c.id = s.course_id
      where ($1::text is null or lr.status = $1)
        and ($2::uuid is null or s.section_id = $2)
      order by case lr.status when 'pending' then 0 else 1 end, lr.created_at desc
      limit $3`,
    [status ?? null, sectionId ?? null, limit],
  ).then((x) => x.rows);

export const listMine = (studentId, db = pool) =>
  db.query(
    `select id, from_date, to_date, reason, status, decision_note, decided_at, created_at,
            (document_ref is not null) as has_document
       from leave_requests where student_id = $1 order by created_at desc`,
    [studentId],
  ).then((x) => x.rows);

/** History tab: every decision this approver has made. */
export const listDecisionsBy = (actorId, db = pool) =>
  db.query(
    `select lr.id, lr.student_id, lr.from_date, lr.to_date, lr.reason, lr.status,
            lr.decided_by, lr.decided_at, lr.decision_note, lr.created_at,
            (lr.document_ref is not null) as has_document,
            u.name as student_name, s.roll_number
       from leave_requests lr
       join users u on u.id = lr.student_id
       join students s on s.user_id = lr.student_id
      where lr.decided_by = $1
      order by lr.decided_at desc limit 200`,
    [actorId],
  ).then((x) => x.rows);

/**
 * Changes a decision that was already made. Separate from decide() on purpose:
 * that one only moves a request out of 'pending', this one knowingly reverses
 * an approver's earlier call and always carries a reason.
 */
export const reviseDecision = (d, db = pool) =>
  db.query(
    `update leave_requests
        set status = $2, decided_by = $3, decider_role = $4, decided_at = now(),
            decision_note = $5
      where id = $1 and status <> 'pending'
      returning id, student_id, from_date, to_date, status, decision_note`,
    [d.id, d.status, d.actorId, d.actorRole, d.note],
  ).then((x) => x.rows[0] || null);
