// Small shared helpers. No Node- or browser-only APIs beyond globalThis.crypto.
import { httpError } from './catalog.js';
import { format, isLang } from './messages.js';
export { httpError, format, isLang };

/** Translatable error: English message from MSG['err.' + code], plus code and params for the client. */
export function apiError(status, code, params = {}) {
  const e = httpError(status, format(`err.${code}`, params, 'en'), code, params);
  e.code = code;
  e.params = params;
  return e;
}
// '' / undefined → fallback; anything else must be one of the five codes.
export const langOr = (x, fallback = null) => {
  const l = String(x ?? '').trim().toLowerCase().slice(0, 2);
  return isLang(l) ? l : fallback;
};
// Owner link with the owner's language as a real query (the hash route stays untouched).
export const ownerUrl = (appUrl, job) => `${appUrl || ''}/?lang=${job.ownerLang || 'en'}#/o/${job.jobId}/${job.ownerToken}`;

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomString(len, alphabet = ALPHA) {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}
export const newId = (prefix, len = 6) => `${prefix}-${randomString(len)}`;
export const secretToken = () => randomString(24, 'abcdefghijkmnopqrstuvwxyz0123456789');

export async function sha256(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function normalizePhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}
export const maskPhone = (p) => {
  const d = normalizePhone(p);
  return d ? `••••••${d.slice(-4)}` : '';
};
export const iso = (ms) => new Date(ms).toISOString();

// With a key, title/body are MSG[key + '.title'] / MSG[key + '.body']; English copies are stored as the fallback.
export async function notifyUser(ctx, userId, { key = null, params = {}, title, body = '', link = '' }) {
  if (!userId) return;
  const at = iso(ctx.now());
  if (key) title = format(`${key}.title`, params, 'en'), body = format(`${key}.body`, params, 'en');
  await ctx.store.put({ PK: `USER#${userId}`, SK: `NOTIF#${at}#${randomString(4)}`, type: 'notification', key, params: key ? params : null, title, body, link, read: false, at });
}

export function requireFields(body, fields) {
  for (const f of fields) {
    if (body?.[f] === undefined || body?.[f] === null || body?.[f] === '') throw apiError(400, 'missingField', { field: { msg: `field.${f}` } });
  }
}
// `name` is a field code: MSG['field.' + name].
export function clampNumber(v, min, max, name) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw apiError(400, 'outOfRange', { field: { msg: `field.${name}` }, min, max });
  return n;
}
