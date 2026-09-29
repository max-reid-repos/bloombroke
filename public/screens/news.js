// NEWS: finance headlines from a few public feeds, newest first. New stories are pushed
// as they come (the news hub); while the stream is down the list is polled every minute.

import { esc, panel, LOADING } from './markets.js';
import { toolbar, segmented } from '../kit-core.js'; // not kit.js: the card pages stay out of the startup JS

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

// One key per story: its link, so a headline edited in place is still the same story.
// A story with no link falls back to its words.
const titleWords = (n) => String(n?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function newsKey(n) {
  const link = safeHref(n?.link);
  return link ? `l:${link}` : `t:${titleWords(n)}`;
}

// A filing (SEC tab rows carry a ticker field): the same words every quarter
// ("Apple Inc.: Results"), so filings are told apart by link only.
const isFilingRow = (n) => 'ticker' in (n || {}) || n?.source === 'SEC' || n?.source === 'SEC EDGAR';

// A story the list already has: the same link, or (headlines only) the same words under
// another link, one story on two feeds. seen: { links, words } Sets, updated.
export function seenStory(n, seen) {
  const k = newsKey(n);
  const w = titleWords(n);
  if (!w || seen.links.has(k) || (!isFilingRow(n) && seen.words.has(w))) return true;
  seen.links.add(k);
  if (!isFilingRow(n)) seen.words.add(w);
  return false;
}

// One copy of each story, first one kept (the list comes newest first). A story with
// no words is dropped too. The server's news hub uses the same rule (seenStory).
export function dedupeNews(items) {
  const seen = { links: new Set(), words: new Set() };
  return (items || []).filter((n) => !seenStory(n, seen));
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
export function liveNews({ body, meta = null, metaHtml = () => '', ctx, marker = false }) {
  const tracker = newsTracker();
  const counter = newCounter();
  const glow = new Set();
  let timer = null;
  let streaming = false;
  const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  let listening = false;
  const paintMeta = () => { if (meta) meta.innerHTML = `${newBadge(counter.count)}${marker ? liveMarker(streaming) : ''}${metaHtml()}`; };
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
  // The stream came up (true) or is down and the list is polled (false).
  function setLive(on) {
    if (streaming === Boolean(on)) return;
    streaming = Boolean(on);
    paintMeta();
  }
  return { show, paintMeta, clear, setLive };
}

// ---- Push: new stories as they come (the news hub, /api/news/stream) ---------------------

// The title strip marker: LIVE filled while the stream is up, hollow while the list is
// polled every minute instead.
export function liveMarker(on) {
  return on
    ? '<span class="news-live is-on" title="Live: new stories appear as they come in">LIVE</span>'
    : '<span class="news-live" title="Checking for new stories every minute">LIVE</span>';
}

export const streamUrl = (tabs, last = null) => `/api/news/stream?tabs=${encodeURIComponent(tabs.join(','))}${last ? `&last=${encodeURIComponent(last)}` : ''}`;
export const LIST_MAX = 100;

// Pushed stories into a list: one copy each, newest first, at most max.
export function mergePushed(items, pushed, max = LIST_MAX) {
  const all = dedupeNews([...(pushed || []), ...(items || [])]);
  return all.sort((a, b) => String(b.time || '').localeCompare(String(a.time || ''))).slice(0, max);
}

// One EventSource for these tabs. onItems(tab, items) for news and sync events,
// onState(live). It closes while the page is hidden and opens again (with the last event
// id, so nothing is missed) when it is shown. A dropped connection the browser retries by
// itself (the server spreads its retry delay). A stream the browser gave up on (the
// server restarting, or refusing: 429, 503) is tried again after a random, growing wait
// (about 30 s, 60 s, 120 s); after maxFails in a row it rests for restMs, and the page
// polls meanwhile. Showing the page again always starts over. Returns { live, gaveUp }.
export function newsStream({ tabs, onItems, onState = () => {}, ctx = {}, ES = globalThis.EventSource, doc = globalThis.document, retryMs = 30_000, maxFails = 3, restMs = 5 * 60_000, rand = Math.random }) {
  let es = null;
  let live = false;
  let lastId = null;
  let fails = 0;
  let gaveUp = !ES;
  let retry = null;
  let stopped = false;
  const set = (v) => { if (live !== v) { live = v; onState(v); } };
  const onMsg = (e) => {
    if (e.lastEventId) lastId = e.lastEventId;
    let d = null;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d && typeof d.tab === 'string' && Array.isArray(d.items)) onItems(d.tab, d.items, e.type);
  };
  const later = (fn, ms) => { clearTimeout(retry); retry = setTimeout(fn, ms); };
  function open() {
    if (!ES || es || gaveUp || stopped || doc?.hidden) return;
    const s = new ES(streamUrl(tabs, lastId));
    es = s;
    s.addEventListener('open', () => { fails = 0; set(true); });
    s.addEventListener('news', onMsg);
    s.addEventListener('sync', onMsg);
    s.addEventListener('error', () => {
      set(false);
      // CONNECTING: the browser reconnects by itself, with Last-Event-ID.
      if (s.readyState !== 2) return;
      s.close();
      if (es === s) es = null;
      fails += 1;
      if (fails >= maxFails) {
        gaveUp = true;
        later(() => { gaveUp = false; fails = 0; open(); }, restMs);
        return;
      }
      later(open, Math.round(retryMs * 2 ** (fails - 1) * (0.5 + rand())));
    });
  }
  function close() {
    clearTimeout(retry);
    if (es) { es.close(); es = null; }
    set(false);
  }
  const onVis = () => {
    if (doc.hidden) { close(); return; }
    if (ES) { gaveUp = false; fails = 0; }
    open();
  };
  doc?.addEventListener?.('visibilitychange', onVis);
  ctx.onCleanup?.(() => { stopped = true; close(); doc?.removeEventListener?.('visibilitychange', onVis); });
  open();
  return { get live() { return live; }, get gaveUp() { return gaveUp; } };
}

// ---- Hour rules and "Since your last visit" (NEWS only; the HOME box stays plain) ------

// A row's hour for the rules between hours: today "h:14" (label 14:00), an older day
// "d:2026-09-24" (label SEP 24), New York time. null for no time.
export function hourOf(iso, now = new Date()) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const day = (x) => x.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (day(d) !== day(now)) return { key: `d:${day(d)}`, label: fmtNewsTime(iso, now) };
  const h = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });
  return { key: `h:${h}`, label: `${h}:00` };
}

export const SINCE_LINE = 'Since your last visit';
export const SEEN_KEY = 'bb.news.seen';
export const SEEN_MS = 10_000; // the list on show this long counts as seen

// The newest story's time on a list ('' for none).
export function newestTime(items) {
  let best = '';
  let bt = -Infinity;
  for (const n of items || []) {
    const t = Date.parse(n?.time);
    if (Number.isFinite(t) && t > bt) { bt = t; best = n.time; }
  }
  return best;
}

// The newest time seen on a tab in this browser, or null. store: { get, set } (ctx.store,
// or a stub); any failure (private mode, blocked storage) is no line, never an error.
export function readSeen(store, tab) {
  try {
    const all = store?.get?.(SEEN_KEY, null);
    const v = all && typeof all === 'object' ? all[tab] : null;
    return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
  } catch { return null; }
}
export function writeSeen(store, tab, iso) {
  if (!iso) return;
  try {
    const all = store?.get?.(SEEN_KEY, null);
    const next = { ...(all && typeof all === 'object' ? all : {}) };
    const old = Date.parse(next[tab]);
    if (Number.isFinite(old) && old >= Date.parse(iso)) return;
    next[tab] = iso;
    store?.set?.(SEEN_KEY, next);
  } catch { /* storage unavailable: no line next time */ }
}

// items -> <ol class="news">. Options (NEWS only): hours, a thin rule with the hour as a
// small dim label between two hours; since, the time seen last visit: one line "Since
// your last visit" above the older stories (only with newer ones above it).
export function newsList(items, { hours = false, since = null, now = new Date() } = {}) {
  const list = dedupeNews(items).filter((n) => safeHref(n.link));
  const sinceT = since ? Date.parse(since) : NaN;
  let sinceAt = -1;
  if (Number.isFinite(sinceT)) {
    const i = list.findIndex((n) => !(Date.parse(n.time) > sinceT));
    if (i > 0) sinceAt = i;
  }
  let prevHour = null;
  const rows = list.map((n, i) => {
    const href = safeHref(n.link);
    const src = shortSource(n.source);
    const filing = 'ticker' in n;
    let before = '';
    const hr = hours ? hourOf(n.time, now) : null;
    if (i === sinceAt) before = `<li class="news-since" role="separator"><span class="news-since-l">${esc(SINCE_LINE)}</span></li>`;
    else if (hr && prevHour && hr.key !== prevHour) before = `<li class="news-hour" aria-hidden="true"><span class="news-hour-l num">${esc(hr.label)}</span></li>`;
    if (hr) prevHour = hr.key;
    return `${before}<li class="news-row${filing && !n.ticker ? ' is-dim' : ''}" data-k="${esc(newsKey(n))}">
      ${newsTimeHtml(n.time, now)}
      <span class="news-src dim" title="${esc(n.source || '')}">${esc(src)}</span>
      ${filing ? filingCell(n, href) : `<a class="news-title" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(n.title)}">${esc(n.title)}</a>`}
    </li>`;
  }).join('');
  return `<ol class="news">${rows}</ol>`;
}

// The source toggles, once, in the panel's title strip (rule B): ALL and each feed on a
// wide screen; on a phone one button that steps to the next source. One source (SEC,
// WSB) or no list yet: the tab's sources as quiet words.
export function sourceToggles(sources, src, tab) {
  if (!sources || sources.length < 2) return `<span class="news-srcs-t">${esc(TAB_SOURCES[tab] || '')}</span>`;
  const all = ['ALL', ...sources];
  const next = all[(all.indexOf(src) + 1) % all.length] || 'ALL';
  return `<span class="news-srcs">${segmented(all.map((x) => ({ label: x, value: x })), src, { label: 'Source' })}</span>`
    + `<button type="button" class="news-src-one" data-value="${esc(next)}" aria-label="Source ${esc(src)}, press for ${esc(next)}">SOURCE ${esc(src)}</button>`;
}

export function render(el, cmd, ctx) {
  const tab = NEWS_TABS.includes(cmd.args?.tab) ? cmd.args.tab : 'MARKETS';
  el.innerHTML = panel('1', 'News', `<div class="news-bar">${LOADING}</div><div class="news-body"></div>`, { cls: 'panel-solo', metaId: 'news-meta', bodyCls: 'flush', meta: sourceToggles(null, 'ALL', tab) });
  const bar = el.querySelector('.news-bar');
  const body = el.querySelector('.news-body');
  const metaEl = el.querySelector('#news-meta');
  let data = null;
  let pending = []; // pushed before the first list came
  let src = 'ALL';
  let sources = [];
  const live = liveNews({ body, meta: metaEl, metaHtml: () => sourceToggles(sources, src, tab), ctx, marker: true });
  const tabs = segmented(NEWS_TABS.map((t) => ({ label: t, cmd: tabCommand(t) })), tab, { label: 'News tab' });

  // "Since your last visit": the newest time seen last visit (fixed for this visit), and
  // the newest seen now, kept when the reader leaves NEWS, hides the page, or has had the
  // list on show for SEEN_MS.
  const since = readSeen(ctx.store, tab);
  let newest = '';
  let seenTimer = null;
  const remember = () => writeSeen(ctx.store, tab, newest);
  const onHide = () => { if (document.hidden) remember(); };
  document.addEventListener('visibilitychange', onHide);
  globalThis.addEventListener?.('pagehide', remember);
  ctx.onCleanup?.(() => {
    clearTimeout(seenTimer);
    remember();
    document.removeEventListener('visibilitychange', onHide);
    globalThis.removeEventListener?.('pagehide', remember);
  });

  function paint() {
    if (!data) return;
    sources = [...new Set(data.sources.map(shortSource))];
    if (!sources.includes(src)) src = 'ALL';
    const items = dedupeNews(filterNews(data.items, src));
    // A toggle in the strip that had the focus keeps it through the repaint.
    const focused = metaEl.contains(document.activeElement) ? document.activeElement.className : null;
    bar.innerHTML = toolbar({ left: tabs, label: 'News' });
    live.show(data.items, items, items.length ? newsList(items, { hours: true, since }) : '<p class="panel-msg">NO DATA</p>');
    if (focused) metaEl.querySelector(focused.includes('news-src-one') ? '.news-src-one' : '.seg-item.is-active')?.focus();
    newest = newestTime([{ time: newest }, ...data.items]);
    if (!seenTimer) seenTimer = setTimeout(remember, SEEN_MS);
  }

  metaEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    src = b.dataset.value;
    paint();
  });

  async function load() {
    try {
      data = await ctx.fetchJSON(newsApi(tab), { signal: ctx.signal });
      if (pending.length) { data = { ...data, items: mergePushed(data.items, pending) }; pending = []; }
      paint();
      if (data.updated) ctx.updated(data.updated, data.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('.news')) { bar.innerHTML = toolbar({ left: tabs, label: 'News' }); body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`; }
      ctx.status('COULD NOT REFRESH NEWS', 'warn');
    }
  }

  // New stories are pushed as they come; the minute poll runs only while the stream is down.
  const stream = newsStream({
    tabs: [tab], ctx,
    onState: (on) => live.setLive(on),
    onItems: (t, items) => {
      if (t !== tab) return;
      if (!data) { pending = mergePushed(pending, items); return; }
      const names = new Set(data.sources || []);
      for (const n of items) if (n.source) names.add(n.source);
      data = { ...data, items: mergePushed(data.items, items), sources: [...names] };
      paint();
    },
  });

  load();
  ctx.live(() => { if (!stream.live) load(); }, NEWS_POLL_MS);
}
