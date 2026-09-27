// SPONSOR: how sponsors work on Bloombroke, on one short screen: a live preview of the
// strip, four facts, links that show what a sponsor gets, and the contact. Also the
// browser side of the sponsor config (/api/sponsors, from data/sponsors.json via
// lib/sponsors.js), and the "SPONSORED BY" note on a WEIRD gauge. The strip itself is
// public/sponsor-strip.js. Plain text and plain links: no pixels, no scripts, no tracking.

import { esc, panel, metaNote, q } from './markets.js';
import { findCommand } from '../registry.js';
import { stripItems, mountStrip, ROTATE_MS, MAX_SPONSOR_LINES, loadSponsors } from '../sponsor-strip.js';

export { loadSponsors }; // the config, asked once per page load: the status line needs it at startup
import { tileBody, WEIRD_GAUGES } from './weird.js';

export const CONTACT = 'hello@bloombroke.com';
export const FACTS = [
  'Not shown to Pro users.',
  `Rotates every ${ROTATE_MS / 1000} s, up to ${MAX_SPONSOR_LINES} sponsors.`,
  'No tracking, no pixels, no scripts.',
];
export const NOT_FOR = 'Not for brokers, exchanges, crypto, funds or tip sellers.';
// What a sponsor can look at first. A link shows only when its command exists here; its
// words are the tooltip, so the page stays short.
export const PROOF = [
  ['BBRK', 'site numbers'],
  ['CHANGES', 'what is new'],
  ['DATA', 'sources'],
  ['MCP', 'AI access'],
  ['WEIRD', 'gauges'],
];
// SITE NUMBERS: a few rows from /api/bbrk, today so far and the last 7 days.
// Four rows from /api/bbrk audience and inventory; BBRK has the rest.
export const NUMBERS = [
  ['Visitors (7d)', (b) => fmtN(b?.audience?.visitors?.d7)],
  ['Avg visit', (b) => fmtDur(b?.audience?.avgVisitSec)],
  ['Strip shown (7d)', (b) => fmtN(b?.inventory?.stripShown?.d7)],
  ['Top country', (b) => topCountry(b?.audience?.countries)],
];
// The gauge shown as a sponsorship preview. Never saved to the sponsor config.
export const PREVIEW_GAUGE = 'canal';
export const PREVIEW_SPONSOR = 'SPONSORED BY YOUR NAME';

function fmtN(v) { return Number.isFinite(v) ? v.toLocaleString('en-US') : '--'; }
// 102 -> "1m 42s", 40 -> "40s". Unknown: --.
export function fmtDur(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '--';
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
export function topCountry(list) {
  const c = Array.isArray(list) ? list[0] : null;
  return c?.name && Number.isFinite(c.pct) ? `${c.name} ${Math.round(c.pct)}%` : '--';
}

// The rows, from /api/bbrk (null while it loads, or a field missing: --).
export function numbersHtml(bbrk) {
  const rows = NUMBERS.map(([label, value]) => `<tr><th scope="row">${esc(label)}</th><td class="num">${esc(value(bbrk))}</td></tr>`).join('');
  return `<table class="spon-nums"><tbody>${rows}</tbody></table>`;
}

// The terminal's bottom two rows in small: the status row with the ad line where it
// really runs, and the key bar under it.
export function bottomMockHtml() {
  return `<p class="spon-h">BOTTOM ROW, EVERY SCREEN</p>
    <div class="spon-mock" role="img" aria-label="The status row at the bottom of every screen, with the sponsor line in it">
      <div class="spon-mock-row"><span class="spon-mock-msg"></span><span class="spon-strip spon-mock-strip" id="spon-demo"></span><span class="spon-mock-legal"><span class="spon-mock-nfa">Not financial advice · </span>Terms · Feedback</span></div>
      <div class="spon-mock-keys"><span>F1 HELP</span><span class="spon-mock-key"></span><span class="spon-mock-key"></span><span class="spon-mock-more"></span></div>
    </div>`;
}

// A real WEIRD tile with a made-up sponsor, marked as a preview. d: /api/weird/<id>.
export function gaugePreviewHtml(d) {
  const g = WEIRD_GAUGES.find((x) => x.id === PREVIEW_GAUGE);
  if (!g) return '';
  return `<div class="wd-tile spon-tile" data-cmd="${esc(g.command)}" tabindex="0"><section class="panel">
    <header class="panel-head"><h2 class="panel-label">${esc(g.command)}</h2><span class="panel-meta">${metaNote(PREVIEW_SPONSOR, 'A preview: no gauge is sponsored yet')}</span></header>
    <div class="panel-body">${tileBody(g, d)}</div></section></div>`;
}

export const proofLinks = (has = (c) => Boolean(findCommand(c))) => PROOF.filter(([c]) => has(c));

// A WEIRD gauge's title strip: SPONSORED BY <name>, or '' when the gauge has no sponsor.
export function gaugeSponsorHtml(cfg, id) {
  const name = cfg?.gauges?.[id]?.name;
  return name ? metaNote(`SPONSORED BY ${String(name).toUpperCase()}`) : '';
}

// The one hook in the WEIRD gauge screen: if the gauge has a sponsor, a note of its own
// goes in the title strip just before the gauge's meta, so the screen can keep writing
// its own notes (record lines) into that meta without touching this one.
export function markGaugeSponsor(metaEl, id) {
  if (!metaEl) return;
  loadSponsors().then((cfg) => {
    const html = gaugeSponsorHtml(cfg, id);
    if (html && metaEl.isConnected) metaEl.insertAdjacentHTML('beforebegin', `<span class="panel-meta wd-sponsor">${html}</span>`);
  });
}

export function sponsorHtml({ has, bbrk = null, gauge = null } = {}) {
  const link = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;
  const hasBbrk = (has || ((c) => Boolean(findCommand(c))))('BBRK');
  // BBRK already heads the numbers block, so it is not listed twice.
  const proof = proofLinks(has).filter(([c]) => !(hasBbrk && c === 'BBRK'));
  const numbers = hasBbrk
    ? `<section class="spon-box"><h3 class="spon-h">SITE NUMBERS ${link('BBRK')}</h3><div id="spon-nums">${numbersHtml(bbrk)}</div></section>` : '';
  return panel('1', 'Sponsor', `${bottomMockHtml()}
    <ul class="spon-facts">${FACTS.map((t) => `<li>${esc(t)}</li>`).join('')}<li class="is-no">${esc(NOT_FOR)}</li></ul>
    <div class="spon-proofs">${numbers}<section class="spon-box"><div id="spon-gauge">${gaugePreviewHtml(gauge)}</div></section></div>
    ${proof.length ? `<ul class="spon-proof">${proof.map(([c, what]) => `<li title="${esc(what)}">${link(c)}</li>`).join('')}</ul>` : ''}
    <p class="notice">Email for rates: <a href="mailto:${CONTACT}">${CONTACT}</a></p>`, { cls: 'panel-solo' });
}

// The real strip at the bottom: outlined for 2 s when SPONSOR opens (static with reduced
// motion; the CSS drops the animation), so it is clear where the line runs.
export const SPOT_MS = 2000;
export function spotlightStrip(doc = globalThis.document) {
  const real = doc?.getElementById?.('status-sponsor');
  if (!real || real.hidden) return null;
  real.classList.add('is-spot');
  return setTimeout(() => real.classList.remove('is-spot'), SPOT_MS);
}

export function render(el, cmd, ctx) {
  el.innerHTML = sponsorHtml();
  ctx.status('SPONSOR: EMAIL FOR RATES');
  // After the sponsor config arrives (the status bar paints its strip from the same
  // request first), outline the real strip.
  let spot = null;
  loadSponsors().then(() => { if (el.isConnected) spot = spotlightStrip(); });
  ctx.onCleanup(() => { clearTimeout(spot); document.getElementById('status-sponsor')?.classList.remove('is-spot'); });
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let demo = null;
  ctx.onCleanup(() => demo?.stop());
  loadSponsors().then((cfg) => {
    const host = el.querySelector('#spon-demo');
    if (!host || !el.isConnected) return;
    // The real strip, as a visitor who is not Pro sees it.
    const items = stripItems(cfg, { pro: false });
    if (items.length) demo = mountStrip(host, items, { reduceMotion, isHidden: () => document.hidden });
  });
  // Proof: the site numbers and a live gauge, each filled in when it comes.
  const get = (url) => (ctx.fetchJSON ? ctx.fetchJSON(url, { signal: ctx.signal }) : Promise.reject(new Error('no fetch')));
  get('/api/bbrk').then((d) => { const h = el.querySelector('#spon-nums'); if (h) h.innerHTML = numbersHtml(d); }).catch(() => {});
  get(`/api/weird/${PREVIEW_GAUGE}`).then((d) => { const h = el.querySelector('#spon-gauge'); if (h) h.innerHTML = gaugePreviewHtml(d); })
    .catch(() => { const h = el.querySelector('#spon-gauge'); if (h) h.innerHTML = gaugePreviewHtml({ ok: false }); });
}
