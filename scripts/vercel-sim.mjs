// Stands in for Vercel's Node runtime: sets the same environment flag the
// platform sets, then hands each request to the very default export Vercel
// calls — so what gets tested is the deployed path, not a parallel one.
process.env.VERCEL ||= '1';
process.env.STORAGE_DRIVER ||= 'local'; // no Blob token in a local check

import { createServer } from 'node:http';

const { default: handler } = await import('../api/index.js');

const port = Number(process.env.PORT || 4001);
createServer((req, res) => handler(req, res)).listen(port, () => {
  console.log(`vercel-sim on ${port}`);
});
