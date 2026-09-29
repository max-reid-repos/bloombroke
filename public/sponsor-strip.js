// The sponsor strip in the status bar: one line at a time, a new one every 4 seconds,
// with a short slide in (none with reduced motion). It holds still while the pointer is
// on it or it has the keyboard focus, and while the tab is hidden. Paid lines are marked
// SPONSOR and open the sponsor's site; our own lines are marked AD and run a command.
// Pro users see nothing. The same component is the live preview on the SPONSOR screen.

import { goal } from './goal.js';

// The config, asked once per page load. Anything wrong: no sponsors. price: SPONSOR's line.
let loading = null;
export function loadSponsors() {
  const none = { lines: [], house: [], gauges: {}, line: null };
  if (typeof fetch !== 'function') return Promise.resolve(none);
  loading ||= fetch('/api/sponsors', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && typeof d === 'object'
      ? { lines: Array.isArray(d.lines) ? d.lines : [], house: Array.isArray(d.house) ? d.house : [], gauges: d.gauges || {}, line: d.line || null, price: d.price }
      : none))
    .catch(() => { loading = null; return none; });
  return loading;
}

export const ROTATE_MS = 4000;
export const MAX_SPONSOR_LINES = 8;
export const SLIDE_MS = 180;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// cfg from /api/sponsors -> the lines to rotate. Paid lines when there are any, else our
// own. None at all for Pro.
export function stripItems(cfg, { pro = false } = {}) {
  if (pro || !cfg) return [];
  const paid = (cfg.lines?.length ? cfg.lines : cfg.line ? [cfg.line] : [])
    .filter((l) => l?.name && l?.text)
    .map((l) => ({ kind: 'paid', label: 'SPONSOR', text: `${l.name}: ${l.text}`, url: /^https:\/\//.test(l.url || '') ? l.url : null }));
  if (paid.length) return paid;
  return (cfg.house || []).filter((l) => l?.text).map((l) => ({ kind: 'house', label: 'AD', text: l.text, cmd: l.cmd || 'SPONSOR' }));
}

// One line. A paid line with a link opens it in a new tab with no referrer; an AD line
// runs its command in the terminal (the app's data-cmd click).
export function itemHtml(item) {
  if (!item) return '';
  const inner = `<span class="sponsor-k">${esc(item.label)}</span><span class="spon-text">${esc(item.text)}</span>`;
  if (item.kind === 'paid') {
    return item.url
      ? `<a class="spon-item" href="${esc(item.url)}" rel="sponsored noopener" referrerpolicy="no-referrer" target="_blank">${inner}</a>`
      : `<span class="spon-item">${inner}</span>`;
  }
  const q = `?${new URLSearchParams({ c: item.cmd })}`;
  return `<a class="spon-item" href="${esc(q)}" data-cmd="${esc(item.cmd)}">${inner}</a>`;
}

// Rotate items in host. Returns { stop, next, index, paused }. isHidden: whether the tab
// is hidden (skips a turn). reduceMotion: swap without the slide. onPaidClick: a click on
// a paid line (the sponsor_click goal; our own AD lines send nothing). onShow: a line
// was shown while the tab is visible; onAnyClick: a click on any line (BBRK's strip
// inventory; the status bar counts, the SPONSOR screen preview does not).
export function mountStrip(host, items, { reduceMotion = false, isHidden = () => false, rotateMs = ROTATE_MS, onPaidClick = () => goal('sponsor_click'), onShow = () => {}, onAnyClick = () => {} } = {}) {
  let i = 0;
  let hover = false;
  let focus = false;
  let slide = null;
  const show = (animate) => {
    host.innerHTML = itemHtml(items[i]);
    if (!isHidden()) { try { onShow(items[i]); } catch { /* a count never stops the strip */ } }
    if (!animate || reduceMotion) return;
    host.classList.remove('is-sliding');
    void host.offsetWidth; // restart the animation
    host.classList.add('is-sliding');
    clearTimeout(slide);
    slide = setTimeout(() => host.classList.remove('is-sliding'), SLIDE_MS);
  };
  const ctl = {
    get index() { return i; },
    get paused() { return hover || focus; },
    next() {
      if (items.length < 2 || ctl.paused || isHidden()) return false;
      i = (i + 1) % items.length;
      show(true);
      return true;
    },
    stop() {
      clearInterval(timer);
      clearTimeout(slide);
      for (const [t, f] of on) host.removeEventListener(t, f);
      host.classList.remove('is-sliding');
    },
  };
  const on = [
    ['mouseenter', () => { hover = true; }],
    ['mouseleave', () => { hover = false; }],
    ['focusin', () => { focus = true; }],
    ['focusout', () => { focus = false; }],
    ['click', (e) => {
      if (e?.target?.closest?.('a.spon-item[rel~="sponsored"]')) onPaidClick();
      if (e?.target?.closest?.('a.spon-item')) { try { onAnyClick(); } catch { /* never blocks the link */ } }
    }],
  ];
  for (const [t, f] of on) host.addEventListener(t, f);
  show(false);
  const timer = items.length > 1 ? setInterval(() => ctl.next(), rotateMs) : null;
  return ctl;
}
