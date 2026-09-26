import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { isCalculated, FX_SOURCE } from '../public/screens/fx.js';
import { newsList, TAB_SOURCES, NEWS_TABS } from '../public/screens/news.js';
import { tickerNewsList, TICKER_SOURCES } from '../public/screens/tickernews.js';

const src = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

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
  assert.match(src('screens/fxmatrix.js'), /Source: ECB statistics via Frankfurter/);
  assert.match(src('screens/fxmatrix.js'), /calculated from the euro rates/);
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
});

test('SEC screens say US SEC EDGAR', () => {
  assert.match(src('screens/financials.js'), /Source: US SEC EDGAR/);
  assert.match(src('screens/profile.js'), /US SEC EDGAR/);
});

test('every data screen names its source', () => {
  const needs = {
    'screens/markets.js': /Prices from CNBC/, 'screens/home.js': /Prices from CNBC/, 'screens/quote.js': /from CNBC/,
    'screens/rates.js': /Freddie Mac/, 'screens/curve.js': /US Treasury/, 'screens/bonds.js': /from CNBC/, 'screens/cpi.js': /Bureau of Labor Statistics/,
    'screens/watch.js': /Prices from CNBC/, 'screens/portfolio.js': /Prices from CNBC/, 'screens/commodities.js': /from CNBC/,
    'screens/earnings.js': /from Nasdaq/, 'screens/dividends.js': /from Nasdaq/, 'screens/calendar.js': /Forex Factory/, 'screens/screen.js': /Nasdaq/,
    'screens/history.js': /from CNBC/, 'screens/compare.js': /from CNBC/, 'screens/sectors.js': /from CNBC/, 'screens/movers.js': /from CNBC/, 'screens/world.js': /from CNBC/,
  };
  for (const [f, re] of Object.entries(needs)) assert.match(src(f), re, f);
});

test('no affiliate, broker or exchange referral links anywhere in public/', () => {
  const walk = (d) => readdirSync(new URL(`../public/${d}`, import.meta.url), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${d}${e.name}/`) : /\.(js|html|css)$/.test(e.name) ? [`${d}${e.name}`] : []));
  for (const f of walk('')) {
    const s = src(f);
    assert.doesNotMatch(s, /[?&](ref|aff|affiliate|referral|partner)=|utm_source=|robinhood|coinbase\.com|binance|etoro|webull|interactivebrokers|tastytrade/i, f);
  }
});
