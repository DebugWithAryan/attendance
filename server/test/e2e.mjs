const BASE = process.env.API_BASE || 'http://localhost:4000/api';
let pass = 0; let fail = 0;

const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log('  PASS', label); }
  else { fail += 1; console.log('  FAIL', label, extra ? JSON.stringify(extra).slice(0, 300) : ''); }
};

async function call(method, path, { token, body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: raw ? text : data, headers: res.headers };
}

const login = async (loginId) => (await call('POST', '/auth/login', { body: { loginId, password: 'password123' } })).data;

console.log('\n1. auth + rbac');
const hod = await login('hod');
const ravi = await login('ravi');       // teacher, owns CSE-B period 3
const mentor = await login('mentor');
const student = await login('cse-b1');
ok(hod.user.role === 'hod', 'hod signs in');
ok((await call('POST', '/auth/login', { body: { loginId: 'hod', password: 'wrong' } })).status === 401, 'wrong password rejected');
ok((await call('GET', '/attendance/roster?sectionId=x&classDate=2026-09-14&periodNumber=3', { token: student.token })).status === 403,
  'student cannot reach the attendance endpoint');
ok((await call('GET', '/activity', { token: ravi.token })).status === 403, 'teacher cannot read the audit trail');
ok((await call('GET', '/clubs', { token: student.token })).status === 403, 'student cannot list clubs');

console.log('\n2. structure reads');
const courses = (await call('GET', '/courses', { token: hod.token })).data;
const sections = (await call('GET', `/sections?courseId=${courses[0].id}`, { token: hod.token })).data;
const sectionB = sections.find((s) => s.name === 'CSE-B');
ok(courses.length === 1 && sections.length === 2, 'seeded course and sections visible');
ok(!!sectionB.class_teacher_name, 'class teacher allocation present');

console.log('\n3. marking attendance');
const DATE = '2026-09-14'; // a Monday
const PERIOD = 3;
const rosterRes = await call('GET', `/attendance/roster?sectionId=${sectionB.id}&classDate=${DATE}&periodNumber=${PERIOD}`, { token: ravi.token });
ok(rosterRes.status === 200 && rosterRes.data.students.length === 10, 'roster loads for the owning teacher', rosterRes.data);
const roster = rosterRes.data.students;

const wrongSection = await call('GET', `/attendance/roster?sectionId=${sections.find((s) => s.name === 'CSE-A').id}&classDate=${DATE}&periodNumber=${PERIOD}`, { token: ravi.token });
ok(wrongSection.status === 403, 'teacher blocked from a period that is not theirs');

const marks = roster.map((s, i) => ({ student_id: s.studentId, status: i < 7 ? 'present' : 'absent' }));
const saved = await call('POST', '/attendance/roster', { token: ravi.token, body: { sectionId: sectionB.id, classDate: DATE, periodNumber: PERIOD, marks } });
ok(saved.status === 200 && saved.data.saved === 10, 'roster saves', saved.data);

const after = (await call('GET', `/attendance/roster?sectionId=${sectionB.id}&classDate=${DATE}&periodNumber=${PERIOD}`, { token: ravi.token })).data;
ok(after.students[0].status === 'present' && after.students[9].status === 'absent', 'saved marks read back');
ok(!!after.students[0].lastUpdatedBy, 'last-updated-by stamp present');

console.log('\n4. percentages');
const absentee = roster[9];
let view = (await call('GET', `/attendance/student/${absentee.studentId}`, { token: hod.token })).data;
ok(view.overall.percentage === 0 && view.overall.conducted === 1, 'summary table updated by trigger', view.overall);
ok(view.overall.needed === 3, 'classes-needed calculator (0/1 at 75% needs 3)', view.overall);
ok(view.overall.belowMinimum === true, 'below-minimum flag set');
ok(!('canSkip' in view.overall), 'calculator never reports skippable classes');

console.log('\n5. edit window + audit');
const recordId = after.students[9].studentId && (await call('GET', `/records?sectionId=${sectionB.id}`, { token: ravi.token })).status === 200;
ok(recordId, 'records endpoint reachable by teacher');
const roster2 = after.students[9];
const recRes = await call('GET', `/attendance/roster?sectionId=${sectionB.id}&classDate=${DATE}&periodNumber=${PERIOD}`, { token: ravi.token });
const targetRecord = (await (async () => {
  const rows = (await call('GET', `/records?sectionId=${sectionB.id}`, { token: hod.token })).data;
  return rows.find((r) => r.student_id === roster2.studentId);
})());
ok(!!targetRecord && targetRecord.absent_count === 1, 'register shows the absence');

// find the record id through the roster (it is exposed as record via student view path)
const editTarget = (await call('GET', `/attendance/roster?sectionId=${sectionB.id}&classDate=${DATE}&periodNumber=${PERIOD}`, { token: ravi.token })).data.students[9];
const noReason = await call('PATCH', `/attendance/record/${editTarget.recordId || '00000000-0000-0000-0000-000000000000'}`, { token: ravi.token, body: { status: 'present', reason: '' } });
ok(noReason.status === 400, 'edit without a reason is rejected');

console.log('\n6. leave flow');
const leave = await call('POST', '/leave', { token: student.token, body: { fromDate: DATE, toDate: DATE, reason: 'Fever, attaching certificate' } });
ok(leave.status === 201, 'student applies for leave', leave.data);
const queue = (await call('GET', '/leave/queue?status=pending', { token: hod.token })).data;
ok(queue.length === 1, 'request reaches the HOD queue', queue);
const decided = await call('PATCH', `/leave/${leave.data.id}`, { token: hod.token, body: { status: 'approved', note: 'Certificate verified' } });
ok(decided.status === 200 && decided.data.periodsMarked === 5, 'approval marks the day as leave across all 5 periods', decided.data);
const afterLeave = (await call('GET', `/attendance/student/${student.user.id}`, { token: hod.token })).data;
ok(afterLeave.overall.leave_count === 5, 'leave counted separately', afterLeave.overall);
ok(afterLeave.overall.percentage === null || afterLeave.overall.absent_count === 0, 'approved leave does not count against the student', afterLeave.overall);
ok((await call('PATCH', `/leave/${leave.data.id}`, { token: hod.token, body: { status: 'rejected' } })).status === 400, 'a decided request cannot be re-decided');

console.log('\n7. club + event credit with override');
const club = await call('POST', '/clubs', { token: mentor.token, body: { name: 'Robotics Club' } });
ok(club.status === 201, 'mentor creates a club', club.data);
const member = await call('POST', `/clubs/${club.data.id}/members`, { token: mentor.token, body: { loginId: 'cse-b8' } });
ok(member.status === 200, 'mentor adds a member by login ID', member.data);
ok((await call('POST', `/clubs/${club.data.id}/members`, { token: mentor.token, body: { loginId: 'cse-b8' } })).status === 400, 'duplicate membership rejected');

const event = await call('POST', '/events', { token: mentor.token, body: { title: 'State Robotics Meet', eventDate: DATE, visibility: 'members_only', clubId: club.data.id, creditPeriods: [PERIOD] } });
ok(event.status === 201 && event.data.credit_periods.length === 1, 'event created with a credit period', event.data);

const b2 = await login('cse-b8');
const beforeCredit = (await call('GET', `/attendance/student/${b2.user.id}`, { token: hod.token })).data.overall;
const join = await call('POST', `/events/${event.data.id}/join`, { token: b2.token });
ok(join.status === 200, 'member sends a join request', join.data);
const outsider = await login('cse-a1');
ok((await call('POST', `/events/${event.data.id}/join`, { token: outsider.token })).status === 403, 'non-member blocked from a members-only event');
ok((await call('PATCH', `/events/requests/${join.data.id}`, { token: ravi.token, body: { status: 'approved' } })).status === 403,
  'only the poster can approve (no double-crediting)');

const requests = (await call('GET', `/events/${event.data.id}/requests`, { token: mentor.token })).data;
const approved = await call('PATCH', `/events/requests/${requests[0].id}`, { token: mentor.token, body: { status: 'approved' } });
ok(approved.status === 200, 'mentor approves the join request', approved.data);
ok(approved.data.credits[0].wasOverride === true && approved.data.credits[0].previousStatus === 'absent',
  'credit is recorded as an override of the teacher mark', approved.data.credits);

const afterCredit = (await call('GET', `/attendance/student/${b2.user.id}`, { token: hod.token })).data.overall;
ok(afterCredit.present_count === beforeCredit.present_count + 1, 'credited period now counts as present', { beforeCredit, afterCredit });

console.log('\n8. account creation through the API');
const newStudent = await call('POST', '/users', { token: hod.token, body: { name: 'Test Student', loginId: 'test.student', password: 'password123', role: 'student', courseId: courses[0].id, sectionId: sectionB.id, rollNumber: 'B099' } });
ok(newStudent.status === 201, 'HOD creates a student account', newStudent.data);
const dupe = await call('POST', '/users', { token: hod.token, body: { name: 'Test Student', loginId: 'test.student', password: 'password123', role: 'student', courseId: courses[0].id, sectionId: sectionB.id, rollNumber: 'B098' } });
ok(dupe.status === 409 && dupe.data.message.includes('login ID'), 'duplicate login ID rejected with a readable message', dupe.data);
ok((await call('POST', '/users', { token: ravi.token, body: { name: 'X Teacher', loginId: 'x.teacher', password: 'password123', role: 'teacher' } })).status === 403,
  'a teacher with add-authority still cannot create teachers');
ok((await call('POST', '/auth/login', { body: { loginId: 'test.student', password: 'password123' } })).status === 200, 'the new account can sign in');
const removed = await call('DELETE', `/users/${newStudent.data.id}`, { token: hod.token });
ok(removed.status === 200, 'HOD removes the account');
ok((await call('POST', '/auth/login', { body: { loginId: 'test.student', password: 'password123' } })).status === 401, 'a removed account cannot sign in');

console.log('\n9. audit trail + notifications');
const activity = (await call('GET', '/activity?limit=200', { token: hod.token })).data;
const actions = new Set(activity.map((a) => a.action_type));
for (const expected of ['attendance.saved', 'leave.approved', 'attendance.credit_override', 'club.created', 'event.created', 'user.created']) {
  ok(actions.has(expected), `activity log contains ${expected}`);
}
const overrideRow = activity.find((a) => a.action_type === 'attendance.credit_override');
ok(overrideRow.reason?.includes('State Robotics Meet') && overrideRow.details.previous_status === 'absent',
  'override row carries reason and previous status', overrideRow);
const teacherNotes = (await call('GET', '/notifications', { token: ravi.token })).data;
ok(teacherNotes.some((n) => n.title.includes('overridden')), 'affected teacher was notified of the override');

console.log('\n10. records + export');
const rows = (await call('GET', `/records?courseId=${courses[0].id}`, { token: hod.token })).data;
ok(rows.length === 20 && rows.every((r) => r.minimum === 75), 'register covers every student with the HOD minimum', rows[0]);
const exportAll = await call('GET', `/records/export?courseId=${courses[0].id}`, { token: hod.token, raw: true });
ok(exportAll.data.split('\n')[0].startsWith('Roll number,Name,Login ID'), 'full CSV export has a header row');
ok(exportAll.data.trim().split('\n').length === 21, 'full export has one row per student');
const exportBelow = await call('GET', `/records/export?courseId=${courses[0].id}&onlyBelow=true`, { token: hod.token, raw: true });
ok(Number(exportBelow.headers.get('x-row-count')) < 20, 'below-minimum export is filtered', exportBelow.headers.get('x-row-count'));
ok((await call('GET', '/activity?action=records.exported', { token: hod.token })).data.length === 2, 'both exports were logged');

console.log('\n11. schedule highlighting');
const grid = (await call('GET', `/schedule/course/${courses[0].id}`, { token: ravi.token })).data;
ok(grid.slots.length === 60, 'six-day grid for both sections');
ok(grid.slots.some((s) => s.mine) && grid.slots.some((s) => !s.mine), 'own classes flagged per viewer');
const mine = (await call('GET', '/schedule/mine', { token: student.token })).data;
ok(mine.slots.length === 30 && mine.slots.every((s) => s.section_name === 'CSE-B'), 'student sees only their own section');


console.log('\n12. hardening: login lockout and certificate upload');
// A 1x1 PNG, the smallest honest stand-in for a phone photo.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARgwAAwEBAGVQZ+cAAAAASUVORK5CYII=';

const withDoc = await call('POST', '/leave', {
  token: student.token,
  body: { fromDate: '2026-09-21', toDate: '2026-09-21', reason: 'Dental surgery, certificate attached', certificate: PNG },
});
ok(withDoc.status === 201 && withDoc.data.has_document === true, 'the certificate travels with the request', withDoc.data);
ok(withDoc.data.document_ref === undefined && withDoc.data.document_url === undefined,
  'the storage reference never reaches the client', Object.keys(withDoc.data).join(','));

ok((await call('POST', '/leave', {
  token: student.token,
  body: { fromDate: '2026-09-22', toDate: '2026-09-22', reason: 'Testing a bad attachment', certificate: 'data:text/html;base64,PGI+' },
})).status === 400, 'a non-image, non-PDF attachment is rejected');

const queued = (await call('GET', '/leave/queue?status=pending', { token: hod.token })).data.find((r) => r.id === withDoc.data.id);
ok(queued?.has_document === true, 'the approver is told a certificate exists');
ok(queued?.document_ref === undefined, 'but never gets the reference itself', Object.keys(queued || {}).join(','));

// Health data: only the student, their class teacher and the HOD.
const asStudent = await call('GET', `/leave/${withDoc.data.id}/document`, { token: student.token, raw: true });
ok(asStudent.status === 200 && asStudent.headers.get('content-type') === 'image/png',
  'the student can open their own certificate', asStudent.status);
ok(asStudent.headers.get('cache-control')?.includes('no-store'), 'and it is not cached');
ok((await call('GET', `/leave/${withDoc.data.id}/document`, { token: hod.token, raw: true })).status === 200,
  'the HOD can open it');

const otherStudent = await login('cse-a1');
ok((await call('GET', `/leave/${withDoc.data.id}/document`, { token: otherStudent.token })).status === 403,
  'another student cannot');
ok((await call('GET', `/leave/${withDoc.data.id}/document`, { token: mentor.token })).status === 403,
  'a mentor cannot');
ok((await call('GET', '/activity?action=leave.document_viewed', { token: hod.token })).data.length >= 2,
  'every view of a certificate is logged');

console.log('\n13. changing a decision that was already made');
const toRevise = await call('POST', '/leave', {
  token: student.token, body: { fromDate: '2026-09-23', toDate: '2026-09-23', reason: 'Family function, may be cancelled' },
});
await call('PATCH', `/leave/${toRevise.data.id}`, { token: hod.token, body: { status: 'approved' } });
const leaveAfterApproval = (await call('GET', `/attendance/student/${student.user.id}`, { token: hod.token })).data.overall.leave_count;

ok((await call('PATCH', `/leave/${toRevise.data.id}/decision`, { token: hod.token, body: { status: 'rejected' } })).status === 400,
  'changing a decision without a reason is refused');
const revised = await call('PATCH', `/leave/${toRevise.data.id}/decision`, {
  token: hod.token, body: { status: 'rejected', reason: 'The event was cancelled, the student attended' },
});
ok(revised.status === 200 && revised.data.periodsChanged > 0, 'the decision flips and the register is corrected', revised.data);

const leaveAfterRevision = (await call('GET', `/attendance/student/${student.user.id}`, { token: hod.token })).data.overall.leave_count;
ok(leaveAfterRevision === leaveAfterApproval - revised.data.periodsChanged,
  'the leave days written by that approval were removed', { leaveAfterApproval, leaveAfterRevision });
ok((await call('GET', '/activity?action=leave.decision_revised', { token: hod.token })).data.length === 1,
  'the reversal is in the audit trail');
ok((await call('PATCH', `/leave/${toRevise.data.id}/decision`, { token: ravi.token, body: { status: 'approved', reason: 'trying it on' } })).status === 403,
  'a teacher cannot overturn the HOD\u2019s decision');

console.log('\n14. password reset and bulk import');
const target = (await call('GET', '/users?role=student', { token: hod.token })).data.find((u) => u.login_id === 'cse-a2');
ok((await call('POST', `/users/${target.id}/password`, { token: hod.token, body: { password: 'short' } })).status === 400,
  'a short reset password is refused');
ok((await call('POST', `/users/${target.id}/password`, { token: hod.token, body: { password: 'brand-new-password' } })).status === 200,
  'the HOD sets a new password');
ok((await call('POST', '/auth/login', { body: { loginId: 'cse-a2', password: 'brand-new-password' } })).status === 200,
  'the student signs in with it');
ok((await call('POST', '/auth/login', { body: { loginId: 'cse-a2', password: 'password123' } })).status === 401,
  'and the old one stops working');

const imported = await call('POST', '/users/import', {
  token: hod.token,
  body: {
    courseId: courses[0].id,
    sectionId: sectionB.id,
    csv: [
      'roll_number,name,login_id,password',
      'B051,Imported One,import.one,firstpass123',
      'B052,Imported Two,import.two,firstpass123',
      'B053,Missing Password,import.three',
      'B054,Weak,import.four,short',
      'B055,Duplicate,cse-b1,firstpass123',
    ].join('\n'),
  },
});
ok(imported.data.created === 2, 'good rows are imported', imported.data);
ok(imported.data.failed.length === 3, 'bad rows are reported, not silently dropped', imported.data.failed);
ok(imported.data.failed.every((f) => f.line && f.reason), 'each failure names its line and why');
ok((await call('POST', '/auth/login', { body: { loginId: 'import.one', password: 'firstpass123' } })).status === 200,
  'an imported student can sign in');

let locked = null;
for (let i = 0; i < 9; i += 1) {
  locked = await call('POST', '/auth/login', { body: { loginId: 'nobody.here', password: 'wrong' } });
}
ok(locked.status === 429 && /Too many failed attempts/.test(locked.data.message), 'repeated failures lock the login', locked.data);
ok((await call('POST', '/auth/login', { body: { loginId: 'hod', password: 'password123' } })).status === 200,
  'the lock is per login ID, not global');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
