// The WHY share card (/og/why.png) and its page title and description.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sharp from 'sharp';
import { whyTicker, whyCardModel, whyTree, makeWhyCards, mountWhyCards, CARD_ROWS } from '../lib/og-why.js';
import { whyMeta } from '../lib/seo.js';
import { withMeta, W, H } from '../lib/og.js';
import { parseCommand } from '../public/app.js';

const WHY = {
  ticker: 'AAPL', company: true, name: 'Apple Inc.', rows: [
    { rank: 1, date: '2026-04-09', pct: 15.33, close: 198.85, items: [{ kind: 'NEWS', text: 'Tariff pause lifts stocks', url: 'https://n.test/1' }, { kind: 'FILING', text: '8-K: other events' }] },
    { rank: 2, date: '2026-04-03', pct: -9.25, close: 203.19, items: [] },
    { rank: 3, date: '2026-04-04', pct: -7.29, close: 188.38, items: [{ kind: 'FILING', text: '8-K: earnings' }] },
    { rank: 4, date: '2026-05-02', pct: -3.74, close: 205.35, items: [] },
  ],
};

test('WHY card: only WHY <ticker> makes one, either word order', () => {
  assert.equal(whyTicker('WHY AAPL', parseCommand), 'AAPL');
  assert.equal(whyTicker('aapl why', parseCommand), 'AAPL');
  for (const c of ['WHY', 'AAPL', 'NEWS AAPL', '', 'WHATIF IPHONE6']) assert.equal(whyTicker(c, parseCommand), null, c);
});

test('WHY card: the symbol and its top 3 rows, straight from getWhy', () => {
  const m = whyCardModel(WHY);
  assert.equal(CARD_ROWS, 3);
  assert.equal(m.rows.length, 3);
  assert.deepEqual(m.rows[0], { date: 'APR 09, 2026', pct: '+15.33%', dir: 'up', close: '198.85', what: 'Tariff pause lifts stocks', more: 1 });
  assert.equal(m.rows[1].pct, '−9.25%');
  assert.equal(m.rows[1].what, '--', 'nothing came out: --');
  assert.equal(whyCardModel({ ...WHY, company: false }), null);
  assert.equal(whyCardModel({ ...WHY, rows: [] }), null);
});

test('WHY card: renders a 1200x630 PNG', async () => {
  const cards = makeWhyCards({ getWhy: async () => WHY, parse: parseCommand });
  const { png, maxAge } = await cards.png('WHY AAPL');
  const info = await sharp(png).metadata();
  assert.equal(info.format, 'png');
  assert.equal(info.width, W);
  assert.equal(info.height, H);
  assert.equal(maxAge, 3600);
  const tree = JSON.stringify(whyTree(whyCardModel(WHY)));
  assert.match(tree, /BIGGEST DAILY MOVES, 1Y/);
  assert.match(tree, /Not a cause/);
  assert.doesNotMatch(tree, /—/);
});

test('WHY card: the OG route serves the card, and the site card for anything else', async () => {
  const app = express();
  let calls = 0;
  const siteCard = await sharp({ create: { width: W, height: H, channels: 3, background: '#05080C' } }).png().toBuffer();
  mountWhyCards(app, { getWhy: async () => { calls += 1; return WHY; }, parse: parseCommand, fallback: async () => siteCard });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/og/why.png?c=WHY+AAPL`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.match(res.headers.get('cache-control'), /max-age=3600/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.notDeepEqual(buf, siteCard);
    const other = await fetch(`${base}/og/why.png?c=MARKETS`);
    assert.equal(other.status, 200);
    assert.deepEqual(Buffer.from(await other.arrayBuffer()), siteCard);
    assert.match(other.headers.get('cache-control'), /max-age=300/);
    assert.equal(calls, 1, 'no data asked for a command that is not WHY');
  } finally {
    server.close();
  }
});

test('WHY page meta: an SEO title and description from lib/seo.js, with the card', async () => {
  const m = whyMeta('AAPL', { name: 'Apple Inc.', top: { pct: '+15.33%', date: 'APR 09, 2026' } });
  assert.equal(m.title, 'AAPL biggest daily moves, 1Y | WHY | Bloombroke');
  assert.match(m.description, /10 biggest daily moves in Apple Inc\. \(AAPL\)/);
  assert.match(m.description, /Biggest: \+15\.33% on APR 09, 2026\./);
  assert.match(m.description, /not a cause/);
  assert.equal(m.image, 'https://bloombroke.com/og/why.png?c=WHY+AAPL');
  assert.equal(m.url, 'https://bloombroke.com/?c=WHY+AAPL');
  for (const v of Object.values(m)) assert.doesNotMatch(v, /—|\b(buy|sell|signal|target)\b/i);
  // Through the share path: the card's meta ends up in the page.
  const cards = makeWhyCards({ getWhy: async () => WHY, parse: parseCommand });
  const meta = await cards.meta('AAPL WHY');
  const html = withMeta('<html><head><title>x</title><meta name="description" content="y"></head></html>', meta);
  assert.match(html, /<title>AAPL biggest daily moves, 1Y \| WHY \| Bloombroke<\/title>/);
  assert.match(html, /og:image" content="https:\/\/bloombroke\.com\/og\/why\.png\?c=WHY\+AAPL"/);
  assert.equal(await cards.meta('MARKETS'), null);
  const slow = makeWhyCards({ getWhy: () => new Promise(() => {}), parse: parseCommand });
  const late = await slow.meta('WHY AAPL', { wait: 20 });
  assert.equal(late.title, 'AAPL biggest daily moves, 1Y | WHY | Bloombroke', 'a slow answer still gets the title');
  const spx = await makeWhyCards({ getWhy: async () => ({ ticker: 'SPX', company: false, rows: [] }), parse: parseCommand }).meta('WHY SPX');
  assert.equal(spx.image, 'https://bloombroke.com/og/default.png');
});
