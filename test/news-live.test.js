// Live NEWS: the minute poll's merge and new-story logic, and the server TTLs behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newsKey, dedupeNews, newsTracker, newCounter, newBadge, newsList, NEWS_POLL_MS, NEW_BADGE_MS, GLOW_MS } from '../public/screens/news.js';
import { makeNewsFeeds, TAB_FEEDS, FAST_FEED_TTL, FEED_TTL } from '../data/newsfeeds.js';
import { NEWS_TTL } from '../data/news.js';
import { createCache } from '../data/cache.js';

const h = (title, link = `https://x.test/${encodeURIComponent(title)}`, extra = {}) => ({ title, link, time: '2026-09-27T12:00:00Z', source: 'CNBC', ...extra });

test('live news: the poll and badge timings', () => {
  assert.equal(NEWS_POLL_MS, 60_000);
  assert.equal(NEW_BADGE_MS, 30_000);
  assert.equal(GLOW_MS, 2000);
});

test('live news: one key per story, by link first, words only without a link', () => {
  assert.equal(newsKey(h('Stocks rise')), 'l:https://x.test/Stocks%20rise');
  assert.equal(newsKey(h('Stocks rise', 'https://a.test/1')), newsKey(h('Stocks rise sharply (updated)', 'https://a.test/1')), 'an edited headline is the same story');
  assert.notEqual(newsKey({ title: 'Apple: Results', link: 'https://sec.gov/1', ticker: 'AAPL' }), newsKey({ title: 'Apple: Results', link: 'https://sec.gov/2', ticker: 'AAPL' }));
  assert.equal(newsKey({ title: 'No  Link!', link: 'javascript:x' }), 't:no link');
});

test('live news: a merged list never shows a story twice', () => {
  const items = [h('A'), h('B'), h('a'), h('C'), h('B', 'https://y.test/b'), h('A edited', 'https://x.test/A'), { title: '', link: 'https://z.test' }];
  assert.deepEqual(dedupeNews(items).map((n) => n.title), ['A', 'B', 'C']);
  const html = newsList(items.slice(0, 6));
  assert.equal((html.match(/<li /g) || []).length, 3);
  assert.match(html, /data-k="l:https:\/\/x\.test\/A"/);
});

test('live news: the first look has nothing new; later looks flag only new stories', () => {
  const t = newsTracker();
  assert.equal(t.started, false);
  assert.equal(t.track([h('A'), h('B')]).size, 0, 'first load: nothing is new');
  assert.equal(t.started, true);
  assert.equal(t.track([h('A'), h('B')]).size, 0, 'same list: nothing new');
  const fresh = t.track([h('C'), h('A'), h('B')]);
  assert.deepEqual([...fresh], [newsKey(h('C'))]);
  // B drops off the list and comes back: it is not new.
  t.track([h('C'), h('A')]);
  assert.equal(t.track([h('C'), h('A'), h('B')]).size, 0);
  // An edited headline on the same link is not new; a new link is.
  assert.equal(t.track([h('C, updated', 'https://x.test/C')]).size, 0);
  assert.equal(t.track([h('C', 'https://moved.test/c')]).size, 1);
});

test('live news: the tracker keeps a bounded memory', () => {
  const t = newsTracker({ maxSeen: 5 });
  t.track([h('1'), h('2'), h('3')]);
  t.track([h('4'), h('5'), h('6'), h('7')]);
  // 1 and 2 were forgotten; 3 is still known.
  assert.equal(t.track([h('3')]).size, 0);
  assert.equal(t.track([h('1')]).size, 1);
});

test('live news: the N NEW count adds up across polls and clears', () => {
  const c = newCounter();
  assert.equal(newBadge(c.count), '');
  c.add(2);
  c.add(1);
  assert.equal(c.count, 3);
  assert.match(newBadge(c.count), />3 NEW</);
  c.clear();
  assert.equal(c.count, 0);
  assert.equal(newBadge(0), '');
});

test('server TTLs: WIRES and SEC feeds 60 s, MACRO and WSB 3 min, MARKETS 3 min', () => {
  assert.equal(FAST_FEED_TTL, 60_000);
  assert.equal(FEED_TTL, 180_000);
  assert.equal(NEWS_TTL, 180_000);
  for (const f of [...TAB_FEEDS.WIRES, ...TAB_FEEDS.SEC]) assert.equal(f.ttl, 60_000, f.id);
  for (const f of [...TAB_FEEDS.MACRO, ...TAB_FEEDS.WSB]) assert.equal(f.ttl, undefined, f.id);
});

test('server TTLs: one upstream fetch per TTL, however many readers ask', async () => {
  let now = 0;
  let calls = 0;
  const ua = [];
  const xml = '<rss><channel><item><title>Acme posts results</title><link>https://www.businesswire.com/news/home/1/en/</link><pubDate>Sat, 26 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>';
  const fetchImpl = async (url, opts) => { calls += 1; ua.push(opts.headers['User-Agent']); return new Response(xml); };
  const feeds = { WIRES: [{ id: 'w', name: 'Business Wire', url: 'https://w.test', ttl: FAST_FEED_TTL }], SEC: [] };
  const nf = makeNewsFeeds({ fetchImpl, cache: createCache({ now: () => now }), feeds, secTickers: async () => ({ value: { byCik: new Map() } }) });
  await Promise.all([nf.getNewsTab('WIRES'), nf.getNewsTab('WIRES'), nf.getNewsTab('WIRES')]);
  assert.equal(calls, 1);
  now = 59_000;
  await nf.getNewsTab('WIRES');
  assert.equal(calls, 1, 'still fresh at 59 s');
  now = 61_000;
  const d = await nf.getNewsTab('WIRES');
  assert.equal(calls, 2, 'fetched again after 60 s');
  assert.equal(d.items[0].title, 'Acme posts results');
  assert.ok(ua.every((u) => /@/.test(u)), 'the User-Agent names a contact (SEC fair access)');
});
