// Licence keys and the Pro status rules. Pure functions, no I/O.
//
// A key looks like BB-7KQ2-M9XD-HT4P-WZ3C: 16 characters from a 32 letter alphabet with
// no 0/O or 1/I, so 80 random bits. Only its SHA-256 hash and last 4 characters are stored.

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const KEY_RE = /^BB-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const REVEAL_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export function generateKey(rand = randomBytes) {
  const bytes = rand(16);
  let body = '';
  // 256 is a multiple of 32, so masking to 5 bits has no bias.
  for (let i = 0; i < 16; i++) body += ALPHABET[bytes[i] & 31];
  return `BB-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}

// Whatever the user pasted -> the canonical key, or null. Case, spaces and dashes do not matter.
export function normalizeKey(input) {
  if (typeof input !== 'string' || input.length > 64) return null;
  let s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length === 18 && s.startsWith('BB')) s = s.slice(2);
  if (s.length !== 16) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return `BB-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

export function hashKey(key) {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function last4(key) {
  return key.slice(-4);
}

// Pro access from a stored licence row. past_due keeps access for 7 days from when it
// started; canceled, unpaid, incomplete and anything else means no Pro.
export function proAccess(lic, now = Date.now()) {
  if (!lic) return { active: false, status: null };
  const base = { status: lic.status, last4: lic.last4 };
  if (ACTIVE_STATUSES.has(lic.status)) return { ...base, active: true };
  if (lic.status === 'past_due') {
    const since = Number.isFinite(lic.past_due_since) ? lic.past_due_since : lic.updated_at;
    const graceUntil = since + GRACE_MS;
    return { ...base, active: now < graceUntil, graceUntil };
  }
  return { ...base, active: false };
}

// ---- reveal: the full key, encrypted at rest for the 24 hour success-page window ------

export function revealKeyFrom(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('PRO_SECRET must be at least 32 characters');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), 'bloombroke-pro', 'licence-reveal-v1', 32));
}

// AES-256-GCM. The checkout session id is the associated data, so a ciphertext only
// opens for the session it was made for.
export function encryptReveal(aesKey, plaintext, sessionId) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', aesKey, iv);
  c.setAAD(Buffer.from(String(sessionId), 'utf8'));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}

export function decryptReveal(aesKey, token, sessionId) {
  const [v, iv, ct, tag] = String(token).split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('bad reveal token');
  const d = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(String(sessionId), 'utf8'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
