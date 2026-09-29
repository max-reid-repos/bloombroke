// BBRK: Bloombroke's own site numbers for sponsors, drawn as a split card page (kit.js
// cardPage split): the numbers left, the globe of visitor places right (on a phone the
// numbers first, then the globe). A joke ticker: BBRK is on no exchange (checked against
// the SEC company_tickers list and the Nasdaq and NYSE symbol lists, Sep 27 2026).
// The hero reads alone: "N visitors today", set against yesterday up to the same time in
// the line under it; the visitors a day from launch day (the first day with any visitor)
// as a chart; three facts at most; the Pro seats taken, in words; the globe with one line
// saying what a figure is. Everything else (countries, referrers, 30 days when it says
// nothing new, desktop share, MRR, the strip counters, the sources) is behind + Details.
// Totals only, from GET /api/bbrk (lib/counters.js, lib/datafast.js). Missing shows --.
// The globe (public/globe.js): visitor places of the last 7 days, countries and cities of
// 3 or more visitors rounded to about 100 km (the server folds the rest).
// Command only: a row on HOME would push the markets grid past its share of a 1536x730
// screen (tested Sep 27 2026).

import { esc, fmtSigned, dirOf } from './markets.js';
import { cardPage, cardFacts, cardRows, raw, fitToView, fmtDate } from '../kit.js';
import { loadDots, mountGlobe, globeLabel } from '../globe.js';

export const BBRK = 'BBRK';
export const KICKER = 'BBRK · OUR OWN SITE NUMBERS';
export const STRIP = 'OUR OWN SITE NUMBERS. NOT A SECURITY. NOT FOR SALE.';
export const SOURCE = 'Visitors: our analytics. Strip, embeds, MCP: our server counters. Days in New York time.';
// What a figure on the globe is (globe.js: a place of the last 7 days, a country or a city
// of 3 or more; nearby places merge into one figure, and the number under it is their
// visitors, drawn from 2 up). One line, the same "7 days" as the fact.
export const GLOBE_CAPTION = 'Each figure is a place with visitors in 7 days; its number is how many.';
export const MAX_FACTS = 3;
export const GLOBE_MAX = 560; // px: the globe in the right column, at most (fitToView)

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

// The hero, a sentence that reads alone: '12 visitors today', '1 visitor today', 'No
// visitors yet today' (a zero said, not printed), '-- visitors today' while unknown.
export function heroText(today) {
  if (!fin(today) || today < 0) return '-- visitors today';
  if (today === 0) return 'No visitors yet today';
  return `${count(today)} ${Math.round(today) === 1 ? 'visitor' : 'visitors'} today`;
}

// Today so far against yesterday up to the same time: { text, dir }. '+12', '−3', '±0';
// '--' when either is unknown (never '0 0.00%').
export function heroChange(today, before) {
  if (!fin(today) || !fin(before)) return { text: '--', dir: 'flat' };
  const ch = Math.round(today - before);
  return { text: ch === 0 ? '±0' : fmtSigned(ch, 0), dir: dirOf(ch) };
}

// The line under the hero: '+12 vs same time yesterday', or '' (no line) when either
// number is unknown.
export function subHtml(v) {
  if (!fin(v?.today) || !fin(v?.yesterdaySoFar)) return '';
  const chg = heroChange(v.today, v.yesterdaySoFar);
  return `<span class="num ${chg.dir}">${esc(chg.text)}</span> vs same time yesterday`;
}

// 'US 41% · UK 9% · Canada 6%', or '--'.
export function topLine(list) {
  const rows = Array.isArray(list) ? list.filter((x) => x?.name) : [];
  return rows.length ? rows.map((x) => `${x.name} ${pct(x.pct)}`).join(' · ') : '--';
}

// Visitors a day from launch day: the days from the first one with any visitor to today,
// never the empty days before. { values, from } (from: its New York date when day, today's,
// is known), or null with no visitor yet.
export function sinceLaunch(spark, day = null) {
  const v = (Array.isArray(spark) ? spark : []).map((n) => (fin(n) ? n : 0));
  const first = v.findIndex((n) => n > 0);
  if (first < 0) return null;
  const values = v.slice(first);
  let from = null;
  const m = typeof day === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (m) from = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] - (values.length - 1))).toISOString().slice(0, 10);
  return { values, from };
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
  const label = `Visitors a day since launch day, ${v.length} days. Today so far: ${count(v[v.length - 1])}.`;
  return `<svg class="bb-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">`
    + `<path class="bb-spark-area" d="${line} L${w} ${h} L0 ${h} Z"/>`
    + `<path class="bb-spark-line" d="${line}" vector-effect="non-scaling-stroke"/>`
    + `<path class="bb-spark-dot" d="M${lx.toFixed(1)} ${ly.toFixed(1)} h0" vector-effect="non-scaling-stroke"/></svg>`;
}

// The chart and its two ends: launch day at the left, TODAY at the right. '' before launch.
export function chartHtml(d) {
  const s = sinceLaunch(d?.audience?.spark30, d?.day);
  const svg = s ? chartSvg(s.values) : '';
  if (!svg) return '';
  return svg + `<p class="bb-ends" aria-hidden="true"><span>${esc(s.from ? fmtDate(s.from) : '')}</span><span>TODAY</span></p>`;
}

// 'MRR $0 (test mode)' -> '$0, test mode': a row in + Details, never a tile up front
// (while checkout is in test mode it is a note for us, not a number for visitors). null: no row.
export function mrrText(mrr) {
  const m = /^MRR (\S+)(?: \((.+)\))?$/.exec(String(mrr || ''));
  return m ? `${m[1]}${m[2] ? `, ${m[2]}` : ''}` : null;
}

// Three facts at most, in this order: visitors in 7 days, in 30 days (only when it says
// something new), the average visit, returning visitors. What does not fit is in + Details.
export function allFacts(d) {
  const a = d?.audience || {};
  const v = a.visitors || {};
  const d30 = fin(v.d30) && v.d30 !== v.d7;
  return [
    { value: count(v.d7), label: '7 DAYS', key: 'd7' },
    d30 ? { value: count(v.d30), label: '30 DAYS', key: 'd30' } : null,
    { value: visitTime(a.avgVisitSec), label: 'AVG VISIT', key: 'visit' },
    { value: pct(a.returningPct), label: 'RETURNING', key: 'returning' },
  ].filter(Boolean);
}

export const factsOf = (d) => allFacts(d).slice(0, MAX_FACTS).map(({ value, label }) => ({ value, label }));

// The Pro seats taken: the licences of the current Stripe mode (lib/counters.js seats.all).
// Live: '3 Pro seats taken', and a calm 'No Pro seats taken yet' for none. Test mode: no
// one has paid, so 'No paid Pro seats yet' (the test seats are a row in + Details). ''
// when unknown (no Stripe, no database).
export function seatsText(d) {
  const all = d?.seats?.all;
  if (!Number.isInteger(all) || all < 0) return '';
  if (d.mode === 'test') return 'No paid Pro seats yet';
  if (d.mode !== 'live') return '';
  return all === 0 ? 'No Pro seats taken yet' : `${count(all)} Pro ${all === 1 ? 'seat' : 'seats'} taken`;
}

export function seatsHtml(d) {
  const t = seatsText(d);
  const html = esc(t).replace(/^([\d,]+) /, '<span class="num">$1</span> ');
  return `<p class="bb-seats" id="bb-seats"${t ? '' : ' hidden'}>${html}</p>`;
}

export function factsHtml(d) {
  return `<div class="bb-numbers">${cardFacts(factsOf(d), { id: 'bb-facts' })}${seatsHtml(d)}</div>`;
}

export function detailsHtml(d) {
  const a = d?.audience || {};
  const inv = d?.inventory || {};
  const shown = new Set(allFacts(d).slice(0, MAX_FACTS).map((f) => f.key));
  const rest = allFacts(d).filter((f) => !shown.has(f.key));
  const v30 = a.visitors?.d30;
  const invRows = INVENTORY.map(([k, label]) => `<tr><th scope="row">${esc(label)}</th><td class="num">${count(inv[k]?.today)}</td><td class="num">${count(inv[k]?.d7)}</td></tr>`).join('');
  const testSeats = d?.mode === 'test' && Number.isInteger(d?.seats?.all) ? `${count(d.seats.all)} in test mode, no card charged` : null;
  return cardRows([
    ['Countries', topLine(a.countries)],
    ['Referrers', topLine(a.referrers)],
    // 30 days: here when it is not a fact up front (the same as 7 days, or no room).
    shown.has('d30') ? null : ['30 days', fin(v30) ? `${count(v30)} visitors` : '--'],
    ...rest.filter((f) => f.key !== 'd30').map((f) => [f.label === 'AVG VISIT' ? 'Avg visit' : 'Returning', f.value]),
    ['Desktop', pct(a.desktopPct)],
  ])
    + `<table class="grid-table bb-table">
    <thead><tr><th scope="col"><span class="offscreen">Sponsor inventory</span></th><th scope="col" class="num">Today</th><th scope="col" class="num">7D</th></tr></thead>
    <tbody>${invRows}</tbody>
  </table>`
    + cardRows([
      ...(mrrText(d?.mrr) ? [['MRR', mrrText(d.mrr)]] : []),
      ...(testSeats ? [['Pro seats', testSeats]] : []),
      ['Sources', SOURCE],
      ['BBRK', 'Not a security. Not for sale.'],
    ]);
}

export function globeHtml(d) {
  return `<figure class="bb-globe"><canvas role="img" aria-label="${esc(globeLabel(d))}"></canvas><figcaption class="bb-caption">${esc(GLOBE_CAPTION)}</figcaption></figure>`;
}

// The whole card. d: /api/bbrk, or null while it loads (-- everywhere).
export function bbrkHtml(d) {
  const v = d?.audience?.visitors || {};
  return cardPage({
    label: 'BBRK, our own site numbers',
    split: true,
    cls: 'bb-card',
    art: raw(globeHtml(d)),
    kicker: KICKER,
    hero: heroText(v.today),
    heroId: 'bb-hero',
    heroSize: 44,
    sub: raw(`<span id="bb-sub">${subHtml(v)}</span>`),
    chart: raw(`<div class="bb-chart" id="bb-chart">${chartHtml(d)}</div>`),
    facts: factsHtml(d),
    details: raw(`<div id="bb-details">${detailsHtml(d)}</div>`),
  });
}

// The globe's words for a screen reader live with the globe (globe.js).
export { globeCaption, globeLabel } from '../globe.js';

export function render(el, cmd, ctx) {
  el.innerHTML = bbrkHtml(null);
  const fig = el.querySelector('.bb-globe');
  const canvas = fig.querySelector('canvas');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let globe = null;
  let latest = null;
  // The globe takes the room left in the first view, up to GLOBE_MAX in the right column
  // (never below the fold on a desktop); again when the window or the numbers change size.
  const fit = () => { fitToView(fig, { max: GLOBE_MAX }); globe?.update(latest?.audience?.globe || null, latest?.audience?.live ?? null); };
  let frame = 0; // a resize fits once a frame, not once an event
  const onResize = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; fit(); }); };
  fitToView(fig, { max: GLOBE_MAX });
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
    const swap = (sel, html) => { const n = el.querySelector(sel); if (n) n.outerHTML = html; };
    swap('#bb-facts', cardFacts(factsOf(d), { id: 'bb-facts' }));
    swap('#bb-seats', seatsHtml(d));
    set('#bb-hero', esc(heroText(d?.audience?.visitors?.today)));
    set('#bb-sub', subHtml(d?.audience?.visitors));
    set('#bb-chart', chartHtml(d));
    set('#bb-details', detailsHtml(d));
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
