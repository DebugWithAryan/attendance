/**
 * The empty-deployment check.
 *
 * A fresh install has one HOD and nothing else, and that is exactly the state
 * nobody tests until a real person signs in and finds a blank page. This walks
 * the HOD overview on an empty database and checks it tells them what to do.
 *
 *   API_ORIGIN=http://127.0.0.1:4001 node test/first-run.mjs
 *
 * Point it at a database that has been migrated but NOT seeded, with a single
 * HOD whose password is below.
 */
import { JSDOM } from 'jsdom';
const API = process.env.API_ORIGIN || 'http://127.0.0.1:4001';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `${API}/`, pretendToBeVisual: true });
const g = globalThis;
g.window = dom.window; g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
for (const k of ['sessionStorage','localStorage','HTMLElement','Element','Node','Event','MutationObserver','File','FileReader','Blob','FormData']) g[k] = dom.window[k];
g.requestAnimationFrame = (fn) => setTimeout(fn, 0); g.cancelAnimationFrame = clearTimeout;
const nodeFetch = fetch;
g.fetch = (i, o) => nodeFetch(typeof i === 'string' && i.startsWith('/') ? API + i : i, o);
dom.window.fetch = g.fetch;
const errs = []; const real = console.error; console.error = (...a) => errs.push(a.join(' '));
const { mount } = await import('../dist-test/smoke-entry.js');
const { token } = await (await nodeFetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId: 'hod', password: process.env.HOD_PASSWORD || 'a-real-password-here' }) })).json();
sessionStorage.setItem('attendance.token', token);
const host = document.getElementById('root');
mount(host, '/');
await new Promise((r) => setTimeout(r, 1200));
console.error = real;
const text = host.textContent.replace(/\s+/g, ' ');
const items = [...host.querySelectorAll('.checklist li')];
let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log('  ok  ', l); } else { fail++; console.log('  FAIL', l, x || ''); } };
ok(text.includes('Finish setting up the department'), 'the empty overview leads with what to do next');
ok(items.length === 8, 'all eight setup steps are listed', items.length);
ok(items[0].className.includes('next'), 'the first incomplete step is marked as next');
ok(items.every((li) => li.querySelector('.why')), 'each step explains why it has to happen');
ok(text.includes('0 of 8 done'), 'progress is stated', text.match(/\d of \d done/)?.[0]);
ok(!!items[0].querySelector('a'), 'the next step is a link, not just advice');
ok(text.includes('No attendance has been marked yet'), 'the averages table explains its own emptiness');
ok(errs.filter((e) => !/Future Flag|not wrapped in act/.test(e)).length === 0, 'no console errors', errs[0]);
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
