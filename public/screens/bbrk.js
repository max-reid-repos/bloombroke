// BBRK: Bloombroke's own site numbers, drawn like a quote screen. A joke ticker: BBRK is
// on no exchange (checked against the SEC company_tickers list and the Nasdaq and NYSE
// symbol lists, Sep 27 2026). The "price" is today's WHATIF results; the table has the
// other counters. Totals only, from our own server (lib/counters.js, GET /api/bbrk).
// A counter the server does not have yet shows --. Command only: a row on HOME would
// push the markets grid past its share of a 1536x730 screen (tested Sep 27 2026).

import { esc, fmtSigned, fmtPct, dirOf, panel, metaNote, LOADING } from './markets.js';

export const BBRK = 'BBRK';
export const STRIP = 'OUR OWN SITE NUMBERS. NOT A SECURITY. NOT FOR SALE.';
export const SOURCE = 'Bloombroke server counters, updated live';
export const HERO = 'whatif_run';

// [counter, label]. seats is the Pro seats row (licences in the current Stripe mode).
export const ROWS = [
  ['whatif_run', 'WHATIF results run'],
  ['whatif_video', 'WHATIF videos saved'],
  ['whatif_embed', 'WHATIF embeds copied'],
  ['whatif_share', 'WHATIF shares'],
  ['guess_played', 'GUESS games played'],
  ['guess_shared', 'GUESS games shared'],
  ['mcp_call', 'MCP tool calls'],
  ['feedback_sent', 'Feedback notes received'],
  ['seats', 'Pro seats issued'],
];

const count = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '--');

// The counter's { today, yesterday, d7, all }, or null.
export function counterOf(d, name) {
  const c = name === 'seats' ? d?.seats : d?.counts?.[name];
  return c && typeof c === 'object' ? c : null;
}

export function seatsLabel(d) {
  return d?.mode === 'test' ? 'Pro seats issued (test mode)' : 'Pro seats issued';
}

// Today against yesterday: { text, dir }. "+3 +33.33%"; no yesterday: the change only.
export function heroChange(c) {
  if (!c) return { text: '--', dir: 'flat' };
  const ch = c.today - c.yesterday;
  const pct = c.yesterday > 0 ? (ch / c.yesterday) * 100 : null;
  return { text: `${fmtSigned(ch, 0)} ${pct === null ? '' : fmtPct(pct)}`.trim(), dir: dirOf(ch) };
}

export function bbrkHtml(d) {
  const hero = counterOf(d, HERO);
  const chg = heroChange(hero);
  const stat = (k, v) => `<div class="stat"><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`;
  const rows = ROWS.map(([name, label]) => {
    const c = counterOf(d, name);
    const text = name === 'seats' ? seatsLabel(d) : label;
    return `<tr><th scope="row">${esc(text)}</th><td class="num">${count(c?.today)}</td><td class="num">${count(c?.d7)}</td><td class="num">${count(c?.all)}</td></tr>`;
  }).join('');
  return `<div class="q-top bb-top">
    <div class="q-main">
      <p class="q-name">${BBRK} <span class="dim">Bloombroke site numbers</span></p>
      <p class="q-hero num"><span class="q-last">${count(hero?.today)}</span><span class="q-ccy">WHATIF RESULTS TODAY</span></p>
      <p class="q-chg num ${chg.dir}">${esc(chg.text)} <span class="dim">vs yesterday</span></p>
      <p class="q-asof dim">Source: ${esc(SOURCE)}</p>
    </div>
    <dl class="stats">
      ${stat('Yesterday', count(hero?.yesterday))}
      ${stat('7 days', count(hero?.d7))}
      ${stat('All time', count(hero?.all))}
      ${stat('MRR', d?.mrr ? d.mrr.replace(/^MRR /, '') : '--')}
    </dl>
  </div>
  <table class="grid-table bb-table">
    <thead><tr><th scope="col">Counter</th><th scope="col" class="num">Today</th><th scope="col" class="num">7 days</th><th scope="col" class="num">All time</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', BBRK, LOADING, { cls: 'panel-solo bb-panel', meta: metaNote(STRIP) });
  const body = el.querySelector('.panel-body');
  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/bbrk', { signal: ctx.signal });
      body.innerHTML = bbrkHtml(d);
      ctx.updated(d.updated, false);
      ctx.status(`${BBRK}: ${STRIP}`);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = bbrkHtml(null);
      ctx.status('COULD NOT REFRESH BBRK', 'warn');
    }
  }
  load();
  ctx.live(load, 30_000);
}
