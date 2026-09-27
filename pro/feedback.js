// FEEDBACK: a short note from anyone, free or Pro, stored in the Pro database. No
// third-party calls and no email is sent. No IP address is stored: the rate limit holds
// the address in memory for up to an hour, then forgets it.
//
//   POST /api/feedback   same origin only, JSON { message, email?, screen?, website? }
//                        -> { ok: true }
//
// message: 1 to 1000 characters after trimming. email: optional, only to reply.
// screen: the command the sender was on, for context (never a key or a code: the page
// sends the address bar form, which leaves those out). website: a honeypot field that
// people never see; a bot that fills it gets { ok: true } and nothing is stored.
// Rows older than 12 months are deleted (pruneFeedback, at boot and daily).

import express from 'express';
import { createLimiter, clientIp } from './ratelimit.js';
import { TERMS_VERSION } from '../public/legal-version.js';

export const MAX_MESSAGE = 1000;
export const MAX_EMAIL = 254;
export const MAX_SCREEN = 64;
export const KEEP_MS = 365 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Characters that can steer a terminal or reorder text when the owner reads notes over
// ssh: C0 controls except tab and newline, DEL, C1 controls, and the bidi overrides and
// isolates. They are stripped from a note and refused in an email address.
export const UNSAFE_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const UNSAFE_ONE = new RegExp(UNSAFE_RE.source);

// A note with Windows line ends made plain and every unsafe character taken out.
export function cleanMessage(v) {
  return String(v).replace(/\r\n?/g, '\n').replace(UNSAFE_RE, '');
}
const HOUR = 60 * 60 * 1000;

export class FeedbackError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// The screen as a short, plain label, or null.
export function cleanScreen(v) {
  if (typeof v !== 'string') return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9 .:/<>=%$+_-]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_SCREEN).trim();
  return s || null;
}

// A body -> { message, email, screen } or throws FeedbackError.
export function validateFeedback(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FeedbackError('bad_request', 'Send { message }.');
  const message = typeof body.message === 'string' ? cleanMessage(body.message).trim() : '';
  if (!message) throw new FeedbackError('empty', 'Write something first.');
  if (message.length > MAX_MESSAGE) throw new FeedbackError('too_long', `Keep it under ${MAX_MESSAGE} characters.`);
  let email = null;
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    if (typeof body.email !== 'string') throw new FeedbackError('bad_email', 'That email address does not look right.');
    const e = body.email.trim();
    if (e) {
      if (e.length > MAX_EMAIL || !EMAIL_RE.test(e) || UNSAFE_ONE.test(e)) throw new FeedbackError('bad_email', 'That email address does not look right.');
      email = e;
    }
  }
  return { message, email, screen: cleanScreen(body.screen) };
}

export function createFeedbackStore(db, { now = () => Date.now() } = {}) {
  const q = {
    add: db.prepare('INSERT INTO feedback (created_at, message, email, screen, legal_version) VALUES (?, ?, ?, ?, ?)'),
    recent: db.prepare('SELECT * FROM feedback WHERE created_at >= ? ORDER BY created_at DESC, id DESC LIMIT ?'),
    prune: db.prepare('DELETE FROM feedback WHERE created_at < ?'),
  };
  return {
    add({ message, email = null, screen = null }) {
      return Number(q.add.run(now(), message, email, screen, TERMS_VERSION).lastInsertRowid);
    },
    recent({ since = 0, limit = 50 } = {}) { return q.recent.all(since, limit); },
    prune(before = now() - KEEP_MS) { return Number(q.prune.run(before).changes); },
  };
}

// Same origin only: the browser's Origin must be this site. A cross-site page, or a
// script with no Origin, is refused.
export function sameOrigin(req, publicUrl) {
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = req.get('origin');
  if (!origin) return false;
  let o;
  try { o = new URL(origin); } catch { return false; }
  if (o.host === req.get('host')) return true;
  try { return o.origin === new URL(publicUrl).origin; } catch { return false; }
}

export function mountFeedback(app, {
  store, publicUrl = 'https://bloombroke.com', now = () => Date.now(), limiter = createLimiter({ max: 5, windowMs: HOUR, now }), log = console,
}) {
  const fail = (res, status, error, message) => res.status(status).json({ error, message });
  app.post('/api/feedback', express.json({ limit: '8kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!sameOrigin(req, publicUrl)) return fail(res, 403, 'cross_origin', 'Send feedback from bloombroke.com.');
    let fb;
    try {
      fb = validateFeedback(req.body);
    } catch (err) {
      if (err instanceof FeedbackError) return fail(res, 400, err.code, err.message);
      throw err;
    }
    const r = limiter.hit(clientIp(req));
    if (!r.ok) {
      res.set('Retry-After', String(r.retryAfter));
      return fail(res, 429, 'rate_limited', 'That is a lot of feedback for one hour. Try again later, or email hello@bloombroke.com.');
    }
    // The honeypot: people never see this field. Say thanks, keep nothing.
    if (typeof req.body.website === 'string' && req.body.website.trim()) return res.json({ ok: true });
    try {
      store.add(fb);
    } catch (err) {
      log.error('[feedback]', err.message);
      return fail(res, 503, 'unavailable', 'Could not save that. Try again in a minute, or email hello@bloombroke.com.');
    }
    res.json({ ok: true });
  });
  app.use('/api/feedback', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err?.type === 'entity.too.large') return fail(res, 413, 'too_long', `Keep it under ${MAX_MESSAGE} characters.`);
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'bad_json', 'That is not valid JSON.');
    return next(err);
  });
}
