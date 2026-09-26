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

test('FX: ECB via Frankfurter, daily, cross rates marked calculated', () => {
  assert.match(FX_SOURCE, /^Source: ECB statistics via Frankfurter\./);
  assert.match(FX_SOURCE, /DAILY/);
  assert.equal(isCalculated('USD', 'THB'), true);
  assert.equal(isCalculated('EUR', 'USD'), false);
  assert.equal(isCalculated('USD', 'EUR'), false);
  assert.match(src('screens/fx.js'), /meta\.title = FX_SOURCE/, 'the source is the tooltip of the FX panel head');
  assert.match(disclaimer, /ECB reference rates via Frankfurter/);
  assert.match(disclaimer, /calculated from the euro rates/);
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
  assert.equal(TICKER_SOURCES, 'NASDAQ · SA · SEC');
  for (const f of ['screens/news.js', 'screens/tickernews.js']) assert.doesNotMatch(src(f), /class="footnote"/, f);
  assert.match(disclaimer, /Each headline links to the original publisher/);
  assert.match(disclaimer, /Headlines: CNBC, MarketWatch, Yahoo Finance, Nasdaq, Seeking Alpha, the Federal Reserve, BLS, SEC EDGAR, GlobeNewswire, PR Newswire, Business Wire and Reddit \(r\/wallstreetbets\)\./);
});

test('the Disclaimer names every data source, and what RT and DLY mean', () => {
  const block = disclaimer.slice(disclaimer.indexOf('Where the data comes from'));
  for (const re of [/CNBC/, /Nasdaq Last Sale/, /US SEC EDGAR/, /Freddie Mac/, /US Treasury/, /Bureau of Labor Statistics/, /Forex Factory/,
    /FRED, Federal Reserve Bank of St\. Louis/, /Federal Reserve Bank of New York/, /Cboe/, /CoinGecko/, /Frankfurter/,
    /RT means real time\. DLY means delayed: futures about 10 minutes, indexes about 15 minutes/]) assert.match(block, re);
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
  assert.match(src('screens/company-kit.js'), /return extra \?/, 'company screens keep only their notes, not a source line');
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
