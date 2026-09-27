// SPONSOR: how sponsors work on Bloombroke, on one short screen: a live preview of the
// strip, four facts, links that show what a sponsor gets, and the contact. Also the
// browser side of the sponsor config (/api/sponsors, from data/sponsors.json via
// lib/sponsors.js), and the "SPONSORED BY" note on a WEIRD gauge. The strip itself is
// public/sponsor-strip.js. Plain text and plain links: no pixels, no scripts, no tracking.

import { esc, panel, metaNote, q } from './markets.js';
import { findCommand } from '../registry.js';
import { stripItems, mountStrip, ROTATE_MS, MAX_SPONSOR_LINES } from '../sponsor-strip.js';

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
  ['DATA', 'where data comes from'],
  ['MCP', 'AI access'],
  ['WEIRD', 'sponsor one gauge'],
];
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

export function sponsorHtml({ has } = {}) {
  const link = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;
  const proof = proofLinks(has);
  return panel('1', 'Sponsor', `<div class="spon-preview" aria-label="Preview of the sponsor strip"><span class="spon-strip" id="spon-demo"></span></div>
    <ul class="spon-facts">${FACTS.map((t) => `<li>${esc(t)}</li>`).join('')}<li class="is-no">${esc(NOT_FOR)}</li></ul>
    ${proof.length ? `<ul class="spon-proof">${proof.map(([c, what]) => `<li>${link(c)} ${esc(what)}</li>`).join('')}</ul>` : ''}
    <p class="notice">Email for rates: <a href="mailto:${CONTACT}">${CONTACT}</a></p>`, { cls: 'panel-solo', meta: metaNote('EMAIL FOR RATES') });
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
}
