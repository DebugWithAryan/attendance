/**
 * Photographs the demo college for the user manual, into web/public/manual/.
 *
 * Needs the app running against a demo database, with DEMO_MODE on:
 *
 *   export DATABASE_URL=postgres://…/attendance_demo MANUAL_DATE=2026-09-28   # any Monday
 *   node server/src/infra/db/migrate.js
 *   node --import ./scripts/manual/clock.mjs server/src/infra/db/seed-demo.js --reset
 *   DEMO_MODE=1 PORT=4000 node --import ./scripts/manual/clock.mjs scripts/vercel-sim.mjs &
 *   npm --prefix web run build && (cd web && npx vite preview --port 5173) &
 *   node scripts/manual/screenshots.mjs
 *   node scripts/manual/pdf.mjs
 *
 * MANUAL_DATE shifts the server's clock and the browser's to a weekday, so
 * "today" has classes in the pictures whenever the manual is regenerated.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';
import { shiftSource } from './clock.mjs';

const ORIGIN = process.env.MANUAL_ORIGIN || 'http://127.0.0.1:5173';
const DATE = process.env.MANUAL_DATE;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'public', 'manual');
const only = process.argv[2];
mkdirSync(OUT, { recursive: true });

// Helpers the steps below call inside the page. React only notices a value
// set through the element's native setter, so typing goes through it.
const HELPERS = `window.__m = {
  btn: (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t),
  click(t) { const b = this.btn(t) || [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t)); if (!b) throw new Error('no button ' + t); b.click(); },
  field: (label) => [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(label))?.querySelector('input,select,textarea'),
  choose(label, match) {
    const s = this.field(label); if (!s) throw new Error('no field ' + label);
    const o = [...s.options].find((x) => x.textContent.trim() === match) || [...s.options].find((x) => x.textContent.includes(match));
    if (!o) throw new Error('no option ' + match); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
  },
  type(label, value) {
    const el = this.field(label); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  },
  target(selector, text) {
    document.getElementById('shot-target')?.removeAttribute('id');
    const el = [...document.querySelectorAll(selector)].find((p) => !text || p.textContent.includes(text));
    // Left at the top of the page: scrolled, the sticky top bar would sit over the clipped panel.
    if (!el) throw new Error('no ' + selector + ' containing ' + text); el.id = 'shot-target'; window.scrollTo(0, 0); return true;
  },
};`;

const page = await launch({ width: 1200, height: 820 });
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `${DATE ? shiftSource(DATE) : ''}\n${HELPERS}` });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const signIn = async (loginId) => {
  const res = await fetch(`${ORIGIN}/api/demo/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId }),
  });
  if (!res.ok) throw new Error(`demo sign-in failed for ${loginId}: is DEMO_MODE on and seed:demo run?`);
  const { token } = await res.json();
  await page.goto(`${ORIGIN}/welcome`);
  await page.eval(`sessionStorage.setItem('attendance.token', ${JSON.stringify(token)})`);
};
const signOut = async () => { await page.goto(`${ORIGIN}/welcome`); await page.eval('sessionStorage.clear()'); };

/** name, path, text to wait for, then optional steps; `clip` photographs #shot-target only. */
async function shot(name, path, waitFor, { steps = [], clip = false, full = false, settle = 600 } = {}) {
  if (only && !name.includes(only)) return;
  await page.goto(`${ORIGIN}${path}`);
  if (waitFor) await page.waitForText(waitFor);
  for (const s of steps) {
    if (typeof s === 'number') await sleep(s);
    else if (s.wait) await page.waitForText(s.wait);
    else await page.eval(s);
  }
  await sleep(settle);
  const bytes = await page.screenshot({ quality: 74, fullPage: full, clipSelector: clip ? '#shot-target' : null });
  writeFileSync(join(OUT, `${name}.jpg`), bytes);
  console.log(`  ${name}.jpg  ${Math.round(bytes.length / 1024)} KB`);
}

try {
  console.log(`photographing ${ORIGIN}${DATE ? ` as of ${DATE}` : ''}`);
  await signOut();
  await shot('welcome', '/welcome', 'Try it with a demo account', { settle: 1200 });
  await shot('sign-in', '/', 'Or try a demo account');

  await signIn('demo.student');
  await shot('student-overview', '/', 'Your attendance', { full: true });
  await shot('student-analytics', '/analytics', 'Attendance from events', { full: true });
  await shot('student-events', '/events', 'B-Plan', { steps: ["__m.target('.panel', 'Inter-college B-Plan Contest')"], clip: true });
  await shot('student-leave', '/leave', 'Apply');
  await shot('student-schedule', '/schedule', 'Mon', { full: true });

  await signIn('demo.teacher');
  await shot('teacher-overview', '/', 'Your classes today');
  await shot('teacher-attendance', '/attendance', 'Pick the class', {
    steps: [
      "__m.choose('Course', 'BBA')", 400, "__m.choose('Section', 'D2')", 300,
      ...(DATE ? [`__m.type('Date', '${DATE}')`, 300] : []),
      "__m.choose('Period', 'Period 1')", { wait: 'students' },
      "__m.click('Mark all present')", 200,
      "[...document.querySelectorAll('.register .line')].slice(2, 4).forEach((l) => [...l.querySelectorAll('button')].find((b) => b.dataset.status === 'absent').click())",
    ],
    // The visible screen, with the save bar where a teacher sees it.
  });

  await signIn('demo.hod');
  await shot('hod-overview', '/', 'Classes held', { full: true });
  await shot('hod-schedule', '/schedule', 'periods allocated', { full: true, settle: 1000 });
  await shot('hod-week', '/schedule', 'periods allocated', {
    steps: ["__m.click('Timings')", 300, "__m.target('.week-settings')"], clip: true,
  });
  await shot('hod-allocate', '/schedule', 'periods allocated', {
    steps: [
      "[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Change D2, Wednesday, period 1')).click()",
      300, "__m.target('.panel', 'Change D2')",
    ],
    clip: true,
  });
  await shot('hod-cancel', '/schedule', 'periods allocated', {
    steps: ["__m.click('Cancel classes')", 400, "__m.type('Reason', 'College closed for heavy rain')", "__m.target('.cancel-panel')"],
    clip: true,
  });
  await shot('hod-records', '/records', 'Pick a course', { steps: ["__m.choose('Course', 'BBA')", { wait: 'students' }] });
  await shot('hod-leave', '/leave', 'Rohit Nair');
  await shot('hod-setup', '/setup', 'Courses', { steps: ["__m.choose('Working on course', 'BBA')", 800] });
  await shot('hod-events', '/events', 'Tech Fest 2026', { steps: ["__m.target('.panel', 'Tech Fest 2026')"], clip: true });

  await signIn('demo.mentor');
  await shot('mentor-events', '/events', 'Case Study Challenge', {
    steps: [
      "__m.target('.panel', 'Case Study Challenge')",
      "[...document.querySelector('#shot-target').querySelectorAll('button')].find((b) => b.textContent.startsWith('Review join requests')).click()",
      500,
      "[...document.querySelector('#shot-target').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add attendance').click()",
      500,
    ],
    clip: true,
  });

  await signIn('demo.admin');
  await shot('admin-accounts', '/accounts', 'Create an account');
  await shot('guide-share', '/guide', 'Share the app', { steps: [1000, "__m.target('.qr-share')"], clip: true });

  await page.viewport(390, 844, { mobile: true, scale: 2 });
  await signIn('demo.student');
  await shot('phone-student', '/', 'Your attendance');
  await signIn('demo.teacher');
  await shot('phone-teacher', '/', 'Your classes today');
} finally {
  await page.close();
}
