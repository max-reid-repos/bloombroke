// CALENDAR: this week's economic calendar. US events plus the big ones from elsewhere.

import { esc, q, panel, LOADING } from './markets.js';

export const SCOPES = { MAJOR: 'US and high impact', ALL: 'Every event', US: 'US only' };

// CALENDAR [ALL|US]
export function parse(args) {
  if (!args.length) return { scope: 'MAJOR' };
  const t = args.join(' ');
  if (t === 'ALL') return { scope: 'ALL' };
  if (t === 'US' || t === 'USD') return { scope: 'US' };
  return { error: 'usage' };
}

export function filterEvents(events, scope) {
  if (scope === 'ALL') return events;
  if (scope === 'US') return events.filter((e) => e.country === 'USD');
  return events.filter((e) => e.country === 'USD' || e.impact === 'High' || e.impact === 'Holiday');
}

const NY = 'America/New_York';
export const nyDayOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: NY });
const dayLabel = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: NY, weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: NY, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const IMPACT = { High: ['HIGH', 'imp-high'], Medium: ['MED', 'imp-med'], Low: ['LOW', 'imp-low'], Holiday: ['HOLIDAY', 'imp-hol'] };
const COUNTRY = { USD: 'US', EUR: 'EU', GBP: 'UK', JPY: 'JP', CNY: 'CN', CAD: 'CA', AUD: 'AU', NZD: 'NZ', CHF: 'CH', ALL: 'ALL' };

export function calendarTable(events, now = new Date()) {
  let day = '';
  const rows = events.map((e) => {
    const d = nyDayOf(e.time);
    const head = d !== day ? `<tr class="group-row"><th colspan="6" scope="rowgroup">${esc(dayLabel(e.time))}</th></tr>` : '';
    day = d;
    const [imp, cls] = IMPACT[e.impact] || IMPACT.Low;
    const past = Date.parse(e.time) < now.getTime() ? ' is-past' : '';
    return `${head}<tr class="${past.trim()}">
      <td class="num cal-time dim">${esc(timeOf(e.time))}</td>
      <td class="cal-cty">${esc(COUNTRY[e.country] || e.country)}</td>
      <td class="cal-imp ${cls}">${esc(imp)}</td>
      <th scope="row" class="name cal-title">${esc(e.title)}</th>
      <td class="num">${esc(e.forecast || '--')}</td>
      <td class="num dim">${esc(e.previous || '--')}</td>
    </tr>`;
  }).join('');
  return `<table class="grid-table calendar-table">
    <thead><tr><th scope="col" class="num">ET</th><th scope="col" class="cal-cty">Where</th><th scope="col" class="cal-imp">Impact</th><th scope="col">Event</th><th scope="col" class="num">Forecast</th><th scope="col" class="num">Previous</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function scopeTabs(active) {
  return `<nav class="tabs" aria-label="Filter">${[['MAJOR', 'CALENDAR'], ['US', 'CALENDAR US'], ['ALL', 'CALENDAR ALL']].map(([k, c]) => `<a class="tab${k === active ? ' is-active' : ''}" href="${esc(q(c))}" data-cmd="${esc(c)}"${k === active ? ' aria-current="true"' : ''}>${k}</a>`).join('')}</nav>`;
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    const ex = ['CALENDAR', 'CALENDAR US', 'CALENDAR ALL'];
    el.innerHTML = panel('1', 'Calendar', `<p class="notice">CALENDAR takes US or ALL.</p><p class="muted examples">Try ${ex.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ')}</p>`, { cls: 'panel-solo' });
    ctx.status('CALENDAR: CHECK THE FORMAT', 'warn');
    return;
  }
  const scope = cmd.args.scope;
  el.innerHTML = panel('1', 'Economic calendar this week', LOADING, { cls: 'panel-solo', meta: scopeTabs(scope) })
    + `<p class="footnote">${esc(SCOPES[scope])}. Times in New York (ET). From the Forex Factory weekly feed, which lists forecast and previous values; actual results are not in it.</p>`;
  const body = el.querySelector('.panel-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/calendar', { signal: ctx.signal });
      const list = filterEvents(d.events, scope);
      body.innerHTML = list.length ? calendarTable(list) : '<p class="panel-msg">No events this week for this filter.</p>';
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH CALENDAR', 'warn');
    }
  }

  load();
  ctx.every(load, 10 * 60_000);
}
