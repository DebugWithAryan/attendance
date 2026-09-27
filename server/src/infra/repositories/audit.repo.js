import { pool } from '../db/pool.js';

/**
 * The two shared write paths the spec asks for (sections 6.1 and 8):
 * every flow calls these instead of writing its own log/notify code.
 * Both accept a transaction client so the log can never commit without the
 * change it describes.
 */
export async function logActivity(entry, db = pool) {
  const { actorId, actorRole, action, entity, targetId, reason, details } = entry;
  await db.query(
    `insert into activity_log (actor_id, actor_role, action_type, target_entity, target_id, reason, details)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [actorId ?? null, actorRole ?? null, action, entity ?? null, targetId ?? null, reason ?? null, details ?? {}],
  );
}

export async function notify(recipients, message, db = pool) {
  const ids = [...new Set((Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean))];
  if (!ids.length) return;
  await db.query(
    `insert into notifications (recipient_id, title, message, category, posted_by)
     select id, $2, $3, $4, $5 from unnest($1::uuid[]) as id`,
    [ids, message.title, message.body ?? null, message.category ?? 'general', message.postedBy ?? null],
  );
}

export function listActivity({ from, to, action, actorId, limit = 100, offset = 0 }, db = pool) {
  return db.query(
    `select a.*, u.name as actor_name, u.login_id as actor_login_id
       from activity_log a left join users u on u.id = a.actor_id
      where ($1::date is null or a.created_at >= $1::date)
        and ($2::date is null or a.created_at < ($2::date + 1))
        and ($3::text is null or a.action_type = $3)
        and ($4::uuid is null or a.actor_id = $4)
      order by a.created_at desc
      limit $5 offset $6`,
    [from ?? null, to ?? null, action ?? null, actorId ?? null, limit, offset],
  ).then((r) => r.rows);
}

export function listNotifications(userId, db = pool) {
  return db.query(
    `select n.*, u.name as posted_by_name from notifications n
       left join users u on u.id = n.posted_by
      where n.recipient_id = $1 order by n.created_at desc limit 100`,
    [userId],
  ).then((r) => r.rows);
}

export async function markNotificationsRead(userId, db = pool) {
  await db.query('update notifications set read_at = now() where recipient_id = $1 and read_at is null', [userId]);
}
