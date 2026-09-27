/**
 * The new screens, driven through the real UI in jsdom against the live API:
 * building a timetable for a section that has nothing in it yet, shaping the
 * week, the QR code and the introduction page it leads to, cancelling a class
 * from the marking screen, event credits on a student's card, and the badge.
 *
 *   API_ORIGIN=http://127.0.0.1:4001 node test/features.mjs
 *
 * Needs the seeded department; creates what else it needs itself.
 */
import { JSDOM } from 'jsdom';
import jsQR from 'jsqr';

const API = process.env.API_ORIGIN || 'http://127.0.0.1:4001';
let pass = 0;
let fail = 0;
const out = console.error;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; out('  ok  ', label); }
  else { fail += 1; out('  FAIL', label, extra === undefined ? '' : String(extra).slice(0, 300)); }
};
const step = (n, label) => out(`\n${n}. ${label}`);

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `${API}/`, pretendToBeVisual: true });
const g = globalThis;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
for (const k of ['sessionStorage', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver']) g[k] = dom.window[k];
g.requestAnimationFrame = (fn) => setTimeout(fn, 0);
g.cancelAnimationFrame = clearTimeout;
const nodeFetch = fetch;
g.fetch = (input, init) => nodeFetch(typeof input === 'string' && input.startsWith('/') ? API + input : input, init);
dom.window.fetch = g.fetch;
const consoleErrors = [];
console.error = (...a) => consoleErrors.push(a.map(String).join(' '));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = () => document.getElementById('root');
const all = (sel) => [...host().querySelectorAll(sel)];
const text = () => (host().textContent || '').replace(/\s+/g, ' ');
async function until(predicate, label, timeout = 8000) {
  const started = Date.now();
  for (;;) {
    const hit = predicate();
    if (hit) return hit;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}\n  page said: ${text().slice(0, 400)}`);
    await sleep(60);
  }
}
const btn = (label) => all('button').find((b) => b.textContent.trim() === label);
const field = (labelText) => all('label').find((l) => l.textContent.trim().startsWith(labelText))?.querySelector('input, textarea, select');
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
};

const call = async (method, path, token, body) => {
  const res = await nodeFetch(`${API}/api${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};
const tokenFor = async (loginId) => (await call('POST', '/auth/login', null, { loginId, password: 'password123' })).token;

const { mount } = await import('../dist-test/smoke-entry.js');
let root = null;
const open = async (path, token) => {
  if (root) root.unmount();
  if (token) sessionStorage.setItem('attendance.token', token); else sessionStorage.clear();
  root = mount(host(), path);
  await sleep(400);
};

const hod = await tokenFor('hod');

step(1, 'The HOD builds a timetable for a section that has nothing in it');
const stamp = Date.now().toString(36).slice(-4);
const course = await call('POST', '/courses', hod, { name: `Omega Studies ${stamp}` });
await call('POST', '/sections', hod, { courseId: course.id, name: 'O1' });
await call('POST', '/subjects', hod, { courseId: course.id, name: 'Omega Basics' });

await open('/schedule', hod);
await until(() => field('Course'), 'the course picker');
await until(() => [...field('Course').options].some((o) => o.textContent.includes('Omega Studies')), 'the new course in the picker');
choose(field('Course'), (o) => o.textContent.includes(`Omega Studies ${stamp}`));
const addButtons = () => all('button').filter((b) => b.textContent.trim() === 'add');
await until(() => addButtons().length > 0, 'the empty grid');
ok(addButtons().length === 48, `every period of an empty section offers "add" (${addButtons().length} of 6 days x 8 periods)`);
ok(text().includes('Nothing allocated yet'), 'and the page says what to do');

addButtons()[0].click();
await until(() => btn('Save period'), 'the allocation form');
ok(/Allocate O1 · Monday · period 1/.test(text()), 'the form opens under the grid it was tapped in, naming the period');
choose(field('Subject'), 'Omega Basics');
choose(field('Teacher'), (o) => o.textContent.startsWith('Joseph Thomas'));
btn('Save period').click();
await until(() => text().includes('O1, Monday period 1: Omega Basics with Joseph Thomas.'), 'the save to confirm');
ok(all('.timetable td').some((td) => td.textContent.includes('Omega Basics') && td.textContent.includes('Joseph Thomas')),
  'the period shows its subject and teacher');
ok(addButtons().length === 47, 'and is no longer empty');

choose(field('Days a week'), 'Monday–Friday');
choose(field('Periods a day'), '4');
btn('Timings').click();
await until(() => field('Period 1'), 'the timings form');
type(field('Period 1'), '9:30–10:30');
choose(field('Break after'), 'Period 2');
btn('Save week').click();
await until(() => text().includes('now runs Monday to Friday, 4 periods a day'), 'the week to save');
ok(addButtons().length === 19, `the grid follows the new week (${addButtons().length} empty of 5 x 4)`);
ok(all('.timetable thead th').some((th) => th.textContent.includes('9:30–10:30')), 'with the time printed under its period');
ok(all('.timetable td.break').length === 5, 'and the break shown on every day');

step(2, 'The QR code on the Guide page opens the introduction page');
await open('/guide', hod);
const svg = await until(() => host().querySelector('svg.qr path'), 'the QR code to be drawn');
const box = Number(host().querySelector('svg.qr').getAttribute('viewBox').split(' ')[2]);
const dark = new Set([...svg.getAttribute('d').matchAll(/M(\d+),(\d+)/g)].map((m) => `${m[1]},${m[2]}`));
const scale = 6;
const size = box * scale;
const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    if (dark.has(`${Math.floor(x / scale)},${Math.floor(y / scale)}`)) {
      const i = (y * size + x) * 4;
      pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0;
    }
  }
}
const decoded = jsQR(pixels, size, size);
ok(decoded?.data === `${API}/welcome`, `a phone scanning it lands on ${API}/welcome`, decoded?.data);
ok(all('a').some((a) => a.getAttribute('href') === '/user-manual.pdf'), 'the manual can be downloaded from the Guide');

step(3, 'The introduction page needs no account');
await open('/welcome', null);
await until(() => text().includes('What it does'), 'the introduction page');
ok(text().includes('The college attendance register, on every phone.'), 'it says what the app is');
ok(all('a').some((a) => a.getAttribute('href') === '/user-manual.pdf' && a.hasAttribute('download')), 'it offers the manual as a download');
ok(all('a').some((a) => a.textContent.trim() === 'Sign in'), 'and a way to sign in');
ok(!text().includes('Try it with a demo account'), 'with no demo accounts unless the deployment runs DEMO_MODE');

step(4, 'A teacher cancels a class from the marking screen, then takes it back');
const ravi = await tokenFor('ravi');
await open('/attendance', ravi);
await until(() => all('select').length >= 3 && all('select')[0].options.length > 1, 'the attendance pickers');
choose(all('select')[0], (o) => o.textContent.includes('B.Tech'));
await until(() => [...all('select')[1].options].some((o) => o.textContent === 'CSE-B'), 'the sections');
choose(all('select')[1], 'CSE-B');
type(host().querySelector('input[type="date"]'), '2027-03-08');
await sleep(150);
choose(all('select')[2], 'Period 3');
await until(() => all('.register .line').length > 0, 'the roster');
all('button').find((b) => b.textContent.includes('Cancel it instead')).click();
await until(() => field('Why is this class not happening?'), 'the reason field');
type(field('Why is this class not happening?'), 'Invigilating an exam');
btn('Cancel this class').click();
await until(() => text().includes('This class is cancelled.'), 'the class to be cancelled');
ok(text().includes('Invigilating an exam'), 'the register explains why');
ok(all('.register .line').length === 0, 'and offers nothing to mark');
btn('Restore this class').click();
await until(() => all('.register .line').length > 0, 'the register to come back');
ok(text().includes('The class is back on'), 'restoring it brings the register back');

step(5, 'A student sees exactly what an event credited');
const mentor = await tokenFor('mentor');
const expo = await call('POST', '/events', mentor, { title: `UI Expo ${stamp}`, eventDate: '2027-03-12', creditPeriods: [3, 7] });
await call('POST', `/events/${expo.id}/attendance`, mentor, { loginIds: ['cse-b7'] });
await open('/events', await tokenFor('cse-b7'));
await until(() => text().includes(`UI Expo ${stamp}`), 'the event');
const card = all('.panel').find((p) => p.textContent.includes(`UI Expo ${stamp}`)).textContent.replace(/\s+/g, ' ');
ok(/Attendance credited: period 3 · \S/.test(card), 'the credited period is named, with its class', card.slice(0, 200));
ok(card.includes('Period 7 not credited: no class scheduled in this period'), 'and the period that could not be credited says why');

step(6, 'The badge, where the student can see it');
const cseB = (await call('GET', '/courses', hod)).find((c) => c.name.startsWith('B.Tech'));
const rows = await call('GET', `/records?courseId=${cseB.id}`, hod);
const star = rows.find((r) => r.badge && /^cse-b\d+$/.test(r.login_id));
if (!star) {
  ok(false, 'a seeded student with the badge to look at', rows.map((r) => `${r.login_id}:${r.percentage}`).join(' '));
} else {
  const starToken = await tokenFor(star.login_id);
  await open('/', starToken);
  await until(() => text().includes('Your attendance'), 'the student overview');
  ok(text().includes('90%+ attendance') && !!host().querySelector('.seal'), `${star.login_id} (${star.percentage}%) sees the badge`);
  await open('/analytics', starToken);
  await until(() => text().includes('Subject detail'), 'the analytics page');
  ok(text().includes('Not marked') && text().includes('classes held for you'), 'analytics counts against the classes held');
}

root?.unmount();
console.error = out;
const realErrors = consoleErrors.filter((e) => !/Future Flag|not wrapped in act|Not implemented/.test(e));
if (realErrors.length) { fail += 1; out(`\n  FAIL console errors: ${realErrors[0].slice(0, 300)}`); }
out(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
