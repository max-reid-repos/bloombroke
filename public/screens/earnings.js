// EARNINGS: who reports earnings on a day, or across a week. Biggest companies first.

import { esc, q, fmtNum, panel, LOADING } from './markets.js';
import { tickerCell, fmtCompact } from './movers.js';
import { toolbar, segmented, edgeFade } from '../kit.js';

const WORDS = { TODAY: 0, TOMORROW: 1, YESTERDAY: -1 };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// EARNINGS [TODAY|TOMORROW|YESTERDAY|WEEK|NEXT WEEK|YYYY-MM-DD] [WEEK]
export function parse(args) {
  const toks = args.filter((t) => t !== 'ON' && t !== 'FOR' && t !== 'THIS');
  let week = false;
  let day = 'TODAY';
  if (toks[0] === 'NEXT' && toks[1] === 'WEEK' && toks.length === 2) return { day: '+7', week: true };
  const rest = toks.filter((t) => { if (t === 'WEEK') { week = true; return false; } return true; });
  if (rest.length > 1) return { error: 'usage' };
  if (rest.length === 1) {
    if (rest[0] in WORDS) day = rest[0];
    else if (ISO.test(rest[0]) && !Number.isNaN(Date.parse(`${rest[0]}T12:00:00Z`)) && new Date(`${rest[0]}T12:00:00Z`).toISOString().startsWith(rest[0])) day = rest[0];
    else return { error: 'usage' };
  }
  return { day, week };
}

export function nyToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function resolveDay(day, now = new Date()) {
  if (ISO.test(day)) return day;
  const offset = day === '+7' ? 7 : WORDS[day] ?? 0;
  const d = new Date(`${nyToday(now)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export const fmtDayLong = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();

const fmtEps = (n) => (Number.isFinite(n) ? fmtNum(n, 2) : '--');

const addDays = (day, k) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};

// Monday of the week that holds `day` (weekends belong to the week before).
export function mondayOf(day) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

// The day pills: that week's Monday to Friday and WEEK, with the week before and the
// week after at the ends. [{ label, cmd }] for segmented(); active is the label to mark.
export function dayPills(day, week) {
  const mon = mondayOf(day);
  const days = [0, 1, 2, 3, 4].map((k) => addDays(mon, k));
  const label = (d) => `${new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase()} ${Number(d.slice(8))}`;
  const items = [
    { label: '‹ PREV', cmd: `EARNINGS ${addDays(mon, -7)}${week ? ' WEEK' : ''}` },
    ...days.map((d) => ({ label: label(d), cmd: `EARNINGS ${d}` })),
    { label: 'WEEK', cmd: `EARNINGS ${mon} WEEK` },
    { label: 'NEXT ›', cmd: `EARNINGS ${addDays(mon, 7)}${week ? ' WEEK' : ''}` },
  ];
  const active = week ? 'WEEK' : (days.includes(day) ? label(day) : null);
  return { items, active };
}

function table(rows) {
  return `<table class="grid-table earnings-table">
    <thead><tr><th scope="col">Company</th><th scope="col" class="when">When</th><th scope="col" class="num chg">Mkt cap</th><th scope="col" class="num">EPS est</th><th scope="col" class="num time">Last year</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      ${tickerCell(r.ticker, r.name)}
      <td class="when ${r.time ? '' : 'dim'}"${r.time ? '' : ' title="No time announced"'}>${esc(r.time || '--')}</td>
      <td class="num chg">${esc(Number.isFinite(r.marketCap) ? fmtCompact(r.marketCap) : '--')}</td>
      <td class="num last">${fmtEps(r.epsForecast)}</td>
      <td class="num time dim">${fmtEps(r.lastYearEps)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function usage() {
  const ex = ['EARNINGS', 'EARNINGS TOMORROW', 'EARNINGS WEEK', 'EARNINGS 2026-10-14'];
  return `<p class="notice">EARNINGS takes a day or WEEK.</p>
    <p class="muted examples">Try ${ex.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ')}</p>`;
}

const WEEK_LIMIT = 15;

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Earnings', usage(), { cls: 'panel-solo' });
    ctx.status('EARNINGS: CHECK THE FORMAT', 'warn');
    return;
  }
  const day = resolveDay(cmd.args.day);
  const week = cmd.args.week;
  const pills = dayPills(day, week);
  const bar = `<div class="er-bar scroll-x">${toolbar({ left: segmented(pills.items, pills.active, { label: 'Day' }), label: 'Day' })}</div>`;
  el.innerHTML = `${bar}<div id="er-host">${panel('1', week ? `Earnings week of ${day}` : `Earnings ${fmtDayLong(day)}`, LOADING, { cls: 'panel-solo' })}</div>`;
  const hostEl = el.querySelector('#er-host');
  ctx.onCleanup(edgeFade(el.querySelector('.er-bar')));

  const params = new URLSearchParams({ d: day });
  if (week) params.set('w', '1');
  ctx.fetchJSON(`/api/earnings?${params}`, { signal: ctx.signal }).then((d) => {
    const panels = d.days.map((x, i) => {
      const label = `Earnings ${fmtDayLong(x.date)}`;
      if (x.rows === null) return panel(String(i + 1), label, '<p class="panel-msg">This day did not load. Try again in a minute.</p>');
      if (!x.rows.length) return panel(String(i + 1), label, '<p class="panel-msg">No earnings reports listed for this day.</p>', { meta: '0 REPORTS' });
      const shown = week ? x.rows.slice(0, WEEK_LIMIT) : x.rows;
      const more = shown.length < x.rows.length
        ? `<p class="more"><a class="code" href="${esc(q(`EARNINGS ${x.date}`))}" data-cmd="${esc(`EARNINGS ${x.date}`)}">+${x.rows.length - shown.length} more on ${esc(x.date)}</a></p>`
        : '';
      return panel(String(i + 1), label, table(shown) + more, { meta: `${x.rows.length} REPORTS`, cmd: week ? `EARNINGS ${x.date}` : '', bodyCls: 'flush' });
    });
    hostEl.innerHTML = week ? `<div class="stack">${panels.join('')}</div>` : panels[0].replace('class="panel ', 'class="panel panel-solo ');
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    hostEl.innerHTML = panel('1', 'Earnings', `<p class="panel-msg">${esc(err.message)}</p>`, { cls: 'panel-solo' });
    ctx.status('EARNINGS: NO DATA', 'warn');
  });
}
