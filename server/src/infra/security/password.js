import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt);
// N=16384 keeps hashing near ~30ms and ~16MB peak per call — deliberate, since
// a college server may be a 1GB box and argon2 would need a native build.
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, PARAMS.keylen, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain, stored) {
  const [scheme, N, r, p, salt, key] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(plain, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
