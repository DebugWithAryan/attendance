// Same walk as test/render.mjs, but against the demo's in-browser API, so the
// published link is verified before it goes out.
import { JSDOM } from 'jsdom';

const PAGES = {
  hod: ['/', '/records', '/analytics', '/schedule', '/leave', '/events', '/clubs', '/notifications', '/setup', '/activities', '/profile'],
  teacher: ['/', '/attendance', '/records', '/analytics', '/schedule', '/leave', '/events', '/notifications', '/setup', '/profile'],
  student: ['/', '/analytics', '/schedule', '/leave', '/events', '/notifications', '/profile'],
  mentor: ['/', '/events', '/clubs', '/notifications', '/profile'],
};
const LOGINS = { hod: 'hod', teacher: 'ravi', student: 'cse-b1', mentor: 'mentor' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://demo.local/', pretendToBeVisual: true });
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
dom.window.fetch = async () => { throw new Error('unmocked'); };

const errors = [];
const real = console.error;
console.error = (...a) => errors.push(a.map(String).join(' '));

const { mount } = await import('../dist-demo-ssr/smoke-entry.js');
// In a browser, window.fetch *is* globalThis.fetch; under Node they differ, so
// point the global at the mock the bundle just installed on window.
g.fetch = dom.window.fetch;

let pass = 0; let fail = 0;
for (const [role, paths] of Object.entries(PAGES)) {
  const res = await dom.window.fetch('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId: LOGINS[role], password: 'password123' }),
  });
  const { token } = await res.json();
  real(`\n${role}`);
  for (const path of paths) {
    sessionStorage.setItem('attendance.token', token);
    errors.length = 0;
    const host = document.getElementById('root');
    const root = mount(host, path);
    await sleep(700);
    const text = (host.textContent || '').trim();
    root.unmount();
    const bad = errors.filter((e) => !/Future Flag|not wrapped in act/.test(e));
    if (bad.length) { fail += 1; real(`  FAIL ${path} — ${bad[0].slice(0, 200)}`); }
    else if (!text || /^(Loading|Signing you in)/.test(text)) { fail += 1; real(`  FAIL ${path} — stuck loading`); }
    else { pass += 1; real(`  ok   ${path} — ${text.replace(/\s+/g, ' ').slice(55, 135)}`); }
  }
}
console.error = real;
console.log(`\n${pass} demo pages rendered, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
