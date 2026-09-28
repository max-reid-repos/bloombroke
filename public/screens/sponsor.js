// SPONSOR: three things, big. YOUR AD HERE, with the real strip at the bottom outlined and
// a small label above it; one live line of our own numbers (/api/bbrk: DataFast audience
// and the strip inventory) and what one line would get a week; one action, the email.
// Also the browser side of the sponsor config (/api/sponsors, from data/sponsors.json via
// lib/sponsors.js), and the "SPONSORED BY" note on a WEIRD gauge. The strip itself is
// public/sponsor-strip.js. Plain text and plain links: no pixels, no scripts, no tracking.

import { esc, metaNote, q } from './markets.js';
import { findCommand } from '../registry.js';
import { stripItems, loadSponsors } from '../sponsor-strip.js';

export { loadSponsors }; // the config, asked once per page load: the status line needs it at startup

export const CONTACT = 'hello@bloombroke.com';
export const SUBJECT = 'Sponsor Bloombroke';
export const MAILTO = `mailto:${CONTACT}?subject=${encodeURIComponent(SUBJECT)}`;
export const HERO = 'YOUR AD HERE';
export const POINT = '↓ this line, every screen';
export const FINE = 'One rotating line. No tracking. No finance products. Hidden for Pro.';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const count = (v) => v.toLocaleString('en-US');
// DataFast country names, short enough for one line. Any other name as it comes.
const SHORT = { 'United States': 'US', 'United States of America': 'US', 'United Kingdom': 'UK', 'United Arab Emirates': 'UAE' };

// 429 -> '7 min', 40 -> '40 s'. Unknown: '-- min'.
export function visitLen(sec) {
  if (!fin(sec) || sec < 0) return '-- min';
  return sec < 60 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`;
}

// The live line, as parts: '7 here now', '173 visitors this week', '8 min visits', '60% US'. Here
// now only when DataFast knows it and it is above 0; every other part is -- when missing.
export function proofParts(b) {
  const a = b?.audience || {};
  const parts = [];
  if (Number.isInteger(a.live) && a.live > 0) parts.push(`${count(a.live)} here now`);
  const d7 = a.visitors?.d7;
  parts.push(`${fin(d7) && d7 >= 0 ? count(d7) : '--'} visitors this week`);
  parts.push(`${visitLen(a.avgVisitSec)} visits`);
  const top = Array.isArray(a.countries) ? a.countries[0] : null;
  parts.push(top?.name && fin(top.pct) ? `${Math.round(top.pct)}% ${SHORT[top.name] || top.name}` : '-- top country');
  return parts;
}

// Paid lines already in rotation (a non-Pro visitor's strip). House lines do not count:
// the first paid line replaces them all.
export function paidLines(cfg) {
  return stripItems(cfg, { pro: false }).filter((i) => i.kind === 'paid').length;
}

// Rounded down to a clean number: under 100 as it is, then two leading digits
// (192 -> 190, 5678 -> 5600, 12345 -> 12000).
export function cleanDown(n) {
  if (!fin(n) || n < 0) return null;
  const v = Math.floor(n);
  if (v < 100) return v;
  const step = 10 ** (String(v).length - 2);
  return Math.floor(v / step) * step;
}

// Times one more line would be seen a week: the last 7 days' strip_shown shared with the
// paid lines already there (all of it when there are none). null when unknown.
export function weeklyViews(b, cfg) {
  const shown = b?.inventory?.stripShown?.d7;
  if (!fin(shown) || shown < 0) return null;
  return cleanDown(shown / (paidLines(cfg) + 1));
}

export function viewsLine(n) {
  return n === null || n === undefined ? 'Your line: -- views a week' : `Your line: about ${count(n)} views a week`;
}

export function proofHtml(b, cfg) {
  const parts = proofParts(b).map((p) => `<span class="spon-part">${esc(p)}</span>`).join('<span class="spon-dot" aria-hidden="true"> · </span>');
  return `<p class="spon-live">${parts}</p><p class="spon-views">${esc(viewsLine(weeklyViews(b, cfg)))}</p>`;
}

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

// b: /api/bbrk (null while it loads: --). cfg: /api/sponsors. has: whether a command exists.
export function sponsorHtml({ has, bbrk = null, cfg = null } = {}) {
  const weird = (has || ((c) => Boolean(findCommand(c))))('WEIRD')
    ? ` <a class="spon-weird" href="${esc(q('WEIRD'))}" data-cmd="WEIRD">Or a WEIRD gauge</a>` : '';
  return `<section class="spon-page" aria-label="Sponsor">
    <h2 class="spon-hero">${esc(HERO)}</h2>
    <div id="spon-proof" class="spon-proof">${proofHtml(bbrk, cfg)}</div>
    <p class="spon-act"><a class="spon-mail" href="${esc(MAILTO)}">EMAIL ${esc(CONTACT)}</a>${weird}</p>
    <p class="spon-fine">${esc(FINE)}</p>
  </section>`;
}

// The real strip at the bottom, while SPONSOR is open: outlined (a short glow first; still
// with reduced motion, in the CSS), with a small label just above it. Nothing for Pro (no
// strip). Returns stop(), which takes both away.
export function pointAtStrip(doc = globalThis.document, win = globalThis.window) {
  const real = doc?.getElementById?.('status-sponsor');
  if (!real || real.hidden) return () => {};
  real.classList.add('is-spot');
  const tag = doc.createElement('div');
  tag.className = 'spon-point';
  tag.setAttribute('aria-hidden', 'true');
  tag.textContent = POINT;
  doc.body.appendChild(tag);
  // Above the line itself, clear of the screen edges.
  const place = () => {
    const box = (real.querySelector?.('.spon-item') || real).getBoundingClientRect();
    const w = tag.offsetWidth || 0;
    const vw = win?.innerWidth || box.right;
    const left = Math.max(8, Math.min(box.left + box.width / 2 - w / 2, vw - w - 8));
    tag.style.left = `${Math.round(left)}px`;
    tag.style.top = `${Math.round(box.top - (tag.offsetHeight || 0) - 4)}px`;
  };
  place();
  win?.addEventListener?.('resize', place);
  return () => {
    win?.removeEventListener?.('resize', place);
    tag.remove();
    real.classList.remove('is-spot');
  };
}

export function render(el, cmd, ctx) {
  let cfg = null;
  let bbrk = null;
  el.innerHTML = sponsorHtml();
  ctx.status('SPONSOR: EMAIL US');
  const paint = () => { const h = el.querySelector('#spon-proof'); if (h) h.innerHTML = proofHtml(bbrk, cfg); };
  // After the sponsor config arrives (the status bar paints its strip from the same
  // request first), point at the real strip.
  let unpoint = () => {};
  let open = true;
  ctx.onCleanup(() => { open = false; unpoint(); });
  loadSponsors().then((c) => {
    if (!open || !el.isConnected) return;
    cfg = c;
    unpoint = pointAtStrip();
    paint();
  });
  // Our own numbers, again every minute while the screen is open.
  const load = () => {
    if (!ctx.fetchJSON) return;
    ctx.fetchJSON('/api/bbrk', { signal: ctx.signal }).then((d) => { if (open) { bbrk = d; paint(); } }).catch(() => {});
  };
  load();
  ctx.live?.(load, 60_000);
}
