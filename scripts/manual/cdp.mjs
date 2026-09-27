/**
 * Just enough of the Chrome DevTools Protocol to drive a headless Chromium:
 * open a page, run script in it, wait for text, take a screenshot, print a
 * PDF. No dependencies: Node 22's built-in WebSocket and fetch do the work.
 *
 * Used by scripts/manual/*.mjs to photograph the app for the user manual and
 * to print the manual itself.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1280, height = 800 } = {}) {
  if (typeof WebSocket === 'undefined') throw new Error('Needs Node 22 or later (built-in WebSocket).');
  const executable = CANDIDATES.find((p) => existsSync(p));
  if (!executable) throw new Error('No Chromium found. Set CHROMIUM_PATH to a Chrome or Chromium binary.');

  const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(executable, [
    '--headless=new', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu',
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--font-render-hinting=none', '--disable-background-networking', '--disable-component-update',
    `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore' });

  let target;
  for (let i = 0; i < 100 && !target; i += 1) {
    await sleep(100);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
  }
  if (!target) { proc.kill(); throw new Error('Chromium did not start.'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(`${data.error.message}`)); else resolve(data.result);
    } else if (data.method && listeners.has(data.method)) {
      for (const fn of listeners.get(data.method)) fn(data.params);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const once = (method) => new Promise((resolve) => {
    const fn = (params) => { listeners.set(method, (listeners.get(method) || []).filter((f) => f !== fn)); resolve(params); };
    listeners.set(method, [...(listeners.get(method) || []), fn]);
  });

  await send('Page.enable');
  await send('Runtime.enable');

  const page = {
    send,
    async viewport(w, h, { mobile = false, scale = 1 } = {}) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile });
    },
    async colorScheme(scheme) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    },
    async goto(url) {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url });
      await Promise.race([loaded, sleep(15000)]);
    },
    async eval(expression) {
      const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error(`page script failed: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`);
      return res.result.value;
    },
    /** Waits until the page's text contains `text` (a string or RegExp source). */
    async waitForText(text, timeout = 10000) {
      const started = Date.now();
      const probe = `document.body && ${text instanceof RegExp ? `${text}.test(document.body.innerText)` : `document.body.innerText.includes(${JSON.stringify(text)})`}`;
      while (Date.now() - started < timeout) {
        if (await page.eval(probe)) return true;
        await sleep(100);
      }
      throw new Error(`timed out waiting for "${text}"; page says: ${(await page.eval('document.body.innerText')).slice(0, 300)}`);
    },
    async screenshot({ fullPage = false, quality = 82, clipSelector = null } = {}) {
      let clip;
      if (clipSelector) {
        const box = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(clipSelector)}).getBoundingClientRect();
          return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);
        clip = { ...box, scale: 1 };
      } else if (fullPage) {
        const size = await page.eval('({ width: document.documentElement.clientWidth, height: Math.min(document.documentElement.scrollHeight, 4000) })');
        clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
      }
      const res = await send('Page.captureScreenshot', {
        format: 'jpeg', quality, captureBeyondViewport: !!(fullPage || clipSelector), ...(clip ? { clip } : {}),
      });
      return Buffer.from(res.data, 'base64');
    },
    async pdf(options = {}) {
      const res = await send('Page.printToPDF', {
        printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, ...options,
      });
      return Buffer.from(res.data, 'base64');
    },
    async close() {
      const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((r) => proc.once('exit', r));
      try { await send('Browser.close'); } catch { /* already gone */ }
      ws.close();
      proc.kill();
      // Chromium writes to its profile until the moment it exits.
      await Promise.race([exited, sleep(5000)]);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
  await page.viewport(width, height);
  return page;
}
