// Share cards for ticker screens and AFFORD, and the site's own share text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  DEFAULT_META, quoteTicker, quoteModel, quoteTree, quoteMeta, getQuoteCard, sparkPath, asOfText,
  affordModel, affordTree, affordMeta, renderPng, withMeta, W, H,
} from '../lib/og.js';
import { parseCommand } from '../public/app.js';

const QUOTE = {
  ticker: 'AAPL', name: 'Apple Inc.', label: null, kind: 'stock', decimals: null, realTime: true, currency: 'USD',
  last: 340.08, change: 4.16, changePct: 1.24, asOf: '2026-09-25T14:14:12.148-0400', stale: false, updated: '2026-09-25T18:14:25.736Z',
};
const CHART = { points: [309.9, 313.45, 314.58, 319.7, 316.85, 325.13, 324.96, 328.21, 319.97, 316.22, 315.34, 326.57, 332.27, 333.08, 331.34, 332.41, 337].map((v, i) => ({ t: 1787630400000 + i * 864e5, v })), stale: false };

test('site share text: free first, Pro second, no paid-sounding lines', () => {
  assert.equal(DEFAULT_META.title, 'Bloombroke: a free market terminal. Pro $420 a year.');
  assert.match(DEFAULT_META.description, /free market terminal/);
  for (const v of Object.values(DEFAULT_META)) {
    assert.doesNotMatch(v, /32,000|a month\.$|less than a coffee/);
    assert.doesNotMatch(v, /—/);
  }
});

test('ticker card: only a symbol makes one, never a command', () => {
  assert.equal(quoteTicker('AAPL', parseCommand), 'AAPL');
  assert.equal(quoteTicker('aapl 5y', parseCommand), 'AAPL');
  assert.equal(quoteTicker('GOLD', parseCommand), 'GOLD');
  for (const c of ['MARKETS', 'NEWS', 'HOME', 'AAPL NEWS', 'nvidia', '', 'WHATIF IPHONE6', 'AFFORD 1200']) assert.equal(quoteTicker(c, parseCommand), null, c);
});

test('ticker card: numbers straight from the quote and the 1-month bars', () => {
  const m = quoteModel(QUOTE, CHART, 'AAPL');
  assert.equal(m.name, 'Apple Inc.');
  assert.equal(m.last, '340.08');
  assert.equal(m.change, '+4.16');
  assert.equal(m.changePct, '+1.24%');
  assert.equal(m.dir, 'up');
  assert.equal(m.points.length, 17);
  assert.equal(m.monthPct, `+${((340.08 / 309.9 - 1) * 100).toFixed(1)}%`);
  assert.equal(m.asOf, 'SEP 25 2026 14:14 ET');
  assert.equal(m.fresh, 'REAL TIME (NASDAQ LAST SALE)');
  assert.equal(m.source, 'CNBC');
  const down = quoteModel({ ...QUOTE, change: -2.5, changePct: -0.73, realTime: false, kind: 'future', decimals: 1 }, null, 'GOLD');
  assert.deepEqual([down.change, down.changePct, down.dir, down.fresh, down.monthPct, down.points.length], ['-2.5', '-0.73%', 'down', 'DELAYED', null, 0]);
  assert.equal(asOfText('2026-09-24'), 'SEP 24 2026 CLOSE');
  assert.equal(asOfText('nonsense'), '');
  assert.match(sparkPath([1, 2, 3], 100, 50), /^M0\.0 44\.0 L50\.0 25\.0 L100\.0 6\.0$/);
  assert.equal(sparkPath([1], 100, 50), '');
});

test('ticker card: meta, cached 10 minutes, never for last-known prices', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-og-q-'));
  try {
    let calls = 0;
    const deps = { parse: parseCommand, cacheDir: dir, getQuote: async (t) => { calls += 1; return t === 'AAPL' ? QUOTE : null; }, getChart: async () => CHART };
    const a = await getQuoteCard('AAPL', deps);
    const b = await getQuoteCard('aapl', deps);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
    assert.equal(await getQuoteCard('XYZQ', deps), null, 'no quote: the site card');
    assert.equal(await getQuoteCard('MARKETS', deps), null);
    const noChart = await getQuoteCard('MSFT', { ...deps, getQuote: async () => ({ ...QUOTE, ticker: 'MSFT' }), getChart: async () => { throw new Error('down'); } });
    assert.equal(noChart.points.length, 0, 'a chart outage still gives a card, without the line');
    const before = readdirSync(dir).length;
    await getQuoteCard('TSLA', { ...deps, getQuote: async () => ({ ...QUOTE, stale: true }) });
    assert.equal(readdirSync(dir).length, before, 'stale quotes are not kept');
    const meta = quoteMeta(a);
    assert.equal(meta.title, 'AAPL: Apple Inc. 340.08 USD, +1.24% today');
    assert.match(meta.description, /^As of SEP 25 2026 14:14 ET, real time \(Nasdaq Last Sale\)\. 1 month: \+9\.7%\. Source: CNBC\./);
    assert.equal(meta.image, 'https://bloombroke.com/og/quote.png?c=AAPL');
    assert.equal(meta.url, 'https://bloombroke.com/?c=AAPL');
    const html = withMeta('<head>\n</head>', meta);
    assert.match(html, /og:image" content="https:\/\/bloombroke\.com\/og\/quote\.png\?c=AAPL"/);
    assert.match(html, /twitter:card" content="summary_large_image"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AFFORD card: cost per use and verdict from the same maths as the screen', () => {
  const m = affordModel('AFFORD 1200 BIKE 2 PER WEEK');
  assert.deepEqual(m, {
    command: 'AFFORD 1200 BIKE 2 PER WEEK FOR 3Y', label: 'Bike', price: '$1,200', perUse: '$3.85',
    how: 'used twice a week for 3 years', uses: '312 uses', verdict: 'SLEEP ON IT', verdictKey: 'sleep', line: 'Under $10 a use. Think it over.',
  });
  assert.equal(affordModel('afford $1,200 twice a week').command, 'AFFORD 1200 2 PER WEEK FOR 3Y');
  assert.equal(affordModel('AFFORD 1200 AAPL'), null, 'investments get the site card');
  assert.equal(affordModel('AFFORD'), null);
  assert.equal(affordModel('WHATIF IPHONE6'), null);
  const meta = affordMeta(m);
  assert.equal(meta.title, 'Bike, $1,200: $3.85 per use. SLEEP ON IT.');
  assert.equal(meta.image, 'https://bloombroke.com/og/afford.png?c=AFFORD+1200+BIKE+2+PER+WEEK+FOR+3Y');
  assert.doesNotMatch(JSON.stringify([m, meta]), /—/);
});

test('ticker and AFFORD cards render at 1200x630', async () => {
  const trees = [
    quoteTree(quoteModel(QUOTE, CHART, 'AAPL')),
    quoteTree(quoteModel(QUOTE, null, 'AAPL')),
    affordTree(affordModel('AFFORD 30000 FOR 8Y')),
  ];
  for (const tree of trees) {
    const png = await renderPng(tree);
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, W);
    assert.equal(meta.height, H);
  }
});
