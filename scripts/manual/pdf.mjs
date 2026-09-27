/**
 * Prints web/public/user-manual.html to web/public/user-manual.pdf with the
 * same headless Chromium that took the screenshots. Run it after
 * screenshots.mjs, or whenever the manual's text changes.
 *
 *   node scripts/manual/pdf.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './cdp.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'public');
const page = await launch({ width: 1200, height: 900 });
try {
  await page.colorScheme('light');
  await page.goto(pathToFileURL(join(PUBLIC, 'user-manual.html')).href);
  await page.eval(`Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))`);
  const broken = await page.eval('[...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src"))');
  if (broken.length) throw new Error(`missing images: ${broken.join(', ')} (run screenshots.mjs first)`);
  const pdf = await page.pdf({
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-size:8px;color:#7b908c;padding:0 14mm;display:flex;justify-content:space-between;">
      <span>Attendance — User manual</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  writeFileSync(join(PUBLIC, 'user-manual.pdf'), pdf);
  console.log(`user-manual.pdf  ${Math.round(pdf.length / 1024)} KB`);
} finally {
  await page.close();
}
