import * as clubs from '../infra/repositories/club.repo.js';
import * as users from '../infra/repositories/user.repo.js';
import { logActivity, notify } from '../infra/repositories/audit.repo.js';
import { rethrow } from '../shared/pgErrors.js';
import { badRequest, forbidden, notFound } from '../shared/errors.js';

async function ownClub(actor, clubId) {
  const club = await clubs.findClub(clubId);
  if (!club) throw notFound('That club does not exist.');
  if (actor.role !== 'hod' && club.mentor_id !== actor.id) {
    throw forbidden('You can only manage your own club.');
  }
  return club;
}

export async function create(actor, { name }) {
  const club = await clubs.insertClub(name, actor.id).catch(rethrow);
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'club.created',
    entity: 'club', targetId: club.id, details: { name },
  });
  return club;
}

/** HOD gets every club (view-only); a mentor gets their own. */
export const list = (actor) => clubs.listClubs({ mentorId: actor.role === 'hod' ? null : actor.id });

export async function addMember(actor, clubId, { loginId }) {
  const club = await ownClub(actor, clubId);
  const student = await users.findByLoginId(loginId);
  if (!student || student.role !== 'student') throw badRequest('No active student has that login ID.');

  const added = await clubs.addMember(clubId, student.id, actor.id);
  if (!added) throw badRequest(`${student.name} is already a member.`);

  await notify(student.id, {
    title: `Added to ${club.name}`,
    body: 'You can now see and join this club\u2019s events.',
    category: 'club',
    postedBy: actor.id,
  });
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'club.member_added',
    entity: 'club', targetId: clubId,
    details: { student: student.name, login_id: student.login_id },
  });
  return { studentId: student.id, name: student.name };
}

export async function removeMember(actor, clubId, studentId) {
  await ownClub(actor, clubId);
  const removed = await clubs.removeMember(clubId, studentId);
  if (!removed) throw notFound('That student is not a member.');
  await logActivity({
    actorId: actor.id, actorRole: actor.role, action: 'club.member_removed',
    entity: 'club', targetId: clubId, details: { student_id: studentId },
  });
  return removed;
}
