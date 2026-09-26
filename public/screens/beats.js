// BEATS <ticker>: reported earnings per share against the consensus estimate, and the
// surprise, for the last quarters. The next report date leads the table, and a chart of
// EPS against the estimate sits beside it.

import { esc, fmtNum, fmtSigned, dirOf, panel, LOADING } from './markets.js';
import { metaNote, errorHtml, tickerUsage, fmtDay, dash } from './company-kit.js';
import { mountBars, barsLegend } from './minibars.js';

export { parseTicker as parse } from './company-kit.js';

const eps = (n) => (Number.isFinite(n) ? fmtNum(n, 2) : dash);
const signedPct = (n) => (Number.isFinite(n) ? `${fmtSigned(n, 2)}%` : dash);

// "Jun 2026" -> "JUN '26" for the chart's labels.
export function shortQuarter(q) {
  const m = /^([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(String(q || '').trim());
  return m ? `${m[1].toUpperCase()} '${m[2].slice(2)}` : String(q || '').toUpperCase();
}

// Oldest first: EPS and consensus per quarter, then the next quarter's consensus (drawn open).
export function beatsGroups(rows, next = null) {
  const groups = [...rows].reverse().map((r) => ({ label: shortQuarter(r.quarter), values: { eps: r.eps, consensus: r.consensus } }));
  if (next && Number.isFinite(next.consensus)) groups.push({ label: 'NEXT', values: { consensus: next.consensus }, open: { consensus: true } });
  return groups;
}

export function nextLine(next) {
  if (!next?.date) return '';
  return `${fmtDay(next.date)}${next.estimated ? ' (estimated)' : ''}`;
}

export function beatsTable(rows, next = null) {
  const up = next?.date ? `<tr class="bt-next hide-m">
      <th scope="row" class="name">Next report</th>
      <td class="date hide-m">${esc(nextLine(next))}</td>
      <td class="num dim">${dash}</td>
      <td class="num">${eps(next.consensus)}</td>
      <td class="num dim">${dash}</td>
    </tr>` : '';
  return `<table class="dt bt-dt">
    <thead><tr><th scope="col">Quarter</th><th scope="col" class="hide-m">Reported</th><th scope="col" class="num">EPS</th><th scope="col" class="num">Consensus</th><th scope="col" class="num">Surprise</th></tr></thead>
    <tbody>${up}${rows.map((r) => `<tr>
      <th scope="row" class="name">${esc(r.quarter)}</th>
      <td class="date hide-m">${esc(fmtDay(r.reported))}</td>
      <td class="num last">${eps(r.eps)}</td>
      <td class="num">${eps(r.consensus)}</td>
      <td class="num ${dirOf(r.surprisePct)}">${signedPct(r.surprisePct)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

const NOTE = 'EPS IN USD, AS REPORTED';
const NOTE_LONG = 'EPS = earnings per share, in USD, as reported. Consensus = the consensus estimate as published by the source. Surprise = how far reported EPS was from it, as published. An estimated next report date is projected from past report dates and may move.';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Beats', tickerUsage('BEATS', ['BEATS AAPL', 'BEATS MSFT', 'BEATS KO']), { cls: 'panel-solo' });
    ctx.status('BEATS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = panel('1', `${ticker} earnings vs estimates`, LOADING, { cls: 'panel-solo', metaId: 'bt-meta', bodyCls: 'flush' });
  const body = el.querySelector('.panel-body');
  let stopChart = null;
  ctx.onCleanup(() => stopChart?.());

  ctx.fetchJSON(`/api/beats?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    const series = [{ key: 'eps', cls: 'mb-a', label: 'Reported EPS' }, { key: 'consensus', cls: 'mb-b', label: 'Consensus' }];
    const legend = d.next && Number.isFinite(d.next.consensus) ? [...series, { key: 'n', cls: 'mb-open', label: 'Next quarter consensus' }] : series;
    body.innerHTML = `<div class="with-side side-hug co-wide">
        <div>${d.next?.date ? `<p class="bt-next-line m-only-block">Next report ${esc(nextLine(d.next))}${Number.isFinite(d.next.consensus) ? `, consensus EPS ${eps(d.next.consensus)}` : ''}</p>` : ''}${beatsTable(d.rows, d.next)}</div>
        <aside class="side-panel" aria-label="EPS against the estimate">
          <p class="side-title tag">EPS against the estimate, USD</p>
          <div class="side-chart" id="bt-chart"></div>
          ${barsLegend(legend)}
        </aside>
      </div>`;
    stopChart = mountBars(body.querySelector('#bt-chart'), beatsGroups(d.rows, d.next), series, {
      label: `${ticker} reported EPS and consensus by quarter`, fmtY: (v) => fmtNum(v, 2),
    });
    el.querySelector('#bt-meta').innerHTML = `LAST ${d.rows.length} QUARTERS · ${metaNote(NOTE, NOTE_LONG)}`;
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<div class="co-pad">${errorHtml(err, ticker)}</div>`;
    ctx.status(err.status === 404 ? `NO EARNINGS DATA FOR ${ticker}` : 'BEATS: NO DATA', 'warn');
  });
}
