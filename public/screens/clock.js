// CLOCK: world market clocks. Local time, OPEN or CLOSED, and time to the next open or close.
// Also exports the exchange hours WORLD uses.
//
// Hours are regular sessions in local time, minutes after midnight. Weekends are closed.
// Only NYSE and Nasdaq know their holidays here; for the others a holiday shows up when
// the exchange's main index has not traded today (see holidayFromQuote).

import { esc, panel, metaNote, LOADING } from './markets.js';
import { NYSE_HOLIDAYS, NYSE_EARLY_CLOSES } from '../app.js';

const hm = (h, m = 0) => h * 60 + m;
// NYSE_HOLIDAYS is read at call time: app.js imports this file, so it is not ready at load.
const US = { us: true };

export const EXCHANGES = {
  NYSE: { name: 'NYSE', city: 'New York', tz: 'America/New_York', sessions: [[hm(9, 30), hm(16)]], ...US },
  NASDAQ: { name: 'Nasdaq', city: 'New York', tz: 'America/New_York', sessions: [[hm(9, 30), hm(16)]], ...US },
  TSX: { name: 'TSX', city: 'Toronto', tz: 'America/Toronto', sessions: [[hm(9, 30), hm(16)]] },
  B3: { name: 'B3', city: 'Sao Paulo', tz: 'America/Sao_Paulo', sessions: [[hm(10), hm(17)]] },
  BMV: { name: 'BMV', city: 'Mexico City', tz: 'America/Mexico_City', sessions: [[hm(8, 30), hm(15)]] },
  BYMA: { name: 'BYMA', city: 'Buenos Aires', tz: 'America/Argentina/Buenos_Aires', sessions: [[hm(11), hm(17)]] },
  LSE: { name: 'LSE', city: 'London', tz: 'Europe/London', sessions: [[hm(8), hm(16, 30)]] },
  XETRA: { name: 'Xetra', city: 'Frankfurt', tz: 'Europe/Berlin', sessions: [[hm(9), hm(17, 30)]] },
  EURONEXT: { name: 'Euronext', city: 'Paris', tz: 'Europe/Paris', sessions: [[hm(9), hm(17, 30)]] },
  AMS: { name: 'Euronext', city: 'Amsterdam', tz: 'Europe/Amsterdam', sessions: [[hm(9), hm(17, 30)]] },
  BME: { name: 'BME', city: 'Madrid', tz: 'Europe/Madrid', sessions: [[hm(9), hm(17, 30)]] },
  BIT: { name: 'Borsa Italiana', city: 'Milan', tz: 'Europe/Rome', sessions: [[hm(9), hm(17, 30)]] },
  SIX: { name: 'SIX', city: 'Zurich', tz: 'Europe/Zurich', sessions: [[hm(9), hm(17, 30)]] },
  BIST: { name: 'Borsa Istanbul', city: 'Istanbul', tz: 'Europe/Istanbul', sessions: [[hm(10), hm(18)]] },
  TSE: { name: 'TSE', city: 'Tokyo', tz: 'Asia/Tokyo', sessions: [[hm(9), hm(11, 30)], [hm(12, 30), hm(15, 30)]] },
  HKEX: { name: 'HKEX', city: 'Hong Kong', tz: 'Asia/Hong_Kong', sessions: [[hm(9, 30), hm(12)], [hm(13), hm(16)]] },
  SSE: { name: 'SSE', city: 'Shanghai', tz: 'Asia/Shanghai', sessions: [[hm(9, 30), hm(11, 30)], [hm(13), hm(15)]] },
  KRX: { name: 'KRX', city: 'Seoul', tz: 'Asia/Seoul', sessions: [[hm(9), hm(15, 30)]] },
  TWSE: { name: 'TWSE', city: 'Taipei', tz: 'Asia/Taipei', sessions: [[hm(9), hm(13, 30)]] },
  SGX: { name: 'SGX', city: 'Singapore', tz: 'Asia/Singapore', sessions: [[hm(9), hm(12)], [hm(13), hm(17)]] },
  SET: { name: 'SET', city: 'Bangkok', tz: 'Asia/Bangkok', sessions: [[hm(10), hm(12, 30)], [hm(14, 30), hm(16, 30)]] },
  ASX: { name: 'ASX', city: 'Sydney', tz: 'Australia/Sydney', sessions: [[hm(10), hm(16)]] },
  NSE: { name: 'NSE', city: 'Mumbai', tz: 'Asia/Kolkata', sessions: [[hm(9, 15), hm(15, 30)]] },
  NZX: { name: 'NZX', city: 'Wellington', tz: 'Pacific/Auckland', sessions: [[hm(10), hm(16, 45)]] },
  HOSE: { name: 'HOSE', city: 'Ho Chi Minh City', tz: 'Asia/Ho_Chi_Minh', sessions: [[hm(9), hm(11, 30)], [hm(13), hm(14, 45)]] },
};

// The CLOCK screen's exchanges, and the WORLD index that tells us each one traded today.
export const CLOCK_LIST = [
  ['NYSE', 'SPX'], ['NASDAQ', 'IXIC'], ['LSE', 'FTSE'], ['XETRA', 'DAX'], ['EURONEXT', 'CAC'],
  ['TSE', 'N225'], ['HKEX', 'HSI'], ['SSE', 'SSEC'], ['SET', 'SET'], ['ASX', 'ASX'], ['NSE', 'NIFTY'],
];

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map();

export function localParts(tz, date = new Date()) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  const parts = f.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    dow: DOW[get('weekday')],
    hour, minute, second,
    mins: hour * 60 + minute + second / 60,
  };
}

function nextDay(day, k) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return { day: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
}

export function sessionsOn(ex, day, dow) {
  if (dow === 0 || dow === 6 || (ex.us && NYSE_HOLIDAYS.has(day))) return [];
  if (ex.us && NYSE_EARLY_CLOSES.has(day)) return ex.sessions.map(([a, b]) => [a, Math.min(b, hm(13))]).filter(([a, b]) => b > a);
  return ex.sessions;
}

// { state: 'OPEN' | 'LUNCH' | 'CLOSED', next: 'CLOSES' | 'OPENS', minsTo, local, day }
export function sessionState(ex, date = new Date()) {
  const lp = localParts(ex.tz, date);
  const now = lp.mins;
  const today = sessionsOn(ex, lp.day, lp.dow);
  const p = (n) => String(n).padStart(2, '0');
  const base = { local: `${p(lp.hour)}:${p(lp.minute)}:${p(lp.second)}`, day: lp.day, mins: now };
  for (const [a, b] of today) {
    if (now >= a && now < b) return { ...base, state: 'OPEN', next: 'CLOSES', minsTo: b - now };
  }
  const later = today.find(([a]) => a > now);
  if (later) {
    const lunch = today.some(([, b]) => b <= now);
    return { ...base, state: lunch ? 'LUNCH' : 'CLOSED', next: 'OPENS', minsTo: later[0] - now };
  }
  for (let k = 1; k <= 14; k++) {
    const nd = nextDay(lp.day, k);
    const s = sessionsOn(ex, nd.day, nd.dow);
    if (s.length) return { ...base, state: 'CLOSED', next: 'OPENS', minsTo: k * 1440 + s[0][0] - now };
  }
  return { ...base, state: 'CLOSED', next: null, minsTo: null };
}

// The schedule says open, but the exchange's main index has not traded today (local date)
// 30 minutes after the first open: treat it as a holiday.
export function holidayFromQuote(ex, st, asOf) {
  if (!asOf || (st.state !== 'OPEN' && st.state !== 'LUNCH')) return false;
  const first = ex.sessions[0][0];
  if (st.mins - first < 30) return false;
  const quoteDay = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : (() => {
    const d = new Date(asOf);
    return Number.isNaN(d.getTime()) ? null : localParts(ex.tz, d).day;
  })();
  return Boolean(quoteDay) && quoteDay < st.day;
}

// Minutes -> "2H 05M", "45M", "1D 03H".
export function fmtDuration(mins) {
  if (!Number.isFinite(mins) || mins < 0) return '--';
  const m = Math.floor(mins);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const p = (n) => String(n).padStart(2, '0');
  if (d) return `${d}D ${p(h)}H`;
  if (h) return `${h}H ${p(mm)}M`;
  return `${mm}M`;
}

export function fmtHours(ex) {
  const t = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return ex.sessions.map(([a, b]) => `${t(a)}-${t(b)}`).join(' ');
}

// Status cell text and class, with the holiday check applied.
export function statusOf(ex, st, asOf) {
  if (holidayFromQuote(ex, st, asOf)) return { text: 'HOLIDAY', cls: 'st-closed', next: '--' };
  if (st.state === 'OPEN') return { text: 'OPEN', cls: 'st-open', next: `CLOSES IN ${fmtDuration(st.minsTo)}` };
  if (st.state === 'LUNCH') return { text: 'LUNCH', cls: 'st-lunch', next: `OPENS IN ${fmtDuration(st.minsTo)}` };
  return { text: 'CLOSED', cls: 'st-closed', next: st.next ? `OPENS IN ${fmtDuration(st.minsTo)}` : '--' };
}

// A 24 hour strip of the local day: ticks every 6 hours, sessions filled, a mark at the
// local time. The DAY header carries the matching 00 06 12 18 24 scale.
function dayBar(ex, st) {
  const ticks = [360, 720, 1080].map((x) => `<rect class="db-tick" x="${x - 2}" y="1" width="4" height="8"/>`).join('');
  const blocks = ex.sessions.map(([a, b]) => `<rect class="db-on" x="${a}" y="2" width="${b - a}" height="6"/>`).join('');
  return `<svg class="daybar" viewBox="0 0 1440 10" preserveAspectRatio="none" aria-hidden="true"><rect class="db-track" x="0" y="4" width="1440" height="2"/>${ticks}${blocks}<rect class="db-now" x="${Math.max(0, Math.min(1436, st.mins - 2)).toFixed(0)}" y="0" width="4" height="10"/></svg>`;
}

const DAY_SCALE = `<span class="db-scale" aria-hidden="true">${['00', '06', '12', '18', '24'].map((h) => `<span>${h}</span>`).join('')}</span><span class="offscreen">Day, local hours</span>`;

// The side summary: what is open now, and the next open and the next close anywhere.
export function nextBells(list) {
  const open = list.filter((r) => r.s.text === 'OPEN');
  const soonest = (rows) => rows.filter((r) => Number.isFinite(r.st.minsTo)).sort((a, b) => a.st.minsTo - b.st.minsTo)[0] || null;
  const nextOpen = soonest(list.filter((r) => r.st.next === 'OPENS' && r.s.text !== 'HOLIDAY'));
  const nextClose = soonest(open);
  return { open: open.map((r) => r.ex.name), nextOpen, nextClose };
}

function sideHtml(list) {
  const b = nextBells(list);
  const line = (r) => (r ? `<span class="ex-name">${esc(r.ex.name)}</span> <span class="dim">${esc(r.ex.city)}</span><span class="nb-in">IN ${esc(fmtDuration(r.st.minsTo))}</span>` : '<span class="dim">--</span>');
  return `<dl class="nb">
    <dt>Open now</dt><dd>${b.open.length ? esc([...new Set(b.open)].join(', ')) : '<span class="dim">None</span>'}</dd>
    <dt>Next close</dt><dd>${line(b.nextClose)}</dd>
    <dt>Next open</dt><dd>${line(b.nextOpen)}</dd>
  </dl>`;
}

function clockList(asOfByIdx, date) {
  return CLOCK_LIST.map(([id, idx]) => {
    const ex = EXCHANGES[id];
    const st = sessionState(ex, date);
    return { ex, st, s: statusOf(ex, st, asOfByIdx.get(idx)) };
  });
}

function rows(list) {
  return list.map(({ ex, st, s }) => {
    return `<tr>
      <th scope="row" class="name"><span class="ex-name">${esc(ex.name)}</span> <span class="dim ex-city">${esc(ex.city)}</span></th>
      <td class="num last">${esc(st.local.slice(0, 5))}<span class="dim secs">${esc(st.local.slice(5))}</span></td>
      <td class="st ${s.cls}">${esc(s.text)}</td>
      <td class="num next">${esc(s.next)}</td>
      <td class="bar-cell">${dayBar(ex, st)}</td>
      <td class="num time dim">${esc(fmtHours(ex))}</td>
    </tr>`;
  }).join('');
}

// How holidays show: the long form of the title strip's note (its tooltip).
export const HOLIDAY_RULE = 'NYSE and Nasdaq holidays are built in; other holidays show once the main index has not traded by 30 minutes after the open.';

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="with-side">${panel('1', 'Market clocks', '', { cls: 'panel-solo', metaId: 'ck-meta', meta: metaNote('REGULAR HOURS, LOCAL TIME', HOLIDAY_RULE) })}${panel('2', 'Next bells', '', { cls: 'panel-solo' })}</div>`;
  const [body, side] = el.querySelectorAll('.panel-body');
  const asOfByIdx = new Map();

  // The table is drawn once. Each second only the text that changed is written: the
  // seconds, then once a minute the time, the countdown and the now mark.
  let cells = null;
  let sideWas = '';
  const put = (node, text) => { if (node.nodeValue !== text) node.nodeValue = text; };
  function paint() {
    const list = clockList(asOfByIdx, new Date());
    if (!cells) {
      body.innerHTML = `<table class="grid-table clock-table">
        <thead><tr><th scope="col">Exchange</th><th scope="col" class="num">Local</th><th scope="col">Status</th><th scope="col" class="num next">Next</th><th scope="col" class="bar-cell">${DAY_SCALE}</th><th scope="col" class="num time">Hours</th></tr></thead>
        <tbody>${rows(list)}</tbody>
      </table>`;
      cells = [...body.querySelectorAll('tbody tr')].map((tr) => {
        const last = tr.querySelector('.last');
        return { hm: last.firstChild, secs: last.querySelector('.secs').firstChild, st: tr.querySelector('.st'), next: tr.querySelector('.next').firstChild, now: tr.querySelector('.db-now') };
      });
    } else {
      list.forEach(({ st, s }, i) => {
        const c = cells[i];
        put(c.hm, st.local.slice(0, 5));
        put(c.secs, st.local.slice(5));
        const cls = `st ${s.cls}`;
        if (c.st.className !== cls) c.st.className = cls;
        if (c.st.textContent !== s.text) c.st.textContent = s.text;
        put(c.next, s.next);
        const x = Math.max(0, Math.min(1436, st.mins - 2)).toFixed(0);
        if (c.now.getAttribute('x') !== x) c.now.setAttribute('x', x);
      });
    }
    const sideNow = sideHtml(list);
    if (sideNow !== sideWas) { side.innerHTML = sideNow; sideWas = sideNow; }
  }

  paint();
  ctx.status('CLOCK: LOCAL TIME AT EACH EXCHANGE');
  ctx.every(paint, 1000);

  ctx.fetchJSON('/api/world', { signal: ctx.signal }).then((d) => {
    for (const r of d.indexes || []) asOfByIdx.set(r.id, r.asOf);
    paint();
  }).catch(() => { /* the clocks work without it */ });
}
