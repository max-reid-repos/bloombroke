// NEWS, the screen (routes: app.js, commands.js): the tabs, the source toggles in the
// title strip, the hour rules, "Before your last visit", push and the minute poll. The
// list and the live parts are news.js's, which HOME's news box shares at startup.

import { esc, panel, LOADING } from './markets.js';
import { toolbar, segmented } from '../kit-core.js'; // not kit.js: the card pages stay out
import {
  NEWS_TABS, tabCommand, TAB_SOURCES, newsApi, shortSource, fmtNewsTime, filterNews, dedupeNews,
  liveNews, newsStream, mergePushed, newsList, NEWS_POLL_MS,
} from './news.js';

export { parse } from './news.js';

// ---- Hour rules and "Before your last visit" (NEWS only; the HOME box stays plain) ------

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

export const VISIT_LINE = 'Before your last visit';
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

// The NEWS list: news.js newsList with, when asked, hours (a thin rule with the hour as a
// small dim label between two hours) and since (the time seen last visit: one line
// "Before your last visit" above the older stories, only with newer ones above it).
export function newsPageList(items, { hours = false, since = null, now = new Date() } = {}) {
  const sinceT = since ? Date.parse(since) : NaN;
  let sinceAt = -1;
  let prevHour = null;
  const before = (n, i, list) => {
    if (i === 0 && Number.isFinite(sinceT)) {
      const k = list.findIndex((x) => !(Date.parse(x.time) > sinceT));
      if (k > 0) sinceAt = k;
    }
    const hr = hours ? hourOf(n.time, now) : null;
    let html = '';
    if (i === sinceAt) html = `<li class="news-since" role="separator"><span class="news-since-l">${esc(VISIT_LINE)}</span></li>`;
    else if (hr && prevHour && hr.key !== prevHour) html = `<li class="news-hour" aria-hidden="true"><span class="news-hour-l num">${esc(hr.label)}</span></li>`;
    if (hr) prevHour = hr.key;
    return html;
  };
  return newsList(items, { before, now });
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

  // "Before your last visit": the newest time seen last visit (fixed for this visit), and
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
    bar.innerHTML = toolbar({ left: tabs, label: 'News' });
    live.show(data.items, items, items.length ? newsPageList(items, { hours: true, since }) : '<p class="panel-msg">NO DATA</p>');
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
