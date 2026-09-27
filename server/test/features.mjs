/**
 * The timetable builder, class cancellation, classes held, the attendance
 * badge, event attendance and the routine importer, through real HTTP against
 * a real database. Section 8 also writes to the database directly.
 *
 * Runs after the other suites, on the seeded department they leave behind; it
 * adds its own course and uses dates in 2027, so it disturbs nothing they
 * assert on.
 *
 *   API_BASE=http://127.0.0.1:4001/api DATABASE_URL=... node server/test/features.mjs
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.API_BASE || 'http://localhost:4000/api';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
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
const login = async (loginId, password = 'password123') => {
  const res = await call('POST', '/auth/login', { body: { loginId, password } });
  if (res.status !== 200) throw new Error(`cannot sign in as ${loginId}: ${JSON.stringify(res.data)}`);
  return { token: res.data.token, id: res.data.user.id };
};

// Dates far from anything the other suites mark. 2027-03-01 is a Monday.
const MON = '2027-03-01'; const TUE = '2027-03-02'; const WED = '2027-03-03';
const THU = '2027-03-04'; const FRI = '2027-03-05'; const SUN = '2027-02-28';

const hod = await login('hod');
const ravi = await login('ravi');       // teaches CSE-B period 3 every day
const meera = await login('meera');
const mentor = await login('mentor');
const btech = (await call('GET', '/courses', { token: hod.token })).data.find((c) => c.name.startsWith('B.Tech'));
const sections = (await call('GET', `/sections?courseId=${btech.id}`, { token: hod.token })).data;
const sectionB = sections.find((s) => s.name === 'CSE-B');
const teachers = (await call('GET', '/users?role=teacher', { token: hod.token })).data;
const divya = teachers.find((t) => t.login_id === 'divya');
const students = (await call('GET', '/users?role=student', { token: hod.token })).data;
const studentId = (loginId) => students.find((s) => s.login_id === loginId).id;

console.log('\n1. the timetable builder, from an empty course');
const course = (await call('POST', '/courses', { token: hod.token, body: { name: 'Zeta Studies' } })).data;
const z1 = (await call('POST', '/sections', { token: hod.token, body: { courseId: course.id, name: 'Z1' } })).data;
const zOne = (await call('POST', '/subjects', { token: hod.token, body: { courseId: course.id, name: 'Zeta One' } })).data;
let grid = (await call('GET', `/schedule/course/${course.id}`, { token: hod.token })).data;
ok(grid.slots.length === 0 && grid.periodsPerDay === 8 && grid.days.length === 6,
  'an empty course still reports the shape of its week, so its grid can be drawn and filled', grid);

const week = await call('PUT', `/schedule/course/${course.id}/settings`, {
  token: hod.token,
  body: { periodsPerDay: 3, daysPerWeek: 5, timings: { periods: ['9:00–10:00', '10:05–11:05', ''], breakAfter: 2, breakTime: '11:05–11:30', afterHours: { 1: 'Library hours' } } },
});
ok(week.status === 200 && week.data.periodsPerDay === 3 && week.data.daysPerWeek === 5, 'the HOD sets five days of three periods', week.data);
grid = (await call('GET', `/schedule/course/${course.id}`, { token: hod.token })).data;
ok(grid.days.length === 5 && grid.days.at(-1) === 'Friday', 'the grid runs Monday to Friday');
ok(grid.timings?.periods?.[0] === '9:00–10:00' && grid.timings.breakAfter === 2 && grid.timings.afterHours['1'] === 'Library hours',
  'the printed timings are kept for the grid to show', grid.timings);
ok((await call('PUT', `/schedule/course/${course.id}/settings`, { token: hod.token, body: { periodsPerDay: 13 } })).status === 400,
  'a day cannot have more than 12 periods');

const slotBody = (extra) => ({ courseId: course.id, sectionId: z1.id, dayOfWeek: 1, periodNumber: 1, subjectId: zOne.id, teacherId: divya.id, ...extra });
const first = await call('PUT', '/schedule/slot', { token: hod.token, body: slotBody() });
ok(first.status === 200, 'the first period of an empty section can be allocated', first.data);
ok((await call('PUT', '/schedule/slot', { token: hod.token, body: slotBody({ dayOfWeek: 6 }) })).status === 400,
  'Saturday is refused when the week ends on Friday');
ok((await call('PUT', '/schedule/slot', { token: hod.token, body: slotBody({ periodNumber: 4 }) })).status === 400,
  'a period past the end of the day is refused');
ok((await call('PUT', '/schedule/slot', { token: hod.token, body: slotBody({ sectionId: sectionB.id }) })).status === 400,
  'a section from another course is refused');
const studentAsTeacher = await call('PUT', '/schedule/slot', { token: hod.token, body: slotBody({ teacherId: studentId('cse-a1') }) });
ok(studentAsTeacher.status === 400 && /active teacher/.test(studentAsTeacher.data.message), 'a student cannot be allocated as the teacher');
const bSubject = (await call('GET', `/subjects?courseId=${btech.id}`, { token: hod.token })).data[0];
ok((await call('PUT', '/schedule/slot', { token: hod.token, body: slotBody({ subjectId: bSubject.id }) })).status === 400,
  'a subject from another course is refused');
const clash = await call('PUT', '/schedule/slot', { token: hod.token, body: slotBody({ periodNumber: 2, teacherId: (teachers.find((t) => t.login_id === 'karthik')).id }) });
ok(clash.status === 200, 'a free teacher can take another period');
const changed = await call('PUT', '/schedule/slot', { token: hod.token, body: slotBody({ teacherId: (teachers.find((t) => t.login_id === 'fathima')).id }) });
ok(changed.status === 200 && changed.data.id === first.data.id, 'changing an allocated period keeps the same slot');
await call('PUT', '/schedule/slot', { token: hod.token, body: slotBody({ periodNumber: 3 }) });
const shrink = await call('PUT', `/schedule/course/${course.id}/settings`, { token: hod.token, body: { periodsPerDay: 2 } });
ok(shrink.status === 400 && /Period 3 still has a class/.test(shrink.data.message), 'the day cannot shrink under a class', shrink.data);
await call('PUT', '/schedule/slot', { token: hod.token, body: slotBody({ dayOfWeek: 5, periodNumber: 1 }) });
const shorter = await call('PUT', `/schedule/course/${course.id}/settings`, { token: hod.token, body: { periodsPerDay: 3, daysPerWeek: 4 } });
ok(shorter.status === 400 && /Friday still has a class/.test(shorter.data.message), 'nor can the week', shorter.data);

// Clearing a period whose registers were already taken used to fail with
// "one of the linked records no longer exists".
const bGrid = (await call('GET', `/schedule/course/${btech.id}`, { token: hod.token })).data;
const marked = bGrid.slots.find((s) => s.section_id === sectionB.id && s.day_of_week === 1 && s.period_number === 3);
const cleared = await call('DELETE', `/schedule/slot/${marked.id}`, { token: hod.token });
ok(cleared.status === 200, 'a period with registers already taken can be cleared', cleared.data);
const restored = await call('PUT', '/schedule/slot', {
  token: hod.token,
  body: { courseId: btech.id, sectionId: sectionB.id, dayOfWeek: 1, periodNumber: 3, subjectId: marked.subject_id, teacherId: marked.teacher_id },
});
ok(restored.status === 200, 'and allocated again');
const history = (await call('GET', `/records?sectionId=${sectionB.id}&from=2026-09-14&to=2026-09-14`, { token: hod.token })).data;
ok(history.some((r) => r.absent_count > 0 || r.present_count > 0), 'the registers taken in it survive the clearing');

console.log('\n2. cancelling classes, and what a cancellation touches');
const own = await call('POST', '/classes/cancel', { token: ravi.token, body: { date: MON, periods: [3], reason: 'Workshop at another college' } });
ok(own.status === 200 && own.data.cancelled.length === 1 && own.data.cancelled[0].sectionName === 'CSE-B',
  'a teacher cancels their own class in one request', own.data);
const notMine = await call('POST', '/classes/cancel', { token: ravi.token, body: { date: MON, periods: [1] } });
ok(notMine.status === 400 && /You have no classes/.test(notMine.data.message), 'but only their own', notMine.data);
ok((await call('POST', '/classes/cancel', { token: mentor.token, body: { date: MON } })).status === 403, 'a mentor cannot cancel classes');
ok((await call('POST', '/classes/cancel', { token: hod.token, body: { date: SUN } })).status === 400, 'there is nothing to cancel on a Sunday');

const roster = (await call('GET', `/attendance/roster?sectionId=${sectionB.id}&classDate=${MON}&periodNumber=3`, { token: ravi.token })).data;
ok(roster.cancelled?.reason === 'Workshop at another college', 'the register says the class is cancelled', roster.cancelled);
const save = await call('POST', '/attendance/roster', {
  token: ravi.token, body: { sectionId: sectionB.id, classDate: MON, periodNumber: 3, marks: [{ student_id: studentId('cse-b3'), status: 'present' }] },
});
ok(save.status === 409, 'and cannot be taken', save.data);
const studentView = await login('cse-b2');
ok((await call('GET', '/classes/cancellations', { token: studentView.token })).data.some((c) => c.class_date === MON),
  'students of the section see the cancellation');
ok((await call('GET', '/notifications', { token: studentView.token })).data.some((n) => /cancelled/i.test(n.title)),
  'and were told about it');
ok((await call('GET', '/notifications', { token: hod.token })).data.some((n) => n.title === 'A teacher cancelled a class'),
  'the HOD hears when a teacher cancels a class');

const b3 = await login('cse-b3');
const leave = await call('POST', '/leave', { token: b3.token, body: { fromDate: MON, toDate: MON, reason: 'Sister’s wedding, family event' } });
const approved = await call('PATCH', `/leave/${leave.data.id}`, { token: hod.token, body: { status: 'approved' } });
ok(approved.data.periodsMarked === 4, 'approved leave skips the cancelled class (4 of 5 periods)', approved.data);
const undo = await call('DELETE', `/classes/cancellations/${own.data.batchId}`, { token: ravi.token });
ok(undo.status === 200 && undo.data.leavePeriodsRestored === 1, 'restoring the class writes the approved leave back into it', undo.data);
ok((await call('GET', `/attendance/roster?sectionId=${sectionB.id}&classDate=${MON}&periodNumber=3`, { token: ravi.token })).data
  .students.find((s) => s.studentId === b3.id)?.status === 'leave', 'so the student on leave is not left unmarked');

const day = await call('POST', '/classes/cancel', { token: hod.token, body: { date: TUE, courseId: btech.id, reason: 'Holiday' } });
ok(day.status === 200 && day.data.cancelled.length === 10, 'the HOD cancels a whole day for a course in one request', day.data.cancelled?.length);
ok((await call('DELETE', `/classes/cancellations/${day.data.batchId}`, { token: ravi.token })).status === 403,
  'a teacher cannot restore the HOD’s cancellation');
const again = await call('POST', '/classes/cancel', { token: hod.token, body: { date: TUE, courseId: btech.id } });
ok(again.status === 200 && again.data.batchId === null && again.data.skipped.every((s) => s.reason === 'already cancelled'),
  'cancelling it twice changes nothing, and says why', again.data);
ok((await call('DELETE', `/classes/cancellations/${day.data.batchId}`, { token: hod.token })).data.restored === 10, 'the HOD restores all ten');

const held = await call('POST', '/classes/cancel', { token: hod.token, body: { date: '2026-09-14', sectionId: sectionB.id, periods: [3] } });
ok(held.data.batchId === null && held.data.skipped[0]?.reason === 'register already taken',
  'a class whose register was taken is never cancelled', held.data);

console.log('\n3. classes held, and the ones nobody marked');
const late = await call('POST', '/users', {
  token: hod.token,
  body: { name: 'Late Joiner', loginId: 'feat.late', password: 'password123', role: 'student', courseId: btech.id, sectionId: sectionB.id, rollNumber: 'B090' },
});
const lateView = async () => (await call('GET', `/attendance/student/${late.data.id}`, { token: hod.token })).data;
let lv = await lateView();
ok(lv.overall.conducted === 0 && lv.classesHeld.section > 0,
  'classes held before a student joined do not count against them', { overall: lv.overall, held: lv.classesHeld });

const thuRoster = (await call('GET', `/attendance/roster?sectionId=${sectionB.id}&classDate=${THU}&periodNumber=3`, { token: ravi.token })).data;
const everyoneButLate = thuRoster.students.filter((s) => s.studentId !== late.data.id).map((s) => ({ student_id: s.studentId, status: 'present' }));
await call('POST', '/attendance/roster', { token: ravi.token, body: { sectionId: sectionB.id, classDate: THU, periodNumber: 3, marks: everyoneButLate } });
lv = await lateView();
ok(lv.overall.not_marked === 1 && lv.overall.conducted === 1 && lv.overall.percentage === 0,
  'a held class with no mark counts as missed', lv.overall);
const rows = (await call('GET', `/records?sectionId=${sectionB.id}&from=${THU}&to=${THU}`, { token: hod.token })).data;
const lateRow = rows.find((r) => r.student_id === late.data.id);
ok(lateRow.not_marked === 1 && lateRow.section_classes_held === 1 && lateRow.conducted === 1,
  'the register shows the missing mark and the section’s count of classes held', lateRow);
const csv = await fetch(`${BASE}/records/export?sectionId=${sectionB.id}&from=${THU}&to=${THU}`, { headers: { authorization: `Bearer ${hod.token}` } }).then((r) => r.text());
ok(/Not marked/.test(csv.split('\n')[0]) && /Classes held for section/.test(csv.split('\n')[0]), 'the export carries both columns');

await call('POST', '/attendance/roster', {
  token: ravi.token, body: { sectionId: sectionB.id, classDate: THU, periodNumber: 3, marks: [...everyoneButLate, { student_id: late.data.id, status: 'present' }] },
});
lv = await lateView();
ok(lv.overall.not_marked === 0 && lv.overall.percentage === 100, 'marking them fixes it', lv.overall);

console.log('\n4. the attendance badge');
ok(lv.badge.earned === true && lv.badge.threshold === 90, 'a student at 100% has the badge', lv.badge);
const low = (await call('GET', `/attendance/student/${studentId('cse-b10')}`, { token: hod.token })).data;
ok(low.badge.earned === false && low.badge.needed > 0, 'a student below 90% is told how many classes it takes', low.badge);
ok(rows.find((r) => r.student_id === late.data.id)?.badge === false && (await call('GET', `/records?sectionId=${sectionB.id}&from=${THU}&to=${THU}`, { token: hod.token })).data
  .find((r) => r.student_id === late.data.id).badge === true, 'the register marks who holds it');

console.log('\n5. event attendance, added by the organiser');
const club = (await call('POST', '/clubs', { token: mentor.token, body: { name: 'Feature Club' } })).data;
await call('POST', `/clubs/${club.id}/members`, { token: mentor.token, body: { loginId: 'cse-b5' } });
const clubEvent = (await call('POST', '/events', { token: mentor.token, body: { title: 'Feature Expo', eventDate: FRI, visibility: 'members_only', clubId: club.id, creditPeriods: [3, 3, 6] } })).data;
ok(clubEvent.credit_periods.join() === '3,6', 'a repeated credit period is stored once', clubEvent.credit_periods);
const added = await call('POST', `/events/${clubEvent.id}/attendance`, { token: mentor.token, body: { loginIds: ['cse-b5', 'CSE-B5', 'cse-b6', 'no.such.student'] } });
ok(added.status === 200 && added.data.added === 1, 'the organiser adds a member’s attendance directly', added.data);
ok(added.data.failed.some((f) => f.loginId === 'cse-b6' && /member/.test(f.reason)), 'a non-member of a members-only event is refused');
ok(added.data.failed.some((f) => f.loginId === 'no.such.student'), 'an unknown login ID is reported, not ignored');
const credits = added.data.results.find((r) => r.status === 'added').credits;
ok(credits.find((c) => c.period === 3)?.subject && credits.find((c) => c.period === 6)?.skipped === 'no class scheduled in this period',
  'each period says whether it was credited, and why not', credits);
ok((await call('POST', `/events/${clubEvent.id}/attendance`, { token: mentor.token, body: { loginIds: ['cse-b5'] } })).data.already === 1,
  'adding the same student again credits nothing twice');
ok((await call('POST', `/events/${clubEvent.id}/attendance`, { token: ravi.token, body: { loginIds: ['cse-b5'] } })).status === 403,
  'only the organiser can add attendance');

const b5 = await login('cse-b5');
const seen = (await call('GET', '/events', { token: b5.token })).data.find((e) => e.id === clubEvent.id);
ok(seen.my_credits.some((c) => c.period === 3 && c.subject) && seen.my_not_credited.some((m) => m.period === 6 && /no class/.test(m.reason)),
  'the student sees what the event credited, and why the rest was not', { credits: seen.my_credits, missing: seen.my_not_credited });
const b5View = (await call('GET', `/attendance/student/${b5.id}`, { token: b5.token })).data;
ok(b5View.eventCredits.some((c) => c.event_title === 'Feature Expo' && c.counted), 'and in their own attendance');
ok((await call('GET', '/notifications', { token: ravi.token })).data.some((n) => /Feature Expo/.test(n.message || '')),
  'the teacher of the credited class was told');

const friRoster = (await call('GET', `/attendance/roster?sectionId=${sectionB.id}&classDate=${FRI}&periodNumber=3`, { token: ravi.token })).data;
await call('POST', '/attendance/roster', {
  token: ravi.token, body: { sectionId: sectionB.id, classDate: FRI, periodNumber: 3, marks: friRoster.students.map((s) => ({ student_id: s.studentId, status: s.status || 'present' })) },
});
const afterSave = (await call('GET', `/attendance/roster?sectionId=${sectionB.id}&classDate=${FRI}&periodNumber=3`, { token: ravi.token })).data;
ok(afterSave.students.find((s) => s.studentId === b5.id)?.source === 'event_credit',
  'saving the register leaves an event credit marked as one');

const wedEvent = (await call('POST', '/events', { token: mentor.token, body: { title: 'Midweek Meet', eventDate: WED, creditPeriods: [3] } })).data;
await call('POST', '/classes/cancel', { token: hod.token, body: { date: WED, sectionId: sectionB.id, periods: [3], eventId: wedEvent.id } });
const skipped = await call('POST', `/events/${wedEvent.id}/attendance`, { token: mentor.token, body: { loginIds: ['cse-b4'] } });
ok(skipped.data.results[0]?.credits?.[0]?.skipped === 'class cancelled', 'a cancelled class is never credited', skipped.data.results);
const meeraCancel = await call('POST', '/classes/cancel', { token: meera.token, body: { date: WED, periods: [3] } });
ok(meeraCancel.status === 400, 'a teacher with no class in that period cannot cancel it', meeraCancel.data);

console.log('\n6. demo sign-in stays off unless the deployment asks for it');
const demo = await call('GET', '/demo');
ok(demo.status === 200 && demo.data.enabled === false && demo.data.accounts.length === 0, 'the sign-in page offers no demo accounts');
ok((await call('POST', '/demo/login', { body: { loginId: 'demo.hod' } })).status === 404, 'and one-tap demo sign-in is refused');

console.log('\n7. importing a class routine');
const run = (...args) => execFileSync('node', [join(ROOT, 'server/src/infra/db/import-timetable.js'), ...args], { encoding: 'utf8', env: process.env });
const dry = run('--dry-run');
ok(/dry run, nothing saved/.test(dry), 'a dry run says so');
ok(!(await call('GET', '/courses', { token: hod.token })).data.some((c) => c.name === 'BBA'), 'and saves nothing');
const out = run();
ok(/19 added/.test(out) && /Wednesday period 1: Review Business Communication/.test(out),
  'the D2 BBA routine loads, naming the class that has no teacher', out);
const bba = (await call('GET', '/courses', { token: hod.token })).data.find((c) => c.name === 'BBA');
const bbaGrid = (await call('GET', `/schedule/course/${bba.id}`, { token: hod.token })).data;
const cellAt = (d, p) => bbaGrid.slots.find((s) => s.day_of_week === d && s.period_number === p);
ok(bbaGrid.days.length === 5 && bbaGrid.periodsPerDay === 4, 'as five days of four periods');
ok(cellAt(1, 1)?.subject_name === 'Business Ethics' && cellAt(1, 1)?.teacher_name === 'SS'
  && cellAt(5, 3)?.subject_name === 'Constitutional Values' && cellAt(5, 3)?.teacher_name === 'DN'
  && cellAt(2, 4)?.subject_name === 'Environmental Studies – 1',
  'with each period where the printed routine puts it', { mon1: cellAt(1, 1), fri3: cellAt(5, 3) });
ok(bbaGrid.timings.periods[0] === '10:15–11:15' && bbaGrid.timings.breakAfter === 3 && bbaGrid.timings.afterHours['1'] === 'Mentorship & Value-Added Course',
  'and its printed times, break and after-hours activities', bbaGrid.timings);
ok(/0 added, 0 changed, 19 already right, 0 cleared/.test(run()), 'importing it again changes nothing');

console.log('\n8. a register written by anything else still counts as a class held');
// The previous version of the app keeps serving while a new deployment builds,
// and it writes registers knowing nothing of class_sessions. The database
// records the class for it, so "classes held" never misses one.
const { default: pg } = await import('pg');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const { rows: [slot] } = await db.query(
    `select sl.id, sl.section_id, sl.subject_id, sl.teacher_id, sl.period_number
       from schedule_slots sl join sections s on s.id = sl.section_id
      where s.name = 'CSE-B' and sl.day_of_week = 2
      order by sl.period_number limit 1`);
  const APR = '2027-04-06'; // a Tuesday nothing else touches
  const heldBefore = (await call('GET', '/overview', { token: hod.token })).data.classStats.held;
  await db.query(
    `insert into attendance_records (student_id, section_id, subject_id, slot_id, class_date, period_number, status, source, marked_by)
     select st.user_id, $1, $2, $3, $4, $5, 'present', 'teacher', $6 from students st where st.section_id = $1`,
    [slot.section_id, slot.subject_id, slot.id, APR, slot.period_number, slot.teacher_id]);
  const { rows: held } = await db.query(
    'select status, teacher_id, slot_id from class_sessions where section_id = $1 and class_date = $2 and period_number = $3',
    [slot.section_id, APR, slot.period_number]);
  ok(held.length === 1 && held[0].status === 'held' && held[0].teacher_id === slot.teacher_id && held[0].slot_id === slot.id,
    'a register written straight into the database records its class as held', held);
  ok((await call('GET', '/overview', { token: hod.token })).data.classStats.held === heldBefore + 1, 'and the college counts it once');

  // Approved leave is not a register: it never makes a class held.
  const other = slot.period_number === 1 ? 2 : 1;
  await db.query(
    `insert into attendance_records (student_id, section_id, subject_id, class_date, period_number, status, source)
     select st.user_id, $1, $2, $3, $4, 'leave', 'leave_approval' from students st where st.section_id = $1 limit 1`,
    [slot.section_id, slot.subject_id, APR, other]);
  const { rowCount } = await db.query(
    'select 1 from class_sessions where section_id = $1 and class_date = $2 and period_number = $3', [slot.section_id, APR, other]);
  ok(rowCount === 0, 'a leave row alone does not count as a class held');

  // Leave the department as the web suite, which runs next, expects to find it.
  await db.query('delete from attendance_records where section_id = $1 and class_date = $2', [slot.section_id, APR]);
  await db.query('delete from class_sessions where section_id = $1 and class_date = $2', [slot.section_id, APR]);
  ok((await call('GET', '/overview', { token: hod.token })).data.classStats.held === heldBefore, 'removing it again takes the class back off the count');
} finally {
  await db.end();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
