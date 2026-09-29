// SPONSOR: a card page (kit.js cardPage). YOUR AD HERE, big; one line of what a line
// would get a week; EMAIL (the one primary button) and BBRK NUMBERS; the rule line; three
// of our own numbers (/api/bbrk: our analytics and the strip inventory); BBRK's globe of
// visitor places under them, at --globe-w. The rest is behind + Details. While SPONSOR
// is open the real strip at the bottom is outlined, with a small label above it. The
// numbers and the globe's dots come again every minute while the tab is visible (the
// shell's ctx.live).
// Also the browser side of the sponsor config (/api/sponsors, from data/sponsors.json via
// lib/sponsors.js), and the "SPONSORED BY" note on a WEIRD gauge. The strip itself is
// public/sponsor-strip.js. Plain text and plain links: no pixels, no scripts, no tracking.

import { esc, metaNote, q } from './markets.js';
import { cardPage, cardButton, cardFacts, cardRows, raw } from '../kit.js';
import { findCommand } from '../registry.js';
import { stripItems, loadSponsors } from '../sponsor-strip.js';
import { loadDots, mountGlobe, globeLabel } from '../globe.js';
import { isPro } from '../pro.js'; // no SPONSORED BY on screen for Pro

export { loadSponsors }; // the config, asked once per page load: the status line needs it at startup

export const CONTACT = 'hello@bloombroke.com';
export const SUBJECT = 'Sponsor Bloombroke';
export const MAILTO = `mailto:${CONTACT}?subject=${encodeURIComponent(SUBJECT)}`;
export const HERO = 'YOUR AD HERE';
export const POINT = '↓ this line, every screen';
export const REFRESH_MS = 60_000;
export const PHONE_MQ = '(max-width: 639px)'; // kit.css's phone layout
export const FINE = 'One rotating line. No tracking. No finance products. Hidden for Pro.';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const count = (v) => v.toLocaleString('en-US');
// Country names from our analytics, short enough for one line. Any other name as it comes.
const SHORT = { 'United States': 'US', 'United States of America': 'US', 'United Kingdom': 'UK', 'United Arab Emirates': 'UAE' };

// 429 -> '7 min', 40 -> '40 s'. Unknown: '-- min'.
export function visitLen(sec) {
  if (!fin(sec) || sec < 0) return '-- min';
  return sec < 60 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`;
}

// Three of our own numbers, as card facts: page views this week, visit length, the top
// country. Each is -- when missing.
export function sponFacts(b) {
  const a = b?.audience || {};
  const d7 = a.pageviews?.d7;
  const top = Array.isArray(a.countries) ? a.countries[0] : null;
  const known = top?.name && fin(top.pct);
  return [
    { value: fin(d7) && d7 >= 0 ? count(d7) : '--', label: 'PAGE VIEWS, 7D' },
    { value: visitLen(a.avgVisitSec), label: 'VISITS' },
    { value: known ? `${Math.round(top.pct)}%` : '--', label: known ? (SHORT[top.name] || top.name) : 'TOP COUNTRY' },
  ];
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

export function factsHtml(b) {
  return cardFacts(sponFacts(b), { id: 'spon-facts' });
}

// A WEIRD gauge's title strip: SPONSORED BY <name>, or '' when the gauge has no sponsor.
// Never on screen for Pro (PRO says "No ads."); the public share cards keep it (og-weird).
export function gaugeSponsorHtml(cfg, id, { pro = false } = {}) {
  if (pro) return '';
  const name = cfg?.gauges?.[id]?.name;
  return name ? metaNote(`SPONSORED BY ${String(name).toUpperCase()}`) : '';
}

// The one hook in the WEIRD gauge screen: if the gauge has a sponsor, a note of its own
// goes in the title strip just before the gauge's meta, so the screen can keep writing
// its own notes (record lines) into that meta without touching this one.
// pro: asked when the config arrives (default: this browser holds active Pro).
export function markGaugeSponsor(metaEl, id, { pro = isPro } = {}) {
  if (!metaEl) return;
  loadSponsors().then((cfg) => {
    const html = gaugeSponsorHtml(cfg, id, { pro: pro() });
    if (html && metaEl.isConnected) metaEl.insertAdjacentHTML('beforebegin', `<span class="panel-meta wd-sponsor">${html}</span>`);
  });
}

// What + Details holds: where the line runs, how "your line" is counted, the WEIRD
// gauges, where the numbers come from.
export function detailsHtml(exists) {
  const weird = exists('WEIRD') ? raw(`<a class="spon-weird" href="${esc(q('WEIRD'))}" data-cmd="WEIRD">Or a WEIRD gauge</a>: your name in its title strip.`) : '';
  return cardRows([
    ['Where', 'The line at the bottom of every screen, for everyone without Pro.'],
    ['Your line', 'Last 7 days of strip views, shared with the paid lines, rounded down.'],
    weird ? ['Gauges', weird] : null,
    ['Numbers', 'Visitors: our analytics. Strip: our server counters.'],
  ]);
}

// b: /api/bbrk (null while it loads: --). cfg: /api/sponsors. has: whether a command exists.
export function sponsorHtml({ has, bbrk = null, cfg = null } = {}) {
  const exists = has || ((c) => Boolean(findCommand(c)));
  const act = cardButton({ label: `EMAIL ${CONTACT}`, primary: true, href: MAILTO })
    + (exists('BBRK') ? cardButton({ label: 'BBRK NUMBERS', cmd: 'BBRK' }) : '');
  return cardPage({
    label: 'Sponsor',
    wide: true,
    cls: 'spon-card',
    hero: raw(`<span class="spon-slot">${esc(HERO)}</span>`),
    heroSize: 96,
    sub: viewsLine(weeklyViews(bbrk, cfg)),
    subId: 'spon-views',
    act: raw(act),
    note: FINE,
    facts: factsHtml(bbrk),
    media: raw(`<figure class="spon-globe"><canvas role="img" aria-label="${esc(globeLabel(bbrk))}"></canvas></figure>`),
    details: raw(detailsHtml(exists)),
  });
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
  // When the page scrolls (a phone; a desktop too, down to the big globe), the label would
  // sit on the buttons or the globe: then it shows only while the page is scrolled to the
  // bottom, where the screen keeps room for it (sponsor.css). A page that does not scroll
  // shows it all the time. The page is the document on a phone, #screen on a desktop.
  const show = () => {
    const boxes = [doc.scrollingElement || doc.documentElement, doc.getElementById?.('screen')]
      .filter((el, i, a) => el && typeof el.scrollHeight === 'number' && a.indexOf(el) === i)
      .map((el) => ({ el, view: el.clientHeight || win?.innerHeight || 0 }))
      .filter(({ el, view }) => el.scrollHeight - view > 4);
    const hide = boxes.some(({ el, view }) => el.scrollTop + view < el.scrollHeight - 4);
    if (tag.hidden !== hide) tag.hidden = hide;
  };
  const onScroll = () => show();
  const onResize = () => { place(); show(); };
  place();
  show();
  win?.addEventListener?.('resize', onResize);
  // Capture: #screen's own scroll does not bubble to the window.
  win?.addEventListener?.('scroll', onScroll, { passive: true, capture: true });
  // stop.refresh(): again after the screen's own content changes height (sponsor render).
  const stop = () => {
    win?.removeEventListener?.('resize', onResize);
    win?.removeEventListener?.('scroll', onScroll, { capture: true });
    tag.remove();
    real.classList.remove('is-spot');
  };
  stop.refresh = show;
  return stop;
}

export function render(el, cmd, ctx) {
  let cfg = null;
  let bbrk = null;
  el.innerHTML = sponsorHtml();
  ctx.status('SPONSOR: EMAIL US');
  let globe = null;
  const canvas = el.querySelector('.spon-globe canvas');
  const paint = () => {
    const f = el.querySelector('#spon-facts');
    if (f) f.outerHTML = factsHtml(bbrk);
    const v = el.querySelector('#spon-views');
    if (v) v.textContent = viewsLine(weeklyViews(bbrk, cfg));
    canvas?.setAttribute('aria-label', globeLabel(bbrk));
    globe?.update(bbrk?.audience?.globe || null, bbrk?.audience?.live ?? null);
    unpoint.refresh?.(); // the new numbers may change the page's height
  };
  // After the sponsor config arrives (the status bar paints its strip from the same
  // request first), point at the real strip.
  let unpoint = () => {};
  let open = true;
  ctx.onCleanup(() => { open = false; unpoint(); globe?.stop(); });
  // BBRK's globe: places with 3 visitors or more only (the server folds the rest).
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  loadDots().then((geo) => {
    if (!open || !canvas?.isConnected) return;
    globe = mountGlobe(canvas, geo, bbrk?.audience?.globe || null, { reduceMotion, live: bbrk?.audience?.live ?? null });
  }).catch(() => { const f = el.querySelector('.spon-globe'); if (open && f) f.hidden = true; });
  loadSponsors().then((c) => {
    if (!open || !el.isConnected) return;
    cfg = c;
    unpoint = pointAtStrip();
    paint();
  });
  // Our own numbers and the globe's dots, again every minute while the tab is visible
  // (ctx.live skips a hidden tab and catches up when it is shown).
  const load = () => {
    if (!ctx.fetchJSON) return;
    ctx.fetchJSON('/api/bbrk', { signal: ctx.signal }).then((d) => { if (open) { bbrk = d; paint(); } }).catch(() => {});
  };
  load();
  ctx.live(load, REFRESH_MS);
}
