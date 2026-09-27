/**
 * Mounts the real React app inside jsdom, signed in as each role, and walks
 * every page in that role's sidebar. Fails on a thrown render, a React error,
 * or a page that never gets past its loading state.
 *
 *   node test/render.mjs        (needs the API running; set API_ORIGIN to point elsewhere)
 */
import { JSDOM } from 'jsdom';

const API = process.env.API_ORIGIN || 'http://127.0.0.1:4000';
const PAGES = {
  admin: ['/', '/accounts', '/records', '/analytics', '/schedule', '/leave', '/events', '/clubs', '/notifications', '/setup', '/activities', '/guide', '/profile'],
  hod: ['/', '/records', '/analytics', '/schedule', '/leave', '/events', '/clubs', '/notifications', '/setup', '/activities', '/guide', '/profile'],
  teacher: ['/', '/attendance', '/records', '/analytics', '/schedule', '/leave', '/events', '/notifications', '/setup', '/guide', '/profile'],
  student: ['/', '/analytics', '/schedule', '/leave', '/events', '/notifications', '/guide', '/profile'],
  mentor: ['/', '/events', '/clubs', '/notifications', '/guide', '/profile'],
};
const LOGINS = { admin: 'admin', hod: 'hod', teacher: 'ravi', student: 'cse-b1', mentor: 'mentor' };
// The administrator is made by the first-run suite, not the seed, so it has its
// own password.
const PASSWORDS = { admin: 'admin-password-1' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${API}/`, pretendToBeVisual: true,
});

const problems = [];
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
g.IS_REACT_ACT_ENVIRONMENT = false;

// Relative /api paths need an origin once we are outside a browser.
const nodeFetch = fetch;
g.fetch = (input, init) => nodeFetch(typeof input === 'string' && input.startsWith('/') ? API + input : input, init);
dom.window.fetch = g.fetch;

// The app calls reload() on a 401; jsdom does not implement it, so swallow the
// resulting "not implemented" noise rather than treating it as a render fault.
let reloaded = false;
dom.virtualConsole.on('jsdomError', (e) => {
  if (/Not implemented: navigation/.test(e.message)) reloaded = true;
  else problems.push(`jsdom: ${e.message}`);
});

const realError = console.error;
let consoleErrors = [];
console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')); };
dom.window.addEventListener('error', (e) => problems.push(`window error: ${e.message}`));
process.on('unhandledRejection', (e) => problems.push(`unhandled: ${e?.message || e}`));

const { mount } = await import('../dist-test/smoke-entry.js');

const login = async (loginId, password = 'password123') => {
  const res = await nodeFetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${loginId}`);
  return (await res.json()).token;
};

let pass = 0;
let fail = 0;

for (const [role, paths] of Object.entries(PAGES)) {
  const token = await login(LOGINS[role], PASSWORDS[role]);
  realError(`\n${role} (${LOGINS[role]})`);

  for (const path of paths) {
    sessionStorage.setItem('attendance.token', token);
    consoleErrors = [];
    const host = document.getElementById('root');
    const root = mount(host, path);
    await sleep(700);
    const text = host.textContent || '';
    const html = host.innerHTML || '';
    root.unmount();

    const stillLoading = /^\s*(Loading|Signing you in)/.test(text.trim()) || text.trim() === '';
    const reactErrors = consoleErrors.filter((e) => !/not wrapped in act|ReactDOMTestUtils/.test(e));

    if (reactErrors.length) {
      fail += 1;
      realError(`  FAIL ${path} — ${reactErrors[0].slice(0, 220)}`);
    } else if (stillLoading) {
      fail += 1;
      realError(`  FAIL ${path} — never rendered past loading (${text.slice(0, 80)})`);
    } else if (!/Attendance/.test(html)) {
      fail += 1;
      realError(`  FAIL ${path} — shell missing`);
    } else {
      pass += 1;
      realError(`  ok   ${path} — ${text.replace(/\s+/g, ' ').slice(60, 150)}`);
    }
  }
}

console.error = realError;
if (reloaded) console.error('\nnote: the app triggered a reload (a 401 slipped through)');
for (const p of problems) console.error('problem:', p);
console.error(`\n${pass} pages rendered, ${fail} failed\n`);
process.exit(fail || problems.length ? 1 : 0);
