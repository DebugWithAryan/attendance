/**
 * Single source of truth for "who may do what".
 * Routes reference capabilities, never role strings, so a permission change is
 * a one-line edit here instead of a hunt through handlers.
 *
 * `admin` is the account administrator and sits above `hod`: it can see and
 * manage everything, including attendance records and leave documents. What it
 * deliberately does not get are the four capabilities that only make sense for
 * someone with a place in the timetable — marking your own class, applying for
 * your own leave, joining an event as a student, running a club as its mentor.
 * Those are not restrictions on what an admin may see; an admin simply has no
 * class, no leave and no club of their own.
 */
export const CAPABILITIES = {
  // structure
  'users.manage':        ['admin', 'hod', 'teacher:granted'],
  'courses.manage':      ['admin', 'hod'],
  'schedule.manage':     ['admin', 'hod'],
  'schedule.viewAll':    ['admin', 'hod', 'teacher'],
  // Calling classes off in advance. A teacher may cancel only their own
  // periods; the HOD and administrator may cancel any, college-wide in one go.
  'classes.cancel':      ['admin', 'hod', 'teacher'],
  'allocation.manage':   ['admin', 'hod'],
  'criteria.manage':     ['admin', 'hod'],
  // attendance
  'attendance.mark':     ['teacher'],
  'attendance.editAny':  ['admin', 'hod'],
  'records.view':        ['admin', 'hod', 'teacher'],
  'records.export':      ['admin', 'hod', 'teacher'],
  'analytics.view':      ['admin', 'hod', 'teacher', 'student'],
  // leave
  'leave.apply':         ['student'],
  'leave.decide':        ['admin', 'hod', 'teacher'],
  // events, clubs
  'events.post':         ['admin', 'hod', 'teacher', 'mentor'],
  'events.join':         ['student'],
  'clubs.manage':        ['mentor'],
  'clubs.viewAll':       ['admin', 'hod'],
  // cross-cutting
  'notifications.post':  ['admin', 'hod', 'teacher', 'mentor'],
  'activity.view':       ['admin', 'hod'],
  // account administration, the admin's own job
  'accounts.administer': ['admin'],
};

export function can(user, capability) {
  const allowed = CAPABILITIES[capability];
  if (!allowed) return false;
  return allowed.some((entry) => {
    if (entry === 'teacher:granted') return user.role === 'teacher' && user.canAddUsers;
    return entry === user.role;
  });
}
