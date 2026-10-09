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

// ---- gift codes ----------------------------------------------------------------------
// A gift code looks like GIFT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX: 28 characters from the
// same 32 letter alphabet, so 140 random bits. GIFT cannot be part of the body (there is
// no I in the alphabet), and the body is longer than a licence key's, so the two never
// mix. Only the SHA-256 hash and the last 4 characters are stored, like licence keys.
export const GIFT_LEN = 28;
export const GIFT_RE = /^GIFT(-[A-HJ-NP-Z2-9]{4}){7}$/;
export const GIFT_DAYS = 30;
export const GIFT_MS = GIFT_DAYS * 24 * 60 * 60 * 1000;
export const GIFT_CODE_DAYS = 90;
export const GIFT_CODE_MS = GIFT_CODE_DAYS * 24 * 60 * 60 * 1000;
export const MAX_GIFTS = 3;

export function generateGiftCode(rand = randomBytes) {
  const bytes = rand(GIFT_LEN);
  let body = '';
  for (let i = 0; i < GIFT_LEN; i++) body += ALPHABET[bytes[i] & 31];
  return formatGift(body);
}

const formatGift = (body) => `GIFT-${body.match(/.{4}/g).join('-')}`;

// Whatever the user pasted -> the canonical code, or null. Case, spaces and dashes do not
// matter, and GIFT in front is optional.
export function normalizeGiftCode(input) {
  if (typeof input !== 'string' || input.length > 80) return null;
  let s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length === GIFT_LEN + 4 && s.startsWith('GIFT')) s = s.slice(4);
  if (s.length !== GIFT_LEN) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return formatGift(s);
}

// A licence made from a gift code: free Pro until gift_expires_at, no subscription.
export const isGiftLicence = (lic) => Boolean(lic) && Number.isFinite(lic.gift_expires_at) && !lic.stripe_subscription_id;

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

// A founders licence (pro/founders.js): no subscription of its own and no gift month.
// A five-year seat gets term_ends_at at go-live; a founder seat gets its renewal
// subscription at go-live (then it is a normal subscription licence).
export const isFoundersLicence = (lic) => Boolean(lic) && !lic.stripe_subscription_id && !Number.isFinite(lic.gift_expires_at) && !lic.checkout_session_id;
// A term licence: a founders licence with an end set (term_ends_at).
export const isTermLicence = (lic) => isFoundersLicence(lic) && Number.isFinite(lic.term_ends_at);

// Pro access from a stored licence row. past_due keeps access for 7 days from when it
// started; canceled, unpaid, incomplete and anything else means no Pro. A gift licence
// is Pro until its 30 days end. A term licence (a five-year founders seat) is Pro while
// it is 'active' and before term_ends_at; a founders licence with no end set yet is Pro
// while it is 'active'.
export function proAccess(lic, now = Date.now()) {
  if (!lic) return { active: false, status: null };
  const base = { status: lic.status, last4: lic.last4 };
  // A gift month: Pro until it ends, then off. There is nothing to renew.
  if (isGiftLicence(lic)) {
    const on = now < lic.gift_expires_at;
    return { ...base, status: on ? 'gift' : 'gift_ended', active: on, giftUntil: lic.gift_expires_at };
  }
  if (isTermLicence(lic) && lic.status === 'active') {
    return { ...base, active: now < lic.term_ends_at, termUntil: lic.term_ends_at };
  }
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
