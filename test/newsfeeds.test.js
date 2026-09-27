// NEWS tabs and the extra NEWS <ticker> sources. Fixtures in test/fixtures/news/ were
// captured live once and trimmed; nothing here touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseFeed, parseSec8k, parseWsb, parseSeekingAlpha, itemWords, filingTitle, companyName, maskProfanity,
  isWsbNoise, stripEmoji, cleanLink, parseSecTickers, withTickers, fetchCapped, makeNewsFeeds, TAB_FEEDS, NEWS_TABS as SERVER_TABS, FEED_UA, notLawFirm, mergeItems, dedupeKey,
} from '../data/newsfeeds.js';
import { makeTickerNews, parseSec8kSubmissions, sec8kFromFilings, filingTime, nyNoon } from '../data/tickernews.js';
import { parseSubmissions, filterFilings } from '../data/filings.js';
import { SEC_UA } from '../data/financials.js';
import { retarget } from '../public/desk-layout.js';
import { fmtNewsTime } from '../public/screens/news.js';
import { createCache } from '../data/cache.js';
import { newsList, shortSource, parse as parseNewsArgs, NEWS_TABS, tabCommand, newsApi } from '../public/screens/news.js';
import { aboutTicker, tickerNewsList } from '../public/screens/tickernews.js';
import { parseCommand } from '../public/app.js';

const fx = (f, enc = 'utf8') => readFileSync(new URL(`./fixtures/news/${f}`, import.meta.url), enc);
const fxJson = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const textRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) });

// ---- 8-K item codes ------------------------------------------------------------------

test('8-K item codes become plain words; 9.01 and unknown codes drop out', () => {
  assert.equal(itemWords('2.02,9.01'), 'Results');
  assert.equal(itemWords(['5.02']), 'Exec change');
  assert.equal(itemWords('1.01, 2.03, 9.01'), 'Deal, New debt');
  assert.equal(itemWords('8.01'), 'Other');
  assert.equal(itemWords('9.01'), '');
  assert.equal(itemWords('x, 2.02, 2.02'), 'Results', 'junk ignored, no repeats');
  assert.equal(itemWords('2.2'), 'Results', 'a short code is item 2.02');
  assert.equal(itemWords('5.04, 6.01'), 'Benefit plan blackout, ABS material');
  assert.equal(filingTitle('Apple Inc.', '2.02,9.01'), 'Apple Inc.: Results');
  assert.equal(filingTitle('Apple Inc.', '9.01'), 'Apple Inc.: 8-K filing');
  assert.equal(filingTitle('Apple Inc.', '5.02', '8-K/A'), 'Apple Inc.: Exec change (amended)');
  assert.equal(companyName('TIDEWATER INC'), 'Tidewater Inc');
  assert.equal(companyName('KEYCORP /NEW/'), 'Keycorp');
  assert.equal(companyName('UNITED STATES OIL FUND, LP'), 'United States Oil Fund, LP');
  assert.equal(companyName('Co-Diagnostics, Inc.'), 'Co-Diagnostics, Inc.', 'mixed case stays as filed');
});

test('filing times: EDGAR acceptance is UTC; a bare filing day is noon in New York', () => {
  assert.equal(new Date(filingTime('2026-07-30T20:30:28.000Z', '2026-07-30')).toISOString(), '2026-07-30T20:30:28.000Z');
  assert.equal(new Date(filingTime('', '2026-07-30')).toISOString(), '2026-07-30T16:00:00.000Z', 'summer: UTC-4');
  assert.equal(new Date(nyNoon('2026-01-15')).toISOString(), '2026-01-15T17:00:00.000Z', 'winter: UTC-5');
  assert.equal(fmtNewsTime(new Date(filingTime(null, '2026-03-09')).toISOString(), new Date('2026-09-26T12:00:00Z')), 'MAR 09', 'never the day before');
  assert.ok(Number.isNaN(filingTime('junk', 'junk')));
});

test('SEC tab rows carry the filer ticker; filers without one are dimmed', async () => {
  const map = parseSecTickers({ 0: { cik_str: 98222, ticker: 'TDW', title: 'Tidewater' }, 1: { cik_str: 1067983, ticker: 'BRK-B', title: 'Berkshire' }, 2: { cik_str: 1067983, ticker: 'BRK-A', title: 'Berkshire' } });
  assert.equal(map.byCik.get(1067983), 'BRK.B', 'the first ticker, written with a dot');
  const rows = withTickers(parseSec8k(fx('sec-8k.atom', 'latin1')), map.byCik);
  assert.equal(rows.find((n) => n.title.startsWith('Tidewater')).ticker, 'TDW');
  assert.equal(rows.find((n) => n.title.startsWith('United States')).ticker, null);
  assert.ok(rows.every((n) => !('cik' in n)));
  assert.ok(withTickers(parseSec8k(fx('sec-8k.atom', 'latin1')), null).every((n) => !('ticker' in n) && !('cik' in n)), 'map down: rows as they are');
  const html = newsList(rows);
  assert.match(html, /<a class="news-tkr" href="\?c=TDW" data-cmd="TDW">TDW<\/a><a class="news-link" href="https:\/\/www\.sec\.gov\/[^"]+" target="_blank" rel="noopener noreferrer">Tidewater Inc: Deal, New debt<\/a>/);
  assert.equal((html.match(/is-dim/g) || []).length, rows.filter((n) => !n.ticker).length);

  const feeds = { SEC: [{ id: 'sec', name: 'SEC EDGAR', url: 'https://sec/feed', parse: parseSec8k }] };
  const fetchImpl = async (url) => (url === 'https://sec/feed' ? textRes(fx('sec-8k.atom', 'latin1'))
    : url.endsWith('company_tickers.json') ? textRes(JSON.stringify({ 0: { cik_str: 98222, ticker: 'TDW', title: 'Tidewater' } })) : textRes('', 404));
  const d = await makeNewsFeeds({ fetchImpl, cache: createCache(), feeds }).getNewsTab('SEC');
  assert.equal(d.items.find((n) => n.title.startsWith('Tidewater')).ticker, 'TDW');
});

test('DESK: a linked NEWS tab keeps its tab; plain NEWS and NEWS <ticker> follow the ticker', () => {
  assert.equal(retarget('NEWS WSB', 'MSFT', parseCommand), null);
  assert.equal(retarget('NEWS SEC', 'MSFT', parseCommand), null);
  assert.equal(retarget('NEWS', 'MSFT', parseCommand), 'NEWS MSFT');
  assert.equal(retarget('NEWS AAPL', 'MSFT', parseCommand), 'NEWS MSFT');
});

test('SEC tab: latest 8-Ks by company, with plain item words and a filing link', () => {
  const items = parseSec8k(fx('sec-8k.atom', 'latin1'));
  assert.equal(items.length, 5);
  const tide = items.find((n) => n.title.startsWith('Tidewater'));
  assert.equal(tide.title, 'Tidewater Inc: Deal, New debt');
  assert.match(tide.link, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/98222\/\d{18}\/[\d-]+-index\.htm$/);
  assert.equal(tide.source, 'SEC EDGAR');
  assert.ok(items.some((n) => /: Results$/.test(n.title)), 'a 2.02 reads Results');
  assert.ok(items.some((n) => /Restructuring, Exec change$/.test(n.title)), 'several items in filing order');
  assert.ok(items.every((n) => /^\d{4}-\d{2}-\d{2}T/.test(n.time)));
  const twice = parseSec8k(fx('sec-8k.atom', 'latin1').replace('</feed>', `${/<entry>[\s\S]*?<\/entry>/.exec(fx('sec-8k.atom', 'latin1'))[0]}</feed>`));
  assert.equal(twice.length, 5, 'one row per accession number');
});

test('ticker 8-Ks from the submissions JSON: newest year only, always about the company', () => {
  const now = Date.parse('2026-09-26T00:00:00Z');
  const rows = parseSec8kSubmissions(fxJson('sec-submissions-aapl.json'), { now });
  assert.deepEqual(rows.map((r) => r.title), ['Apple Inc.: Exec change (amended)', 'Apple Inc.: Results', 'Apple Inc.: Results']);
  assert.ok(rows.every((r) => r.source === 'SEC' && r.about === true));
  assert.match(rows[1].link, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\/000032019326000018\/aapl-20260730\.htm$/);
  assert.equal(rows[1].time, '2026-07-30T20:30:28.000Z');
  assert.equal(parseSec8kSubmissions(fxJson('sec-submissions-aapl.json'), { now: Date.parse('2028-01-01') }).length, 0, 'old filings drop out');
  assert.deepEqual(parseSec8kSubmissions(null), []);
  // The same headlines from FILINGS rows (the SEC queue's answer).
  const sub = parseSubmissions(fxJson('sec-submissions-aapl.json'));
  const viaFilings = sec8kFromFilings(filterFilings(sub.rows, '8-K').rows, sub.name, { now });
  assert.deepEqual(viaFilings, rows);
});

// ---- WSB --------------------------------------------------------------------------

test('WSB: daily and weekend threads skipped, titles masked, links to the post', () => {
  const items = parseWsb(fx('wsb.atom'));
  const titles = items.map((n) => n.title);
  assert.ok(!titles.some((t) => /thread|moves tomorrow/i.test(t)), titles.join(' | '));
  assert.ok(titles.includes('Loss porn. Have a w***.'));
  assert.ok(items.every((n) => n.link.startsWith('https://www.reddit.com/r/wallstreetbets/comments/')));
  assert.ok(items.every((n) => n.source === 'r/wallstreetbets'));
  assert.equal(isWsbNoise('Daily Discussion Thread for September 25, 2026'), true);
  assert.equal(isWsbNoise('What Are Your Moves Tomorrow, September 25, 2026'), true);
  assert.equal(isWsbNoise('Weekly Earnings Thread Sep 28 - Oct 2, 2026'), true);
  assert.equal(isWsbNoise('Anything at all', '/u/AutoModerator'), true);
  assert.equal(isWsbNoise('NVDA earnings play', '/u/someone'), false);
  assert.equal(isWsbNoise('NVDA earnings thread was wild', '/u/someone'), false, 'only titles that start that way');
  assert.equal(stripEmoji('META printer went BRRRR \u{1F680} to the moon \u{1F31D}\u{FE0F}'), 'META printer went BRRRR to the moon');
  assert.equal(stripEmoji('Microbot Medical\u00AE'), 'Microbot Medical\u00AE', 'marks like (R) stay');
  assert.equal(stripEmoji('Up \u2B06\uFE0F only \u2B50 \u231B'), 'Up only');
});

test('profanity and slurs are masked; ordinary words are not', () => {
  assert.equal(maskProfanity('What the fuck is this'), 'What the f*** is this');
  assert.equal(maskProfanity('FUCKING puts'), 'F****** puts');
  assert.equal(maskProfanity('bullshit rally'), 'b******* rally');
  assert.equal(maskProfanity('you retards'), 'you r******');
  assert.equal(maskProfanity('Cocktail hour for Spice stocks'), 'Cocktail hour for Spice stocks');
  assert.equal(maskProfanity("Dick's Sporting Goods beats"), "Dick's Sporting Goods beats");
  assert.equal(maskProfanity('Scunthorpe United'), 'Scunthorpe United');
  assert.equal(maskProfanity('motherfuckers'), 'm************', 'a compound is masked whole');
  assert.equal(maskProfanity(null), '');
  for (const ok of ['Wankel engine maker', 'Fire retardant stocks rally', 'Niggling doubts', 'A chink in the armor', 'SPIC bond yields']) {
    assert.equal(maskProfanity(ok), ok, ok);
  }
  assert.equal(maskProfanity('retarded calls'), 'r******* calls');
  assert.equal(maskProfanity('my niggas'), 'my n*****');
});

// ---- other feeds ----------------------------------------------------------------------

test('MACRO: Fed releases without bank orders and enforcement; Fed speeches; BLS Atom', () => {
  const fed = parseFeed(fx('fed-press.xml'), 'Federal Reserve', { keep: TAB_FEEDS.MACRO[0].keep });
  assert.equal(fed.length, 1);
  assert.match(fed[0].title, /public comment/);
  assert.equal(fed[0].link, 'https://www.federalreserve.gov/newsevents/pressreleases/bcreg20260924a.htm');
  const speeches = parseFeed(fx('fed-speeches.xml'), 'Federal Reserve');
  assert.equal(speeches.length, 2);
  const bls = parseFeed(fx('bls-cpi.atom'), 'BLS');
  assert.equal(bls.length, 2);
  assert.match(bls[0].title, /^CPI for all items/);
  assert.match(bls[0].link, /^https:\/\/www\.bls\.gov\/news\.release\//);
  assert.equal(bls[0].time, '2026-09-11T11:50:40.968Z');
});

test('WIRES: English only, law firm notices out, tracking words stripped', () => {
  const gnw = parseFeed(fx('gnw.xml'), 'GlobeNewswire', { keep: TAB_FEEDS.WIRES.find((f) => f.id === 'gnw').keep });
  assert.equal(gnw.length, 2, 'the Indonesian release is left out');
  const bw = parseFeed(fx('bw.xml'), 'Business Wire', { keep: TAB_FEEDS.WIRES.find((f) => f.id === 'bw-earnings').keep });
  assert.ok(bw.length >= 1);
  for (const n of bw) {
    assert.match(n.link, /^https:\/\/www\.businesswire\.com\/news\/home\//);
    assert.doesNotMatch(n.link, /feedref/);
  }
  assert.equal(parseFeed(fx('prn-all.xml'), 'PR Newswire', { keep: notLawFirm }).length, 0, 'class action notices are not company news');
  assert.equal(parseFeed(fx('prn-all.xml'), 'PR Newswire').length, 2);
  assert.equal(cleanLink('http://x.com/a?utm_source=rss&id=3&source=feed'), 'https://x.com/a?id=3');
  assert.equal(cleanLink('javascript:alert(1)'), null);
});

test('Seeking Alpha: news links to the story, articles lose the feed tag', () => {
  const items = parseSeekingAlpha(fx('sa-aapl.xml'));
  assert.equal(items.length, 3);
  assert.equal(items[0].link, 'https://seekingalpha.com/news/4647212');
  assert.match(items[1].link, /^https:\/\/seekingalpha\.com\/article\/4949762-[a-z0-9-]+$/);
  assert.ok(items.every((n) => !/[?&]source=/.test(n.link)));
});

// ---- fetch, merge, failure ------------------------------------------------------------

test('fetchCapped: sends the Bloombroke UA, stops past the size cap', async () => {
  let ua = null;
  const ok = await fetchCapped(async (url, opts) => { ua = opts.headers['User-Agent']; return new Response('<rss/>'); }, 'https://x.test/');
  assert.equal(ok, '<rss/>');
  assert.equal(ua, FEED_UA);
  assert.match(FEED_UA, /^Bloombroke\/1\.0 \(hello@bloombroke\.com\)$/);
  await assert.rejects(fetchCapped(async () => new Response('x'.repeat(5000)), 'https://x.test/', { maxBytes: 1000 }), /too large/);
  await assert.rejects(fetchCapped(async () => textRes('', 403), 'https://x.test/'), /HTTP 403/);
  const hang = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const t0 = Date.now();
  await assert.rejects(fetchCapped(hang, 'https://x.test/', { timeoutMs: 40 }), /timeout after 40 ms/);
  assert.ok(Date.now() - t0 < 1000, 'gives up on time');
  let ua2 = null;
  await fetchCapped(async (u, o) => { ua2 = o.headers['User-Agent']; return textRes('ok'); }, 'https://x.test/', { ua: 'Browser' });
  assert.equal(ua2, 'Browser', 'a source that needs a browser UA can have one');
  const iso = await fetchCapped(async () => new Response(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><t>caf\xe9</t>', 'latin1')), 'https://x.test/');
  assert.match(iso, /café/);
});

test('dedupe: one copy of each headline, newest first; filings by link', () => {
  const a = [{ title: 'Apple: Results', link: 'https://a/1', time: '2026-09-25T10:00:00.000Z' }];
  const b = [{ title: 'apple -- results!', link: 'https://b/1', time: '2026-09-25T09:00:00.000Z' }, { title: 'Later', link: 'https://b/2', time: '2026-09-25T11:00:00.000Z' }];
  assert.deepEqual(mergeItems([a, b]).map((n) => n.title), ['Later', 'Apple: Results']);
  const q = (link, time) => ({ title: 'Apple Inc.: Results', link, time, source: 'SEC' });
  const f = mergeItems([[q('https://sec/1', '2026-07-30'), q('https://sec/2', '2026-04-30')], [q('https://sec/1', '2026-07-30')]]);
  assert.deepEqual(f.map((n) => n.link), ['https://sec/1', 'https://sec/2'], 'a Results 8-K every quarter, each once');
  assert.equal(mergeItems([[{ title: '', link: 'https://x/', time: null }]]).length, 0);
  assert.equal(mergeItems([a, b], 1).length, 1);
});

test('a tab survives one dead feed; a tab with every feed dead is empty, not an error', async () => {
  const body = { 'https://w/1': fx('fed-speeches.xml'), 'https://w/2': fx('bls-cpi.atom') };
  const feeds = { MACRO: [
    { id: 'a', name: 'Federal Reserve', url: 'https://w/1' },
    { id: 'b', name: 'BLS', url: 'https://w/2' },
    { id: 'c', name: 'Dead', url: 'https://w/3' },
  ] };
  const fetchImpl = async (url) => (body[url] ? textRes(body[url]) : textRes('', 500));
  const d = await makeNewsFeeds({ fetchImpl, cache: createCache(), feeds }).getNewsTab('macro');
  assert.equal(d.tab, 'MACRO');
  assert.equal(d.items.length, 4);
  assert.deepEqual(d.sources, ['Federal Reserve', 'BLS']);
  assert.deepEqual(d.failed, ['Dead']);
  assert.ok(d.items.every((n, i) => i === 0 || d.items[i - 1].time >= n.time), 'newest first');
  const dead = await makeNewsFeeds({ fetchImpl: async () => { throw new Error('down'); }, cache: createCache(), feeds }).getNewsTab('MACRO');
  assert.deepEqual(dead.items, []);
  assert.equal(dead.updated, null);
  await assert.rejects(makeNewsFeeds({ fetchImpl, feeds }).getNewsTab('NOPE'), /unknown news tab/);
  assert.deepEqual(SERVER_TABS, NEWS_TABS, 'server and screen agree on the tabs');
  for (const t of SERVER_TABS.slice(1)) assert.ok(TAB_FEEDS[t]?.length, t);
});

test('NEWS <ticker>: Nasdaq, Seeking Alpha and SEC merged; one source down is fine', async () => {
  const now = Date.now();
  const sub = fxJson('sec-submissions-aapl.json');
  // Move the fixture's 8-Ks into the last year so they count.
  sub.filings.recent.acceptanceDateTime = sub.filings.recent.acceptanceDateTime.map((_, i) => new Date(now - (i + 1) * 86400_000).toISOString());
  const fetchImpl = async (url, opts) => {
    if (url.includes('nasdaq.com')) return textRes('', 503);
    if (url.includes('seekingalpha.com')) return textRes(fx('sa-aapl.xml'));
    if (url.endsWith('company_tickers.json')) return textRes(JSON.stringify({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } }));
    if (url.includes('/submissions/CIK0000320193.json')) {
      secCalls.push(opts?.headers?.['User-Agent']);
      return textRes(JSON.stringify(sub));
    }
    return textRes('', 404);
  };
  const secCalls = [];
  const tn = makeTickerNews({ fetchImpl, cache: createCache() });
  const d = await tn.getTickerNews('aapl');
  assert.equal(d.ticker, 'AAPL');
  await tn.getTickerNews('AAPL');
  assert.equal(secCalls.length, 1, 'one SEC submissions fetch per ticker, cached');
  assert.equal(secCalls[0], SEC_UA, 'through FILINGS: the SEC User-Agent');
  const srcs = new Set(d.items.map((n) => n.source));
  assert.ok(srcs.has('SA') && srcs.has('SEC'), [...srcs].join(','));
  assert.ok(d.items.every((n, i) => i === 0 || d.items[i - 1].time >= n.time), 'newest first');
  assert.equal(new Set(d.items.map(dedupeKey)).size, d.items.length, 'no repeats');
  assert.equal(d.items.filter((n) => n.title === 'Apple Inc.: Results').length, 2, 'each quarter\'s results filing');
  const sec = d.items.filter((n) => n.source === 'SEC');
  assert.equal(aboutTicker(sec, 'AAPL', null).length, sec.length, 'filings always count as about the company');

  const unknown = await makeTickerNews({ fetchImpl, cache: createCache() }).getTickerNews('ZZZZ');
  assert.ok(unknown.items.every((n) => n.source === 'SA'), 'no SEC match is not an error');
  const saDown = async (url) => (url.includes('nasdaq.com') ? textRes(fx('nasdaq-aapl.xml')) : url.includes('seekingalpha.com') ? textRes('', 500) : fetchImpl(url));
  const n = await makeTickerNews({ fetchImpl: saDown, cache: createCache() }).getTickerNews('AAPL');
  assert.ok(n.items.some((x) => x.source !== 'SA' && x.source !== 'SEC'), 'Nasdaq rows keep their publisher');
  assert.ok(!n.items.some((x) => x.source === 'SA'));
  await assert.rejects(makeTickerNews({ fetchImpl: async () => textRes('', 500), cache: createCache() }).getTickerNews('AAPL'), (e) => e.code === 'unavailable');

  // A slow SEC lookup does not hold the answer: past the budget it goes out without filings.
  const slowSec = async (url) => (url.includes('/submissions/') ? new Promise((r) => setTimeout(() => r(textRes(JSON.stringify(sub))), 300)) : fetchImpl(url));
  const t0 = Date.now();
  const quick = await makeTickerNews({ fetchImpl: slowSec, cache: createCache(), secBudgetMs: 30 }).getTickerNews('AAPL');
  assert.ok(Date.now() - t0 < 250, 'did not wait for SEC');
  assert.ok(!quick.items.some((x) => x.source === 'SEC'));
});

// ---- screen: tabs, tags, escaping -------------------------------------------------

test('NEWS tabs are commands; NEWS alone is MARKETS; NEWS <ticker> still works', () => {
  assert.deepEqual(NEWS_TABS, ['MARKETS', 'MACRO', 'SEC', 'WIRES', 'WSB']);
  for (const t of NEWS_TABS) {
    const p = parseCommand(tabCommand(t));
    assert.equal(p.name, 'NEWS', t);
    assert.equal(p.error, undefined, t);
  }
  assert.deepEqual(parseCommand('news sec').args, { tab: 'SEC' });
  assert.equal(parseCommand('NEWS').args?.tab, undefined);
  assert.equal(parseCommand('NEWS AAPL').name, 'TICKERNEWS');
  assert.equal(parseCommand('AAPL NEWS').name, 'TICKERNEWS');
  assert.equal(parseNewsArgs(['AAPL']), null);
  assert.equal(newsApi('MARKETS'), '/api/news');
  assert.equal(newsApi('WSB'), '/api/news?tab=WSB');
});

test('every source has its short tag', () => {
  const tags = { CNBC: 'CNBC', MarketWatch: 'MKTW', 'Yahoo Finance': 'YHOO', 'Federal Reserve': 'FED', BLS: 'BLS', 'SEC EDGAR': 'SEC', 'PR Newswire': 'PRN', GlobeNewswire: 'GNW', 'Business Wire': 'BW', 'r/wallstreetbets': 'WSB' };
  for (const [name, tag] of Object.entries(tags)) assert.equal(shortSource(name), tag, name);
  const names = new Set(Object.values(TAB_FEEDS).flat().map((f) => f.name));
  for (const n of names) assert.ok(tags[n], `${n} has a tag`);
});

test('escaping: feed text never becomes markup; only http links, new tab, no referrer', () => {
  const [item] = parseFeed('<rss><item><title>&lt;img src=x onerror=alert(1)&gt; Fed "hikes" &amp; more</title><link>https://example.com/a?b=1&amp;c="2"</link></item></rss>', 'BLS');
  const html = newsList([item, { title: 'bad', link: 'javascript:alert(1)', source: 'x' }]);
  assert.doesNotMatch(html, /<img|onerror=alert\(1\)>|javascript:/);
  assert.match(html, /Fed &quot;hikes&quot; &amp; more/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  const t = tickerNewsList([{ title: '<script>x</script>', link: 'https://example.com/', source: '<b>SA</b>', time: null }]);
  assert.doesNotMatch(t, /<script>|<b>/);
  assert.match(t, /&lt;script&gt;/);
});
