// PINGS, the sending half (pro/push.js has the store and the routes): a small queue that
// hands pings to the push service of each browser (web-push: VAPID and the payload
// encryption), the CHAT message pings, and the closed-tab ALERTS loop.
//
// A payload is tiny JSON { t: title, b: body, u: url, g: tag } and web-push encrypts it
// end to end: the push service (Apple, Google, Mozilla, Microsoft) never reads it.
// Sending is injected (send), so tests never call a real push service.

import { parse as legacyParse } from 'node:url';
import { TICKER_WORD_RE } from './chat.js';
import { conditionMet } from '../public/alerts.js';

export const CHAT_TTL = 60 * 60; // seconds: a chat ping older than an hour is not delivered
export const ALERT_TTL = 10 * 60; // seconds: an alert older than 10 minutes is not delivered
export const CHAT_THROTTLE_MS = 5 * 60 * 1000; // one ping per chat per person per 5 minutes
export const CHAT_ALIVE_MS = 30 * 1000; // on the CHAT screen: a wait open, or one in the last 30 s
export const MAX_FAILS = 5; // failed sends in a row before a subscription is dropped
export const SEND_TIMEOUT_MS = 10 * 1000;
export const ALERT_EVERY_MS = 60 * 1000;
export const ALERT_SYMBOLS_MAX = 300; // distinct symbols checked in one cycle
export const QUOTE_CHUNK = 60; // symbols per quote call (data/quotes.js MAX_LIST)
export const TEXT_MAX = 80;
export const OPEN_CHAT = 'Open CHAT to read it.';
const MAX_THROTTLE_KEYS = 50_000;
const MAX_SEEN = 5_000;

// ---- where a ping may go -----------------------------------------------------------------

export const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
export const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];
// The raw address, before any parser: https://, a plain host (no port, no user), a path,
// and none of the characters two URL parsers read differently. dev: host:port on this machine.
const RAW_RE = /^https:\/\/([a-z0-9.-]+)\/[^\s\\"'{}|^`<>;]*$/i;
const RAW_DEV_RE = /^https:\/\/((?:localhost|127\.0\.0\.1):\d{2,5})\/[^\s\\"'{}|^`<>;]*$/i;

// Is this a push service we send to? web-push sends with the legacy url.parse(), the
// check above uses the WHATWG URL: the raw host, both parsers' hosts and the allowlist
// must all agree, so no address can mean one host here and another there.
// devHosts (development only): host:port on this machine, a fake push service.
export function pushHostOk(endpoint, devHosts = []) {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
  let whatwg;
  let legacy;
  try { whatwg = new URL(endpoint); legacy = legacyParse(endpoint); } catch { return false; }
  const dev = devHosts.length ? RAW_DEV_RE.exec(endpoint) : null;
  if (dev) {
    const h = dev[1].toLowerCase();
    return devHosts.includes(h) && whatwg.protocol === 'https:' && whatwg.host === h && legacy.host === h;
  }
  const m = RAW_RE.exec(endpoint);
  if (!m) return false;
  const host = m[1].toLowerCase();
  if (whatwg.protocol !== 'https:' || whatwg.username || whatwg.password || whatwg.port) return false;
  if (whatwg.hostname !== host || legacy.hostname !== host || legacy.protocol !== 'https:' || legacy.port || legacy.auth) return false;
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

// ---- payloads --------------------------------------------------------------------------

// A message as a ping line: $TICKER stamps as plain tickers, one line, 80 characters.
export function plainText(text, max = TEXT_MAX) {
  const s = String(text ?? '').replace(new RegExp(TICKER_WORD_RE.source, 'g'), '$1$2').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s;
}

// message: the stored message as CHAT shows it ({ seat, name, text, card }).
export function chatPayload(message, { showText = false, room = null } = {}) {
  const who = message?.name ? `@${message.name}` : `SEAT ${message?.seat ?? '--'}`;
  const text = showText ? (plainText(message?.text) || plainText(message?.card?.title || '')) : '';
  const out = { t: `New message from ${who}`, b: text || OPEN_CHAT, u: '/?c=CHAT' };
  if (room !== null) out.g = `bb-chat-${room}`;
  return out;
}

const OP_WORDS = { '>': 'above', '>=': 'at or above', '<': 'below', '<=': 'at or below' };
// A level as typed (350, 1,250.5); a value with the alert's decimals (351.20).
export const fmtLevel = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 });
export const fmtValue = (n, dp = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

// "AAPL above 350" / "AAPL 351.20 · above your 350", opening the stock.
export function alertPayload(row, value) {
  const word = OP_WORDS[row.op] || row.op;
  const level = fmtLevel(row.level);
  return {
    t: `${row.symbol} ${word} ${level}`,
    b: Number.isFinite(value) ? `${row.symbol} ${fmtValue(value, row.dp)} · ${word} your ${level}` : `${row.symbol} is ${word} your ${level}`,
    u: `/?c=${encodeURIComponent(row.symbol)}`,
    g: `bb-alert-${row.client_id}`,
  };
}

export const TEST_PAYLOAD = { t: 'Bloombroke', b: 'Test ping. Pings work on this device.', u: '/?c=ME', g: 'bb-test' };

// The US stock market's regular hours, New York time (holidays not counted).
const nyParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function usMarketOpen(date = new Date()) {
  const p = Object.fromEntries(nyParts.formatToParts(date).map((x) => [x.type, x.value]));
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const mins = Number(p.hour) * 60 + Number(p.minute);
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ---- the queue -------------------------------------------------------------------------

// store: pro/push.js createPushStore. send(subscription, body, { ttl, urgency, topic })
// resolves when the push service took it, or rejects with { statusCode }.
// 404 or 410: the subscription is gone, dropped. Anything else: one more failure, and
// the subscription is dropped after MAX_FAILS in a row. A full queue drops the new ping.
// hostOk: the allowlist again, right before sending (a row that got past it is dropped,
// never sent to).
export function createSender({
  store, send, log = console, now = () => Date.now(), concurrency = 4, maxQueue = 2000, hostOk = (e) => pushHostOk(e),
}) {
  const queue = [];
  let running = 0;
  let dropped = 0;
  let waiters = [];
  const settle = () => {
    if (running || queue.length) return;
    const w = waiters;
    waiters = [];
    for (const fn of w) fn();
  };
  async function run({ sub, body, opts }) {
    if (!hostOk(sub.endpoint)) {
      store.dropSub(sub.id);
      log.error?.('[push] a subscription with an address we do not send to was dropped');
      return;
    }
    try {
      await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, opts);
      store.sendOk(sub.id, now());
    } catch (err) {
      const code = Number(err?.statusCode) || null;
      if (code === 404 || code === 410) { store.dropSub(sub.id); return; }
      const n = store.sendFailed(sub.id);
      if (n >= MAX_FAILS) store.dropSub(sub.id);
      log.error?.(`[push] send failed (${code || err?.code || 'error'}), ${n} in a row`);
    }
  }
  function pump() {
    while (running < concurrency && queue.length) {
      const job = queue.shift();
      running += 1;
      run(job).catch(() => {}).finally(() => { running -= 1; pump(); settle(); });
    }
  }
  function enqueue(sub, payload, opts) {
    if (queue.length >= maxQueue) { dropped += 1; return false; }
    queue.push({ sub, body: JSON.stringify(payload), opts });
    pump();
    return true;
  }
  return {
    enqueue,
    // Every device of a licence. Returns how many pings were queued.
    toLicence(licId, payload, opts) {
      let n = 0;
      for (const sub of store.subsOf(licId)) if (enqueue(sub, payload, opts)) n += 1;
      return n;
    },
    // Tests: resolves when the queue is empty and nothing is in flight.
    drain() { return running || queue.length ? new Promise((r) => { waiters.push(r); }) : Promise.resolve(); },
    stats: () => ({ queued: queue.length, running, dropped }),
  };
}

// ---- CHAT --------------------------------------------------------------------------------

// Called by the CHAT message route for a new message (never for server lines, GUESS
// results or DRIVE): { room, from, message, notify, hub }. notify: the room's members who
// see the message (the HIDDEN rule: in a group, not those who blocked the sender). A
// member gets a ping when: not the sender, not on the CHAT screen now (hub.alive), CHAT
// pings on, a device to ping, Pro active, and no ping for this chat in the last 5 minutes.
export function createChatPinger({
  store, sender, isActive, now = () => Date.now(), throttleMs = CHAT_THROTTLE_MS, aliveMs = CHAT_ALIVE_MS,
}) {
  const last = new Map(); // `${licence}:${room}` -> when the last ping went
  return function onMessage({ room, from, message, notify = [], hub = null }) {
    if (!message || message.kind === 'sys' || message.kind === 'guess') return 0;
    let sent = 0;
    for (const id of new Set(notify)) {
      if (id === from) continue;
      if (hub?.alive?.(id, aliveMs)) continue;
      const prefs = store.prefs(id);
      if (!prefs.chat || !store.hasSubs(id)) continue;
      const k = `${id}:${room}`;
      const t = now();
      const prev = last.get(k);
      if (prev !== undefined && t - prev < throttleMs) continue;
      if (!isActive(id)) continue;
      last.delete(k);
      last.set(k, t);
      if (last.size > MAX_THROTTLE_KEYS) last.delete(last.keys().next().value);
      if (sender.toLicence(id, chatPayload(message, { showText: prefs.show_text, room }), { ttl: CHAT_TTL, urgency: 'normal', topic: `c${room}` })) sent += 1;
    }
    return sent;
  };
}

// ---- ALERTS ------------------------------------------------------------------------------

// Every minute: the waiting server alerts of licences with ALERTS pings on and a device,
// their distinct symbols (at most 300 a cycle, taking turns when there are more), one
// quote call per 60 symbols through the server's own quote function and its cache. A
// stale quote never fires (the client's rule). Outside US market hours a symbol is only
// looked at when its quote changed since the last cycle (crypto and FX still move).
// An alert fires once: fired_at is set, then the ping goes.
export function createAlertLoop({
  store, sender, getQuoteList, isActive, now = () => Date.now(), log = console,
  everyMs = ALERT_EVERY_MS, cap = ALERT_SYMBOLS_MAX, chunk = QUOTE_CHUNK, marketOpen = usMarketOpen,
}) {
  const seen = new Map(); // symbol -> the last value this loop saw
  let turn = 0;
  let busy = false;
  let timer = null;

  async function cycle() {
    if (busy) return { busy: true };
    busy = true;
    try {
      // Only licences with Pro now: an ended one never uses the symbol budget.
      const active = new Map();
      const live = (id) => { if (!active.has(id)) active.set(id, Boolean(isActive(id))); return active.get(id); };
      const rows = store.waitingAlerts().filter((r) => live(r.licence_id));
      if (!rows.length) return { symbols: 0, fired: 0 };
      const all = [...new Set(rows.map((r) => r.symbol))].sort();
      let syms = all;
      if (all.length > cap) {
        const start = turn % all.length;
        syms = [...all.slice(start), ...all.slice(0, start)].slice(0, cap);
        turn = start + cap;
      }
      const quotes = new Map();
      for (let i = 0; i < syms.length; i += chunk) {
        try {
          const d = await getQuoteList(syms.slice(i, i + chunk));
          for (const q of d?.quotes || []) if (q?.ticker) quotes.set(q.ticker, q);
        } catch (err) { log.error?.('[push] alert quotes', err?.message); }
      }
      const open = marketOpen(new Date(now()));
      const look = new Set();
      for (const s of syms) {
        const q = quotes.get(s);
        if (!q || q.stale || !Number.isFinite(q.last)) continue;
        const prev = seen.get(s);
        if (open || (prev !== undefined && prev !== q.last)) look.add(s);
        seen.delete(s);
        seen.set(s, q.last);
        if (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
      }
      let fired = 0;
      for (const r of rows) {
        if (!look.has(r.symbol)) continue;
        const v = quotes.get(r.symbol).last;
        const hit = conditionMet(r.op, v, r.level);
        if (!r.armed) { if (!hit) store.armAlert(r.id); continue; }
        if (!hit) continue;
        if (!store.fireAlert(r.id, now())) continue;
        // The device that owns the alert, only.
        const device = store.subById(r.sub_id);
        if (device) sender.enqueue(device, alertPayload(r, v), { ttl: ALERT_TTL, urgency: 'high', topic: `a${r.id}` });
        fired += 1;
      }
      return { symbols: syms.length, fired };
    } finally {
      busy = false;
    }
  }

  return {
    cycle,
    start() {
      if (timer || !(everyMs > 0)) return;
      timer = setInterval(() => { cycle().catch((err) => log.error?.('[push] alerts', err?.message)); }, everyMs);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
