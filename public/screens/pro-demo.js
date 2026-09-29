// PRO for a visitor: live minis of the real screens, drawn with the app's own builders, so
// people see what Pro gives instead of reading labels. Loaded by PRO only (screens/pro.js
// loads it by name, for a visitor), never by LOGIN, REDEEM or GIFT.
//
//   CHAT       a real chat window (chat.js messagesHtml): @ana and @joe, four messages that
//              come in one by one at a typing pace, then again after a pause
//   DEVICES    a laptop and a phone: the visitor's own watchlist (watch.js watchCompact),
//              rows on the laptop first, then the same rows on the phone
//   PINGS      a phone lock screen: a price alert and a CHAT ping slide in, in the words
//              pro/push-send.js sends (alertPayload, chatPayload)
//   NO ADS     a small terminal whose sponsor line (sponsor-strip.js itemHtml) slides away
//
// Money: every $ amount is real. One GET /api/quotes call: the $NVDA chip's stamp is the
// real previous close and its live price the real last, so "+x% since" is the true move
// since the last close; the alert's level is a round number just under the real last and
// its body the real last. No quote: the chip without numbers and no price alert.
//
// Motion: prefers-reduced-motion shows each mini's last frame and runs no timer. The
// minis wait while the tab is hidden, stop when the screen is left (ctx.signal, and a
// check that the mini is still on the page), and never run after PRO. Pure builders are
// exported for node:test; startDemo() is the browser part.

import { messagesHtml } from './chat.js';
import { fetchQuotes, watchCompact } from './watch.js';
import { itemHtml } from '../sponsor-strip.js';
import { encode } from '../pixel-avatar.js';
import { loadWatchlist } from '../watchlist.js';
import { seedBits } from './pro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- the people and the chat -------------------------------------------------------------

// Two demo people: a username, a seat, a colour and a seeded pixel avatar.
export const ANA = { name: 'ana', seat: 7, color: 5, avatar: encode(seedBits('ana')) };
export const JOE = { name: 'joe', seat: 12, color: 2, avatar: encode(seedBits('joe')) };
export const CHAT_SYM = 'NVDA';
export const CHAT_CARD = { cmd: 'FISHTANK', title: 'FISHTANK' };
// Light, friendly lines: no buy or sell, no targets, no ratings, no signals.
export const LINES = ['Dad asked what $NVDA makes. I said chips.', 'Have you seen the fish tank?', '', 'Nice. I needed all 6.'];

// GUESS #n: day 1 is 2026-09-27, New York time (data/guess.js puzzleNumber).
const NY = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }) : null;
export function guessNumber(now = Date.now()) {
  const d = NY ? NY.format(new Date(now)) : new Date(now).toISOString().slice(0, 10);
  const ms = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.max(1, Math.round((ms - Date.UTC(2026, 8, 27)) / 864e5) + 1);
}

// The stamp and the live price of the chip, from a real quote only: { tickers, quotes }.
export function chipPrices(qt) {
  const t = { sym: CHAT_SYM };
  const prev = Number(qt?.prevClose);
  const last = Number(qt?.last);
  if (Number.isFinite(prev) && prev > 0) t.price = prev;
  return { tickers: [t], quotes: Number.isFinite(last) && last > 0 ? { [CHAT_SYM]: last } : {} };
}

// The four messages, a minute apart, the last one now. qt: the real NVDA quote, or null.
export function chatScript(qt, now = Date.now()) {
  const at = (i) => now - (3 - i) * 60_000;
  const person = (p) => ({ seat: p.seat, name: p.name, color: p.color, avatar: p.avatar, own: false });
  const { tickers } = chipPrices(qt);
  return [
    { id: 1, at: at(0), ...person(ANA), text: LINES[0], tickers },
    { id: 2, at: at(1), ...person(JOE), text: LINES[1], card: CHAT_CARD },
    { id: 3, at: at(2), ...person(ANA), kind: 'guess', guess: { n: guessNumber(now), tries: 4, solved: true } },
    { id: 4, at: at(3), ...person(JOE), text: LINES[3] },
  ];
}

// The chat window with its first n messages; the newest slides in (fresh).
export function chatHtml(list, n, quotes = {}, now = Date.now(), fresh = false) {
  const shown = list.slice(0, Math.max(0, n));
  let msgs = messagesHtml(shown, quotes, now);
  if (fresh && shown.length) {
    const id = Number(shown[shown.length - 1].id);
    msgs = msgs.replace(`class="cm cm-guess" data-id="${id}"`, `class="cm cm-guess pd-in" data-id="${id}"`).replace(`class="cm" data-id="${id}"`, `class="cm pd-in" data-id="${id}"`);
  }
  return `<div class="pd-win"><div class="pd-bar"><span class="pd-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="ct-name">${esc(ANA.name)}, ${esc(JOE.name)}</span></div>`
    + `<div class="ct-msgs pd-msgs">${msgs}</div></div>`;
}

// A pause before each message, as if typed: longer lines take longer (the first comes quick).
export function typingMs(i, list) {
  if (i === 0) return 700;
  const m = list[i];
  const chars = m?.kind === 'guess' ? 12 : String(m?.text || '').length + (m?.card ? 10 : 0);
  return Math.min(2800, 900 + chars * 40);
}

// ---- every device ------------------------------------------------------------------------

export const FALLBACK_WATCH = ['AAPL', 'NVDA', 'TSLA'];
export const MAX_DEVICE_ROWS = 4;
// The visitor's own list (bb.watch; the starter list when never set), 4 at most.
export function deviceIds(store) {
  let list = [];
  try { list = loadWatchlist(store); } catch { list = []; }
  return (list.length ? list : FALLBACK_WATCH).slice(0, MAX_DEVICE_ROWS);
}

// A table with its first n rows (the head stays): the real watchCompact, cut. fresh: the
// last row comes in.
function rowsCut(ids, byId, n, fresh = false) {
  const html = watchCompact(ids.slice(0, Math.max(0, n)), byId);
  if (!fresh || n < 1) return html;
  const at = html.lastIndexOf('<tr class="row-link"');
  return at < 0 ? html : `${html.slice(0, at)}<tr class="row-link pd-in"${html.slice(at + '<tr class="row-link"'.length)}`;
}

// laptop, phone: how many rows each shows; fresh: 'laptop' or 'phone', where a row just came.
export function devicesHtml(ids, byId, { laptop = 0, phone = 0, fresh = null } = {}) {
  return `<div class="pd-dev">`
    + `<div class="pd-laptop"><div class="pd-lscreen">${rowsCut(ids, byId, laptop, fresh === 'laptop')}</div><div class="pd-lbase"></div></div>`
    + `<div class="pd-phone"><div class="pd-pscreen">${rowsCut(ids, byId, phone, fresh === 'phone')}</div></div>`
    + '</div>';
}

// ---- pings when closed -------------------------------------------------------------------

// The same words as pro/push-send.js (test/pro-demo.test.js checks they match).
const fmtLevel = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 });
const fmtValue = (n, dp = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const OPEN_CHAT = 'Open CHAT to read it.';

// A round number just under the real last price: 191.20 -> 190, 228.86 -> 225.
export function alertLevel(last) {
  const n = Number(last);
  if (!Number.isFinite(n) || n <= 0) return null;
  const step = 5 * 10 ** (Math.floor(Math.log10(n)) - 2);
  let level = Math.floor(n / step) * step;
  if (level >= n) level -= step;
  return Number(level.toFixed(6));
}

// { t, b }: "NVDA above 190" / "NVDA 191.20 · above your 190". null without a real price.
export function alertPing(sym, last) {
  const level = alertLevel(last);
  if (level === null || level <= 0) return null;
  return { t: `${sym} above ${fmtLevel(level)}`, b: `${sym} ${fmtValue(last, 2)} · above your ${fmtLevel(level)}` };
}
export const chatPing = (name) => ({ t: `New message from @${name}`, b: OPEN_CHAT });

const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function noteHtml(p, fresh) {
  return `<div class="pd-note${fresh ? ' pd-in' : ''}"><img class="pd-note-ic" src="/icon-192.png" alt="" width="16" height="16"><span class="pd-note-t">${esc(p.t)}</span><span class="pd-note-b">${esc(p.b)}</span></div>`;
}
// pings: the ones shown, oldest first (the newest goes on top, as a phone stacks them).
export function pingsHtml(pings, now = Date.now(), fresh = false) {
  const list = pings.filter(Boolean);
  const notes = list.map((p, i) => noteHtml(p, fresh && i === list.length - 1)).reverse().join('');
  return `<div class="pd-lock"><span class="pd-lock-time num">${esc(clock(now))}</span><div class="pd-notes">${notes}</div></div>`;
}

// ---- no ads ------------------------------------------------------------------------------

export const HOUSE_LINE = { kind: 'house', label: 'AD', text: 'This line is for rent. No tracking, no pop-ups.', cmd: 'SPONSOR' };
// The status line's legal part, as the page has it (index.html #status-legal).
export const LEGAL_LINE = ['Not financial advice', 'Terms'];
// A small terminal: a chart line and a few rows, so it reads as the terminal, and the real
// status line at the bottom. state: 'ad' (the AD line), 'leaving' (it slides away),
// 'clean' (the legal line only), 'struck' (a still picture: the AD line struck through).
// entering: the line comes in.
export function adsHtml({ state = 'ad', entering = false } = {}) {
  const body = '<div class="pd-term-body">'
    + '<span class="pd-term-panel is-chart"><svg class="pd-term-line" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,32 12,28 22,30 34,20 46,24 58,14 70,18 82,8 100,12"/></svg></span>'
    + `<span class="pd-term-panel is-rows">${'<i></i>'.repeat(4)}</span></div>`;
  const move = state === 'leaving' ? ' pd-out' : entering ? ' pd-in' : '';
  const line = state === 'clean'
    ? `<span class="pd-term-legal${move}">${esc(LEGAL_LINE[0])}<span class="pd-term-sep" aria-hidden="true">·</span><span class="pd-term-link">${esc(LEGAL_LINE[1])}</span></span>`
    : `<span class="pd-term-spon spon-strip${move}${state === 'struck' ? ' pd-struck' : ''}">${itemHtml(HOUSE_LINE)}</span>`;
  return `<div class="pd-term"><div class="pd-term-top"><i></i><i></i><i></i></div>${body}<div class="pd-term-status">${line}</div></div>`;
}

// ---- the player --------------------------------------------------------------------------

// tracks: [{ frames, delay(i): ms before frame i, hold: ms after the last frame, draw(i,
// animate), alive(): still on the page, still(): the picture for reduced motion (else the
// last frame) }]. Frame 0 is drawn at once; reduce: only the still, and no timer at all. Each track loops on its own. Waits while the tab is hidden;
// stop() clears every timer and listener, and so does the signal.
export function play(tracks, { reduce = false, timers = globalThis, doc = globalThis.document, signal = null } = {}) {
  const pending = new Map();
  let stopped = false;
  const ctl = {
    get stopped() { return stopped; },
    get pending() { return pending.size; },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const id of pending.values()) timers.clearTimeout(id);
      pending.clear();
      doc?.removeEventListener?.('visibilitychange', onVis);
      signal?.removeEventListener?.('abort', ctl.stop);
    },
  };
  const hidden = () => Boolean(doc?.hidden);
  const at = tracks.map(() => 0);
  const schedule = (k) => {
    if (stopped || hidden() || pending.has(k)) return;
    const t = tracks[k];
    const last = at[k] === t.frames - 1;
    const next = last ? 0 : at[k] + 1;
    const ms = last ? t.hold : t.delay(next);
    pending.set(k, timers.setTimeout(() => {
      pending.delete(k);
      if (stopped) return;
      if (!tracks.every((x) => x.alive())) { ctl.stop(); return; }
      at[k] = next;
      t.draw(next, true);
      schedule(k);
    }, ms));
  };
  function onVis() {
    if (stopped) return;
    if (hidden()) { for (const id of pending.values()) timers.clearTimeout(id); pending.clear(); return; }
    tracks.forEach((_, k) => schedule(k));
  }
  if (signal?.aborted) { stopped = true; return ctl; }
  if (reduce) {
    tracks.forEach((t) => (t.still ? t.still() : t.draw(t.frames - 1, false)));
    stopped = true;
    return ctl;
  }
  tracks.forEach((t) => t.draw(0, false));
  doc?.addEventListener?.('visibilitychange', onVis);
  signal?.addEventListener?.('abort', ctl.stop, { once: true });
  tracks.forEach((_, k) => schedule(k));
  return ctl;
}

// ---- the browser part ----------------------------------------------------------------------

export const reducedMotion = (win = globalThis.window) => Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// The tracks for the four minis, from the quotes. els: { chat, dev, pings, ads }.
export function demoTracks(els, { byId = {}, ids = FALLBACK_WATCH, now = () => Date.now() } = {}) {
  const alive = (el) => () => Boolean(el?.isConnected);
  const tracks = [];
  if (els.chat) {
    const t0 = now();
    const list = chatScript(byId[CHAT_SYM] || null, t0);
    const { quotes } = chipPrices(byId[CHAT_SYM] || null);
    tracks.push({
      frames: list.length + 1, // 0: empty, then one more message each
      delay: (i) => typingMs(i - 1, list),
      hold: 5000,
      draw: (i, animate) => { els.chat.innerHTML = chatHtml(list, i, quotes, t0, animate); },
      alive: alive(els.chat),
    });
  }
  if (els.dev) {
    const n = ids.length;
    // 0: empty; 1..n: the laptop's rows; n+1..2n: the phone's.
    tracks.push({
      frames: 2 * n + 1,
      delay: (i) => (i === n + 1 ? 900 : i === 1 ? 600 : 350),
      hold: 4000,
      draw: (i, animate) => { els.dev.innerHTML = devicesHtml(ids, byId, { laptop: Math.min(i, n), phone: Math.max(0, i - n), fresh: !animate || i === 0 ? null : i > n ? 'phone' : 'laptop' }); },
      alive: alive(els.dev),
    });
  }
  if (els.pings) {
    const price = alertPing(CHAT_SYM, byId[CHAT_SYM]?.last);
    const pings = [price, chatPing(JOE.name)].filter(Boolean);
    tracks.push({
      frames: pings.length + 1,
      delay: (i) => (i === 1 ? 1200 : 2600),
      hold: 4000,
      draw: (i, animate) => { els.pings.innerHTML = pingsHtml(pings.slice(0, i), now(), animate); },
      alive: alive(els.pings),
    });
  }
  if (els.ads) {
    // 0: the AD line (about 2 s); 1: it slides away; 2: the clean line (about 2 s), again.
    // Reduced motion: the AD line struck through, so a still picture says "no ads".
    const STATES = ['ad', 'leaving', 'clean'];
    tracks.push({
      frames: 3,
      delay: (i) => (i === 1 ? 2000 : 400),
      hold: 2000,
      draw: (i, animate) => { els.ads.innerHTML = adsHtml({ state: STATES[i], entering: animate && i !== 1 }); },
      still: () => { els.ads.innerHTML = adsHtml({ state: 'struck' }); },
      alive: alive(els.ads),
    });
  }
  return tracks;
}

// Start the minis in root (PRO's card): one quotes call, then play. Returns { stop }.
export function startDemo(root, ctx, { reduce = reducedMotion(), timers = globalThis, doc = globalThis.document } = {}) {
  const els = {
    chat: root.querySelector('#pd-chat'),
    dev: root.querySelector('#pd-dev'),
    pings: root.querySelector('#pd-pings'),
    ads: root.querySelector('#pd-ads'),
  };
  let player = null;
  let stopped = false;
  const ctl = { stop() { stopped = true; player?.stop(); }, get player() { return player; } };
  const ids = deviceIds(ctx.store);
  const want = [...new Set([...ids, CHAT_SYM])];
  const go = (byId) => {
    if (stopped || ctx.signal?.aborted || !root.isConnected) return;
    player = play(demoTracks(els, { byId, ids }), { reduce, timers, doc, signal: ctx.signal });
  };
  // A quote that fails: the minis without numbers, never a made-up price.
  Promise.resolve().then(() => fetchQuotes(ctx, want)).then((r) => go(r?.byId || {}), (err) => { if (err?.name !== 'AbortError') go({}); });
  return ctl;
}
