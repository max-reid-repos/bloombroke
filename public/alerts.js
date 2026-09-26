// ALERTS: price and gauge alerts, kept in this browser only (localStorage, max 20).
// Pure parts (parse, crossing, list maths, formatting) are exported for node:test. The
// watcher (startAlerts) runs in the browser: while a Bloombroke tab is open it checks
// every 60 seconds with one /api/quotes call (plus /api/weird when a gauge alert
// exists), pauses while the tab is hidden, and lets only one open tab do the checking.

import { matchInstrument } from './instruments.js';
import { tickerForName, LISTED_TICKERS } from './known-tickers.js';
import { findCommand } from './registry.js';

export const ALERTS_KEY = 'bb.alerts';
export const LEASE_KEY = 'bb.alerts.lease';
export const CHECKED_KEY = 'bb.alerts.checked';
export const MAX_ALERTS = 20;
export const CHECK_MS = 60_000;
export const LEASE_MS = 20_000;
export const TICK_MS = 5_000;
export const MAX_QUOTES = 60;
export const HONEST_LINE = 'Alerts check while Bloombroke is open in a tab.';

const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
const SYM_RE = /^[A-Z0-9.&/-]{1,16}$/;
const OPS = ['>', '<', '>=', '<='];
const OP_WORDS = { ABOVE: '>', OVER: '>', BELOW: '<', UNDER: '<' };
const MINUS = '−';

// WEIRD gauges that have one clear number (data/weird/<id>.js gives value and unit).
// dp: the decimals the headline shows.
export const ALERT_GAUGES = {
  CANAL: { id: 'canal', unit: 'ships/day', dp: 0, name: 'Hormuz ships a day, 7-day average' },
  WAFFLE: { id: 'waffle', unit: 'stores', dp: 0, name: 'Waffle Houses inside storm winds' },
  PANIC: { id: 'panic', unit: '%', dp: 0, name: 'Crash-page views vs 30-day average' },
  HIRING: { id: 'hiring', unit: 'per job', dp: 2, name: 'HN job seekers per job post' },
  HOTDOG: { id: 'hotdog', unit: '$', dp: 2, name: "The $1.50 hot dog in today's money" },
  UNDIES: { id: 'undies', unit: '%', dp: 1, name: "Men's underwear prices vs a year ago" },
  CHANCES: { id: 'odds', unit: '%', dp: 0, name: 'Odds of a US recession' },
  BOXRATE: { id: 'boxrate', unit: '$', dp: 0, name: 'To ship one 40ft container' },
  EGGPRICE: { id: 'eggs', unit: '$', dp: 2, name: 'A dozen eggs, US city average' },
  RIDES: { id: 'rides', unit: 'min', dp: 0, name: 'Average Disney ride wait' },
  TRUCKS: { id: 'trucks', unit: '%', dp: 1, name: 'Freight shipments vs a year ago' },
  BOXES: { id: 'boxes', unit: '%', dp: 1, name: 'Box output vs a year ago' },
  LIPSTICK: { id: 'lipstick', unit: '%', dp: 1, name: 'Cosmetics prices vs a year ago' },
  SICK: { id: 'sick', unit: 'level', dp: 1, name: 'COVID wastewater level, national' },
};
// Words that name a gauge only inside ALERTS (the Hormuz number is CANAL's headline).
const GAUGE_WORDS = { HORMUZ: 'CANAL' };

// The WEIRD command a word names (CANAL, SHIPS, HORMUZ -> CANAL), or null.
export function gaugeCommand(word) {
  const w = String(word ?? '').trim().toUpperCase();
  if (GAUGE_WORDS[w]) return GAUGE_WORDS[w];
  const entry = findCommand(w);
  return entry && entry.category === 'Weird data' ? entry.name : null;
}

// A level: 350, 1,250.5, $4.50, 5.2%, -20. NaN for anything else.
export function parseLevel(text) {
  const s = String(text ?? '').trim().replace(/^\+/, '');
  const m = /^(-|−)?\$?(\d{1,3}(?:,\d{3})+|\d*)(\.\d+)?%?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return NaN;
  const n = Number(`${m[1] ? '-' : ''}${m[2].replace(/,/g, '') || '0'}${m[3] || ''}`);
  return Number.isFinite(n) && Math.abs(n) <= 1e12 ? n : NaN;
}

const decimalsIn = (text) => (/\.(\d+)/.exec(String(text)) || [, ''])[1].length;

// The symbol words of an alert -> { kind: 'quote', sym } | { kind: 'gauge', sym, gauge }
// | { error, bad }. Named instruments (SPX, EUR/USD, S&P 500), tickers, and the company
// names the terminal knows offline (APPLE -> AAPL), like the command bar.
export function resolveAlertSymbol(words) {
  const toks = words.map((w) => String(w).toUpperCase().replace(/^\$/, '')).filter(Boolean);
  if (!toks.length) return { error: 'usage' };
  const text = toks.join(' ');
  if (toks.length === 1) {
    const g = gaugeCommand(toks[0]);
    if (g) {
      const spec = ALERT_GAUGES[g];
      return spec ? { kind: 'gauge', sym: g, gauge: spec.id } : { error: 'gauge', bad: g };
    }
  }
  const m = matchInstrument(toks);
  if (m && m.used === toks.length) return { kind: 'quote', sym: m.inst.id };
  // Like the command bar: a known ticker as it is, then a company name (APPLE), then
  // any ticker-shaped word (the screen checks it has a quote before saving).
  if (toks.length === 1 && LISTED_TICKERS.has(toks[0])) return { kind: 'quote', sym: toks[0] };
  const named = tickerForName(text);
  if (named) return { kind: 'quote', sym: named.id || named };
  if (toks.length === 1 && TICKER_RE.test(toks[0])) return { kind: 'quote', sym: toks[0] };
  return { error: 'symbol', bad: text };
}

// The words after ALERTS:
//   []                      -> show
//   CLEAR                   -> clear (asks first, on the screen)
//   AAPL > 350, US10Y<5.2   -> add { sym, kind, gauge?, op, level, typedDp }
//   CANAL < 5               -> a WEIRD gauge with a number
export function parseAlertArgs(toks) {
  const words = (toks || []).map((t) => String(t).toUpperCase());
  if (!words.length) return { action: 'show' };
  if (words[0] === 'CLEAR') return words.length === 1 ? { action: 'clear' } : { action: 'clear', error: 'usage' };
  const text = words.join(' ').replace(/\s*(>=|<=|>|<)\s*/, ' $1 ').trim();
  const parts = text.split(/\s+/);
  const at = parts.findIndex((p) => OPS.includes(p) || OP_WORDS[p]);
  if (at < 1 || at !== parts.length - 2) return { action: 'add', error: 'usage' };
  const op = OP_WORDS[parts[at]] || parts[at];
  const levelText = parts[at + 1];
  const level = parseLevel(levelText);
  const sym = resolveAlertSymbol(parts.slice(0, at));
  if (sym.error) return { action: 'add', error: sym.error, bad: sym.bad };
  if (!Number.isFinite(level)) return { action: 'add', error: 'level', bad: levelText };
  return { action: 'add', alert: { ...sym, op, level, typedDp: decimalsIn(levelText) } };
}

// The words for an alert: AAPL > 350.
export function alertWords(a) {
  return `${a.sym} ${a.op} ${a.level}`;
}

// Is the condition true for this value?
export function conditionMet(op, value, level) {
  if (!Number.isFinite(value) || !Number.isFinite(level)) return false;
  if (op === '>') return value > level;
  if (op === '<') return value < level;
  if (op === '>=') return value >= level;
  if (op === '<=') return value <= level;
  return false;
}

// Where the value for an alert comes from in a check: quote id or gauge:<id>.
export const valueKey = (a) => (a.kind === 'gauge' ? `gauge:${a.gauge}` : a.sym);

// A check's values against the list. Returns { list, fired } (new objects; the input is
// not changed). A WAITING alert whose condition is true fires once and turns TRIGGERED:
// a price that jumps past the level between two checks still fires. A re-armed alert
// whose condition was still true waits until the value is back on the other side, so it
// fires on a fresh crossing only. Missing values change nothing.
export function evaluate(list, values, now = Date.now()) {
  const fired = [];
  const out = list.map((a) => {
    const v = values[valueKey(a)];
    if (!Number.isFinite(v)) return a;
    const next = { ...a, last: v, lastAt: now };
    if (next.state !== 'waiting') return next;
    const hit = conditionMet(next.op, v, next.level);
    if (next.rearmed) {
      if (!hit) next.rearmed = false;
      return next;
    }
    if (hit) {
      next.state = 'triggered';
      next.firedAt = now;
      next.firedValue = v;
      next.seen = false;
      fired.push(next);
    }
    return next;
  });
  return { list: out, fired };
}

// Back to WAITING. When the last value still meets the condition, it waits for a fresh
// crossing (rearmed) instead of firing again at once.
export function rearm(list, id) {
  return list.map((a) => {
    if (a.id !== id) return a;
    const still = conditionMet(a.op, a.last, a.level);
    const { firedAt, firedValue, ...rest } = a;
    return { ...rest, state: 'waiting', seen: true, rearmed: still };
  });
}

export function removeAlert(list, id) {
  return list.filter((a) => a.id !== id);
}

export function markSeen(list) {
  return list.some((a) => a.state === 'triggered' && !a.seen) ? list.map((a) => (a.state === 'triggered' ? { ...a, seen: true } : a)) : list;
}

export const unseenCount = (list) => list.filter((a) => a.state === 'triggered' && !a.seen).length;

const sameAlert = (a, b) => a.sym === b.sym && a.kind === b.kind && a.op === b.op && a.level === b.level;

// Add a parsed alert. Returns { list, alert } or { list, error: 'full' | 'duplicate' }.
// info: what the add learned (dp, unit, name, last) from a quote or the gauge list.
export function addAlert(list, parsed, info = {}, now = Date.now(), id = newId(now)) {
  if (list.some((a) => sameAlert(a, parsed))) return { list, error: 'duplicate' };
  if (list.length >= MAX_ALERTS) return { list, error: 'full' };
  const spec = parsed.kind === 'gauge' ? ALERT_GAUGES[parsed.sym] : null;
  const dp = Number.isInteger(info.dp) ? info.dp : spec ? spec.dp : 2;
  const alert = {
    id,
    sym: parsed.sym,
    kind: parsed.kind,
    ...(spec ? { gauge: spec.id } : {}),
    unit: spec ? spec.unit : info.unit || '',
    name: String(info.name || spec?.name || '').slice(0, 60),
    op: parsed.op,
    level: parsed.level,
    dp: Math.min(8, Math.max(dp, parsed.typedDp || 0)),
    vdp: Math.min(8, dp),
    created: now,
    state: 'waiting',
    seen: true,
    rearmed: false,
    ...(Number.isFinite(info.last) ? { last: info.last, lastAt: now } : {}),
  };
  return { list: [...list, alert], alert };
}

export function newId(now = Date.now()) {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// A list read from storage: anything malformed is dropped, never trusted.
export function cleanAlerts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    if (typeof a.id !== 'string' || !/^[a-z0-9]{1,24}$/.test(a.id)) continue;
    if (typeof a.sym !== 'string' || !SYM_RE.test(a.sym)) continue;
    if (a.kind !== 'quote' && a.kind !== 'gauge') continue;
    if (a.kind === 'gauge' && (!ALERT_GAUGES[a.sym] || ALERT_GAUGES[a.sym].id !== a.gauge)) continue;
    if (!OPS.includes(a.op) || !Number.isFinite(a.level)) continue;
    if (a.state !== 'waiting' && a.state !== 'triggered') continue;
    out.push({
      ...a,
      unit: typeof a.unit === 'string' ? a.unit.slice(0, 16) : '',
      name: typeof a.name === 'string' ? a.name.slice(0, 60) : '',
      dp: Number.isInteger(a.dp) && a.dp >= 0 && a.dp <= 8 ? a.dp : 2,
      vdp: Number.isInteger(a.vdp) && a.vdp >= 0 && a.vdp <= 8 ? a.vdp : 2,
    });
    if (out.length >= MAX_ALERTS) break;
  }
  return out;
}

export function loadAlerts(store) {
  return cleanAlerts(store.get(ALERTS_KEY, []));
}

export function saveAlerts(store, list) {
  store.set(ALERTS_KEY, cleanAlerts(list));
}

// The one batch call for the quote alerts, or null when there are none.
export function quotesUrl(list) {
  const syms = [...new Set(list.filter((a) => a.kind === 'quote').map((a) => a.sym))].slice(0, MAX_QUOTES);
  return syms.length ? `/api/quotes?s=${syms.map(encodeURIComponent).join(',')}` : null;
}

export const needsWeird = (list) => list.some((a) => a.kind === 'gauge');

// The API answers -> { key: number } for evaluate().
export function valuesFrom(quotes, weird) {
  const values = {};
  for (const qt of quotes?.quotes || []) if (qt && Number.isFinite(qt.last)) values[qt.ticker] = qt.last;
  for (const g of weird?.gauges || []) if (g && g.ok && Number.isFinite(g.value)) values[`gauge:${g.id}`] = g.value;
  return values;
}

// Numbers: 1,234.50 with the alert's decimals; $, % and other units by kind.
export function fmtNumber(n, dp = 2) {
  if (!Number.isFinite(n)) return '--';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return (n < 0 && Number(s.replace(/,/g, '')) !== 0 ? MINUS : '') + s;
}

export function fmtValue(n, unit = '', dp = 2) {
  if (!Number.isFinite(n)) return '--';
  const s = fmtNumber(n, dp);
  if (unit === '$') return s.startsWith(MINUS) ? `${MINUS}$${s.slice(1)}` : `$${s}`;
  if (unit === '%') return `${s}%`;
  return unit ? `${s} ${unit}` : s;
}

export const fmtLevel = (a) => fmtValue(a.level, a.unit, a.dp);
export const fmtNow = (a, v = a.last) => fmtValue(v, a.unit, Math.max(a.vdp ?? a.dp, 0));

// How far the value is from the level: '+2.61%' (or '+6.0 pts' for a gauge in %).
export function distance(a) {
  if (!Number.isFinite(a.last)) return '--';
  if (a.kind === 'gauge' && a.unit === '%') {
    const d = a.level - a.last;
    return `${d > 0 ? '+' : d < 0 ? MINUS : ''}${fmtNumber(Math.abs(d), Math.max(1, a.dp))} pts`;
  }
  if (a.last === 0 || (a.kind === 'gauge' && a.last < 0)) return '--';
  const pct = (a.level / a.last - 1) * 100;
  return `${pct > 0 ? '+' : pct < 0 ? MINUS : ''}${fmtNumber(Math.abs(pct), 2)}%`;
}

// The notification and status line text: "AAPL crossed 350.00 · now 350.42".
export function firedText(a) {
  return `${a.sym} crossed ${fmtLevel(a)} · now ${fmtNow(a, a.firedValue ?? a.last)}`;
}

// The command a fired alert opens: the stock or the gauge's own screen.
export const openCommand = (a) => a.sym;

// ---------------------------------------------------------------------------
// Browser: the watcher. One per page (never inside a DESK panel).
// ---------------------------------------------------------------------------

// The tab lease: { tab, at }. A tab holds it while visible and renews it on each tick;
// a lease older than LEASE_MS belongs to nobody (that tab closed or slept).
export function leaseFree(lease, tab, now) {
  return !lease || lease.tab === tab || !Number.isFinite(lease.at) || now - lease.at > LEASE_MS;
}

export function startAlerts({ store, fetchJSON, status, run, statusline }) {
  const tab = newId();
  let busy = false;
  let flag = null;

  function readLease() { return store.get(LEASE_KEY, null); }
  function takeLease(now, force = false) {
    if (!force && !leaseFree(readLease(), tab, now)) return false;
    store.set(LEASE_KEY, { tab, at: now });
    return readLease()?.tab === tab;
  }
  function dropLease() {
    if (readLease()?.tab === tab) {
      try { localStorage.removeItem(LEASE_KEY); } catch { /* storage unavailable */ }
    }
  }

  // The "1 ALERT" flag in the status line: fired and not yet seen on the ALERTS screen.
  function paintFlag(list = loadAlerts(store)) {
    if (!statusline) return;
    const n = unseenCount(list);
    if (!flag) {
      flag = document.createElement('button');
      flag.type = 'button';
      flag.className = 'status-alerts';
      flag.hidden = true;
      flag.addEventListener('click', (e) => { e.stopPropagation(); run('ALERTS'); });
      statusline.insertBefore(flag, statusline.querySelector('#status-legal'));
    }
    flag.hidden = n === 0;
    flag.textContent = `${n} ALERT${n === 1 ? '' : 'S'}`;
    flag.setAttribute('aria-label', `${n} alert${n === 1 ? '' : 's'} triggered. Open ALERTS`);
  }

  function notify(a) {
    const text = firedText(a);
    status(text);
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(text, { body: 'Bloombroke ALERTS', tag: `bb-alert-${a.id}` });
      n.onclick = () => {
        try { window.focus(); } catch { /* ignore */ }
        n.close();
        saveAlerts(store, loadAlerts(store).map((x) => (x.id === a.id ? { ...x, seen: true } : x)));
        run(openCommand(a));
      };
    } catch { /* some browsers only notify from a service worker: the status line stands */ }
  }

  async function check() {
    if (busy) return;
    const list = loadAlerts(store);
    if (!list.length) return;
    busy = true;
    const now = Date.now();
    store.set(CHECKED_KEY, now);
    try {
      const qUrl = quotesUrl(list);
      const [quotes, weird] = await Promise.all([
        qUrl ? fetchJSON(qUrl).catch(() => null) : null,
        needsWeird(list) ? fetchJSON('/api/weird').catch(() => null) : null,
      ]);
      const values = valuesFrom(quotes, weird);
      // Read again: the list may have changed (another tab, the screen) while we waited.
      const { list: next, fired } = evaluate(loadAlerts(store), values, Date.now());
      saveAlerts(store, next);
      for (const a of fired) notify(a);
      paintFlag(next);
      window.dispatchEvent(new CustomEvent('bb:alerts', { detail: { fired: fired.length } }));
    } finally {
      busy = false;
    }
  }

  const since = () => Date.now() - (Number(store.get(CHECKED_KEY, 0)) || 0);

  function tick() {
    const now = Date.now();
    if (document.hidden) { dropLease(); return; }
    if (!loadAlerts(store).length) return;
    if (!takeLease(now)) return;
    if (since() >= CHECK_MS) check();
  }

  setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { dropLease(); return; }
    // Back on the tab: check once (not again within 10 seconds of the last check).
    if (loadAlerts(store).length && takeLease(Date.now()) && since() >= 10_000) check();
  });
  window.addEventListener('pagehide', dropLease);
  // The ALERTS screen added an alert: check now, from this tab.
  window.addEventListener('bb:alerts-check', () => {
    if (document.hidden) return;
    takeLease(Date.now(), true);
    check();
  });
  // Another tab changed the list (a check, an add, a remove): repaint here.
  window.addEventListener('storage', (e) => {
    if (e.key !== ALERTS_KEY) return;
    paintFlag();
    window.dispatchEvent(new CustomEvent('bb:alerts', { detail: { fired: 0 } }));
  });
  window.addEventListener('bb:alerts-seen', () => paintFlag());
  paintFlag();
  tick();
}
