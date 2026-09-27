/**
 * The tech fest demo: a database made by `npm run seed:demo`, served with
 * DEMO_MODE=1. Checks the one-tap sign-in, the protections that keep a
 * crowd from locking each other out, and that the college tells the stories
 * the pitch relies on.
 *
 *   API_BASE=http://127.0.0.1:4002/api node server/test/demo.mjs
 */
const BASE = process.env.API_BASE || 'http://localhost:4002/api';
let pass = 0; let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log('  PASS', label); }
  else { fail += 1; console.log('  FAIL', label, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); }
};
async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const demoLogin = async (loginId) => (await call('POST', '/demo/login', { body: { loginId } })).data;

console.log('\n1. one-tap sign-in');
const panel = (await call('GET', '/demo')).data;
ok(panel.enabled === true && panel.password === 'demo1234', 'the sign-in page is told demo accounts exist, and their password');
ok(panel.accounts.map((a) => a.loginId).join() === 'demo.hod,demo.teacher,demo.student,demo.atrisk,demo.mentor,demo.admin',
  'six featured accounts, in the order the buttons show them', panel.accounts.map((a) => a.loginId));
const session = {};
for (const a of panel.accounts) {
  const res = await demoLogin(a.loginId);
  const me = (await call('GET', '/auth/me', { token: res.token })).data;
  session[a.loginId] = { token: res.token, id: me.id };
  ok(me.role === a.role && me.isDemo === true, `one tap signs in as ${a.label} (${me.name}), marked as a demo account`);
}
ok((await call('POST', '/demo/login', { body: { loginId: 'demo.s03' } })).status === 404, 'only the featured accounts are one tap away');
ok((await call('POST', '/auth/login', { body: { loginId: 'demo.hod', password: 'demo1234' } })).status === 200,
  'typing the printed password works too');

console.log('\n2. a crowd cannot lock itself out');
const { token: hod } = session['demo.hod'];
const { token: admin } = session['demo.admin'];
ok((await call('POST', '/auth/password', { token: hod, body: { currentPassword: 'demo1234', newPassword: 'hijacked-it' } })).status === 403,
  'a demo account cannot change its own password');
ok((await call('POST', `/users/${session['demo.student'].id}/password`, { token: hod, body: { password: 'hijacked-it' } })).status === 403,
  'nor can the demo HOD reset a demo student’s');
ok((await call('DELETE', `/users/${session['demo.student'].id}`, { token: hod })).status === 403, 'or remove one');
ok((await call('DELETE', `/users/${session['demo.hod'].id}`, { token: admin })).status === 403, 'nor can the demo administrator remove the demo HOD');
const course = (await call('GET', '/courses', { token: hod })).data[0];
const section = (await call('GET', `/sections?courseId=${course.id}`, { token: hod })).data[0];
const visitor = await call('POST', '/users', {
  token: hod,
  body: { name: 'Fest Visitor', loginId: `visitor.${Date.now().toString(36)}`, password: 'password123', role: 'student', courseId: course.id, sectionId: section.id, rollNumber: `V${Date.now() % 100000}` },
});
ok(visitor.status === 201, 'a visitor playing HOD can still add a student');
ok((await call('DELETE', `/users/${visitor.data.id}`, { token: hod })).status === 200, 'and remove the one they added');

console.log('\n3. the real D2 BBA routine');
const grid = (await call('GET', `/schedule/course/${course.id}`, { token: hod })).data;
const cell = (d, p) => grid.slots.find((s) => s.day_of_week === d && s.period_number === p);
ok(course.name === 'BBA' && section.name === 'D2', 'the demo college is BBA, section D2');
ok(grid.days.join() === 'Monday,Tuesday,Wednesday,Thursday,Friday' && grid.periodsPerDay === 4, 'Monday to Friday, four periods');
ok(grid.slots.length === 20, 'all twenty classes of the routine are on the timetable', grid.slots.length);
ok(cell(1, 1).subject_name === 'Business Ethics' && cell(1, 1).teacher_name === 'SS'
  && cell(2, 2).subject_name === 'IT in Business' && cell(2, 2).teacher_name === 'SBK'
  && cell(4, 3).subject_name === 'Financial Institution and Market' && cell(4, 3).teacher_name === 'SM'
  && cell(5, 4).subject_name === 'Financial Institution and Market' && cell(5, 4).teacher_name === 'SM',
  'periods sit where the printed routine puts them');
ok(cell(3, 1).subject_name === 'Review Business Communication' && cell(3, 1).teacher_name === 'To be assigned',
  'the review class with no teacher on the routine waits for one');
ok(grid.timings.periods.join('|') === '10:15–11:15|11:20–12:20|12:25–1:25|2:15–3:15' && grid.timings.breakTime === '1:25–2:15',
  'with the routine’s times and break', grid.timings);

console.log('\n4. the stories the pitch tells');
const star = (await call('GET', `/attendance/student/${session['demo.student'].id}`, { token: hod })).data;
ok(star.badge.earned && star.overall.percentage >= 90, `the featured student has the badge (${star.overall.percentage}%)`);
ok(star.eventCredits.filter((c) => c.counted).length === 2, 'and two classes credited by the B-Plan contest', star.eventCredits);
const risk = (await call('GET', `/attendance/student/${session['demo.atrisk'].id}`, { token: hod })).data;
ok(risk.overall.belowMinimum && risk.overall.needed > 0, `the student at risk is below the minimum and told what it takes (${risk.overall.percentage}%, ${risk.overall.needed} classes)`);
ok(star.classesHeld.section > 50 && star.classesHeld.cancelled >= 4, 'weeks of classes held, and a rain day cancelled', star.classesHeld);
const queue = (await call('GET', '/leave/queue?status=pending', { token: session['demo.teacher'].token })).data;
ok(queue.some((r) => r.student_name === 'Rohit Nair'), 'the class teacher has a leave request to decide');
const events = (await call('GET', '/events', { token: session['demo.mentor'].token })).data;
ok(events.some((e) => e.title === 'Case Study Challenge' && Number(e.pending_count) === 2), 'the mentor has join requests to approve');
const ahead = (await call('GET', '/classes/cancellations', { token: session['demo.student'].token })).data;
ok(ahead.some((c) => /Tech Fest/.test(c.reason)), 'students can see the fest has cancelled a class ahead');
const records = (await call('GET', `/records?courseId=${course.id}`, { token: hod })).data;
ok(records.length >= 30 && records.some((r) => r.not_marked > 0) && records.some((r) => r.badge) && records.some((r) => r.belowMinimum),
  'the register has badge holders, students below the minimum, and a mark or two missing');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
