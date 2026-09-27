/**
 * The administrator role.
 *
 * Runs AFTER the seed, signing in as the account bootstrap.mjs created. The
 * seeded department gives it an HOD, teachers and students to have opinions
 * about.
 *
 *   API_BASE=http://127.0.0.1:4001/api node server/test/admin.mjs
 */
const BASE = process.env.API_BASE || 'http://localhost:4000/api';
let pass = 0; let fail = 0;

const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log('  PASS', label); }
  else { fail += 1; console.log('  FAIL', label, extra ? JSON.stringify(extra).slice(0, 300) : ''); }
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

const signIn = (loginId, password) => call('POST', '/auth/login', { body: { loginId, password } });

console.log('\n1. the bootstrapped administrator signs in');
const adminRes = await signIn('admin', 'admin-password-1');
const admin = adminRes.data;
ok(adminRes.status === 200 && admin.user.role === 'admin', 'administrator signs in', adminRes.data);
const me = (await call('GET', '/auth/me', { token: admin.token })).data;
ok(me.role === 'admin', 'the token carries the admin role');

console.log('\n2. staffing the college');
const newHod = await call('POST', '/users', {
  token: admin.token, body: { name: 'Dr. Second', loginId: 'hod2', password: 'password123', role: 'hod' },
});
ok(newHod.status === 201 && newHod.data.role === 'hod', 'administrator creates an HOD', newHod.data);
ok((await call('POST', '/users', {
  token: admin.token, body: { name: 'New Teacher', loginId: 'teach-new', password: 'password123', role: 'teacher' },
})).status === 201, 'administrator creates a teacher');
ok((await call('POST', '/users', {
  token: admin.token, body: { name: 'Kid', loginId: 'stu-new', password: 'password123', role: 'student' },
})).status === 403, 'administrator cannot create a student: that needs a course and section');

console.log('\n3. the roles stay in their lanes');
const hod = (await signIn('hod', 'password123')).data;
ok((await call('POST', '/users', {
  token: hod.token, body: { name: 'Nope', loginId: 'hod3', password: 'password123', role: 'hod' },
})).status === 403, 'an HOD cannot create another HOD');
ok((await call('DELETE', `/users/${me.id}`, { token: hod.token })).status === 403,
  'an HOD cannot remove the administrator');
ok((await call('POST', `/users/${me.id}/password`, {
  token: hod.token, body: { password: 'stolen-password' },
})).status === 403, 'an HOD cannot reset the administrator password');
ok((await call('DELETE', `/users/${me.id}`, { token: admin.token })).status === 400,
  'the administrator cannot remove their own account');

console.log('\n4. oversight, which is the point of the role');
ok((await call('GET', '/activity', { token: admin.token })).status === 200, 'administrator reads the audit trail');
ok((await call('GET', '/users?role=hod', { token: admin.token })).data.length >= 2, 'administrator lists HODs');
const overview = await call('GET', '/overview', { token: admin.token });
ok(overview.data.role === 'admin', 'the administrator gets an administrator overview', overview.data);
ok(overview.data.accounts.students > 0 && overview.data.accounts.hods >= 2,
  'the overview counts the college, not a timetable', overview.data.accounts);
// The events table constrains creator_role, so this fails loudly if the
// migration forgot to widen it.
ok((await call('POST', '/events', {
  token: admin.token, body: { title: 'Induction day', eventDate: '2026-10-01' },
})).status === 201, 'administrator can post an event');

console.log('\n5. a spare administrator, so one lost password is not terminal');
const deputy = await call('POST', '/users', {
  token: admin.token, body: { name: 'Deputy', loginId: 'admin2', password: 'password123', role: 'admin' },
});
ok(deputy.status === 201 && deputy.data.role === 'admin', 'an administrator can create another administrator', deputy.data);

const deputyToken = (await signIn('admin2', 'password123')).data.token;
ok((await call('POST', `/users/${me.id}/password`, {
  token: deputyToken, body: { password: 'recovered-password' },
})).status === 200, 'one administrator can reset another administrator’s password');
ok((await signIn('admin', 'recovered-password')).status === 200, 'the recovered password works');
ok((await call('DELETE', `/users/${deputy.data.id}`, { token: admin.token })).status === 200,
  'a spare administrator can be removed again');

// Put the password back, so this suite leaves the database as it found it.
await call('POST', `/users/${me.id}/password`, { token: admin.token, body: { password: 'admin-password-1' } });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
