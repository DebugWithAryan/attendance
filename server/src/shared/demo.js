/**
 * The accounts `npm run seed:demo` creates for a public demonstration, such as
 * a tech fest stall. The password is printed on the sign-in page while
 * DEMO_MODE is on, so the server treats these accounts as shared property:
 * none of them can have its password changed or reset, or be removed.
 *
 * This list is also what the one-tap "Try it as…" buttons offer, in order.
 */
export const DEMO_PASSWORD = 'demo1234';

export const DEMO_ACCOUNTS = [
  { loginId: 'demo.hod', role: 'hod', label: 'HOD', blurb: 'Builds the timetable, cancels classes, decides leave.' },
  { loginId: 'demo.teacher', role: 'teacher', label: 'Teacher', blurb: 'Marks today’s register in a few taps.' },
  { loginId: 'demo.student', role: 'student', label: 'Student', blurb: 'Above 90%, so the attendance badge is on show.' },
  { loginId: 'demo.atrisk', role: 'student', label: 'Student at risk', blurb: 'Below the minimum; sees how many classes it takes to recover.' },
  { loginId: 'demo.mentor', role: 'mentor', label: 'Mentor', blurb: 'Runs a club and adds event attendance.' },
  { loginId: 'demo.admin', role: 'admin', label: 'Administrator', blurb: 'Creates accounts and oversees the college.' },
];
