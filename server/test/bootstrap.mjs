/**
 * The first-run endpoint.
 *
 * Runs against a MIGRATED BUT EMPTY database, before the seed, because this is
 * the only state in which the endpoint exists at all — the one state the rest
 * of the suite never sees. It deliberately creates nothing but the
 * administrator, so the seed that follows still has work to do.
 *
 *   API_BASE=http://127.0.0.1:4001/api node server/test/bootstrap.mjs
 */
const BASE = process.env.API_BASE || 'http://localhost:4000/api';
let pass = 0; let fail = 0;

const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log('  PASS', label); }
  else { fail += 1; console.log('  FAIL', label, extra ? JSON.stringify(extra).slice(0, 300) : ''); }
};

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

console.log('\n1. an empty deployment offers to set itself up');
ok((await call('GET', '/bootstrap')).data.needed === true, 'the first-run check reports an empty deployment');
ok((await call('POST', '/bootstrap', { name: 'A', loginId: 'x', password: 'short' })).status === 400,
  'a weak first password is refused');

console.log('\n2. concurrent attempts cannot both win');
// Fired at a genuinely empty table: exactly one of these may create an account.
// All six send the same credentials, so whichever wins, the account the rest of
// the suite signs in as is the same one.
const burst = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/bootstrap', {
  name: 'College Administrator', loginId: 'admin', password: 'admin-password-1',
})));
const created = burst.filter((r) => r.status === 201);
const refused = burst.filter((r) => r.status === 403);
ok(created.length === 1, `exactly one concurrent attempt created an account (got ${created.length})`);
ok(refused.length === 5, `the other five were refused (got ${refused.length})`);
ok(created[0]?.data.role === 'admin', 'the account it created is an administrator', created[0]?.data);

console.log('\n3. and then never again');
ok((await call('GET', '/bootstrap')).data.needed === false, 'the first-run check closes once an account exists');
ok((await call('POST', '/bootstrap', { name: 'Impostor', loginId: 'impostor', password: 'impostor-pass' })).status === 403,
  'a later attempt is refused');

// The rest of the suite signs in as this account.
console.log(`\nbootstrapped administrator: ${created[0]?.data.login_id}`);
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
