/**
 * The whole system, one continuous story, driven through the real UI.
 *
 * No seeded tokens and no direct API calls for the actions — every step types
 * into the same form or clicks the same button a person would, in one mounted
 * app, signing out and in as four different people. The API is whatever
 * API_ORIGIN points at; against scripts/vercel-sim.mjs that is the deployed
 * serverless path.
 *
 *   API_ORIGIN=http://127.0.0.1:4001 node test/journey.mjs
 */
import { JSDOM } from 'jsdom';

const API = process.env.API_ORIGIN || 'http://127.0.0.1:4000';
// The college week is Monday to Saturday, so the journey has to pick real
// teaching days: the server rightly refuses to mark a register on a Sunday.
const isoDay = (d) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());
const nextClassDay = (from) => {
  const d = new Date(from);
  while (isoDay(d) === 7) d.setUTCDate(d.getUTCDate() + 1);
  return d;
};
const classDate = nextClassDay(new Date());
const leaveDate = nextClassDay(new Date(classDate.getTime() + 86400000));
const today = classDate.toISOString().slice(0, 10);
const tomorrow = leaveDate.toISOString().slice(0, 10);

let pass = 0;
let fail = 0;
const out = console.error; // console.error is captured below; this stays visible
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; out('  ok  ', label); }
  else { fail += 1; out('  FAIL', label, extra === undefined ? '' : String(extra).slice(0, 220)); }
};
const step = (n, label) => out(`\n${n}. ${label}`);

/* ---------- browser ---------- */
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${API}/`, pretendToBeVisual: true,
});
const g = globalThis;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
for (const k of ['sessionStorage', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver', 'File', 'FileReader', 'Blob', 'FormData']) {
  g[k] = dom.window[k];
}
g.requestAnimationFrame = (fn) => setTimeout(fn, 0);
g.cancelAnimationFrame = clearTimeout;

// jsdom has no object URLs and no real downloads; record the attempt instead.
const downloads = [];
dom.window.URL.createObjectURL = () => 'blob:demo';
dom.window.URL.revokeObjectURL = () => {};
dom.window.HTMLAnchorElement.prototype.click = function stub() { downloads.push(this.download); };

const nodeFetch = fetch;
g.fetch = (input, init) => nodeFetch(typeof input === 'string' && input.startsWith('/') ? API + input : input, init);
dom.window.fetch = g.fetch;

const consoleErrors = [];
console.error = (...a) => consoleErrors.push(a.map(String).join(' '));

/* ---------- driving ---------- */
const host = () => document.getElementById('root');
const all = (sel) => [...host().querySelectorAll(sel)];
const text = () => (host().textContent || '').replace(/\s+/g, ' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(predicate, label, timeout = 6000) {
  const started = Date.now();
  for (;;) {
    const hit = predicate();
    if (hit) return hit;
    if (Date.now() - started > timeout) {
      throw new Error(`timed out waiting for ${label}\n  page said: ${text().slice(0, 400)}`);
    }
    await sleep(60);
  }
}

const btn = (label) => all('button').find((b) => b.textContent.trim() === label);
const btnLike = (fragment) => all('button').find((b) => b.textContent.includes(fragment));
const nav = (label) => all('a').find((a) => a.textContent.trim().startsWith(label));

const type = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};
const choose = (select, matcher) => {
  const option = [...select.options].find((o) => (typeof matcher === 'function' ? matcher(o) : o.textContent.trim() === matcher));
  if (!option) throw new Error(`no option matching ${matcher} in [${[...select.options].map((o) => o.textContent).join(', ')}]`);
  select.value = option.value;
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  return option;
};
const field = (labelText) => all('label').find((l) => l.textContent.trim().startsWith(labelText))?.querySelector('input, textarea, select');

async function goTo(label) {
  nav(label).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));
  await sleep(500);
}

async function signIn(loginId) {
  await until(() => btn('Sign in'), 'the login form');
  type(all('input')[0], loginId);
  type(all('input')[1], 'password123');
  btn('Sign in').click();
  await until(() => btn('Sign out'), `${loginId} to be signed in`);
  // Signing out leaves the router where it was, so the next person lands on the
  // previous page. Go to Overview deliberately, then wait for its own fetch.
  await sleep(200);
  await goTo('Overview');
  await until(() => /Good day/.test(text()), `${loginId}'s overview`);
}

async function signOut() {
  btn('Sign out').click();
  await until(() => btn('Sign in'), 'the login form again');
}

/* ---------- the journey ---------- */
const { mount } = await import('../dist-test/smoke-entry.js');
mount(host(), '/');

out('\n=== One department, one day, four people ===');

step(1, 'The HOD signs in and sets the rules');
await signIn('hod');
ok(text().includes('Good day, Dr.'), 'lands on the HOD overview');
ok(text().includes('Average attendance by section'), 'sees section averages straight away');

await goTo('Setup');
await until(() => all('select').length > 0, 'the setup page');
choose(field('Working on course'), (o) => o.textContent.includes('B.Tech'));
await sleep(600);
const pctField = await until(() => field('Percentage'), 'the minimum attendance field');
type(pctField, '75');
btn('Save minimum').click();
await until(() => text().includes('Minimum updated'), 'the minimum to save');
ok(true, 'sets the minimum attendance criteria');

step(2, 'A teacher marks the register');
await signOut();
await signIn('ravi');
ok(text().includes('Your classes today'), 'teacher overview lists today\u2019s classes');

await goTo('Attendance');
await until(() => all('select').length >= 3, 'the attendance pickers');
choose(all('select')[0], (o) => o.textContent.includes('B.Tech'));
await sleep(500);
choose(all('select')[1], 'CSE-B');
await sleep(400);
type(host().querySelector('input[type="date"]'), today);
await sleep(300);
choose(all('select')[2], 'Period 3');

const roster = await until(() => (all('.register .line').length >= 10 ? all('.register .line') : null), 'the roster');
const rosterSize = roster.length;
ok(rosterSize >= 10, `roster loads for the teacher\u2019s own period (${rosterSize} students)`);

btn('Mark all present').click();
await sleep(200);
// Mark two named students absent — by roll number, not by position, so the
// story still works when the section has grown since the seed.
for (const roll of ['B009', 'B010']) {
  const line = all('.register .line').find((l) => l.querySelector('.roll')?.textContent.trim() === roll);
  if (!line) throw new Error(`no row for roll ${roll}`);
  [...line.querySelectorAll('button')].find((b) => b.dataset.status === 'absent').click();
  await sleep(60);
}
ok(text().includes(`${rosterSize - 2} present · 2 absent`), 'tally reflects the taps', text().slice(0, 120));

btnLike('Save attendance').click();
await until(() => text().includes(`Saved ${rosterSize} students`), 'the save to confirm');
ok(true, 'attendance saved');

const corrections = all('button').filter((b) => b.textContent.trim() === 'Correct');
corrections.at(-3).click();
await until(() => field('Reason'), 'the correction panel');
type(field('Reason'), 'Arrived late, was in class');
btn('Save correction').click();
await until(() => text().includes('Correction saved and logged'), 'the correction to save');
ok(true, 'a mark corrected inside the 48-hour window, with a reason');

step(3, 'A student checks where they stand and asks for leave');
await signOut();
await signIn('cse-b10');
const studentHome = text();
ok(/Your attendance/.test(studentHome), 'student sees their own percentage');
ok(/Attend \d+ more class/.test(studentHome), 'the calculator tells them what it takes', studentHome.slice(0, 160));
ok(!/can skip|may skip/i.test(studentHome), 'and never how many they can skip');

await goTo('Leave desk');
await until(() => field('From'), 'the leave form');
type(field('From'), tomorrow);
type(field('To'), tomorrow);
type(field('Reason'), 'Viral fever, doctor advised one day of rest.');

// A camera capture arrives as a File on a hidden input, exactly as on a phone.
const fileInput = all('input[type="file"]').at(-1);
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const file = new dom.window.File([png], 'certificate.png', { type: 'image/png' });
Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await until(() => text().includes('Certificate attached'), 'the certificate to upload');
ok(true, 'medical certificate uploaded from the file picker');

btnLike('Send request').click();
await until(() => text().includes('pending'), 'the request to appear');
ok(true, 'leave request submitted');

step(4, 'The HOD approves it and the register updates itself');
await signOut();
await signIn('hod');
await goTo('Leave desk');
await until(() => btn('Approve'), 'the pending request');
ok(text().includes('View medical certificate'), 'the certificate is there to check');
type(field('Note'), 'Certificate verified');
btn('Approve').click();
const approved = await until(() => (/periods marked as leave/.test(text()) ? text() : null), 'the approval to apply');
ok(/\d+ periods marked as leave/.test(approved), 'approval writes leave across the day', approved.match(/Approved\..{0,70}/)?.[0]);

step(5, 'The certificate is viewable, and the decision can be undone');
const viewer = btn('View medical certificate');
ok(!!viewer, 'the certificate opens through an authorised request, not a public link');
viewer.click();
await sleep(600);
ok(!/could not be opened|Only this student/.test(text()), 'the HOD is allowed to open it', text().slice(0, 140));

// The approver changes their mind — the register has to follow.
await goTo('Leave desk');
btn('approved').click();
await until(() => btn('Change this decision'), 'the decided request');
btn('Change this decision').click();
await until(() => field('Reason'), 'the revision form');
type(field('Reason'), 'Certificate was for a different date');
btnLike('Change to rejected').click();
const reversed = await until(() => (/leave periods removed/.test(text()) ? text() : null), 'the reversal');
ok(/\d+ leave periods removed/.test(reversed), 'reversing an approval clears the leave it wrote',
  reversed.match(/Changed to rejected\..{0,60}/)?.[0]);

step(6, 'A mentor runs a club event that credits a class');
await signOut();
await signIn('mentor');
await goTo('Clubs');
await until(() => btn('Create'), 'the club page');
type(field('Name'), 'Robotics Club');
btn('Create').click();
await until(() => text().includes('Robotics Club'), 'the new club');
ok(true, 'mentor creates a club');

await until(() => field('Student login ID'), 'the member form');
type(field('Student login ID'), 'cse-b9');
btn('Add member').click();
await until(() => text().includes('cse-b9'), 'the new member');
ok(true, 'mentor adds a member by login ID');

await goTo('Events');
await until(() => field('Title'), 'the event form');
type(field('Title'), 'State Robotics Meet');
type(field('Date'), today);
choose(field('Who can see it'), 'Club members only');
await sleep(200);
choose(field('Club'), (o) => o.textContent.includes('Robotics'));
all('.marks button').find((b) => b.textContent.trim() === '3').click();
await sleep(120);
btn('Post event').click();
await until(() => text().includes('Event posted'), 'the event to post');
ok(text().includes('credits period 3'), 'event posted with a credit period', text().match(/credits period[^·]{0,20}/)?.[0]);

step(7, 'The student joins and the credit overrides the absence');
await signOut();
await signIn('cse-b9');
await goTo('Events');
await until(() => btn('Ask to join'), 'the members-only event to be visible');
ok(true, 'club member can see a members-only event');
btn('Ask to join').click();
await until(() => text().includes('Request sent'), 'the join request');

await signOut();
await signIn('mentor');
await goTo('Events');
await until(() => btnLike('Review join requests'), 'the review control');
btnLike('Review join requests').click();
await until(() => btn('Approve'), 'the pending join request');
btn('Approve').click();
const credited = await until(() => (/period\(s\) credited/.test(text()) ? text() : null), 'the credit to apply');
ok(/overriding a teacher/.test(credited), 'the override is reported, not silent', credited.match(/Approved\..{0,90}/)?.[0]);

step(8, 'The HOD sees everything that happened');
await signOut();
await signIn('hod');
await goTo('Activities');
await until(() => text().includes('attendance.saved'), 'the audit trail');
const audit = text();
for (const action of ['attendance.saved', 'attendance.edited', 'leave.approved', 'leave.document_viewed', 'leave.decision_revised', 'attendance.credit_override', 'club.member_added', 'event.created']) {
  ok(audit.includes(action), `audit trail shows ${action}`);
}
ok(audit.includes('Arrived late, was in class'), 'the correction reason is on the record');

step(9, 'And exports the students who are behind');
await goTo('Records');
await until(() => all('select').length > 0, 'the records page');
choose(all('select')[0], (o) => o.textContent.includes('B.Tech'));
await until(() => all('tbody tr').length > 0, 'the register');
ok(all('tbody tr').length >= 20, `every student listed (${all('tbody tr').length})`, all('tbody tr').length);
ok(all('tr.flagged').length > 0, 'students under the minimum are flagged', `${all('tr.flagged').length} flagged`);

btn('Export under minimum').click();
await until(() => text().includes('downloaded'), 'the export');
ok(downloads.some((d) => d && d.includes('below-minimum')), 'a filtered CSV was downloaded', downloads.join(', '));

/* ---------- verdict ---------- */
console.error = out;
const realErrors = consoleErrors.filter((e) => !/Future Flag|not wrapped in act|Not implemented/.test(e));
if (realErrors.length) { fail += 1; out(`\n  FAIL console errors: ${realErrors[0].slice(0, 200)}`); }

out(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
