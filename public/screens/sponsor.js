// SPONSOR: how sponsors work on Bloombroke, on one short screen: a live preview of the
// strip, four facts, links that show what a sponsor gets, and the contact. Also the
// browser side of the sponsor config (/api/sponsors, from data/sponsors.json via
// lib/sponsors.js), and the "SPONSORED BY" note on a WEIRD gauge. The strip itself is
// public/sponsor-strip.js. Plain text and plain links: no pixels, no scripts, no tracking.

import { esc, panel, metaNote, q } from './markets.js';
import { findCommand } from '../registry.js';
import { stripItems, mountStrip, ROTATE_MS, MAX_SPONSOR_LINES } from '../sponsor-strip.js';
import { tileBody, WEIRD_GAUGES } from './weird.js';

export const CONTACT = 'hello@bloombroke.com';
export const FACTS = [
  'Every screen, every visitor who is not Pro.',
  `Lines rotate every ${ROTATE_MS / 1000} s. Up to ${MAX_SPONSOR_LINES} sponsors.`,
  'No tracking, no pixels, no scripts.',
];
export const NOT_FOR = 'Not for brokers, exchanges, crypto, funds or tip sellers.';
// What a sponsor can look at first. A link shows only when its command exists here.
export const PROOF = [
  ['BBRK', 'site numbers'],
  ['CHANGES', 'what is new'],
  ['DATA', 'sources'],
  ['MCP', 'AI access'],
  ['WEIRD', 'gauges'],
];
// SITE NUMBERS: a few rows from /api/bbrk, today so far and the last 7 days.
export const NUMBERS = [['whatif_run', 'WHATIF results'], ['guess_played', 'GUESS games'], ['mcp_call', 'MCP calls']];
// The gauge shown as a sponsorship preview. Never saved to the sponsor config.
export const PREVIEW_GAUGE = 'canal';
export const PREVIEW_SPONSOR = 'SPONSORED BY YOUR NAME';

const fmtN = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US') : '--');

// The rows, from /api/bbrk (null while it loads or fails: every number is --).
export function numbersHtml(bbrk) {
  const rows = NUMBERS.map(([k, label]) => {
    const c = bbrk?.counts?.[k];
    return `<tr><th scope="row">${esc(label)}</th><td class="num">${fmtN(c?.today)}</td><td class="num">${fmtN(c?.d7)}</td></tr>`;
  }).join('');
  return `<table class="spon-nums"><thead><tr><th></th><th class="num">TODAY</th><th class="num">7 DAYS</th></tr></thead><tbody>${rows}</tbody></table>`;
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

// The config, asked once per page load. Anything wrong: no sponsors.
let loading = null;
export function loadSponsors() {
  const none = { lines: [], house: [], gauges: {}, line: null };
  if (typeof fetch !== 'function') return Promise.resolve(none);
  loading ||= fetch('/api/sponsors', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && typeof d === 'object'
      ? { lines: Array.isArray(d.lines) ? d.lines : [], house: Array.isArray(d.house) ? d.house : [], gauges: d.gauges || {}, line: d.line || null }
      : none))
    .catch(() => { loading = null; return none; });
  return loading;
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
  return panel('1', 'Sponsor', `<div class="spon-preview" aria-label="Preview of the sponsor strip"><span class="spon-strip" id="spon-demo"></span></div>
    <ul class="spon-facts">${FACTS.map((t) => `<li>${esc(t)}</li>`).join('')}<li class="is-no">${esc(NOT_FOR)}</li></ul>
    <div class="spon-proofs">${numbers}<section class="spon-box"><h3 class="spon-h">PREVIEW</h3><div id="spon-gauge">${gaugePreviewHtml(gauge)}</div></section></div>
    ${proof.length ? `<ul class="spon-proof">${proof.map(([c, what]) => `<li>${link(c)} ${esc(what)}</li>`).join('')}</ul>` : ''}
    <p class="notice">Email for rates: <a href="mailto:${CONTACT}">${CONTACT}</a></p>`, { cls: 'panel-solo' });
}

export function render(el, cmd, ctx) {
  el.innerHTML = sponsorHtml();
  ctx.status('SPONSOR: EMAIL FOR RATES');
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
