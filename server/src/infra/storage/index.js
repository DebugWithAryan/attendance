import { randomUUID } from 'node:crypto';
import { config } from '../../config/index.js';
import { badRequest, notFound } from '../../shared/errors.js';

/**
 * Medical certificates.
 *
 * They arrive as a data URL (camera capture and file picker both), which keeps
 * the upload a plain JSON request: no multipart streaming inside a serverless
 * function and nothing to clean up if the instance dies mid-write.
 *
 * What comes back is a private reference, never a link. Certificates go to a
 * private Blob store and the stored ref is the pathname rather than a URL, so
 * there is no fetchable link to leak: the bytes reach Teacher and HOD only
 * through an authorised endpoint that records who looked, and a ref on its own
 * is useless without the store's token. Health data about a student should not
 * sit behind an unguessable link.
 */
const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

function decode(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl).trim());
  if (!match) throw badRequest('That file could not be read. Take the photo again.');

  const mime = match[1].toLowerCase();
  const ext = TYPES[mime];
  if (!ext) throw badRequest('Attach a JPG, PNG, WEBP, HEIC or PDF file.');

  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw badRequest('That file is empty.');

  const limitMb = Math.round(config.maxUploadBytes / (1024 * 1024));
  if (buffer.length > config.maxUploadBytes) {
    throw badRequest(`Files must be under ${limitMb} MB. Take the photo again at a lower resolution.`);
  }
  return { buffer, ext, mime };
}

export async function saveCertificate(dataUrl) {
  const { buffer, ext, mime } = decode(dataUrl);
  const key = `certificates/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;

  if (config.storageDriver === 'blob') {
    const { put } = await import('@vercel/blob');
    await put(key, buffer, { access: 'private', contentType: mime, addRandomSuffix: false });
    // The pathname, not the returned URL: a private blob cannot be fetched
    // without the store token, so the ref is safe to keep on the leave request.
    return { ref: `blob:${key}`, mime };
  }

  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname, join } = await import('node:path');
  const target = join(config.uploadDir, key);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  return { ref: `local:${key}`, mime };
}

/** Reads the bytes back for an authorised viewer. Callers must authorise first. */
export async function readCertificate(ref) {
  if (!ref) throw notFound('No certificate was attached to this request.');

  if (ref.startsWith('local:')) {
    const { readFile } = await import('node:fs/promises');
    const { join, normalize } = await import('node:path');
    const key = ref.slice('local:'.length);
    // The key is generated server-side, but never trust a stored path blindly.
    if (normalize(key).startsWith('..')) throw notFound('That certificate is not available.');
    try {
      return await readFile(join(config.uploadDir, key));
    } catch {
      throw notFound('That certificate is no longer on disk.');
    }
  }

  if (ref.startsWith('blob:')) {
    const { get } = await import('@vercel/blob');
    const key = ref.slice('blob:'.length);
    let result;
    try {
      result = await get(key, { access: 'private' });
    } catch {
      throw notFound('That certificate could not be retrieved from storage.');
    }
    if (!result?.stream) throw notFound('That certificate could not be retrieved from storage.');
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  // Certificates written before the store was private are stored as plain URLs.
  const res = await fetch(ref);
  if (!res.ok) throw notFound('That certificate could not be retrieved from storage.');
  return Buffer.from(await res.arrayBuffer());
}
