// Photos and voice notes on the local disk (replaces S3 presigned URLs). URLs are signed and expire, like S3's.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, renameSync } from 'node:fs';
import path from 'node:path';

const SAFE_KEY = /^(uploads|tts)\/[A-Za-z0-9/_.-]{1,200}$/;
export const keyOk = (key) => SAFE_KEY.test(String(key || '')) && !String(key).includes('..');

export function createDiskFiles({ dir, secret, baseUrl = '' }) {
  mkdirSync(dir, { recursive: true });
  const sig = (verb, key, exp, type = '') => createHmac('sha256', secret).update(`${verb}\n${key}\n${exp}\n${type}`).digest('base64url');
  const url = (verb, key, type) => {
    const exp = Date.now() + (verb === 'PUT' ? 15 : 60) * 60e3;
    return `${baseUrl}/local/files/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sig(verb, key, exp, verb === 'PUT' ? type : '')}${verb === 'PUT' ? `&type=${encodeURIComponent(type)}` : ''}`;
  };
  const file = (key) => path.join(dir, ...key.split('/'));
  return {
    kind: 'disk',
    async presignPut(key, contentType) { return url('PUT', key, contentType); },
    async presignGet(key) { return key && existsSync(file(key)) ? url('GET', key) : null; },
    async putData(key, dataUrl) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(String(dataUrl));
      if (!m || !keyOk(key)) return;
      this.write(key, Buffer.from(m[3], m[2] ? 'base64' : 'utf8'), m[1] || 'application/octet-stream');
    },
    /** Check a signed URL. verb: 'GET' | 'PUT'. Returns the key or null. */
    check(verb, key, q) {
      if (!keyOk(key) || !(Number(q.exp) > Date.now())) return null;
      const want = Buffer.from(sig(verb, key, q.exp, verb === 'PUT' ? q.type || '' : ''));
      const got = Buffer.from(String(q.sig || ''));
      return want.length === got.length && timingSafeEqual(want, got) ? key : null;
    },
    write(key, buf, type) {
      const f = file(key);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(`${f}.tmp`, buf);
      renameSync(`${f}.tmp`, f);
      writeFileSync(`${f}.type`, String(type || 'application/octet-stream'));
    },
    read(key) {
      const f = file(key);
      if (!keyOk(key) || !existsSync(f)) return null;
      return { body: readFileSync(f), type: existsSync(`${f}.type`) ? readFileSync(`${f}.type`, 'utf8') : 'application/octet-stream' };
    },
    remove(key) { const f = file(key); for (const x of [f, `${f}.type`]) if (existsSync(x)) unlinkSync(x); },
  };
}
