// GRAVEYARD v2, the server side: the data (stones and zombies), the art on disk, F to pay
// respects, ON THIS DAY, and the stone pages' meta and sitemap entries.
//
// data/graveyard.json: one array. An entry is a stone, or a zombie (zombie: true, a company
// that died and came back, with back: { what, date }). Every optional fact is dropped
// unless it has its shape (and, for peakLine, a source): see cleanEntry.
//
// GET  /api/respects            { counts: { LEH: 12, ... } }, kept 30 seconds
// POST /api/respect { ticker }  one more respect: { ticker, n }. Same origin only. One per
//                               stone per address a New York day, 30 a minute per address.
//                               The address is never stored: a salted hash of it sits in
//                               memory until the day ends (the salt is new each day).
// GET  /api/onthisday           { day, items: [entry] }: stones that died on today's date
// GET  /og/onthisday.png        today's anniversary card (or the site card)
//
// The respects totals live in the Pro database (migrations/012_respects.sql): a ticker and
// a count, nothing else. Without the database they are kept in memory.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createLimiter, clientIp } from '../pro/ratelimit.js';
import { sameOrigin } from '../pro/feedback.js';
import { nyDay } from './counters.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GRAVEYARD_FILE = path.join(root, 'data', 'graveyard.json');
export const ART_DIR = path.join(root, 'public', 'img', 'graveyard');
export const ART_URL = '/img/graveyard';
export const RESPECT_LIMIT = { max: 30, windowMs: 60_000 };
export const RESPECT_KEYS_MAX = 200_000;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const https = (u) => typeof u === 'string' && /^https:\/\/[^\s"<>]+$/.test(u);
const text = (s, max) => (typeof s === 'string' && s.trim() && s.length <= max && !/[\u2014<>]/.test(s) ? s.trim() : null);

// ---- Data -------------------------------------------------------------------------------

const PERIOD = /^\d{4}(-(\d{2}(-\d{2})?|Q[1-4]))?(\/\d{4}-\d{2})?$/; // 2007-02-02, 1995-12, 2003-Q4, 1999, 2000-03/2000-05
// A fact's sources: https, or plain http for an old page that has no https (links only).
const link = (u) => typeof u === 'string' && /^https?:\/\/[^\s"<>]+$/.test(u);
const srcs = (v) => { const a = (Array.isArray(v) ? v : [v]).filter(link); return a.length ? [...new Set(a)] : null; };
const price = (p) => {
  if (!p || !Number.isFinite(p.price) || p.price < 0 || !PERIOD.test(p.date || '') || !srcs(p.src)) return null;
  const out = { price: p.price, date: p.date, src: srcs(p.src) };
  for (const k of ['basis', 'kind', 'shareBasis', 'srcKind']) { const t = text(p[k], 120); if (t) out[k] = t; }
  if (typeof p.splitAdjusted === 'boolean') out.splitAdjusted = p.splitAdjusted;
  if (Number.isFinite(p.cap) && p.cap > 0) out.cap = p.cap;
  return out;
};

// The optional facts, kept only in their shape and with their sources. Returns a new object.
export function cleanEntry(e) {
  const out = {
    ticker: e.ticker, name: e.name, what: e.what, date: e.date, src: e.src,
  };
  if (Array.isArray(e.also) && e.also.length) out.also = e.also.filter((w) => /^[A-Z]{3,12}$/.test(w));
  if (Number.isInteger(e.listed)) { out.listed = e.listed; if (srcs(e.listedSrc)) out.listedSrc = srcs(e.listedSrc); }
  if (Number.isInteger(e.founded) && srcs(e.foundedSrc)) { out.founded = e.founded; out.foundedSrc = srcs(e.foundedSrc); }
  const peak = price(e.peak);
  if (peak) out.peak = peak;
  const final = price(e.final);
  if (final) out.final = final;
  const peakLine = text(e.peakLine, 160);
  if (peakLine && srcs(e.peakSrc)) { out.peakLine = peakLine; out.peakSrc = srcs(e.peakSrc); }
  const epitaph = text(e.epitaph, 70);
  if (epitaph) out.epitaph = epitaph;
  const cause = text(e.cause, 90);
  if (cause) { out.cause = cause; if (srcs(e.causeSrc)) out.causeSrc = srcs(e.causeSrc); }
  if (https(e.wayback) && /^https:\/\/web\.archive\.org\//.test(e.wayback)) out.wayback = e.wayback;
  if (e.video && /^[A-Za-z0-9_-]{11}$/.test(e.video.id || '')) {
    out.video = { id: e.video.id, title: text(e.video.title, 120) || `${e.name} video` };
    const ch = text(e.video.channel, 60);
    if (ch) out.video.channel = ch;
  }
  if (ISO.test(e.anniversary || '')) { out.anniversary = e.anniversary; if (srcs(e.anniversarySrc)) out.anniversarySrc = srcs(e.anniversarySrc); }
  const facts = Array.isArray(e.keyFacts) ? e.keyFacts.map((f) => text(f, 240)).filter(Boolean) : [];
  if (facts.length && srcs(e.keyFactsSrc)) { out.keyFacts = facts; out.keyFactsSrc = srcs(e.keyFactsSrc); }
  const seoTitle = text(e.seoTitle, 90);
  if (seoTitle) out.seoTitle = seoTitle;
  if (e.zombie === true) {
    out.zombie = true;
    // tradesAs: the US ticker the company that came back trades under today (GRAVEYARD's
    // CAME BACK row shows its live price); left off when it no longer trades.
    if (/^[A-Z]{1,5}$/.test(e.tradesAs || '')) out.tradesAs = e.tradesAs;
    out.back = {
      what: e.back.what, date: e.back.date,
      ...(/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(e.back.ticker || '') ? { ticker: e.back.ticker } : {}),
      ...(srcs(e.back.src) ? { src: srcs(e.back.src) } : {}),
    };
  }
  return out;
}

const valid = (e) => e && /^[A-Z]{1,5}$/.test(e.ticker) && typeof e.name === 'string' && e.name && typeof e.what === 'string' && e.what
  && ISO.test(e.date) && Array.isArray(e.src) && e.src.length && e.src.every(https)
  && (e.zombie !== true || (e.back && typeof e.back.what === 'string' && e.back.what && ISO.test(e.back.date)));

// { stones, zombies } from the file: well-formed entries only, optional facts cleaned.
export function loadGraveyardData(file = GRAVEYARD_FILE) {
  const list = JSON.parse(readFileSync(file, 'utf8')).filter(valid).map(cleanEntry);
  return { stones: list.filter((e) => !e.zombie), zombies: list.filter((e) => e.zombie) };
}

// The art on disk: public/img/graveyard/stone.webp, cemetery.webp (the share cards),
// cemetery-empty.webp (the walkable cemetery: our stones are the only stones), doodle-
// <ticker>.webp, and sites/<ticker>.webp (the Internet Archive snapshot of the company's
// last homepage, captured once).
export function artOnDisk(dir = ART_DIR) {
  const list = (d) => { try { return existsSync(d) ? readdirSync(d) : []; } catch { return []; } };
  const files = list(dir);
  const has = (f) => files.includes(f);
  return {
    stone: has('stone.webp') ? `${ART_URL}/stone.webp` : null,
    cemetery: has('cemetery.webp') ? `${ART_URL}/cemetery.webp` : null,
    yard: has('cemetery-empty.webp') ? `${ART_URL}/cemetery-empty.webp` : null,
    doodles: files.map((f) => /^doodle-([a-z]{1,5})\.webp$/.exec(f)?.[1]).filter(Boolean).map((t) => t.toUpperCase()),
    sites: list(path.join(dir, 'sites')).map((f) => /^([a-z]{1,5})\.webp$/.exec(f)?.[1]).filter(Boolean).map((t) => t.toUpperCase()),
    dir,
  };
}

// An entry as the browser gets it: with its art links.
export function withArt(e, art) {
  if (!e) return e;
  const doodle = art?.doodles?.includes(e.ticker) ? `${ART_URL}/doodle-${e.ticker.toLowerCase()}.webp` : null;
  const site = e.wayback && art?.sites?.includes(e.ticker) ? `${ART_URL}/sites/${e.ticker.toLowerCase()}.webp` : null;
  return { ...e, art: { stone: art?.stone || null, doodle, site } };
}

// ---- ON THIS DAY -------------------------------------------------------------------------

// Stones whose anniversary (else their date) falls on this New York day, in an earlier year.
export function onThisDay(stones, day) {
  if (!ISO.test(day || '')) return [];
  return stones.filter((e) => { const a = e.anniversary || e.date; return a.slice(5) === day.slice(5) && a.slice(0, 4) < day.slice(0, 4); });
}

// ---- F to pay respects -------------------------------------------------------------------

// Totals per ticker: in the Pro database when attached, else in memory.
export function createRespects() {
  let q = null;
  const mem = new Map();
  return {
    attach(db) {
      q = {
        bump: db.prepare('INSERT INTO respects (ticker, n) VALUES (?, 1) ON CONFLICT(ticker) DO UPDATE SET n = n + 1 RETURNING n'),
        all: db.prepare('SELECT ticker, n FROM respects'),
      };
      return this;
    },
    // One more for this ticker; the new total, or null when it could not be saved.
    bump(ticker) {
      if (q) { try { return q.bump.get(ticker).n; } catch { return null; } }
      const n = (mem.get(ticker) || 0) + 1;
      mem.set(ticker, n);
      return n;
    },
    counts() {
      if (q) { try { return Object.fromEntries(q.all.all().map((r) => [r.ticker, r.n])); } catch { return {}; } }
      return Object.fromEntries(mem);
    },
  };
}
export const siteRespects = createRespects();

// One respect per stone per address a New York day. The key is a hash of the address, the
// ticker and a salt made new each day, held in memory until that day ends. allow() says
// 'ok', 'seen' (already paid today) or 'full' (the day's table is full: try later).
export function makeRespectGate({ now = () => Date.now(), maxKeys = RESPECT_KEYS_MAX, salt = () => randomBytes(16).toString('hex') } = {}) {
  let day = null;
  let pepper = '';
  let seen = new Set();
  return {
    allow(ip, ticker) {
      const today = nyDay(now());
      if (today !== day) { day = today; pepper = salt(); seen = new Set(); }
      const k = createHash('sha256').update(`${pepper}\u0000${ip}\u0000${ticker}`).digest('base64url').slice(0, 22);
      if (seen.has(k)) return 'seen';
      if (seen.size >= maxKeys) return 'full';
      seen.add(k);
      return 'ok';
    },
    size() { return seen.size; },
  };
}

// ---- Routes --------------------------------------------------------------------------------

// data: { stones, zombies }; respects: createRespects(); art: artOnDisk().
export function mountGraveyard(app, {
  data = loadGraveyardData(), respects = siteRespects, art = artOnDisk(), publicUrl = 'https://bloombroke.com',
  now = () => Date.now(), today = () => process.env.BB_TODAY && ISO.test(process.env.BB_TODAY) ? process.env.BB_TODAY : nyDay(now()),
  gate = makeRespectGate({ now }), limiter = createLimiter({ ...RESPECT_LIMIT, now, maxKeys: 20_000 }),
} = {}) {
  const tickers = new Set([...data.stones, ...data.zombies].map((e) => e.ticker));
  const fail = (res, status, error, message) => res.status(status).json({ error, message });
  app.get('/api/respects', (req, res) => {
    res.set('Cache-Control', 'public, max-age=30').json({ counts: respects.counts() });
  });
  app.post('/api/respect', express.json({ limit: '1kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!sameOrigin(req, publicUrl)) return fail(res, 403, 'cross_origin', 'Respects come from bloombroke.com only.');
    const t = typeof req.body?.ticker === 'string' ? req.body.ticker.toUpperCase() : '';
    if (!tickers.has(t)) return fail(res, 400, 'unknown', 'No such stone.');
    const ip = clientIp(req);
    const r = limiter.hit(ip);
    if (!r.ok) { res.set('Retry-After', String(r.retryAfter)); return fail(res, 429, 'rate_limited', 'Slow down. The dead can wait.'); }
    const counts = respects.counts();
    const g = gate.allow(ip, t);
    if (g !== 'ok') return res.json({ ticker: t, n: counts[t] || 0, counted: false, ...(g === 'full' ? { busy: true } : {}) });
    const n = respects.bump(t);
    res.json({ ticker: t, n: n ?? counts[t] ?? 0, counted: n !== null });
  });
  app.use('/api/respect', (err, req, res, next) => {
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') return fail(res, 400, 'bad_body', 'Send { ticker }.');
    return next(err);
  });
  app.get('/api/onthisday', (req, res) => {
    const day = today();
    res.set('Cache-Control', 'public, max-age=300').json({ day, items: onThisDay(data.stones, day).map((e) => withArt(e, art)) });
  });
  return { data, respects, art, today, tickers };
}
