// NEWS: finance headlines from a few public feeds, newest first, refreshed every minute.

import { esc, panel, LOADING } from './markets.js';
import { toolbar, segmented } from '../kit.js';

const SHORT = {
  CNBC: 'CNBC', MarketWatch: 'MKTW', 'Yahoo Finance': 'YHOO', 'Federal Reserve': 'FED', BLS: 'BLS', 'SEC EDGAR': 'SEC',
  'PR Newswire': 'PRN', GlobeNewswire: 'GNW', 'Business Wire': 'BW', 'r/wallstreetbets': 'WSB',
};

// NEWS tabs: NEWS alone is MARKETS; NEWS SEC opens that tab.
export const NEWS_TABS = ['MARKETS', 'MACRO', 'SEC', 'WIRES', 'WSB'];
export const tabCommand = (tab) => (tab === 'MARKETS' ? 'NEWS' : `NEWS ${tab}`);

// NEWS <tab> -> { tab }. Anything else is not this screen (null): NEWS <ticker> is.
export function parse(args) {
  return args.length === 1 && NEWS_TABS.includes(args[0]) ? { tab: args[0] } : null;
}

// Each tab's sources, in the panel's title strip.
export const TAB_SOURCES = {
  MARKETS: 'CNBC · MKTW · YHOO', MACRO: 'FED · BLS', SEC: 'SEC EDGAR', WIRES: 'GNW · PRN · BW', WSB: 'REDDIT',
};

export const newsApi = (tab) => (tab === 'MARKETS' ? '/api/news' : `/api/news?tab=${encodeURIComponent(tab)}`);
export const shortSource = (name) => SHORT[name] || String(name || '').slice(0, 4).toUpperCase();

export function safeHref(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// Today in New York -> "13:02". Older -> "SEP 24".
export function fmtNewsTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '--';
  const day = (x) => x.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  if (day(d) === day(now)) {
    return d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: '2-digit' }).toUpperCase();
}

// The same day on a phone: "9/24" (fits the narrow time column without wrapping).
export function fmtNewsTimeShort(iso, now = new Date()) {
  const long = fmtNewsTime(iso, now);
  if (!/^[A-Z]{3} \d{2}$/.test(long)) return long;
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' });
}

// The time cell: SEP 24 on wide screens, 9/24 on phones (CSS picks one).
export function newsTimeHtml(iso, now = new Date()) {
  const long = fmtNewsTime(iso, now);
  const short = fmtNewsTimeShort(iso, now);
  return long === short
    ? `<span class="news-time num">${esc(long)}</span>`
    : `<span class="news-time num"><span class="nt-l">${esc(long)}</span><span class="nt-s">${esc(short)}</span></span>`;
}

// NEWS source filter: ALL or one feed's short name.
export function filterNews(items, src) {
  return !src || src === 'ALL' ? items : items.filter((n) => shortSource(n.source) === src);
}

const TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// SEC tab rows (they carry a ticker field): the filer's ticker opens its screen, then
// "Company: item words" opens the filing. Filers with no listed ticker are dimmed.
function filingCell(n, href) {
  const t = TICKER.test(n.ticker || '') ? n.ticker : null;
  const tk = t ? `<a class="news-tkr" href="?${esc(new URLSearchParams({ c: t }).toString())}" data-cmd="${esc(t)}">${esc(t)}</a>` : '<span class="news-tkr"></span>';
  return `<span class="news-title news-filing">${tk}<a class="news-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a></span>`;
}

// ---- Live refresh ----------------------------------------------------------------
// NEWS and the HOME news box ask again every minute while the page is on show (ctx.live
// pauses while it is hidden). Stories that were not there before slide in at the top and
// glow for a moment; the title strip says "N NEW" until the reader does something, or
// for 30 seconds.

export const NEWS_POLL_MS = 60_000;
export const NEW_BADGE_MS = 30_000;
export const GLOW_MS = 2000;

// One key per story, the rule the server dedupes by: filings by link (a company files
// "Results" every quarter), headlines by their words.
export function newsKey(n) {
  const filing = 'ticker' in (n || {}) || n?.source === 'SEC' || n?.source === 'SEC EDGAR';
  if (filing) return `l:${n.link || ''}`;
  return `t:${String(n?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

// One copy of each story, first one kept (the list comes newest first).
export function dedupeNews(items) {
  const seen = new Set();
  return (items || []).filter((n) => {
    const k = newsKey(n);
    if (k === 't:' || k === 'l:' || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Which stories are new since the last look. The first look has none (everything on
// screen is simply the news). A story seen once never counts as new again, even if it
// drops off the list and comes back.
export function newsTracker({ maxSeen = 3000 } = {}) {
  let seen = null;
  return {
    // items -> Set of the new keys.
    track(items) {
      const keys = (items || []).map(newsKey);
      const first = !seen;
      if (first) seen = new Set();
      const fresh = new Set();
      for (const k of keys) {
        if (!first && !seen.has(k)) fresh.add(k);
        seen.add(k);
      }
      while (seen.size > maxSeen) seen.delete(seen.values().next().value);
      return fresh;
    },
    get started() { return seen !== null; },
  };
}

// The "N NEW" count: grows with each look that brings new stories, back to 0 when the
// reader does something or NEW_BADGE_MS pass.
export function newCounter() {
  let n = 0;
  return { add: (k) => { n += k; return n; }, clear: () => { n = 0; }, get count() { return n; } };
}

export const newBadge = (n) => (n > 0 ? `<span class="news-new" role="status">${n} NEW</span>` : '');

// The first row still on screen in the scroller, and where it sits, so a repaint that
// adds rows above it can put it back in the same place.
function scrollerOf(el) {
  const box = el.closest('.panel-body');
  if (box && box.scrollHeight > box.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(box).overflowY)) return box;
  return null; // the page itself scrolls (phones)
}
function anchorOf(el) {
  const box = scrollerOf(el);
  const scrolled = box ? box.scrollTop > 0 : window.scrollY > 0 && el.getBoundingClientRect().top < 0;
  if (!scrolled) return null;
  const top = box ? box.getBoundingClientRect().top : 0;
  for (const row of el.querySelectorAll('.news-row[data-k]')) {
    const r = row.getBoundingClientRect();
    if (r.bottom > top) return { box, key: row.dataset.k, y: r.top };
  }
  return null;
}
function restoreAnchor(el, a) {
  if (!a) return;
  const row = [...el.querySelectorAll('.news-row[data-k]')].find((r) => r.dataset.k === a.key);
  if (!row) return;
  const dy = row.getBoundingClientRect().top - a.y;
  if (!dy) return;
  if (a.box) a.box.scrollTop += dy; else window.scrollBy(0, dy);
}

// One live news list: body gets the rows, meta (the title strip) the "N NEW" badge in
// front of metaHtml(). show(items, html) paints; items are the rows html shows.
export function liveNews({ body, meta = null, metaHtml = () => '', ctx }) {
  const tracker = newsTracker();
  const counter = newCounter();
  const glow = new Set();
  let timer = null;
  const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  let listening = false;
  const paintMeta = () => { if (meta) meta.innerHTML = `${newBadge(counter.count)}${metaHtml()}`; };
  function clear() {
    if (!counter.count) return;
    counter.clear();
    clearTimeout(timer);
    stopListening();
    paintMeta();
  }
  function stopListening() {
    if (!listening) return;
    listening = false;
    for (const e of EVENTS) document.removeEventListener(e, clear, true);
  }
  ctx.onCleanup?.(() => { clearTimeout(timer); stopListening(); });

  function show(allItems, shownItems, html) {
    const fresh = tracker.track(allItems);
    const shownFresh = shownItems.map(newsKey).filter((k) => fresh.has(k));
    if (shownFresh.length) {
      counter.add(shownFresh.length);
      for (const k of shownFresh) glow.add(k);
      setTimeout(() => {
        for (const k of shownFresh) glow.delete(k);
        for (const row of body.querySelectorAll('.news-row.is-new')) if (!glow.has(row.dataset.k)) row.classList.remove('is-new');
      }, GLOW_MS);
      clearTimeout(timer);
      timer = setTimeout(clear, NEW_BADGE_MS);
      if (!listening) {
        listening = true;
        // Only a move made after the stories arrived clears the badge.
        setTimeout(() => { if (listening) for (const e of EVENTS) document.addEventListener(e, clear, { capture: true, passive: true }); }, 0);
      }
    }
    const anchor = anchorOf(body);
    body.innerHTML = html;
    if (glow.size) for (const row of body.querySelectorAll('.news-row[data-k]')) if (glow.has(row.dataset.k)) row.classList.add('is-new');
    restoreAnchor(body, anchor);
    paintMeta();
  }
  return { show, paintMeta, clear };
}

export function newsList(items) {
  const rows = dedupeNews(items).map((n) => {
    const href = safeHref(n.link);
    if (!href) return '';
    const src = shortSource(n.source);
    const filing = 'ticker' in n;
    return `<li class="news-row${filing && !n.ticker ? ' is-dim' : ''}" data-k="${esc(newsKey(n))}">
      ${newsTimeHtml(n.time)}
      <span class="news-src" title="${esc(n.source || '')}">${esc(src)}</span>
      ${filing ? filingCell(n, href) : `<a class="news-title" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(n.title)}">${esc(n.title)}</a>`}
    </li>`;
  }).join('');
  return `<ol class="news">${rows}</ol>`;
}

export function render(el, cmd, ctx) {
  const tab = NEWS_TABS.includes(cmd.args?.tab) ? cmd.args.tab : 'MARKETS';
  el.innerHTML = panel('1', 'News', `<div class="news-bar">${LOADING}</div><div class="news-body"></div>`, { cls: 'panel-solo', metaId: 'news-meta', bodyCls: 'flush', meta: esc(TAB_SOURCES[tab]) });
  const bar = el.querySelector('.news-bar');
  const body = el.querySelector('.news-body');
  const live = liveNews({ body, meta: el.querySelector('#news-meta'), metaHtml: () => esc(TAB_SOURCES[tab]), ctx });
  let data = null;
  let src = 'ALL';
  const tabs = segmented(NEWS_TABS.map((t) => ({ label: t, cmd: tabCommand(t) })), tab, { label: 'News tab' });

  function paint() {
    if (!data) return;
    const sources = [...new Set(data.sources.map(shortSource))];
    if (!sources.includes(src)) src = 'ALL';
    const items = dedupeNews(filterNews(data.items, src));
    const pick = sources.length > 1 ? segmented([{ label: 'ALL', value: 'ALL' }, ...sources.map((x) => ({ label: x, value: x }))], src, { label: 'Source' }) : '';
    bar.innerHTML = toolbar({ left: tabs, right: pick, label: 'News' });
    live.show(data.items, items, items.length ? newsList(items) : '<p class="panel-msg">NO DATA</p>');
  }

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    src = b.dataset.value;
    paint();
  });

  async function load() {
    try {
      data = await ctx.fetchJSON(newsApi(tab), { signal: ctx.signal });
      paint();
      if (data.updated) ctx.updated(data.updated, data.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('.news')) { bar.innerHTML = toolbar({ left: tabs, label: 'News' }); body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`; }
      ctx.status('COULD NOT REFRESH NEWS', 'warn');
    }
  }

  load();
  ctx.live(load, NEWS_POLL_MS);
}
