// FEDPATH: the Fed funds rate implied by 30-day Fed funds futures, month by month,
// against today's target range. 100 minus the futures price is the average rate the
// market is paying for that month. No meeting probabilities: this is the prices only.

import { esc, fmtNum, fmtBp, fmtAsOf, panel, metaNote, LOADING } from './markets.js';
import { mountLines, legend } from './lines.js';
import { freshTag } from '../freshness.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// "2026-10" -> "OCT 2026" (long) or "OCT" (short).
export function monthLabel(ym, short = false) {
  const m = Number(String(ym).slice(5, 7));
  if (!(m >= 1 && m <= 12)) return '--';
  return short ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${String(ym).slice(0, 4)}`;
}

// Month rows -> a step line: each month is flat from its start to the next.
export function stepPoints(values) {
  const out = [];
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    out.push({ x: i, y: v }, { x: i + 0.999, y: v });
  });
  return out;
}

export const LABEL = 'Implied by futures prices. Not a forecast by Bloombroke.';

const METHOD = `<details class="fp-method"><summary>HOW THIS IS WORKED OUT</summary>
  <p>Each 30-day Fed funds futures contract (CBOT) settles on 100 minus the average effective Fed funds rate over its calendar month. So 100 minus today's price is the average rate traders are paying for that month. Example: a price of 96.105 implies 3.895%.</p>
  <p>The column "vs effective" is that implied rate minus today's effective Fed funds rate (EFFR), in basis points (1 bp = 0.01%). The change column is the move in the implied rate today: the price change with the sign flipped.</p>
  <p>This screen shows prices only. It does not turn them into odds for each Fed meeting, and it is not a forecast.</p>
</details>`;

// "Not a forecast", short, in the futures panel's title strip.
const FP_NOTE = metaNote('IMPLIED BY FUTURES, NOT A FORECAST', LABEL);

export function render(el, cmd, ctx) {
  // The "not a forecast" line is a short note in the futures panel's title strip.
  el.innerHTML = `<div class="stack">
    ${panel('1', 'Fed funds path', `<div class="chart-host" id="fp-chart">${LOADING}</div><div id="fp-legend"></div>`, { metaId: 'fp-meta', bodyCls: 'flush' })}
    ${panel('2', 'Fed funds futures', LOADING, { metaId: 'fp-t-meta', meta: `${FP_NOTE} · ${freshTag({ realTime: false })} CBOT` })}
  </div>
  ${METHOD}`;
  const host = el.querySelector('#fp-chart');
  const leg = el.querySelector('#fp-legend');
  const meta = el.querySelector('#fp-meta');
  const tBody = el.querySelectorAll('.panel-body')[1];
  let cleanup = null;
  ctx.onCleanup(() => cleanup?.());

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/fedpath', { signal: ctx.signal });
      const months = d.months;
      const fed = d.fed;
      const series = [{ id: 'imp', cls: 'ln-0', label: 'Implied by futures', points: stepPoints(months.map((m) => m.implied)), gapX: 1 }];
      if (fed && Number.isFinite(fed.to) && Number.isFinite(fed.from)) {
        series.push({ id: 'top', cls: 'ln-4', label: `Target range today ${fmtNum(fed.from, 2)}-${fmtNum(fed.to, 2)}%`, points: [{ x: 0, y: fed.to }, { x: months.length, y: fed.to }] });
        series.push({ id: 'bot', cls: 'ln-4', label: '', points: [{ x: 0, y: fed.from }, { x: months.length, y: fed.from }] });
      }
      const base = fed
        ? `<span class="dim">TARGET</span> <span class="num">${esc(`${fmtNum(fed.from, 2)}-${fmtNum(fed.to, 2)}%`)}</span> <span class="m-hide"><span class="dim">EFFECTIVE</span> <span class="num">${esc(Number.isFinite(fed.effective) ? `${fmtNum(fed.effective, 2)}%` : '--')}</span></span>`
        : '<span class="dim">TARGET RANGE --</span>';
      meta.innerHTML = base;
      leg.innerHTML = legend(series.filter((s) => s.label));
      cleanup?.();
      host.textContent = '';
      const narrow = host.clientWidth < 520;
      cleanup = mountLines(host, series, {
        fmtY: (v) => `${fmtNum(v, 2)}%`,
        fmtX: (x) => monthLabel(months[Math.floor(x)]?.month, true),
        xTicks: months.map((_, i) => i + 0.5).filter((_, i) => !narrow || i % 2 === 0),
        label: 'Fed funds rate implied by futures, by month',
        onHover(h) {
          const m = h && months[Math.min(months.length - 1, Math.floor(h.x))];
          meta.innerHTML = m ? `<span class="num">${esc(monthLabel(m.month))} ${esc(Number.isFinite(m.implied) ? `${fmtNum(m.implied, 3)}%` : `-- ${m.gap || ''}`)}</span>` : base;
        },
      });
      tBody.innerHTML = `<table class="grid-table fp-table">
        <thead><tr><th scope="col">Month</th><th scope="col" class="num">Implied rate</th><th scope="col" class="num">Price</th><th scope="col" class="num">vs effective</th><th scope="col" class="num chg">Chg today</th><th scope="col" class="num time">Time</th></tr></thead>
        <tbody>${months.map((m) => {
          if (m.gap) return `<tr><th scope="row" class="name">${esc(monthLabel(m.month))}</th><td class="num dim" colspan="5">-- ${esc(m.gap)}</td></tr>`;
          const move = Number.isFinite(m.change) ? -m.change : NaN;
          return `<tr>
            <th scope="row" class="name">${esc(monthLabel(m.month))}</th>
            <td class="num last">${esc(`${fmtNum(m.implied, 3)}%`)}</td>
            <td class="num">${esc(fmtNum(m.price, 4))}</td>
            <td class="num">${esc(fmtBp(m.vsEffective))}</td>
            <td class="num chg bp">${esc(Number.isFinite(move) ? fmtBp(move * 100) : '--')}</td>
            <td class="num time dim">${esc(fmtAsOf(m.asOf))}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
      const gaps = months.filter((m) => m.gap).length;
      el.querySelector('#fp-t-meta').innerHTML = `${FP_NOTE} · ${freshTag({ realTime: false })} ${months.length - gaps} CONTRACTS${gaps ? ` · ${gaps} WITHOUT A PRICE` : ''}`;
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!host.querySelector('svg')) host.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH FEDPATH', 'warn');
    }
  }

  load();
  ctx.live(load, 60_000);
}
