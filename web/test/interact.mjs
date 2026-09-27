/**
 * Drives the marking screen the way a teacher does — pick the class from the
 * cascading selects, tap the roster, hit Save — and then checks the API agrees.
 * This is the wiring the render pass cannot prove: payload shape, select
 * plumbing, and the save round trip.
 *
 *   node test/interact.mjs      (needs the API running; set API_ORIGIN to point elsewhere)
 */
import { JSDOM } from 'jsdom';

const API = process.env.API_ORIGIN || 'http://127.0.0.1:4000';
const DATE = '2026-09-15'; // a Tuesday
const PERIOD = '3';        // ravi teaches CSE-B period 3 every day in the seed

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log('  ok  ', label); }
  else { fail += 1; console.log('  FAIL', label, extra ? String(extra).slice(0, 200) : ''); }
};

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${API}/`, pretendToBeVisual: true,
});
const g = globalThis;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
g.sessionStorage = dom.window.sessionStorage;
g.localStorage = dom.window.localStorage;
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MutationObserver = dom.window.MutationObserver;
g.requestAnimationFrame = (fn) => setTimeout(fn, 0);
g.cancelAnimationFrame = clearTimeout;

const nodeFetch = fetch;
g.fetch = (input, init) => nodeFetch(typeof input === 'string' && input.startsWith('/') ? API + input : input, init);
dom.window.fetch = g.fetch;

const consoleErrors = [];
const realError = console.error;
console.error = (...a) => consoleErrors.push(a.map(String).join(' '));

const call = async (method, path, token, body) => {
  const res = await nodeFetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};

const token = (await call('POST', '/api/auth/login', null, { loginId: 'ravi', password: 'password123' })).token;
sessionStorage.setItem('attendance.token', token);

const { mount } = await import('../dist-test/smoke-entry.js');
const host = document.getElementById('root');
mount(host, '/attendance');
await sleep(600);

// --- pick the class through the real selects -----------------------------
const selects = () => [...host.querySelectorAll('select')];
const setSelect = async (index, value) => {
  const el = selects()[index];
  el.value = value;
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await sleep(350);
};
// React tracks a controlled input's value itself, so assigning el.value is
// invisible to it. Go through the native setter, the way a real keystroke does.
const type = (el, value) => {
  const proto = el.tagName === 'TEXTAREA'
    ? dom.window.HTMLTextAreaElement.prototype
    : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};
const setInput = async (selector, value) => {
  type(host.querySelector(selector), value);
  await sleep(350);
};

ok(selects().length === 3, 'course, section and period pickers plus a date field', selects().length);

const courseId = [...selects()[0].options].find((o) => o.value)?.value;
await setSelect(0, courseId);
const sectionOption = [...selects()[1].options].find((o) => o.textContent === 'CSE-B');
ok(!!sectionOption, 'sections loaded after picking a course');
await setSelect(1, sectionOption.value);
await setInput('input[type="date"]', DATE);
await setSelect(2, PERIOD);
await sleep(800);

const lines = () => [...host.querySelectorAll('.register .line')];
// Derived, not hard-coded: other suites may have added students to this section.
const rosterSize = lines().length;
ok(rosterSize >= 10, `roster rendered ${rosterSize} students`, rosterSize);
ok(/B001/.test(host.textContent), 'roll numbers shown');

// --- mark the roster ----------------------------------------------------
const markAll = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Mark all present');
markAll.click();
await sleep(200);
ok(lines().filter((l) => l.className.includes('is-present')).length === rosterSize, 'mark-all-present tints every row');

// flip the last two students to absent through their own buttons
for (const line of lines().slice(-2)) {
  [...line.querySelectorAll('button')].find((b) => b.dataset.status === 'absent').click();
  await sleep(80);
}
await sleep(150);
ok(lines().filter((l) => l.className.includes('is-absent')).length === 2, 'two rows flipped to absent');
ok(new RegExp(`${rosterSize - 2} present · 2 absent`).test(host.textContent.replace(/\s+/g, ' ')),
  'the tally counts what is on screen', host.textContent.replace(/\s+/g, ' ').slice(0, 120));

const save = [...host.querySelectorAll('button')].find((b) => b.textContent.startsWith('Save attendance'));
save.click();
await sleep(1200);
ok(new RegExp(`Saved ${rosterSize} students`).test(host.textContent), 'save confirmed in the UI', host.textContent.slice(0, 120));

// --- does the database agree? ------------------------------------------
const roster = await call('GET', `/api/attendance/roster?sectionId=${sectionOption.value}&classDate=${DATE}&periodNumber=${PERIOD}`, token);
const statuses = roster.students.map((s) => s.status);
ok(statuses.filter((s) => s === 'present').length === rosterSize - 2
  && statuses.filter((s) => s === 'absent').length === 2,
  `the API returns ${rosterSize - 2} present and 2 absent`, JSON.stringify(statuses));

// --- correct one mark, with a reason -----------------------------------
const correct = [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Correct');
ok(correct.length === rosterSize, 'every saved row offers a correction', correct.length);
correct.at(-1).click();
await sleep(250);
const reason = [...host.querySelectorAll('input')].find((i) => i.placeholder === 'Marked by mistake');
ok(!!reason, 'the correction panel asks for a reason');
type(reason, 'Late arrival, was present');
await sleep(150);
const saveCorrection = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save correction');
saveCorrection.click();
await sleep(1000);
ok(/Correction saved and logged/.test(host.textContent), 'correction confirmed', host.textContent.slice(0, 120));

const hod = (await call('POST', '/api/auth/login', null, { loginId: 'hod', password: 'password123' })).token;
const log = await call('GET', '/api/activity?action=attendance.edited', hod);
ok(log.some((r) => r.reason === 'Late arrival, was present'), 'the correction reached the audit trail with its reason');

console.error = realError;
const realProblems = consoleErrors.filter((e) => !/Future Flag|not wrapped in act/.test(e));
if (realProblems.length) console.log('  FAIL console errors:', realProblems[0].slice(0, 200));
console.log(`\n${pass} passed, ${fail + (realProblems.length ? 1 : 0)} failed\n`);
process.exit(fail || realProblems.length ? 1 : 0);
