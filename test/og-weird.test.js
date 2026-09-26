// Share cards for the WEIRD gauges: which commands make one, the page meta, the live /
// stale / NO DATA variants, the grid card, and the bounded PNG cache. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import {
  weirdCommand, gaugeModel, collageModel, gaugeTree, collageTree, weirdMeta, makeWeirdCards, cardKey, cardDate,
  sparkPoints, COLLAGE_SIZE, COLLAGE_ORDER,
} from '../lib/og-weird.js';
import { renderPng, withMeta, W, H } from '../lib/og.js';
import { parseCommand, urlFor } from '../public/app.js';
import { WEIRD_GAUGES } from '../public/screens/weird-gauges.js';
import { gaugeShareLinks } from '../public/screens/weird.js';
import { ALIASES } from '../public/registry.js';

const PAGE = '<html><head>\n  <meta property="og:title" content="x">\n  <meta name="twitter:card" content="summary">\n</head><body></body></html>';
const byId = (id) => WEIRD_GAUGES.find((g) => g.id === id);

// A good reading for any gauge, in the /api/weird/<id> shape.
const reading = (g, extra = {}) => ({
  id: g.id, ok: true, stale: false, updated: '2026-09-26T06:00:00.000Z',
  headline: `${g.command} 42`, line: `The ${g.title} line`, spark: [1, 3, 2, 5], asOf: '2026-09-20', source: 'Test source', ...extra,
});

// Every string drawn in a satori tree.
function texts(node, out = []) {
  if (node == null || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  texts(node.props?.children, out);
  return out;
}

test('weird card: only the gauge commands, their aliases and WEIRD make one', () => {
  for (const g of WEIRD_GAUGES) {
    assert.equal(weirdCommand(g.command, parseCommand), g.command);
    assert.equal(weirdCommand(g.command.toLowerCase(), parseCommand), g.command);
  }
  for (const [alias, name] of Object.entries(ALIASES)) {
    if (WEIRD_GAUGES.some((g) => g.command === name)) assert.equal(weirdCommand(alias, parseCommand), name, alias);
  }
  assert.equal(weirdCommand('ships', parseCommand), 'CANAL');
  assert.equal(weirdCommand('CANAL extra words', parseCommand), 'CANAL');
  assert.equal(weirdCommand('WEIRD', parseCommand), 'WEIRD');
  for (const c of ['', 'AAPL', 'HOME', 'NEWS', 'WHATIF IPHONE6', 'AFFORD 1200', '<script>', 'CANAL">', 'weirdo', 'x'.repeat(41), `CANAL ${'x'.repeat(40)}`]) {
    assert.equal(weirdCommand(c, parseCommand), null, c);
  }
});

test('weird card: a live gauge shows its own headline, line, sparkline, source and date', () => {
  const g = byId('canal');
  const m = gaugeModel(g, reading(g, { headline: 'HORMUZ 3 SHIPS/DAY', line: '7-day average; 1-year average 35', source: 'IMF PortWatch' }));
  assert.equal(m.ok, true);
  assert.equal(m.headline, 'HORMUZ 3 SHIPS/DAY');
  assert.equal(m.asOf, 'SEP 20 2026');
  assert.deepEqual(m.spark, [1, 3, 2, 5]);
  assert.equal(m.stale, false);
  const words = texts(gaugeTree(m)).join('\n');
  for (const s of ['HORMUZ 3 SHIPS/DAY', '7-day average; 1-year average 35', 'SOURCE: IMF PortWatch · AS OF SEP 20 2026', 'bloombroke.com/?c=CANAL', 'BLOOMBROKE', 'CANAL']) assert.ok(words.includes(s), s);
  assert.doesNotMatch(words, /STALE/);
  assert.equal(cardDate('2026-08-01', 'month'), 'AUG 2026');
  assert.equal(cardDate('2026-09-26T06:39:51.000Z', 'time'), 'SEP 26 2026 02:39 ET');
  assert.equal(cardDate('', 'day'), '');
  assert.deepEqual(sparkPoints([1, null, 'x', 2]), [1, 2]);
  assert.deepEqual(sparkPoints([1]), []);
  assert.ok(sparkPoints(Array.from({ length: 400 }, (_, i) => i)).length <= 91);
});

test('weird card: a stale gauge keeps its last good value and real date, marked stale', () => {
  const g = byId('pizza');
  const m = gaugeModel(g, reading(g, { stale: true, headline: 'DEFCON 3', asOf: '2026-09-25T22:00:00Z', spark: null }));
  assert.equal(m.stale, true);
  assert.equal(m.headline, 'DEFCON 3');
  assert.equal(m.asOf, 'SEP 25 2026 18:00 ET');
  const words = texts(gaugeTree(m)).join('\n');
  assert.match(words, /LAST GOOD READING SEP 25 2026 18:00 ET · STALE/);
  const meta = weirdMeta(m);
  assert.equal(meta.title, 'PIZZA: DEFCON 3');
  assert.match(meta.description, /last good reading SEP 25 2026 18:00 ET/);
});

test('weird card: NO DATA draws the gauge name and no number', () => {
  const g = byId('undies');
  for (const d of [{ id: 'undies', ok: false, headline: 'NO DATA', source: 'BLS' }, { id: 'undies', ok: false, headline: 'LOADING', pending: true, source: 'BLS' }, null]) {
    const m = gaugeModel(g, d);
    assert.equal(m.ok, false);
    assert.equal(m.headline, undefined);
    assert.equal(m.spark, undefined);
    const words = texts(gaugeTree(m)).join('\n');
    assert.match(words, /UNDIES/);
    // (a source name can hold a series id, like BLS CPI CUUR0000SEAA02)
    assert.doesNotMatch(words.replace(/SOURCE: .*/, ''), /NO DATA|LOADING|\d/, 'no number, no error word on a share card');
    const meta = weirdMeta(m);
    assert.doesNotMatch(`${meta.title} ${meta.description}`.replace(/Source: [^.]*\./, ''), /NO DATA|\d/);
    assert.match(meta.image, /\/og\/weird\.png\?c=UNDIES&v=[0-9a-f]{10}$/);
  }
});

test('weird card: every gauge URL gets its own og and twitter tags, escaped', async () => {
  for (const g of WEIRD_GAUGES) {
    const cards = makeWeirdCards({ getGauge: async (id) => reading(byId(id)), getWeird: async () => ({ gauges: [] }), render: async () => Buffer.from('x') });
    const meta = await cards.meta(g.command);
    const html = withMeta(PAGE, meta);
    const q = `c=${encodeURIComponent(g.command)}`;
    assert.match(html, new RegExp(`og:title" content="${g.command}: ${g.command} 42"`));
    assert.match(html, /og:description" content="The .+ line\. Source: Test source, as of /);
    assert.match(html, new RegExp(`og:image" content="https://bloombroke\\.com/og/weird\\.png\\?${q}&amp;v=[0-9a-f]{10}"`));
    assert.match(html, new RegExp(`og:url" content="https://bloombroke\\.com/\\?${q}"`));
    assert.match(html, /twitter:card" content="summary_large_image"/);
    assert.match(html, /twitter:image" content="https:\/\/bloombroke\.com\/og\/weird\.png/);
    assert.equal((html.match(/og:title/g) || []).length, 1, 'the old tags are replaced');
    assert.doesNotMatch(html, /—/);
  }
  const g = byId('wsb');
  const html = withMeta(PAGE, weirdMeta(gaugeModel(g, reading(g, { headline: '<b>"GME" & co</b>', line: "it's <i>" }))));
  assert.match(html, /og:title" content="WSB: &lt;b&gt;&quot;GME&quot; &amp; co&lt;\/b&gt;"/);
  assert.doesNotMatch(html.split('</head>')[0].replace(/<meta [^>]*>/g, ''), /<b>|<i>/);
});

test('weird grid card: live gauges first, then stale ones, never NO DATA or pending', () => {
  const rows = WEIRD_GAUGES.map((g) => reading(g));
  const m = collageModel(rows);
  assert.equal(m.tiles.length, COLLAGE_SIZE);
  assert.deepEqual(m.tiles.map((t) => t.command), COLLAGE_ORDER.slice(0, COLLAGE_SIZE).map((id) => byId(id).command));
  const mixed = WEIRD_GAUGES.map((g, i) => {
    if (i % 3 === 0) return { id: g.id, ok: false, headline: 'NO DATA', source: 'S' };
    if (i % 3 === 1) return { id: g.id, ok: false, headline: 'LOADING', pending: true, source: 'S' };
    return reading(g, { stale: i % 2 === 0 });
  });
  const mm = collageModel(mixed);
  const okIds = mixed.filter((r) => r.ok).map((r) => byId(r.id).command);
  assert.ok(mm.tiles.every((t) => okIds.includes(t.command)));
  const firstStale = mm.tiles.findIndex((t) => t.stale);
  if (firstStale >= 0) assert.ok(mm.tiles.slice(firstStale).every((t) => t.stale), 'live before stale');
  assert.ok(texts(collageTree(mm)).join('\n').includes('STALE ·') === mm.tiles.some((t) => t.stale));
  const empty = collageModel([{ id: 'canal', ok: false, headline: 'NO DATA', source: 'IMF PortWatch' }]);
  assert.equal(empty.tiles.length, 0);
  assert.doesNotMatch(texts(collageTree(empty)).join('\n').replace(/23 ODD/, ''), /\d/);
  const meta = weirdMeta(m);
  assert.equal(meta.title, 'WEIRD: odd live gauges on Bloombroke');
  assert.match(meta.image, /\/og\/weird\.png\?c=WEIRD&v=/);
});

test('weird cards: drawn once per gauge and data, cache and render work are bounded', async () => {
  let renders = 0;
  let data = Object.fromEntries(WEIRD_GAUGES.map((g) => [g.id, reading(g)]));
  let fallbacks = 0;
  const cards = makeWeirdCards({
    getGauge: async (id) => data[id],
    getWeird: async () => ({ gauges: Object.values(data) }),
    render: async () => { renders += 1; return Buffer.alloc(1000, renders); },
    fallback: async () => { fallbacks += 1; return Buffer.from('site'); },
    maxEntries: 3,
    budget: 8,
  });
  const a = await cards.png('CANAL');
  const b = await cards.png('CANAL');
  assert.equal(renders, 1, 'same data, same PNG');
  assert.equal(a.png, b.png);
  assert.equal(a.maxAge, 600);
  await Promise.all([cards.png('PIZZA'), cards.png('PIZZA'), cards.png('PIZZA')]);
  assert.equal(renders, 2, 'one render in flight per card');
  data = { ...data, canal: reading(byId('canal'), { headline: 'HORMUZ 9 SHIPS/DAY' }) };
  const c = await cards.png('CANAL');
  assert.equal(renders, 3, 'new data, new PNG');
  assert.notEqual(c.png, a.png);
  assert.equal(cards.cache.has(cardKey(c.model)), true);
  for (const cmd of ['DEGEN', 'WAFFLE', 'PANIC']) await cards.png(cmd);
  assert.equal(cards.cache.size, 3, 'the cache never holds more than maxEntries');
  assert.equal(cards.cache.bytes, 3000);
  data = { ...data, eggs: { ...data.eggs, stale: true } };
  assert.equal((await cards.png('EGGPRICE')).maxAge, 120, 'a stale card is kept briefly downstream');
  const hot = await cards.png('HOTDOG');
  assert.equal(renders, 8);
  const over = await cards.png('BIGMAC');
  assert.equal(renders, 8, 'past the render budget nothing new is drawn');
  assert.equal(over.png.toString(), 'site');
  assert.equal(over.maxAge, 60);
  assert.equal(fallbacks, 1);
  assert.equal(await cards.png('AAPL'), null, 'not a gauge: nothing drawn');
  assert.equal(await cards.meta('AAPL'), null);

  data = { ...data, hotdog: reading(byId('hotdog'), { headline: '$9.99' }) };
  const kept = await cards.png('HOTDOG');
  assert.equal(renders, 8, 'still past the budget');
  assert.equal(kept.png, hot.png, 'past the budget: the newest cached card for that command');
  assert.equal(kept.maxAge, 60);
  assert.equal(fallbacks, 1);

  const slow = makeWeirdCards({ getGauge: () => new Promise(() => {}), getWeird: async () => ({ gauges: [] }), render: async () => Buffer.from('x') });
  const m = await slow.model('CANAL', { wait: 20 });
  assert.equal(m.ok, false, 'no answer in time: the no-number card, never an invented one');
});

test('weird meta: the page never waits long for gauge data', async () => {
  let answer = null;
  let calls = 0;
  let t = 0;
  const cards = makeWeirdCards({
    getGauge: (id) => { calls += 1; return answer ? Promise.resolve(answer(id)) : new Promise(() => {}); },
    getWeird: () => new Promise(() => {}),
    render: async () => Buffer.from('x'),
    now: () => t,
  });
  const started = Date.now();
  const cold = await cards.meta('CANAL', { wait: 30 });
  assert.ok(Date.now() - started < 500);
  assert.equal(cold.title, `${byId('canal').title === 'Canal' ? 'Ships through Hormuz, Suez, Panama and other chokepoints' : ''} (CANAL)`, 'slow: the no-number meta');
  const grid = await cards.meta('WEIRD', { wait: 30 });
  assert.equal(grid.title, 'WEIRD: odd live gauges on Bloombroke');
  assert.equal(await cards.meta('AAPL', { wait: 30 }), null);

  answer = (id) => reading(byId(id), { headline: 'HORMUZ 3 SHIPS/DAY' });
  await cards.png('EGGPRICE');
  const known = await cards.meta('EGGPRICE', { wait: 30 });
  assert.equal(known.title, 'EGGPRICE: HORMUZ 3 SHIPS/DAY', 'a drawn card leaves its meta behind');
  answer = null;
  const before = calls;
  const again = await cards.meta('EGGPRICE', { wait: 30 });
  assert.equal(again, known, 'remembered meta comes back at once, even when the source hangs');
  assert.equal(calls, before, 'no refresh while it is fresh');
  t = 60_000;
  assert.equal(await cards.meta('EGGPRICE', { wait: 30 }), known);
  assert.equal(calls, before + 1, 'an old one is refreshed in the background');
});

test('weird cards: real PNGs at 1200x630 (gauge, stale, no data, grid)', async () => {
  const g = byId('eggs');
  const trees = [
    gaugeTree(gaugeModel(g, reading(g, { headline: '$2.27 A DOZEN', line: 'US city average; −64% from peak', asOf: '2026-08-01' }))),
    gaugeTree(gaugeModel(g, reading(g, { stale: true }))),
    gaugeTree(gaugeModel(g, null)),
    collageTree(collageModel(WEIRD_GAUGES.map((x) => reading(x)))),
  ];
  for (const t of trees) {
    const meta = await sharp(await renderPng(t)).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['png', W, H]);
  }
});

test('weird share: a gauge screen links its clean command, and posts it on X', () => {
  assert.equal(urlFor('SHIPS').url, 'CANAL');
  assert.equal(urlFor('canal extra').url, 'CANAL');
  assert.equal(urlFor('WEIRD').url, 'WEIRD');
  const g = byId('canal');
  const links = gaugeShareLinks(g, { headline: 'HORMUZ 3 SHIPS/DAY', line: '7-day average' }, 'https://bloombroke.com');
  assert.equal(links.url, 'https://bloombroke.com/?c=CANAL');
  const x = new URL(links.x);
  assert.equal(x.origin + x.pathname, 'https://x.com/intent/post');
  assert.equal(x.searchParams.get('url'), 'https://bloombroke.com/?c=CANAL');
  assert.equal(x.searchParams.get('text'), 'CANAL: HORMUZ 3 SHIPS/DAY. 7-day average');
  const stale = new URL(gaugeShareLinks(g, { headline: 'HORMUZ 3 SHIPS/DAY', line: 'x'.repeat(300), stale: true }, 'https://bloombroke.com').x);
  const text = stale.searchParams.get('text');
  assert.match(text, /^CANAL: HORMUZ 3 SHIPS\/DAY \(last good reading\)\. x+\.\.\.$/);
  assert.ok(text.length < 160);
});

test('weird share copy rules: no banned brand word, no em dashes, no amber', () => {
  const banned = new RegExp(['Bloom', 'berg'].join(''), 'i');
  for (const f of ['lib/og-weird.js', 'public/screens/weird.js', 'public/commands-weird.js']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, banned, f);
    assert.doesNotMatch(s, /—/, f);
    assert.doesNotMatch(s, /amber|#ffbf00|#ffb000|#f5a623/i, f);
  }
});
