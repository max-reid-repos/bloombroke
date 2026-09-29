import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { isCalculated, FX_SOURCE } from '../public/screens/fx.js';
import { newsList, TAB_SOURCES, NEWS_TABS } from '../public/screens/news.js';
import { tickerNewsList, TICKER_SOURCES } from '../public/screens/tickernews.js';

const src = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const disclaimer = readFileSync(new URL('../legal/disclaimer.md', import.meta.url), 'utf8');
const walk = (d) => readdirSync(new URL(`../public/${d}`, import.meta.url), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}${e.name}/`) : /\.(js|html|css)$/.test(e.name) ? [`${d}${e.name}`] : []));

test('CRYPTO credits CoinGecko with a link', () => {
  const s = src('screens/crypto.js');
  assert.match(s, /Data provided by CoinGecko/);
  assert.match(s, /Powered by <a href="https:\/\/www\.coingecko\.com\/"[^>]*>CoinGecko<\/a>/);
});

test('FX: ECB reference rates (credit the ECB requires), daily, cross rates marked calculated', () => {
  assert.match(FX_SOURCE, /^Source: ECB reference rates,/);
  assert.doesNotMatch(FX_SOURCE, /Frankfurter/, 'no vendor name on screen');
  assert.match(FX_SOURCE, /DAILY/);
  assert.equal(isCalculated('USD', 'THB'), true);
  assert.equal(isCalculated('EUR', 'USD'), false);
  assert.equal(isCalculated('USD', 'EUR'), false);
  assert.match(src('screens/fx.js'), /meta\.title = FX_SOURCE/, 'the source is the tooltip of the FX panel head');
  assert.match(disclaimer, /Exchange rates: ECB reference rates, once a working day/);
  assert.match(disclaimer, /calculated from the euro rates/);
  assert.doesNotMatch(disclaimer, /Frankfurter/, 'no vendor names in the legal text');
});

test('news: headline, publisher and link only, credited to the publisher', () => {
  const html = newsList([{ title: 'Stocks rise', link: 'https://example.com/a', source: 'CNBC', time: '2026-09-25T12:00:00Z', summary: 'SHOULD NOT SHOW' }]);
  assert.match(html, /Stocks rise/);
  assert.match(html, /href="https:\/\/example\.com\/a"/);
  assert.doesNotMatch(html, /SHOULD NOT SHOW/);
  // No footnote: every headline links to the original publisher in a new tab, and each
  // news panel names its sources in its title strip.
  const linkOut = /href="https:\/\/[^"]+" target="_blank" rel="noopener noreferrer"/;
  assert.match(html, linkOut);
  assert.match(tickerNewsList([{ title: 'x', link: 'https://example.com/b', source: 'SA', time: null }]), linkOut);
  assert.match(newsList([{ title: 'Apple Inc.: Results', link: 'https://www.sec.gov/a', source: 'SEC EDGAR', ticker: 'AAPL', time: null }]), linkOut);
  assert.deepEqual(Object.keys(TAB_SOURCES), NEWS_TABS);
  assert.match(src('screens/news.js'), /meta: esc\(TAB_SOURCES\[tab\]\)/);
  assert.match(src('screens/tickernews.js'), /meta: TICKER_SOURCES/);
  assert.equal(TICKER_SOURCES, 'NEWS PUBLISHERS · SEC');
  for (const f of ['screens/news.js', 'screens/tickernews.js']) assert.doesNotMatch(src(f), /class="footnote"/, f);
  assert.match(disclaimer, /Each headline links to the original publisher/);
  assert.match(disclaimer, /Headlines: news publishers and online forums, the Board of Governors of the Federal Reserve System, the US Bureau of Labor Statistics and SEC EDGAR\./);
});

test('the Disclaimer gives every source by class, names US government sources and required credits, and no vendors', () => {
  const block = disclaimer.slice(disclaimer.indexOf('Where the data comes from'));
  for (const re of [/market data providers/, /news publishers/, /public web data/, /our own counters/, /US Securities and Exchange Commission \(EDGAR\)/, /US Treasury/,
    /US Bureau of Labor Statistics/, /Board of Governors of the Federal Reserve System/, /ECB reference rates/, /Powered by CoinGecko/, /The Economist \(CC BY 4\.0\)/,
    /© OpenStreetMap contributors \(ODbL\)/, /powered by Queue-Times\.com/, /Natural Earth/,
    /RT means real time\. DLY means delayed: futures about 10 minutes, indexes about 15 minutes/]) assert.match(block, re);
  // The New York Fed's required notice and disclaimer, filled in, for the EFFR on RATES and FEDPATH.
  assert.ok(block.includes('The effective federal funds rate (EFFR) shown on RATES and FEDPATH is subject to the Terms of Use posted at newyorkfed.org. The New York Fed is not responsible for publication of the EFFR by Bloombroke, does not sanction or endorse any particular republication, and has no liability for your use.'));
  assert.ok(block.includes('Bloombroke is not affiliated with the New York Fed. The New York Fed does not sanction, endorse, or recommend any products or services offered by Bloombroke.'));
  // Commercial vendors are never named in the legal text (owner rule).
  const terms = readFileSync(new URL('../legal/terms.md', import.meta.url), 'utf8');
  for (const v of ['CNBC', 'Nasdaq', 'Frankfurter', 'Cboe', 'Forex Factory', 'Yahoo', 'MarketWatch', 'Seeking Alpha', 'Freddie Mac', 'FRED', 'GlobeNewswire', 'PR Newswire', 'Business Wire', 'Reddit',
    'IMF PortWatch', 'pizzint', 'Apple App Store', 'Algolia', 'Hacker News', 'Forbes', 'ApeWisdom', 'Polymarket', 'Drewry', 'DICJ', 'Wikimedia']) {
    assert.ok(!disclaimer.includes(v), `disclaimer names ${v}`);
    assert.ok(!terms.includes(v), `terms name ${v}`);
  }
});

test('no per-screen source footnotes: the removed lines never render', () => {
  const gone = [
    'Prices from CNBC', 'Prices and charts from CNBC', 'RT: real time', 'DLY: delayed', 'Build your own screen: <a',
    'The status line shows when', 'Headlines from the CNBC, MarketWatch', 'Source: US SEC EDGAR', 'Dividend data from Nasdaq',
    'Earnings calendar and EPS estimates from Nasdaq', 'Source: Nasdaq stock screener', 'Source: FRED',
  ];
  for (const f of walk('')) {
    const s = src(f);
    for (const g of gone) assert.ok(!s.includes(g), `${f}: ${g}`);
    assert.doesNotMatch(s, /class="footnote[^"]*">\s*(Source:|Prices|Futures prices|Index levels|Daily prices)/, f);
  }
  assert.doesNotMatch(src('screens/company-kit.js'), /sourceLine/, 'company screens carry their notes in the title strip');
});

test('no prose footnotes under panels: reading notes live in the title strip', async () => {
  // Only the Pro page keeps one: the operator and contact line.
  const keep = new Set(['screens/pro.js']);
  for (const f of walk('screens/')) {
    if (keep.has(f)) continue;
    // The WORLD phone legend borrows the class for its look; it is a legend, not a note.
    const s = src(f).replace(/<p class="footnote st-legend"/g, '');
    assert.doesNotMatch(s, /class="footnote/, f);
  }
  const { metaNote } = await import('../public/screens/markets.js');
  assert.equal(metaNote('A = B', 'long <form>'), '<span class="meta-note" title="long &lt;form&gt;">A = B</span>');
  // The legally required small print keeps its exact words, now in the title strip.
  // WHATIF (a card page since Sep 29): a short note under SHARE, the exact words first in
  // + Details; no title strip.
  assert.match(src('screens/whatif.js'), /note: RESULT_NOTE,/);
  assert.match(src('screens/whatif.js'), /const small = \[\n    HINDSIGHT_NOTE,/);
  assert.match(src('screens/fedpath.js'), /FP_NOTE = metaNote\('IMPLIED BY FUTURES, NOT A FORECAST', LABEL\)/);
  assert.match(src('screens/funding.js'), /Hindsight only\. Past returns do not predict future returns\. Not a recommendation\./);
  assert.match(src('screens/compound.js'), /The return is your assumption, not a forecast\./);
});

test('RT and DLY tags carry their meaning in a tooltip', async () => {
  const { freshTag } = await import('../public/freshness.js');
  assert.match(freshTag({ realTime: true }), /title="Real time">RT</);
  assert.match(freshTag({ realTime: false }), /title="Delayed: futures about 10 min, indexes about 15 min">DLY</);
});

test('no affiliate, broker or exchange referral links anywhere in public/', () => {
  for (const f of walk('')) {
    const s = src(f);
    assert.doesNotMatch(s, /[?&](ref|aff|affiliate|referral|partner)=|utm_source=|robinhood\.com|coinbase\.com|webull\.com|kalshi\.com|polymarket\.com|binance|etoro|interactivebrokers|tastytrade/i, f);
  }
});
