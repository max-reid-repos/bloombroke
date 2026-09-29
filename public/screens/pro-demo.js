// PRO for a visitor (v5): one stage, four keys. One large demo at a time in a terminal
// panel (screens/pro.js draws the frame: the title strip, the view, the key row 1 to 4);
// this module fills the view with the app's own builders, so people see what Pro gives
// instead of reading labels. Loaded by PRO only (screens/pro.js loads it by name, for a
// visitor), never by LOGIN, REDEEM or GIFT.
//
//   1 PINGS         a phone lock screen, two notifications in the words pro/push-send.js
//                   sends: a CHAT message from @joe (its $NVDA receipt line: the live
//                   price and the move since the previous close) and a price alert
//   2 CHAT          the real chat thread (chat.js messagesHtml), three messages: the
//                   receipt, a GUESS 4/6 and a reply; the demo people have no seat numbers
//   3 EVERY DEVICE  the visitor's own watchlist (bb.watch, 4 at most) on a laptop and a
//                   phone; SPX NDX NVDA MSFT when the list is empty ("demo")
//   4 SEAT          the seat card with the REAL next seat (GET /api/pro/seat, never made
//                   up: SEAT 0000_ until it comes), a blank @______, an empty avatar slot,
//                   and one gift ticket
//
// Money: every $ amount is real. One GET /api/quotes call: the receipt's stamp is the real
// previous close and its live price the real last; the alert's level is the previous close
// rounded down, its body the real last. A quote that fails: no numbers anywhere.
//
// Motion: the stage moves on every STAGE_MS until the visitor presses a key, clicks or
// hovers the stage; then it stays for good on this view. prefers-reduced-motion: no
// moving on, no motion inside (each stage's last frame). Timers wait while the tab is
// hidden and stop when the screen is left (ctx.signal), on a redraw (stop()) and when the
// stage is gone from the page. Pure builders are exported for node:test.

import { messagesHtml, chipHtml } from './chat.js';
import { fetchQuotes, watchCompact } from './watch.js';
import { encode } from '../pixel-avatar.js';
import { loadWatchlist } from '../watchlist.js';
import { seedBits, seatParts, STAGES } from './pro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decode = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export const STAGE_MS = 6000;

// ---- the people and the chat -------------------------------------------------------------

// Two demo people: a username, a colour and a seeded pixel avatar. No seat: a demo person
// with a seat number next to the visitor's real seat would read as a real member.
export const ANA = { name: 'ana', color: 5, avatar: encode(seedBits('ana')) };
export const JOE = { name: 'joe', color: 2, avatar: encode(seedBits('joe')) };
export const CHAT_SYM = 'NVDA';
// Light, friendly lines: no buy or sell, no targets, no ratings, no signals.
export const LINES = ['Dad asked what $NVDA makes. I said chips.', 'Nice. I needed all 6.'];

// GUESS #n: day 1 is 2026-09-27, New York time (data/guess.js puzzleNumber).
const NY = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }) : null;
export function guessNumber(now = Date.now()) {
  const d = NY ? NY.format(new Date(now)) : new Date(now).toISOString().slice(0, 10);
  const ms = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.max(1, Math.round((ms - Date.UTC(2026, 8, 27)) / 864e5) + 1);
}

// The stamp and the live price of the receipt, from a real quote only: { tickers, quotes }.
export function chipPrices(qt) {
  const t = { sym: CHAT_SYM };
  const prev = Number(qt?.prevClose);
  const last = Number(qt?.last);
  if (Number.isFinite(prev) && prev > 0) t.price = prev;
  return { tickers: [t], quotes: Number.isFinite(last) && last > 0 ? { [CHAT_SYM]: last } : {} };
}

// When the receipt's price was the price: the previous close is the close of the trading
// day before the quote's own day (asOf; today in New York without one), at 4:00 PM New
// York. Weekends skipped; market holidays are not known here, so after a holiday the day
// shown is one weekday too late at most.
const NY_PARTS = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }) : null;
function nyAt(y, m, d, hour) {
  // The UTC time whose New York wall clock reads y-m-d hour:00 (EDT is UTC-4, EST UTC-5).
  for (const off of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, hour + off);
    if (!NY_PARTS) return ms;
    const p = Object.fromEntries(NY_PARTS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    if (Number(p.hour) === hour && Number(p.day) === d) return ms;
  }
  return Date.UTC(y, m - 1, d, hour + 4);
}
export function prevCloseAt(qt, now = Date.now()) {
  const own = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(qt?.asOf || ''));
  const day = own ? own.slice(1).join('-') : (NY ? NY.format(new Date(now)) : new Date(now).toISOString().slice(0, 10));
  const d = new Date(`${day}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return nyAt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 16);
}

// The three messages: the receipt when its price was the price (the previous close, so its
// own day row above TODAY's), ana's GUESS a minute ago, joe's reply now. qt: the real NVDA
// quote, or null.
export function chatScript(qt, now = Date.now()) {
  const person = (p) => ({ name: p.name, color: p.color, avatar: p.avatar, own: false });
  const { tickers } = chipPrices(qt);
  return [
    { id: 1, at: prevCloseAt(qt, now), ...person(ANA), text: LINES[0], tickers },
    { id: 2, at: now - 60_000, ...person(ANA), kind: 'guess', guess: { n: guessNumber(now), tries: 4, solved: true } },
    { id: 3, at: now, ...person(JOE), text: LINES[1] },
  ];
}
// The chat's timing: the receipt lands 600 ms after the stage opens, then the others as if typed.
export const CHAT_MS = [600, 1300, 1500];

// The thread with its first n messages; the newest slides in (fresh). The demo people's
// seat part (whoHtml's "#--") is left out.
export function chatHtml(list, n, quotes = {}, now = Date.now(), fresh = false) {
  const shown = list.slice(0, Math.max(0, n));
  let msgs = messagesHtml(shown, quotes, now).replace(/ <span class="cm-seat">[^<]*<\/span>/g, '');
  if (fresh && shown.length) {
    const id = Number(shown[shown.length - 1].id);
    msgs = msgs.replace(`class="cm cm-guess" data-id="${id}"`, `class="cm cm-guess pd-in" data-id="${id}"`).replace(`class="cm" data-id="${id}"`, `class="cm pd-in" data-id="${id}"`);
  }
  return `<div class="pd-chat ct-msgs">${msgs}</div>`;
}

// ---- pings ---------------------------------------------------------------------------------

// The same words as pro/push-send.js (test/pro-v5.test.js checks they match).
const OP_WORDS = { '>': 'above', '>=': 'at or above', '<': 'below' };
const fmtLevel = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 });
const fmtValue = (n, dp = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const OPEN_CHAT = 'Open CHAT to read it.';

// The price alert: its level the previous close rounded down, its body the real last.
// The side is the true one (a last under the level: "below"), so the ping never says
// something the price did not do. null without both real numbers.
export function alertPing(sym, qt) {
  const prev = Number(qt?.prevClose);
  const last = Number(qt?.last);
  if (!(Number.isFinite(prev) && prev >= 1 && Number.isFinite(last) && last > 0)) return null;
  const level = Math.floor(prev);
  const op = last > level ? '>' : last < level ? '<' : '>=';
  const word = OP_WORDS[op];
  return { op, level, t: `${sym} ${word} ${fmtLevel(level)}`, b: `${sym} ${fmtValue(last, 2)} · ${word} your ${fmtLevel(level)}` };
}
// The chat ping: push-send's title; its body the receipt line, "$NVDA 229.82 +0.4% since",
// from the chat's own chip (up or down), or push-send's own body without the numbers.
export function chatPing(name, qt) {
  const { tickers, quotes } = chipPrices(qt);
  const t = `New message from @${name}`;
  if (!Number.isFinite(tickers[0].price) || !quotes[CHAT_SYM]) return { t, b: OPEN_CHAT, dir: '' };
  const chip = chipHtml(tickers[0], quotes[CHAT_SYM]);
  const dir = / class="cm-chip up"/.test(chip) ? 'up' : / class="cm-chip down"/.test(chip) ? 'down' : '';
  return { t, b: decode(chip.replace(/<[^>]+>/g, '')), dir };
}

const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function noteHtml(p, fresh) {
  return `<div class="pd-note${fresh ? ' pd-in' : ''}"><img class="pd-note-ic" src="/icon-192.png" alt="" width="32" height="32">`
    + `<span class="pd-note-t">${esc(p.t)}</span><span class="pd-note-b${p.dir ? ` ${p.dir}` : ''}">${esc(p.b)}</span></div>`;
}
// top: the newest (on top, as a phone stacks them; it slides in when fresh); rest under it.
export function pingsHtml(pings, now = Date.now(), fresh = false) {
  const list = pings.filter(Boolean);
  return `<div class="pd-lock"><span class="pd-lock-time num">${esc(clock(now))}</span><div class="pd-notes">${list.map((p, i) => noteHtml(p, fresh && i === 0)).join('')}</div></div>`;
}

// ---- every device --------------------------------------------------------------------------

export const DEMO_WATCH = ['SPX', 'NDX', 'NVDA', 'MSFT'];
export const MAX_DEVICE_ROWS = 4;
// The visitor's own list (bb.watch, 4 at most) and "your watchlist"; never set or empty:
// the demo list and "demo".
export function deviceList(store) {
  let raw = null;
  try { raw = store?.get?.('bb.watch', null); } catch { raw = null; }
  let list = [];
  if (Array.isArray(raw) && raw.length) { try { list = loadWatchlist(store); } catch { list = []; } }
  return list.length ? { ids: list.slice(0, MAX_DEVICE_ROWS), own: true } : { ids: DEMO_WATCH, own: false };
}
export const devicesMeta = (own) => (own ? 'your watchlist' : 'demo');

// The laptop's rows at once; the phone's (the same rows) when phone is true.
export function devicesHtml(ids, byId, { phone = true, fresh = false } = {}) {
  const table = watchCompact(ids, byId);
  return '<div class="pd-dev">'
    + `<div class="pd-laptop"><div class="pd-lscreen">${table}</div><div class="pd-lbase"></div></div>`
    + `<div class="pd-phone"><div class="pd-pscreen${fresh ? ' pd-in' : ''}">${phone ? table : ''}</div></div>`
    + '</div>';
}

// ---- the seat --------------------------------------------------------------------------------

export const GIFT_TICKET = { n: '3', word: 'GIFT MONTHS' };
export const SEAT_UNKNOWN = '0000_';
// The seat card: an empty avatar slot, a blank @______, SEAT 00043 (the zeros dim), or
// SEAT 0000_ while the number is not known. Beside it, one gift ticket.
export function seatStageHtml(n, fresh = false) {
  const p = seatParts(n);
  const num = p ? `<span class="pro3-zero">${esc(p.lead)}</span>${esc(p.digits)}` : `<span class="pro3-zero">${SEAT_UNKNOWN}</span>`;
  return `<div class="pd-seatstage"><div class="pd-seatrow${fresh ? ' pd-in' : ''}">`
    + `<div class="pd-seatcard"><span class="pd-seat-slot"></span><span class="pd-seat-handle">@______</span><span class="pd-seat-num num"><span class="pro3-word">SEAT </span>${num}</span></div>`
    + `<div class="pd-ticket"><span class="pd-ticket-n num">${esc(GIFT_TICKET.n)}</span><span class="pd-ticket-u">${esc(GIFT_TICKET.word)}</span></div>`
    + '</div></div>';
}

// ---- the stages ----------------------------------------------------------------------------

// A stage: frames (0 first), delay(i) before frame i, draw(i, fresh) its markup. The last
// frame is the still picture (reduced motion, a hidden tab, a still in an embed).
export function stageOf(id, { byId = {}, ids = DEMO_WATCH, seat = null, now = Date.now() } = {}) {
  const qt = byId[CHAT_SYM] || null;
  if (id === 'chat') {
    const list = chatScript(qt, now);
    const { quotes } = chipPrices(qt);
    return { frames: list.length + 1, delay: (i) => CHAT_MS[i - 1], draw: (i, fresh) => chatHtml(list, i, quotes, now, fresh) };
  }
  if (id === 'dev') {
    return { frames: 2, delay: () => 700, draw: (i, fresh) => devicesHtml(ids, byId, { phone: i > 0, fresh: fresh && i > 0 }) };
  }
  if (id === 'seat') return { frames: 1, delay: () => 0, draw: (i, fresh) => seatStageHtml(seat, fresh) };
  // PINGS: both at once, the top one sliding in.
  const pings = [chatPing(JOE.name, qt), alertPing(CHAT_SYM, qt)];
  return { frames: 1, delay: () => 0, draw: (i, fresh) => pingsHtml(pings, now, fresh) };
}

export const reducedMotion = (win = globalThis.window) => Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// The frame's parts: the view, the title strip's label and meta, the keys.
function partsOf(root) {
  return {
    view: root.querySelector('#pd-stage'),
    label: root.querySelector('#pd-stage-label'),
    meta: root.querySelector('#pd-stage-meta'),
    tabs: [...(root.querySelectorAll?.('[data-stage]') || [])],
  };
}
const metaHtml = (text) => `<span aria-hidden="true">·</span> ${esc(text)}`;

// Start the stage in root (PRO's card): one quotes call, then the first stage, then one
// more every STAGE_MS. Returns { pick(i), hold(), refresh(), stop(), current, auto, pending }.
// first: the stage to open with (0-3); hold: the visitor already touched it (no moving on).
// seat(): the next seat, or null (screens/pro.js loads it).
export function startDemo(root, ctx, {
  reduce = reducedMotion(), timers = globalThis, doc = globalThis.document, seat = () => null, first = 0, hold = false, every = STAGE_MS, now = () => Date.now(),
} = {}) {
  const el = partsOf(root);
  const dev = deviceList(ctx?.store);
  let cur = Math.min(STAGES.length - 1, Math.max(0, Number(first) || 0));
  let auto = !reduce && !hold;
  let stopped = false;
  let data = null; // { byId } once the quotes answered (or failed: {})
  const inner = new Set();
  let autoId = null;
  const alive = () => !stopped && Boolean(el.view?.isConnected) && !ctx?.signal?.aborted;
  const clearInner = () => { for (const id of inner) timers.clearTimeout(id); inner.clear(); };
  const clearAuto = () => { if (autoId !== null) timers.clearTimeout(autoId); autoId = null; };
  const later = (fn, ms, set = true) => {
    const id = timers.setTimeout(() => {
      inner.delete(id);
      if (id === autoId) autoId = null;
      if (!alive()) { ctl.stop(); return; }
      fn();
    }, ms);
    if (set) inner.add(id);
    return id;
  };
  const stage = (i) => stageOf(STAGES[i].id, { byId: data?.byId || {}, ids: dev.ids, seat: seat(), now: now() });

  // The frame around the view: the key, the title strip, the view's label.
  function frame(i) {
    const s = STAGES[i];
    el.tabs.forEach((t) => t.setAttribute('aria-selected', String(Number(t.dataset?.stage ?? t.getAttribute?.('data-stage')) === i + 1)));
    if (el.label) el.label.textContent = s.label;
    if (el.meta) el.meta.innerHTML = metaHtml(s.id === 'dev' ? devicesMeta(dev.own) : s.meta);
    el.view?.setAttribute?.('aria-label', s.aria);
  }
  function still(i) {
    const st = stage(i);
    el.view.innerHTML = st.draw(st.frames - 1, false);
  }
  function show(i, animate = true) {
    clearInner();
    cur = i;
    frame(i);
    if (!data) { el.view.innerHTML = ''; return; }
    if (reduce || !animate || doc?.hidden) still(i);
    else {
      const st = stage(i);
      el.view.innerHTML = st.draw(0, true);
      let at = 0;
      for (let k = 1; k < st.frames; k++) {
        at += st.delay(k);
        later(() => { el.view.innerHTML = st.draw(k, true); }, at);
      }
    }
    schedule();
  }
  function schedule() {
    clearAuto();
    if (!auto || !data || stopped || doc?.hidden) return;
    autoId = later(() => show((cur + 1) % STAGES.length), every, false);
  }
  function onVis() {
    if (stopped) return;
    if (doc?.hidden) { clearInner(); clearAuto(); if (data) still(cur); return; }
    schedule();
  }
  const ctl = {
    get current() { return cur; },
    get auto() { return auto; },
    get stopped() { return stopped; },
    get pending() { return inner.size + (autoId !== null ? 1 : 0); },
    // A key or a click: that stage, and the stage stays where the visitor put it.
    pick(i) {
      if (stopped || !Number.isInteger(i) || i < 0 || i >= STAGES.length) return;
      auto = false;
      clearAuto();
      show(i, true);
    },
    // A hover: no more moving on (the stage on show stays, its motion finishes).
    hold() { auto = false; clearAuto(); },
    // The next seat arrived: the seat stage redraws in place.
    refresh() { if (!stopped && data && STAGES[cur].id === 'seat') still(cur); },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInner();
      clearAuto();
      doc?.removeEventListener?.('visibilitychange', onVis);
      ctx?.signal?.removeEventListener?.('abort', ctl.stop);
    },
  };
  if (!el.view || ctx?.signal?.aborted) { stopped = true; return ctl; }
  frame(cur);
  doc?.addEventListener?.('visibilitychange', onVis);
  ctx?.signal?.addEventListener?.('abort', ctl.stop, { once: true });
  const want = [...new Set([...dev.ids, CHAT_SYM])];
  const go = (byId) => {
    if (!alive()) return;
    data = { byId };
    show(cur, true);
  };
  // A quote that fails: the stages without numbers, never a made-up price.
  Promise.resolve().then(() => fetchQuotes(ctx, want)).then((r) => go(r?.byId || {}), (err) => { if (err?.name !== 'AbortError') go({}); });
  return ctl;
}

// Embeds and DESK panels: the first stage as a still picture, with no quotes call and no
// timer (no numbers, so none made up).
export function drawStill(root) {
  const el = partsOf(root);
  if (!el.view) return null;
  const st = stageOf(STAGES[0].id, {});
  el.view.innerHTML = st.draw(st.frames - 1, false);
  return { pending: 0 };
}
