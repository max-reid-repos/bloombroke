// SPONSOR: a card page (kit.js cardPage), one column. It sells the one rotating line at
// the bottom of every screen: the kicker, the headline, how many times the strip was
// shown this week (and what that counts), the price when SPONSOR_PRICE is set, EMAIL (the
// one primary button), the rules in one line, then TRY YOUR LINE: what the visitor types
// shows in the REAL strip at the bottom of the screen while this page is open (never
// saved, never sent; it goes into the EMAIL body only). BBRK's numbers are a text link;
// the rest (where it runs, what is refused, the audience) is behind + Details.
// While SPONSOR is open the real strip is outlined, with a small label above it. The
// numbers come again every minute while the tab is visible (the shell's ctx.live).
// Also the browser side of the sponsor config (/api/sponsors, from data/sponsors.json via
// lib/sponsors.js), and the "SPONSORED BY" note on a WEIRD gauge. The strip itself is
// public/sponsor-strip.js. Plain text and plain links: no pixels, no scripts, no tracking code.

import { esc, metaNote, q } from './markets.js';
import { cardPage, cardButton, cardLink, cardRows, raw } from '../kit.js';
import { findCommand } from '../registry.js';
import { loadSponsors } from '../sponsor-strip.js';
import { isPro } from '../pro.js'; // no SPONSORED BY on screen for Pro

export { loadSponsors }; // the config, asked once per page load: the status line needs it at startup

export const CONTACT = 'hello@bloombroke.com';
export const SUBJECT = 'Sponsor Bloombroke';
export const MAILTO = `mailto:${CONTACT}?subject=${encodeURIComponent(SUBJECT)}`;
export const HERO = 'Your line on every screen.';
// Rule G (kit.css): the last phrase never breaks, so a phone reads "Your line" / "on every
// screen." and a desktop one line.
export const HERO_TAIL = 'on every screen.';
export function heroHtml() {
  return `${esc(HERO.slice(0, -HERO_TAIL.length).trim())} <span class="nowrap">${esc(HERO_TAIL)}</span>`;
}
export const POINT = '↓ this line, every screen';
export const REFRESH_MS = 60_000;
export const PHONE_MQ = '(max-width: 639px)'; // kit.css's phone layout
// The rules, true of the code: one line at a time (sponsor-strip.js), plain text and a link
// with its query string taken off (lib/sponsors.js), no strip for Pro (stripItems).
export const FINE = 'One rotating line. No tracking code. Hidden for Pro.';
// What "Shown N times this week" counts: inventory.stripShown.d7 (lib/counters.js
// strip_shown). One showing is ROTATE_MS (4 s) of a strip line on a visible screen,
// however many lines rotate (public/sponsor-strip.js mountStrip).
export const SHOWN_DEF = 'One showing = 4 seconds on a visible screen.';
export const SHOWN_DETAIL = 'Showings in the last 7 days (New York days, today included), counted by our server. Lines share the showings: with 3 lines in rotation, each gets about a third.';
export const TRY_LABEL = 'TRY YOUR LINE';
export const TRY_MAX = 100; // lib/sponsors.js TEXT_MAX: the longest line text we run
export const TRY_HOLDER = 'Acme: plain words about Acme';
export const NOT_FOR = 'No investment products, brokers, exchanges, crypto, funds or tips.';
// FEED SPONSOR: one sponsor for the live price feed, by email only (no checkout, no public price).
export const FEED_SUBJECT = 'Feed sponsor';
export const FEED = {
  title: 'Feed sponsor',
  line: 'Sponsor the live price feed. One line in the status bar and on share cards.',
  ask: 'Price by email:',
  note: 'Non-financial companies only. Starts when licensed prices go live.',
};
export function feedHtml() {
  const mail = `mailto:${CONTACT}?subject=${encodeURIComponent(FEED_SUBJECT)}`;
  return `<div class="spon-feed" id="spon-feed"><h3 class="tag spon-feed-title">${esc(FEED.title)}</h3>`
    + `<p class="spon-feed-line">${esc(FEED.line)}</p>`
    + `<p class="spon-feed-note">${esc(FEED.note)} ${esc(FEED.ask)} <a href="${esc(mail)}">${esc(CONTACT)}</a>.</p></div>`;
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const count = (v) => Math.round(v).toLocaleString('en-US');

// The line under the headline: the real count of strip lines shown in the last 7 days.
// null: unknown (while it loads, or no counters): '--'.
export function shownCount(b) {
  const n = b?.inventory?.stripShown?.d7;
  return fin(n) && n >= 0 ? n : null;
}

export function shownLine(n) {
  if (n === null || n === undefined) return 'Shown -- times this week.';
  if (n === 0) return 'Not shown yet this week.';
  return `Shown ${count(n)} ${n === 1 ? 'time' : 'times'} this week.`;
}

export function subHtml(b) {
  return `<span id="spon-views">${esc(shownLine(shownCount(b)))}</span><span class="spon-def">${esc(SHOWN_DEF)}</span>`;
}

// '$99 a week', or '' (no price line at all) when SPONSOR_PRICE is unset or not a price.
export function priceText(cfg) {
  const p = cfg?.price;
  return Number.isInteger(p) && p > 0 ? `$${count(p)} a week` : '';
}

export function priceHtml(cfg) {
  const t = priceText(cfg);
  return `<p class="spon-price" id="spon-price"${t ? '' : ' hidden'}>${esc(t)}</p>`;
}

// The EMAIL link: the subject, and the typed line (if any) as the body. Encoded, so an &,
// a # or a new line cannot end the body or start another field.
export function mailtoFor(line = '') {
  const t = String(line ?? '').replace(/\s+/g, ' ').trim().slice(0, TRY_MAX);
  return t ? `${MAILTO}&body=${encodeURIComponent(`Our line: ${t}`)}` : MAILTO;
}

// 'US 77% · Japan 12%' (the top countries, as BBRK names them), or null.
function topLine(list) {
  const rows = Array.isArray(list) ? list.filter((x) => x?.name && fin(x.pct)) : [];
  return rows.length ? rows.map((x) => `${x.name} ${Math.round(x.pct)}%`).join(' · ') : null;
}

// 68 -> '1m 08s' (BBRK's AVG VISIT).
function visitTime(sec) {
  if (!fin(sec) || sec < 0) return null;
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// Who sees the line, in BBRK's words: visitors in 7 days, the average visit, the countries.
export function audienceRows(b) {
  const a = b?.audience || {};
  const d7 = a.visitors?.d7;
  const visit = visitTime(a.avgVisitSec);
  const people = fin(d7) && d7 >= 0 ? `${count(d7)} in 7 days${visit ? `, ${visit} average visit` : ''}` : '--';
  return [['Visitors', people], ['Countries', topLine(a.countries) || '--']];
}

// What + Details holds: what the number counts, where the line runs, what we refuse, the
// WEIRD gauges, who sees it, where the numbers come from.
export function detailsHtml(exists, b = null) {
  const weird = exists('WEIRD') ? raw(`<a class="spon-weird" href="${esc(q('WEIRD'))}" data-cmd="WEIRD">Or a WEIRD gauge</a>: your name in its title strip.`) : '';
  return cardRows([
    ['Shown', SHOWN_DETAIL],
    ['Where', 'The line at the bottom of every screen, for everyone without Pro.'],
    ['Not for', NOT_FOR],
    ['Your line', 'Plain text and one link. No pixels, no scripts, no tracking code. Sponsors get no data from us.'],
    weird ? ['Gauges', weird] : null,
    ...audienceRows(b),
    ['Numbers', 'Visitors: our analytics. Strip: our server counters.'],
  ]);
}

// TRY YOUR LINE: a label and one input, no form (nothing to submit), no name (its value
// never goes into a URL). What is typed shows in the real strip (tryLine).
export function tryHtml() {
  return `<div class="spon-try"><label class="tag" for="spon-try">${esc(TRY_LABEL)}</label>`
    + `<input class="card-input spon-try-input" id="spon-try" type="text" maxlength="${TRY_MAX}" autocomplete="off" spellcheck="false" enterkeyhint="done" placeholder="${esc(TRY_HOLDER)}"></div>`;
}

// b: /api/bbrk (null while it loads: --). cfg: /api/sponsors. has: whether a command exists.
export function sponsorHtml({ has, bbrk = null, cfg = null } = {}) {
  const exists = has || ((c) => Boolean(findCommand(c)));
  const act = priceHtml(cfg) + cardButton({ label: `EMAIL ${CONTACT}`, primary: true, href: MAILTO, id: 'spon-email' });
  return cardPage({
    label: 'Sponsor',
    cls: 'spon-card',
    kicker: 'SPONSOR',
    hero: raw(heroHtml()),
    heroSize: 44,
    sub: raw(subHtml(bbrk)),
    act: raw(act),
    note: FINE,
    media: raw(tryHtml()),
    links: exists('BBRK') ? [`<span class="spon-numbers">Numbers: ${cardLink({ label: 'BBRK', cmd: 'BBRK' })}</span>`] : [],
    details: raw(`<div id="spon-details">${detailsHtml(exists, bbrk)}</div>`),
  }).replace(/<\/section>$/, `${feedHtml()}</section>`); // FEED SPONSOR: a second offer, under + Details
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

// Whether TRY YOUR LINE has a strip to show in: not for Pro (no strip), not in an embed
// (no status bar), not while the strip is hidden.
export function canTry(real, { pro = isPro, doc = globalThis.document } = {}) {
  if (!real || real.hidden) return false;
  if (doc?.documentElement?.classList?.contains('is-embed')) return false;
  return !pro();
}

// The typed line in the REAL strip at the bottom: its lines hidden, the text drawn by the
// CSS from data-try (sponsor.css), so it is never markup. The strip holds still and counts
// nothing while it shows (app.js isHidden). '' puts the strip back. Nothing is stored.
export function tryLine(real, text) {
  if (!real) return;
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, TRY_MAX);
  if (t) {
    real.setAttribute('data-try', t);
    real.classList.add('is-try');
  } else {
    real.classList.remove('is-try');
    real.removeAttribute('data-try');
  }
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
  // Above the line itself, clear of the screen edges. A typed line hides the strip's own
  // line: then above the strip.
  const place = () => {
    const item = real.classList?.contains?.('is-try') ? null : real.querySelector?.('.spon-item');
    const box = (item || real).getBoundingClientRect();
    const w = tag.offsetWidth || 0;
    const vw = win?.innerWidth || box.right;
    const left = Math.max(8, Math.min(box.left + box.width / 2 - w / 2, vw - w - 8));
    tag.style.left = `${Math.round(left)}px`;
    tag.style.top = `${Math.round(box.top - (tag.offsetHeight || 0) - 4)}px`;
  };
  // When the page scrolls (a phone), the label would sit on the buttons: then it shows
  // only while the page is scrolled to the bottom, where the screen keeps room for it
  // (sponsor.css). A page that does not scroll shows it all the time. The page is the
  // document on a phone, #screen on a desktop.
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
  // stop.refresh(): again after the screen's own content changes height (sponsor render);
  // stop.place(): again after the strip's line changes (TRY YOUR LINE).
  const stop = () => {
    win?.removeEventListener?.('resize', onResize);
    win?.removeEventListener?.('scroll', onScroll, { capture: true });
    tag.remove();
    real.classList.remove('is-spot');
  };
  stop.refresh = show;
  stop.place = place;
  return stop;
}

export function render(el, cmd, ctx) {
  let cfg = null;
  let bbrk = null;
  const exists = (c) => Boolean(findCommand(c));
  el.innerHTML = sponsorHtml({ has: exists });
  ctx.status('SPONSOR: EMAIL US');
  const input = el.querySelector?.('#spon-try');
  const email = el.querySelector?.('#spon-email');
  const real = () => globalThis.document?.getElementById?.('status-sponsor') || null;
  // TRY YOUR LINE only where the strip shows: never for Pro or in an embed (no strip).
  const tryBox = input?.closest?.('.card-media');
  const fitTry = () => { if (tryBox) tryBox.hidden = !canTry(real()); };
  fitTry();
  let typed = '';
  const paint = () => {
    const v = el.querySelector('#spon-views');
    if (v) v.textContent = shownLine(shownCount(bbrk));
    const p = el.querySelector('#spon-price');
    if (p) { const t = priceText(cfg); p.textContent = t; p.hidden = !t; }
    const d = el.querySelector('#spon-details');
    if (d) d.innerHTML = detailsHtml(exists, bbrk);
    unpoint.refresh?.(); // the new numbers may change the page's height
  };
  // After the sponsor config arrives (the status bar paints its strip from the same
  // request first), point at the real strip.
  let unpoint = () => {};
  let open = true;
  // TRY YOUR LINE: into the real strip and the EMAIL body as it is typed; nowhere else.
  const onInput = () => {
    typed = input.value;
    tryLine(real(), typed);
    email?.setAttribute('href', mailtoFor(typed));
    unpoint.place?.();
  };
  input?.addEventListener('input', onInput);
  const onPro = () => { fitTry(); if (tryBox?.hidden) tryLine(real(), ''); };
  globalThis.window?.addEventListener?.('bb:pro', onPro);
  ctx.onCleanup(() => {
    open = false;
    input?.removeEventListener('input', onInput);
    globalThis.window?.removeEventListener?.('bb:pro', onPro);
    tryLine(real(), '');
    unpoint();
  });
  loadSponsors().then((c) => {
    if (!open || !el.isConnected) return;
    cfg = c;
    unpoint = pointAtStrip();
    fitTry();
    if (typed) tryLine(real(), typed);
    paint();
  });
  // Our own numbers, again every minute while the tab is visible (ctx.live skips a hidden
  // tab and catches up when it is shown).
  const load = () => {
    if (!ctx.fetchJSON) return;
    ctx.fetchJSON('/api/bbrk', { signal: ctx.signal }).then((d) => { if (open) { bbrk = d; paint(); } }).catch(() => {});
  };
  load();
  ctx.live(load, REFRESH_MS);
}
