// The news hub: while at least one browser listens (lib/newsstream.js), the server polls
// the shared NEWS feeds itself and pushes only the stories that are new.
//
// Each tab's feeds are polled on their own schedule (HUB_EVERY): SEC, WIRES and MARKETS
// every 30 s, MACRO and WSB every 5 minutes. Requests are conditional
// (If-None-Match / If-Modified-Since): a 304 costs the source almost nothing. An error
// or a 429 doubles that feed's gap, up to 10 minutes (a source's Retry-After is honoured
// up to an hour), and a success resets it. The SEC feed goes through the one SEC queue (data/filings.js) with
// the SEC User-Agent.
//
// A tab runs only while someone listens to it; when the last listener leaves it keeps
// going for LINGER_MS (a reader flipping between screens), then stops and forgets its
// state. What the hub fetched also refreshes the /api/news caches (prime), so the poll
// path never fetches the same feed again.
//
// New = not seen before, by the same rule as the browser's list (seenStory: the link,
// or for headlines the same words under another link). A feed's first load after a tab
// starts is a baseline: it sends the tab's list as a "sync" (the browser adds what it
// lacks) instead of "news". Every "news" event has an id (boot-seq) and the last
// REPLAY_MAX are kept, so a browser that reconnects with Last-Event-ID gets what it
// missed.

import { randomBytes } from 'node:crypto';
import { FEEDS as MARKETS_FEEDS, parseRss, primeNews } from './news.js';
import {
  TAB_FEEDS, parseFeed, mergeItems, withTickers, secTickersFor, primeNewsFeed,
  FEED_UA, FEED_TIMEOUT_MS, FEED_MAX_BYTES,
} from './newsfeeds.js';
import { UA } from './quotes.js';
import { SEC_UA } from './financials.js';
import { secQueued } from './filings.js';
import { seenStory } from '../public/screens/news.js';

export const HUB_EVERY = { SEC: 30_000, WIRES: 30_000, MARKETS: 30_000, MACRO: 300_000, WSB: 300_000 };
// A source's Retry-After is honoured up to an hour.
export const MAX_RETRY_AFTER_MS = 60 * 60_000;
// While the hub runs a feed, its /api/news cache entry lives the hub's gap plus this, so
// page views never fetch the source themselves.
export const PRIME_MARGIN_MS = 60_000;
export const MAX_BACKOFF_MS = 10 * 60_000;
export const LINGER_MS = 60_000;
export const REPLAY_MAX = 500;
export const MAX_PUSH = 20; // stories in one event
const LIST_MAX = 50;
const SEEN_MAX = 5000;

// ---- Fetch ---------------------------------------------------------------------------

export class FeedError extends Error {
  constructor(message, { status = 0, retryAfterMs = 0 } = {}) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// Retry-After: seconds, or an HTTP date.
export function retryAfterMs(v, now = Date.now()) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : 0;
}

// A conditional GET: { notModified: true } on 304, else { text, etag, lastModified }.
// 8 s timeout, 5 MB cap. Errors carry the status and any Retry-After.
export async function fetchFeed(fetchImpl, url, { etag = null, lastModified = null, ua = FEED_UA, accept = 'application/rss+xml, application/atom+xml, application/xml, text/xml', timeoutMs = FEED_TIMEOUT_MS, maxBytes = FEED_MAX_BYTES } = {}) {
  const headers = { 'User-Agent': ua, Accept: accept };
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers, signal: ctl.signal, redirect: 'follow' });
    const get = (h) => res.headers?.get?.(h) ?? null;
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw new FeedError(`HTTP ${res.status}`, { status: res.status, retryAfterMs: retryAfterMs(get('retry-after')) });
    if (Number(get('content-length')) > maxBytes) { ctl.abort(); throw new FeedError('response too large'); }
    let text;
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { ctl.abort(); throw new FeedError('response too large'); }
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      }
      const buf = Buffer.concat(chunks);
      text = /encoding=["']iso-8859-1["']/i.test(buf.subarray(0, 200).toString('latin1')) ? buf.toString('latin1') : buf.toString('utf8');
    } else {
      text = await res.text();
      if (text.length > maxBytes) throw new FeedError('response too large');
    }
    return { text, etag: get('etag'), lastModified: get('last-modified') };
  } finally {
    clearTimeout(timer);
  }
}

// ---- The feeds -----------------------------------------------------------------------

// Tab -> [{ id, name, url, ua, sec, parse(xml), prime(id, items) }], from the same
// definitions the /api/news poll path uses.
export function hubFeeds() {
  const tabFeed = (f) => ({
    id: f.id, name: f.name, url: f.url, ua: FEED_UA, sec: false,
    parse: f.parse || ((xml) => parseFeed(xml, f.name, { keep: f.keep })),
    prime: primeNewsFeed,
  });
  return {
    MARKETS: MARKETS_FEEDS.map((f) => ({ id: f.id, name: f.name, url: f.url, ua: UA, sec: false, parse: (xml) => parseRss(xml, f.name), prime: primeNews })),
    MACRO: TAB_FEEDS.MACRO.map(tabFeed),
    SEC: TAB_FEEDS.SEC.map((f) => ({ ...tabFeed(f), ua: SEC_UA, sec: true })),
    WIRES: TAB_FEEDS.WIRES.map(tabFeed),
    WSB: TAB_FEEDS.WSB.map(tabFeed),
  };
}

// ---- The hub ---------------------------------------------------------------------------

const realTimers = { setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, clearTimeout: (t) => clearTimeout(t) };

// client: { send({ event, data, id }) }. subscribe(tabs, client, { lastEventId }) ->
// unsubscribe().
export function makeNewsHub({
  feeds = hubFeeds(), every = HUB_EVERY, fetchImpl = globalThis.fetch, secQueue = secQueued,
  decorate = null, timers = realTimers, maxBackoff = MAX_BACKOFF_MS, linger = LINGER_MS,
  replayMax = REPLAY_MAX, boot = randomBytes(4).toString('hex'), log = (m) => console.error(m), seenMax = SEEN_MAX,
} = {}) {
  // SEC rows get the filer's ticker, as on the poll path.
  const secMap = secTickersFor(fetchImpl);
  const deco = decorate || {
    SEC: (items) => secMap().then((g) => withTickers(items, g.value.byCik), () => withTickers(items, null)),
  };
  const tabs = new Map(); // tab -> running state
  const buffer = []; // the last "news" events, for Last-Event-ID
  let seq = 0;

  const newSeen = () => ({ links: new Set(), words: new Set() });

  function startTab(name) {
    const t = {
      name, subs: new Set(), merged: null, seen: newSeen(), baselined: new Set(), lingerTimer: null, gen: {},
      feeds: (feeds[name] || []).map((f) => ({ f, etag: null, lastModified: null, items: [], gap: every[name], fails: 0, timer: null })),
    };
    tabs.set(name, t);
    // A little apart, so one tab's feeds do not all go at once.
    t.feeds.forEach((s, i) => { s.timer = timers.setTimeout(() => poll(t, s), i * 250); });
    return t;
  }

  function stopTab(t) {
    for (const s of t.feeds) timers.clearTimeout(s.timer);
    timers.clearTimeout(t.lingerTimer);
    t.gen = null; // any poll in flight sees it and stops
    tabs.delete(t.name);
  }

  async function poll(t, s) {
    const gen = t.gen;
    let changed = false;
    let ok = false;
    try {
      const run = () => fetchFeed(fetchImpl, s.f.url, { etag: s.etag, lastModified: s.lastModified, ua: s.f.ua });
      const r = await (s.f.sec ? secQueue(run) : run());
      if (!r.notModified) {
        const items = s.f.parse(r.text);
        // An empty channel (Business Wire earnings on a weekend) is fine; no feed at all is not.
        if (!items.length && !/<(item|entry|channel|feed)\b/i.test(r.text)) throw new FeedError('no items');
        s.etag = r.etag || null;
        s.lastModified = r.lastModified || null;
        s.items = items;
        changed = true;
      }
      s.fails = 0;
      s.gap = every[t.name];
      ok = true;
      // A 304 too: the rows are still current, so the cache entry is refreshed.
      s.f.prime?.(s.f.id, s.items, every[t.name] + PRIME_MARGIN_MS);
    } catch (err) {
      s.fails += 1;
      s.gap = Math.max(Math.min(maxBackoff, s.gap * 2), Math.min(err.retryAfterMs || 0, MAX_RETRY_AFTER_MS));
      if (s.fails === 1 || s.gap >= maxBackoff) log(`[newshub ${s.f.id}] ${err.message}; next try in ${Math.round(s.gap / 1000)} s`);
    }
    if (t.gen !== gen || !gen) return;
    if (changed || (ok && !t.baselined.has(s.f.id))) await update(t, s);
    if (t.gen !== gen || !gen) return;
    s.timer = timers.setTimeout(() => poll(t, s), s.gap);
  }

  async function update(t, s) {
    const my = (t.updates = (t.updates || 0) + 1);
    let merged = mergeItems(t.feeds.map((x) => x.items), LIST_MAX);
    if (deco[t.name]) merged = await deco[t.name](merged);
    const baseline = !t.baselined.has(s.f.id);
    t.baselined.add(s.f.id);
    // A newer update finished first (the SEC ticker lookup is async): it already has
    // this feed's rows, so this older result is dropped, never written over it.
    if (my !== t.updates) return;
    t.merged = merged;
    const fresh = merged.filter((n) => !seenStory(n, t.seen));
    // The seen list is kept small: rebuilt from the list on show (after this poll's new
    // stories are found, so they still go out).
    if (t.seen.links.size > seenMax) {
      t.seen = newSeen();
      for (const n of merged) seenStory(n, t.seen);
    }
    if (baseline) {
      // This feed's first answer: the list as it is, not news.
      if (fresh.length) for (const c of t.subs) c.send({ event: 'sync', data: { tab: t.name, items: merged } });
      return;
    }
    if (!fresh.length) return;
    const ev = { id: `${boot}-${++seq}`, seq, tab: t.name, items: fresh.slice(0, MAX_PUSH) };
    buffer.push(ev);
    while (buffer.length > replayMax) buffer.shift();
    for (const c of t.subs) c.send({ event: 'news', id: ev.id, data: { tab: ev.tab, items: ev.items } });
  }

  // "boot-seq" -> the events after it for these tabs; [] when it is from another run of
  // the server (the sync on connect covers that).
  function replay(lastEventId, names) {
    const m = /^([A-Za-z0-9]{1,16})-(\d{1,12})$/.exec(String(lastEventId || ''));
    if (!m || m[1] !== boot) return [];
    const after = Number(m[2]);
    return buffer.filter((ev) => ev.seq > after && names.includes(ev.tab));
  }

  function subscribe(names, client, { lastEventId = null } = {}) {
    for (const ev of replay(lastEventId, names)) client.send({ event: 'news', id: ev.id, data: { tab: ev.tab, items: ev.items } });
    const joined = [];
    for (const name of names) {
      if (!feeds[name]) continue;
      const t = tabs.get(name) || startTab(name);
      timers.clearTimeout(t.lingerTimer);
      t.lingerTimer = null;
      t.subs.add(client);
      joined.push(t);
      if (t.merged?.length) client.send({ event: 'sync', data: { tab: name, items: t.merged } });
    }
    let done = false;
    return function unsubscribe() {
      if (done) return;
      done = true;
      for (const t of joined) {
        t.subs.delete(client);
        if (t.subs.size || tabs.get(t.name) !== t) continue;
        timers.clearTimeout(t.lingerTimer);
        t.lingerTimer = timers.setTimeout(() => { if (!t.subs.size) stopTab(t); }, linger);
      }
    };
  }

  return {
    subscribe,
    running: () => [...tabs.keys()].sort(),
    listeners: (name) => tabs.get(name)?.subs.size || 0,
    gapOf: (name, id) => tabs.get(name)?.feeds.find((s) => s.f.id === id)?.gap ?? null,
    stopAll: () => { for (const t of [...tabs.values()]) stopTab(t); },
    boot,
  };
}
