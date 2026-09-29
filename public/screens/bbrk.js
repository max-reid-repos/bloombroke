// BBRK: Bloombroke's own site numbers for sponsors, drawn as a card page (kit.js
// cardPage). A joke ticker: BBRK is on no exchange (checked against the SEC
// company_tickers list and the Nasdaq and NYSE symbol lists, Sep 27 2026). The hero is
// visitors so far today, set against yesterday up to the same time; the last 30 days as
// a chart across the column; six key numbers; the globe of visitor places under them.
// Everything else (countries, referrers, what a sponsor gets from our own counters, the
// sources) is behind + Details. Totals only, from GET /api/bbrk (lib/counters.js,
// lib/datafast.js). Anything missing shows --.
// The globe (public/globe.js), at --globe-w, centred under the numbers: visitor places of
// the last 7 days, countries and cities of 3 or more visitors rounded to about 100 km
// (the server folds the rest).
// Command only: a row on HOME would push the markets grid past its share of a 1536x730
// screen (tested Sep 27 2026).

import { esc, fmtSigned, dirOf } from './markets.js';
import { cardPage, cardFacts, cardRows, raw, fitToView } from '../kit.js';
import { loadDots, mountGlobe, globeCaption, globeLabel } from '../globe.js';
import { HERE_MIN } from '../here-now.js';

export const BBRK = 'BBRK';
export const KICKER = 'BBRK · OUR OWN SITE NUMBERS';
export const STRIP = 'OUR OWN SITE NUMBERS. NOT A SECURITY. NOT FOR SALE.';
export const SOURCE = 'Visitors: our analytics. Strip, embeds, MCP: our server counters. Days in New York time.';

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

// Today so far against yesterday up to the same time: { text, dir }. '+12', '−3', '±0';
// '--' when either is unknown (never '0 0.00%').
export function heroChange(today, before) {
  if (!fin(today) || !fin(before)) return { text: '--', dir: 'flat' };
  const ch = Math.round(today - before);
  return { text: ch === 0 ? '±0' : fmtSigned(ch, 0), dir: dirOf(ch) };
}

// The line under the hero: 'visitors today · +12 vs same time yesterday'.
export function subHtml(v) {
  const chg = heroChange(v?.today, v?.yesterdaySoFar);
  return `visitors today · <span class="num ${chg.dir}">${esc(chg.text)}</span> vs same time yesterday`;
}

// 'US 41% · UK 9% · Canada 6%', or '--'.
export function topLine(list) {
  const rows = Array.isArray(list) ? list.filter((x) => x?.name) : [];
  return rows.length ? rows.map((x) => `${x.name} ${pct(x.pct)}`).join(' · ') : '--';
}

// Visitors a day, across the column: an area from zero, the line, a dot on the last day.
// No axes. The SVG stretches to the column (the line and the dot keep their width).
export function chartSvg(values, { w = 300, h = 96 } = {}) {
  const v = (Array.isArray(values) ? values : []).filter(fin);
  if (v.length < 2) return '';
  const hi = Math.max(...v, 1);
  const pts = v.map((y, i) => [(i / (v.length - 1)) * w, h - 4 - (Math.max(0, y) / hi) * (h - 12)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  const label = `Visitors a day, last ${v.length} days. Latest day: ${count(v[v.length - 1])}.`;
  return `<svg class="bb-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">`
    + `<path class="bb-spark-area" d="${line} L${w} ${h} L0 ${h} Z"/>`
    + `<path class="bb-spark-line" d="${line}" vector-effect="non-scaling-stroke"/>`
    + `<path class="bb-spark-dot" d="M${lx.toFixed(1)} ${ly.toFixed(1)} h0" vector-effect="non-scaling-stroke"/></svg>`;
}

// 'MRR $0 (test mode)' -> { value: '$0', label: 'MRR, TEST MODE' }.
export function mrrFact(mrr) {
  const m = /^MRR (\S+)(?: \((.+)\))?$/.exec(String(mrr || ''));
  return m ? { value: m[1], label: `MRR${m[2] ? `, ${m[2].toUpperCase()}` : ''}` } : { value: '--', label: 'MRR' };
}

export function factsOf(d) {
  const a = d?.audience || {};
  const v = a.visitors || {};
  return [
    { value: count(v.d7), label: '7 DAYS' },
    { value: count(v.d30), label: '30 DAYS' },
    { value: visitTime(a.avgVisitSec), label: 'AVG VISIT' },
    { value: pct(a.returningPct), label: 'RETURNING' },
    { value: pct(a.desktopPct), label: 'DESKTOP' },
    mrrFact(d?.mrr),
  ];
}

// The globe's one line: '3 here now · top: United States 71%'. Here now from HERE_MIN,
// like the top bar (1 is most likely the viewer).
export function bbrkCaption(d) {
  const a = d?.audience || {};
  const parts = [];
  if (Number.isInteger(a.live) && a.live >= HERE_MIN) parts.push(`${count(a.live)} here now`);
  const top = Array.isArray(a.countries) ? a.countries.find((c) => c?.name) : null;
  if (top) parts.push(`top: ${top.name} ${pct(top.pct)}`);
  return parts.length ? parts.join(' · ') : globeCaption(null);
}

export function detailsHtml(d) {
  const a = d?.audience || {};
  const inv = d?.inventory || {};
  const invRows = INVENTORY.map(([k, label]) => `<tr><th scope="row">${esc(label)}</th><td class="num">${count(inv[k]?.today)}</td><td class="num">${count(inv[k]?.d7)}</td></tr>`).join('');
  return cardRows([['Countries', topLine(a.countries)], ['Referrers', topLine(a.referrers)]])
    + `<table class="grid-table bb-table">
    <thead><tr><th scope="col"><span class="offscreen">Sponsor inventory</span></th><th scope="col" class="num">Today</th><th scope="col" class="num">7D</th></tr></thead>
    <tbody>${invRows}</tbody>
  </table>`
    + cardRows([['Sources', SOURCE], ['BBRK', 'Not a security. Not for sale.']]);
}

export function globeHtml(d) {
  return `<figure class="bb-globe"><canvas role="img" aria-label="${esc(globeLabel(d))}"></canvas><figcaption class="bb-caption">${esc(bbrkCaption(d))}</figcaption></figure>`;
}

// The whole card. d: /api/bbrk, or null while it loads (-- everywhere).
export function bbrkHtml(d) {
  const v = d?.audience?.visitors || {};
  return cardPage({
    label: 'BBRK, our own site numbers',
    wide: true,
    cls: 'bb-card',
    kicker: KICKER,
    hero: count(v.today),
    heroId: 'bb-hero',
    heroSize: 60,
    sub: raw(subHtml(v)),
    subId: 'bb-sub',
    chart: raw(`<div class="bb-chart" id="bb-chart">${chartSvg(d?.audience?.spark30)}</div>`),
    facts: cardFacts(factsOf(d), { id: 'bb-facts' }),
    media: raw(globeHtml(d)),
    details: raw(`<div id="bb-details">${detailsHtml(d)}</div>`),
  });
}

// The globe's caption and its words for a screen reader live with the globe (SPONSOR
// shows the same globe).
export { globeCaption, globeLabel } from '../globe.js';

export function render(el, cmd, ctx) {
  el.innerHTML = bbrkHtml(null);
  const fig = el.querySelector('.bb-globe');
  const canvas = fig.querySelector('canvas');
  const caption = fig.querySelector('figcaption');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let globe = null;
  let latest = null;
  // The globe takes the room left in the first view (never below the fold on a desktop);
  // again when the window or the numbers above it change size.
  const fit = () => { fitToView(fig); globe?.update(latest?.audience?.globe || null, latest?.audience?.live ?? null); };
  let frame = 0; // a resize fits once a frame, not once an event
  const onResize = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; fit(); }); };
  fitToView(fig);
  document.fonts?.ready.then(() => { if (fig.isConnected) fit(); });
  window.addEventListener('resize', onResize);
  loadDots().then((geo) => {
    if (ctx.signal?.aborted || !canvas.isConnected) return;
    globe = mountGlobe(canvas, geo, latest?.audience?.globe || null, { reduceMotion: reduce, live: latest?.audience?.live ?? null });
  }).catch(() => { fig.hidden = true; });
  const stop = () => { globe?.stop(); window.removeEventListener('resize', onResize); cancelAnimationFrame(frame); };
  ctx.signal?.addEventListener('abort', stop);
  // New numbers go into their own places, so the globe keeps turning and an open
  // + Details stays open.
  const paint = (d) => {
    const set = (sel, html) => { const n = el.querySelector(sel); if (n) n.innerHTML = html; };
    const f = el.querySelector('#bb-facts');
    if (f) f.outerHTML = cardFacts(factsOf(d), { id: 'bb-facts' });
    set('#bb-hero', esc(count(d?.audience?.visitors?.today)));
    set('#bb-sub', subHtml(d?.audience?.visitors));
    set('#bb-chart', chartSvg(d?.audience?.spark30));
    set('#bb-details', detailsHtml(d));
    caption.textContent = bbrkCaption(d);
    canvas.setAttribute('aria-label', globeLabel(d));
  };
  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/bbrk', { signal: ctx.signal });
      latest = d;
      paint(d);
      fit();
      ctx.updated(d.updated, false);
      ctx.status(`${BBRK}: ${STRIP}`);
    } catch (err) {
      if (err.name === 'AbortError') return;
      ctx.status('COULD NOT REFRESH BBRK', 'warn');
    }
  }
  ctx.status(`${BBRK}: ${STRIP}`);
  load();
  ctx.live(load, 60_000);
  return stop;
}
