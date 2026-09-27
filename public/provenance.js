// Where the numbers on a screen come from, for the freshness dot by the clock. Pure
// helpers (node:test imports them); app.js does the DOM.
//
// Every /api answer carries `provenance` (lib/provenance.js):
//   { source, source_url, as_of, fetched_at, age_seconds, delay, note?, dataset?, parts? }
// delay is one of DELAYS. parts: the pieces of a mixed answer (real-time and delayed rows),
// each its own envelope; the top level is the worst of them.
//
// The dot's tooltip names the worst part on the screen in one line; a click opens a small
// list, one line per source, and a link to DATA, where the detail lives. Nothing here
// ever adds text to the screen itself.

export const DELAYS = ['real-time', 'delayed-10m', 'delayed-15m', 'end-of-day', 'daily', 'weekly', 'monthly', 'quarterly', 'static'];
// Classes that describe live prices: the dot names the worst of these when a screen has any.
const LIVE = new Set(['real-time', 'delayed-10m', 'delayed-15m']);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NY = 'America/New_York';

export function delayWord(delay) {
  switch (delay) {
    case 'real-time': return 'real-time';
    case 'delayed-10m': return 'delayed 10m';
    case 'delayed-15m': return 'delayed 15m';
    case 'end-of-day': return 'end of day';
    default: return DELAYS.includes(delay) ? delay : '--';
  }
}

// 42 -> "42s", 300 -> "5m", 7200 -> "2h", 172800 -> "2d".
export function ageWords(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  const s = Math.round(seconds);
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const nyDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: NY });
const nyClock = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: NY, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const monDay = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}${y !== new Date().getUTCFullYear() ? ` ${y}` : ''}`;
};

// as_of in words: "16:00:00 ET" today (New York), "Sep 25 16:00:00 ET" another day,
// "Sep 25" for a date with no time (stored as midnight UTC).
export function asOfWords(asOf, now = Date.now()) {
  const t = Date.parse(asOf || '');
  if (!Number.isFinite(t)) return '--';
  if (/T00:00:00(\.000)?Z$/.test(asOf)) return monDay(asOf);
  const time = `${nyClock(t)} ET`;
  return nyDay(t) === nyDay(now) ? time : `${monDay(nyDay(t))} ${time}`;
}

// A captured envelope's age now: the server's age plus the time since it arrived.
export function ageNow(env, now = Date.now()) {
  if (!env) return NaN;
  const at = Number(env.receivedAt) || now;
  return (Number(env.age_seconds) || 0) + Math.max(0, (now - at) / 1000);
}

const rank = (d) => { const i = DELAYS.indexOf(d); return i < 0 ? DELAYS.length : i; };

// Every envelope on a screen, parts spread out, one per source and delay (the oldest).
// An answer with more than MAX_PARTS parts (WEIRD: a source per gauge) stays one line.
export const MAX_PARTS = 6;
export function flatten(list, now = Date.now()) {
  const out = new Map();
  for (const env of list || []) {
    if (!env || typeof env !== 'object') continue;
    const pieces = Array.isArray(env.parts) && env.parts.length && env.parts.length <= MAX_PARTS ? env.parts.map((p) => ({ ...p, receivedAt: env.receivedAt, stale: env.stale })) : [env];
    for (const p of pieces) {
      if (!p?.source) continue;
      const key = `${p.source}|${p.delay}`;
      const prev = out.get(key);
      if (!prev || ageNow(p, now) > ageNow(prev, now)) out.set(key, p);
    }
  }
  return [...out.values()];
}

// The part the dot names: the slowest live class when the screen has live prices,
// else the slowest class of all; the oldest of equals.
export function worstOf(list, now = Date.now()) {
  const flat = flatten(list, now);
  if (!flat.length) return null;
  const live = flat.filter((p) => LIVE.has(p.delay));
  const pool = live.length ? live : flat;
  return pool.reduce((a, b) => {
    const r = rank(b.delay) - rank(a.delay);
    if (r) return r > 0 ? b : a;
    return ageNow(b, now) > ageNow(a, now) ? b : a;
  });
}

// "CNBC quote service · as of 16:00:00 ET · 12s old · real-time" (and "· last known
// data" when the screen could not refresh).
export function dotTitle(list, { stale = false, now = Date.now() } = {}) {
  const w = worstOf(list, now);
  if (!w) return '';
  return [w.source, `as of ${asOfWords(w.as_of, now)}`, `${ageWords(ageNow(w, now))} old`, delayWord(w.delay), stale ? 'last known data' : '']
    .filter(Boolean).join(' · ');
}

// The popover: one line per source (most live first), each a link to its DATA row,
// then "All sources: DATA". Lines past `max` fold into "+N more".
export function popoverHtml(list, { now = Date.now(), max = 8, toQuery = (c) => `?c=${encodeURIComponent(c)}` } = {}) {
  const flat = flatten(list, now).sort((a, b) => rank(a.delay) - rank(b.delay) || String(a.source).localeCompare(String(b.source)));
  const line = (p) => {
    const cmd = p.dataset ? `DATA ${String(p.dataset).toUpperCase()}` : 'DATA';
    const bits = `${delayWord(p.delay)} · ${ageWords(ageNow(p, now))} old`;
    return `<li><a href="${esc(toQuery(cmd))}" data-cmd="${esc(cmd)}"><span class="pv-src">${esc(p.source)}</span> <span class="pv-dim">${esc(bits)}</span></a></li>`;
  };
  const shown = flat.slice(0, max).map(line).join('');
  const more = flat.length > max ? `<li class="pv-dim">+${flat.length - max} more</li>` : '';
  return `<ul class="pv-list">${shown}${more}</ul><a class="pv-all" href="${esc(toQuery('DATA'))}" data-cmd="DATA">All sources: DATA</a>`;
}

// ---- Time of day of an SEC filing ----------------------------------------------------

// EDGAR acceptance time -> PRE (before 9:30 ET), MKT (9:30 to the close), AH (after the
// close), WKD (a weekend or an NYSE holiday), or '' when there is no time. New York time,
// so daylight saving is handled by the time zone database. closed(day) and early(day)
// name market holidays and 13:00 closes ('YYYY-MM-DD').
export const SESSION_TITLES = {
  PRE: 'Accepted before the 9:30 ET open',
  MKT: 'Accepted while the market was open',
  AH: 'Accepted after the close',
  WKD: 'Accepted on a weekend or market holiday',
};
export function sessionTag(iso, { closed = () => false, early = () => false } = {}) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: NY, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun' || closed(day)) return 'WKD';
  const mins = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  if (mins < 9 * 60 + 30) return 'PRE';
  return mins < (early(day) ? 13 * 60 : 16 * 60) ? 'MKT' : 'AH';
}

// The tiny tag for a screen: <span class="tod" title="...">AH</span>, or ''.
export function sessionHtml(tag, when = '') {
  if (!SESSION_TITLES[tag]) return '';
  const title = when ? `${SESSION_TITLES[tag]} (${when})` : SESSION_TITLES[tag];
  return ` <span class="tod" data-prov title="${esc(title)}">${esc(tag)}</span>`;
}
