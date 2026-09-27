/**
 * The sidebar table from the spec, as data. Each entry lists the roles that
 * see it; the server enforces the same thing again on every call.
 *
 * `admin` appears nearly everywhere because an administrator oversees the
 * whole college. It is absent from Attendance, which is a teacher marking
 * their own class — an admin has no class to mark.
 */
export const NAV = [
  { to: '/', label: 'Overview', roles: ['admin', 'hod', 'teacher', 'student', 'mentor'] },
  { to: '/accounts', label: 'Accounts', roles: ['admin'] },
  { to: '/attendance', label: 'Attendance', roles: ['teacher'] },
  { to: '/records', label: 'Records', roles: ['admin', 'hod', 'teacher'] },
  { to: '/analytics', label: 'Analytics', roles: ['admin', 'hod', 'teacher', 'student'] },
  { to: '/schedule', label: 'Schedule', roles: ['admin', 'hod', 'teacher', 'student'] },
  { to: '/leave', label: 'Leave desk', roles: ['admin', 'hod', 'teacher', 'student'] },
  { to: '/events', label: 'Events', roles: ['admin', 'hod', 'teacher', 'student', 'mentor'] },
  { to: '/clubs', label: 'Clubs', roles: ['admin', 'hod', 'mentor'] },
  { to: '/notifications', label: 'Notifications', roles: ['admin', 'hod', 'teacher', 'student', 'mentor'] },
  { to: '/setup', label: 'Setup', roles: ['admin', 'hod', 'teacher'] },
  { to: '/activities', label: 'Activities', roles: ['admin', 'hod'] },
  { to: '/guide', label: 'Guide', roles: ['admin', 'hod', 'teacher', 'student', 'mentor'] },
  { to: '/profile', label: 'Profile', roles: ['admin', 'hod', 'teacher', 'student', 'mentor'] },
];

export const navFor = (role) => NAV.filter((item) => item.roles.includes(role));
