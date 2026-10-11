// Local accounts and sessions (replaces Cognito on a laptop). Tokens are HMAC-SHA256 signed, 12 h expiry.
// Passwords are stored as scrypt hashes in the main store (LOCALAUTH#<email>). Personas sign in without a password
// only when PN_PERSONAS is on (the default for demos).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const b64 = (s) => Buffer.from(s).toString('base64url');
const HOURS = 12;

export function createSessions(secret) {
  if (!secret || secret.length < 32) throw new Error('Session secret must be at least 32 characters');
  const sign = (p) => createHmac('sha256', secret).update(p).digest('base64url');
  return {
    issue({ userId, groups = [], claims = {} }, now = Date.now()) {
      const payload = b64(JSON.stringify({ sub: userId, groups, claims, exp: now + HOURS * 3600e3 }));
      return { token: `${payload}.${sign(payload)}`, exp: now + HOURS * 3600e3 };
    },
    /** { userId, groups, claims } or null. Constant-time signature check. */
    verify(token, now = Date.now()) {
      const [payload, sig] = String(token || '').split('.');
      if (!payload || !sig) return null;
      const want = Buffer.from(sign(payload));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      try {
        const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!p.sub || !(p.exp > now)) return null;
        return { userId: p.sub, groups: Array.isArray(p.groups) ? p.groups : [], claims: p.claims || {} };
      } catch { return null; }
    },
  };
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  return { salt, hash: scryptSync(String(password), salt, 32).toString('base64url') };
}
export function checkPassword(password, { salt, hash }) {
  const got = scryptSync(String(password), salt, 32);
  const want = Buffer.from(hash, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want);
}
