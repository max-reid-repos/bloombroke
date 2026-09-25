// BREADTH: how many stocks rose and fell. By exchange for the last full session
// (Nasdaq screener), and the S&P 100 by sector right now (the HEATMAP list).

import { esc, fmtNum, panel, LOADING, rerender } from './markets.js';
import { statusLine } from '../freshness.js';

// Both tables put the split bar right after a fixed-width name column, so the bars in
// the two panels start at the same x.
// A bar split into rising, unchanged and falling shares of the total.
export function splitBar(up, unch, down) {
  const total = up + unch + down;
  if (!(total > 0)) return '';
  const w = (n) => (n / total) * 100;
  const a = w(up);
  const b = w(unch);
  return `<svg class="bb-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="bb-up" x="0" y="1" width="${a.toFixed(2)}" height="6"/><rect class="bb-unch" x="${a.toFixed(2)}" y="1" width="${b.toFixed(2)}" height="6"/><rect class="bb-down" x="${(a + b).toFixed(2)}" y="1" width="${w(down).toFixed(2)}" height="6"/></svg>`;
}

// Rising stocks per falling one: 1.52, or -- when nothing fell.
export function adRatio(up, down) {
  return down > 0 ? up / down : null;
}

const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '--');
const fmtPctPlain = (n) => (Number.isFinite(n) ? `${fmtNum(n, 0)}%` : '--');
// Shares: 1.9B, 340M.
export function fmtShares(n) {
  if (!Number.isFinite(n)) return '--';
  if (n >= 1e9) return `${fmtNum(n / 1e9, 2)}B`;
  if (n >= 1e6) return `${fmtNum(n / 1e6, 0)}M`;
  return fmtInt(n);
}

function exchangeTable(exs) {
  return `<table class="grid-table bb-table">
    <thead><tr><th scope="col">Exchange</th><th scope="col" class="bar-cell">Split</th><th scope="col" class="num">Up</th><th scope="col" class="num">Down</th><th scope="col" class="num bb-x">Unch</th><th scope="col" class="num">% up</th><th scope="col" class="num bb-x">Up/down</th><th scope="col" class="num bb-x">Up volume</th><th scope="col" class="num bb-x">Down volume</th></tr></thead>
    <tbody>${exs.map((e) => (e.missing
      ? `<tr><th scope="row" class="name">${esc(e.name)}</th><td class="bar-cell"></td><td class="num">--</td><td class="num">--</td><td class="num bb-x">--</td><td class="num">--</td><td class="num bb-x">--</td><td class="num bb-x">--</td><td class="num bb-x">--</td></tr>`
      : `<tr>
        <th scope="row" class="name">${esc(e.name)}</th>
        <td class="bar-cell">${splitBar(e.up, e.unchanged, e.down)}</td>
        <td class="num up">${fmtInt(e.up)}</td>
        <td class="num down">${fmtInt(e.down)}</td>
        <td class="num bb-x flat">${fmtInt(e.unchanged)}</td>
        <td class="num last">${fmtPctPlain(e.upPct)}</td>
        <td class="num bb-x">${esc(Number.isFinite(adRatio(e.up, e.down)) ? fmtNum(adRatio(e.up, e.down), 2) : '--')}</td>
        <td class="num bb-x">${esc(fmtShares(e.upVolume))}</td>
        <td class="num bb-x">${esc(fmtShares(e.downVolume))}</td>
      </tr>`)).join('')}</tbody>
  </table>`;
}

function sectorTable(sectors, all) {
  const row = (s, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}>
    <th scope="row" class="name">${esc(s.name)}</th>
    <td class="bar-cell">${splitBar(s.up, s.unchanged, s.down)}</td>
    <td class="num up">${fmtInt(s.up)}</td>
    <td class="num down">${fmtInt(s.down)}</td>
    <td class="num bb-x flat">${fmtInt(s.unchanged)}</td>
    <td class="num last">${fmtPctPlain(s.upPct)}</td>
  </tr>`;
  return `<table class="grid-table bb-table">
    <thead><tr><th scope="col">Sector</th><th scope="col" class="bar-cell">Split</th><th scope="col" class="num">Up</th><th scope="col" class="num">Down</th><th scope="col" class="num bb-x">Unch</th><th scope="col" class="num">% up</th></tr></thead>
    <tbody>${all ? row({ ...all, name: `All S&P 100 (${all.total})` }, 'bb-all') : ''}${sectors.map((s) => row(s)).join('')}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="stack">
    ${panel('1', 'Breadth by exchange', LOADING, { metaId: 'bb-meta' })}
    ${panel('2', 'S&P 100 by sector', LOADING, { metaId: 'bb-s-meta', cmd: 'HEATMAP' })}
  </div>
  <p class="footnote">Exchanges: every listed stock in the Nasdaq stock screener, at the close of the last full session; up or down against the close before. Volume is shares traded in the rising and falling stocks. S&P 100: live prices, the same list as HEATMAP. The screener has no 52-week highs or lows. Not financial advice.</p>`;
  const [xBody, sBody] = el.querySelectorAll('.panel-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/breadth', { signal: ctx.signal });
      rerender(xBody, exchangeTable(d.exchanges));
      el.querySelector('#bb-meta').innerHTML = `SESSION ${esc(d.sessionDate || '--')}<span class="m-hide"> · NASDAQ SCREENER</span>`;
      rerender(sBody, d.sectors.length ? sectorTable(d.sectors, d.sp100) : '<p class="panel-msg">S&P 100 prices are taking a break.</p>');
      el.querySelector('#bb-s-meta').textContent = d.sp100 ? `${d.sp100.up} OF ${d.sp100.total} UP` : '--';
      ctx.status(`${statusLine(d.updated, d.stale)} · EXCHANGES: SESSION ${d.sessionDate || '--'}`, d.stale ? 'warn' : '');
    } catch (err) {
      if (err.name === 'AbortError') return;
      for (const b of [xBody, sBody]) if (!b.querySelector('table')) b.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH BREADTH', 'warn');
    }
  }

  load();
  ctx.live(load, 60_000);
}
