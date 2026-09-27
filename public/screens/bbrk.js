// BBRK: Bloombroke's own site numbers for sponsors, drawn like a quote screen. A joke
// ticker: BBRK is on no exchange (checked against the SEC company_tickers list and the
// Nasdaq and NYSE symbol lists, Sep 27 2026). The "price" is visitors so far today, set
// against yesterday up to the same time, with 30 days as a sparkline. Then who they are
// (DataFast, last 30 days) and what a sponsor gets (our own counters). Totals only, from
// GET /api/bbrk (lib/counters.js, lib/datafast.js). Anything missing shows --.
// The globe (public/globe.js): visitor countries of the last 7 days, country level only.
// Command only: a row on HOME would push the markets grid past its share of a 1536x730
// screen (tested Sep 27 2026).

import { esc, fmtSigned, fmtPct, dirOf, panel, metaNote, LOADING } from './markets.js';
import { sparkSvg } from './economy.js';
import { loadDots, mountGlobe } from '../globe.js';

export const BBRK = 'BBRK';
export const STRIP = 'OUR OWN SITE NUMBERS. NOT A SECURITY. NOT FOR SALE.';
export const SOURCE = 'Visitors: DataFast. Strip, embeds, MCP: our server counters. Days in New York time.';

// [inventory key, label]: today and the last 7 days.
export const INVENTORY = [
  ['stripShown', 'Sponsor strip shown'],
  ['stripClicks', 'Sponsor strip clicks'],
  ['embedLoads', 'Embed loads'],
  ['mcpCalls', 'MCP calls'],
];

const fin = (n) => typeof n === 'number' && Number.isFinite(n);
export const count = (n) => (fin(n) ? Math.round(n).toLocaleString('en-US') : '--');
export const pct = (n) => (fin(n) ? `${Math.round(n)}%` : '--');

// 68 -> '1m 08s', 42 -> '42s'.
export function visitTime(sec) {
  if (!fin(sec) || sec < 0) return '--';
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// Today so far against yesterday up to the same time: { text, dir }. '+12 +8.00%'.
export function heroChange(today, before) {
  if (!fin(today) || !fin(before)) return { text: '--', dir: 'flat' };
  const ch = today - before;
  return { text: `${fmtSigned(ch, 0)} ${before > 0 ? fmtPct((ch / before) * 100) : ''}`.trim(), dir: dirOf(ch) };
}

// 'US 41% · UK 9% · Canada 6%', or '--'.
export function topLine(list) {
  const rows = Array.isArray(list) ? list.filter((x) => x?.name) : [];
  return rows.length ? rows.map((x) => `${x.name} ${pct(x.pct)}`).join(' · ') : '--';
}

export function bbrkHtml(d) {
  const a = d?.audience || {};
  const v = a.visitors || {};
  const inv = d?.inventory || {};
  const chg = heroChange(v.today, v.yesterdaySoFar);
  const stat = (k, val) => `<div class="stat"><dt>${esc(k)}</dt><dd class="num">${esc(val)}</dd></div>`;
  const spark = Array.isArray(a.spark30) && a.spark30.length > 1 ? sparkSvg(a.spark30, 240, 36) : '';
  const invRows = INVENTORY.map(([k, label]) => `<tr><th scope="row">${esc(label)}</th><td class="num">${count(inv[k]?.today)}</td><td class="num">${count(inv[k]?.d7)}</td></tr>`).join('');
  return `<div class="q-top bb-top">
    <div class="q-main">
      <p class="q-name">${BBRK} <span class="dim">Visitors today</span></p>
      <p class="q-hero num"><span class="q-last">${count(v.today)}</span></p>
      <p class="q-chg num ${chg.dir}">${esc(chg.text)} <span class="dim">vs yesterday, same time</span></p>
      ${spark ? `<p class="bb-spark" title="Visitors a day, last 30 days">${spark}<span class="dim">30 days</span></p>` : ''}
    </div>
    <dl class="stats">
      ${stat('Visitors 7D', count(v.d7))}
      ${stat('Visitors 30D', count(v.d30))}
      ${stat('Avg visit', visitTime(a.avgVisitSec))}
      ${stat('Returning', pct(a.returningPct))}
      ${stat('Desktop', pct(a.desktopPct))}
      ${stat('MRR', d?.mrr ? d.mrr.replace(/^MRR /, '') : '--')}
    </dl>
  </div>
  <dl class="bb-tops">
    <div><dt>Countries</dt><dd>${esc(topLine(a.countries))}</dd></div>
    <div><dt>Referrers</dt><dd>${esc(topLine(a.referrers))}</dd></div>
  </dl>
  <table class="grid-table bb-table">
    <thead><tr><th scope="col"><span class="offscreen">Sponsor inventory</span></th><th scope="col" class="num">Today</th><th scope="col" class="num">7D</th></tr></thead>
    <tbody>${invRows}</tbody>
  </table>
  <p class="q-asof dim bb-src">${esc(SOURCE)}</p>`;
}

// The globe's caption: '7D by country · 4 live now'.
export function globeCaption(d) {
  const live = d?.audience?.live;
  return `7D by country${fin(live) ? ` · ${count(live)} live now` : ''}`;
}

// The canvas's words for a screen reader: the countries and their visitors.
export function globeLabel(d) {
  const g = d?.audience?.globe;
  const list = (g?.countries || []).slice(0, 8).map((c) => `${c.cc} ${count(c.visitors)}`).join(', ');
  return `Globe of visitors by country, last 7 days${list ? `: ${list}` : ''}${fin(g?.other) && g.other > 0 ? `, other ${count(g.other)}` : ''}.`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', BBRK, `<div class="bb-grid"><div class="bb-data">${LOADING}</div>
    <figure class="bb-globe"><canvas role="img" aria-label="Globe of visitors by country"></canvas><figcaption class="dim">${esc(globeCaption(null))}</figcaption></figure></div>`,
  { cls: 'panel-solo bb-panel', meta: metaNote(STRIP) });
  const body = el.querySelector('.bb-data');
  const canvas = el.querySelector('.bb-globe canvas');
  const caption = el.querySelector('.bb-globe figcaption');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let globe = null;
  let latest = null;
  loadDots().then((geo) => {
    if (ctx.signal?.aborted || !canvas.isConnected) return;
    globe = mountGlobe(canvas, geo, latest?.audience?.globe?.countries || [], { reduceMotion: reduce });
  }).catch(() => { el.querySelector('.bb-globe').hidden = true; });
  ctx.signal?.addEventListener('abort', () => globe?.stop());
  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/bbrk', { signal: ctx.signal });
      latest = d;
      body.innerHTML = bbrkHtml(d);
      caption.textContent = globeCaption(d);
      canvas.setAttribute('aria-label', globeLabel(d));
      globe?.update(d.audience?.globe?.countries || []);
      ctx.updated(d.updated, false);
      ctx.status(`${BBRK}: ${STRIP}`);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = bbrkHtml(null);
      ctx.status('COULD NOT REFRESH BBRK', 'warn');
    }
  }
  load();
  ctx.live(load, 60_000);
  return () => globe?.stop();
}
