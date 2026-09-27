// GRAVEYARD v2: data cleaning, respects, the cemetery's layout and keys, the video facade,
// CSP, the sitemap, ON THIS DAY and the stone pages' meta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Database from 'better-sqlite3';
import { loadGraveyardData, cleanEntry, onThisDay, createRespects, makeRespectGate, mountGraveyard, withArt, artOnDisk } from '../lib/graveyard.js';
import { nosuchMeta, stoneDescription, tombstoneTree, makeNoSuchCards, parseBlocklist } from '../lib/og-nosuch.js';
import { securityHeaders } from '../lib/embed.js';
import { sitemapUrls, graveyardSitemapUrls } from '../lib/seo.js';
import { parseCommand } from '../public/app.js';
import { stoneYears, flowersFor, respectsText, onThisDayLine, ytThumb, ytEmbed, MAX_FLOWERS, GRAVEYARD_VIEWS } from '../public/nosuch.js';
import {
  stoneHtml, stonePageHtml, peakLineHtml, videoHtml, flowersHtml, layout, stepStone, zombiesHtml, graveyardTable, onThisDayHtml, sourcesHtml,
} from '../public/screens/graveyard.js';

const FIX = fileURLToPath(new URL('./fixtures/graveyard-v2.json', import.meta.url));
const DATA = loadGraveyardData(FIX);
const LEH = DATA.stones.find((e) => e.ticker === 'LEH');
const BBI = DATA.stones.find((e) => e.ticker === 'BBI');
const ZOM = DATA.zombies[0];
const BANNED = new RegExp(['bloom', 'berg'].join(''), 'i');

test('data: stones and zombies, bad entries out, unsourced or misshapen facts dropped', () => {
  assert.deepEqual(DATA.stones.map((e) => e.ticker), ['LEH', 'BBI']);
  assert.deepEqual(DATA.zombies.map((e) => e.ticker), ['GMZ']);
  assert.equal(LEH.peakLine, '$1,000 at the peak (Feb 2007) was worth $2 by Sep 2008');
  assert.equal(LEH.video.id, 'AAAAAAAAAAA');
  assert.equal(BBI.peakLine, undefined, 'a peakLine without a source is dropped');
  assert.equal(BBI.video, undefined, 'a bad video id is dropped');
  assert.equal(BBI.wayback, undefined, 'only web.archive.org snapshots');
  assert.equal(cleanEntry({ ...LEH, epitaph: 'a — b' }).epitaph, undefined, 'no em dashes');
  assert.deepEqual(ZOM.back, { what: 'Listed again', date: '2010-11-18', ticker: 'GMX' });
  // The real file loads, every entry sourced, and the stones keep their tickers unique.
  const real = loadGraveyardData();
  assert.ok(real.stones.length >= 30);
  const all = [...real.stones, ...real.zombies];
  assert.equal(new Set(all.map((e) => e.ticker)).size, all.length);
  const text = readFileSync(new URL('../data/graveyard.json', import.meta.url), 'utf8');
  assert.doesNotMatch(text, BANNED);
  assert.doesNotMatch(text, /—/);
});

test('stone: years, flowers, the words on its face; zombies say RETURNED', () => {
  assert.equal(stoneYears(LEH), '1994 - 2008');
  assert.equal(stoneYears(BBI), '2010');
  assert.equal(stoneYears(ZOM), '2009 - 2010');
  assert.deepEqual([0, 1, 2, 3, 4, 8, 1000, 1e9].map(flowersFor), [0, 1, 2, 2, 3, 4, 10, MAX_FLOWERS]);
  assert.equal(respectsText(1), '1 respect');
  assert.equal(respectsText(1234), '1,234 respects');
  assert.equal((flowersHtml(8).match(/<svg/g) || []).length, 4);
  const html = stoneHtml(withArt(LEH, { stone: '/img/graveyard/stone.webp', doodles: ['LEH'] }), { n: 3 });
  assert.match(html, /R\.I\.P\./);
  assert.match(html, /Too big to fail\. Failed\./);
  assert.match(html, /doodle-leh\.webp/);
  assert.match(html, /has-art/);
  assert.match(stoneHtml(ZOM), /RETURNED/);
  assert.doesNotMatch(stoneHtml(ZOM), /R\.I\.P\./);
  assert.doesNotMatch(stoneHtml(BBI), /<img/, 'no art yet: a drawn stone, no images');
});

test('RIP WHATIF: the sourced peak line, hidden when null', () => {
  assert.match(peakLineHtml(LEH), /\$1,000 at the peak \(Feb 2007\) was worth \$2 by Sep 2008 <a class="dim" href="https:\/\/example\.test\/leh-peak" target="_blank" rel="noopener noreferrer">/);
  assert.equal(peakLineHtml(BBI), '');
  assert.doesNotMatch(stonePageHtml(BBI, 0), /gv-whatif/);
  assert.match(stonePageHtml(LEH, 0), /gv-whatif/);
});

test('video: a still and a play mark; nothing from YouTube but the still before a click', () => {
  const html = videoHtml(LEH);
  assert.match(html, /<button type="button" class="gv-video" data-yt="AAAAAAAAAAA"/);
  assert.match(html, /src="https:\/\/i\.ytimg\.com\/vi\/AAAAAAAAAAA\/hqdefault\.jpg"/);
  assert.doesNotMatch(html, /<iframe|<script|youtube\.com|youtube-nocookie/, 'no player, no script, no youtube.com');
  const page = stonePageHtml(LEH, 0);
  assert.doesNotMatch(page, /<iframe|<script|youtube-nocookie|www\.youtube\.com/);
  assert.equal(videoHtml(BBI), '');
  assert.equal(ytThumb('bad'), null);
  assert.equal(ytEmbed('AAAAAAAAAAA'), 'https://www.youtube-nocookie.com/embed/AAAAAAAAAAA?autoplay=1&rel=0');
  assert.equal(ytEmbed('<x>'), null);
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /youtube\.com\/iframe_api|www\.youtube\.com\/embed/, 'no YouTube script, no tracking player');
});

test('CSP: only the video still and the no-cookie player are added', () => {
  const csp = securityHeaders()['Content-Security-Policy'];
  const dir = (name) => csp.split('; ').find((d) => d.startsWith(`${name} `));
  assert.equal(dir('img-src'), "img-src 'self' data: https://i.ytimg.com");
  assert.equal(dir('frame-src'), "frame-src 'self' https://www.youtube-nocookie.com");
  assert.equal(dir('script-src'), "script-src 'self' https://datafa.st https://static.cloudflareinsights.com", 'no YouTube script');
  assert.doesNotMatch(csp, /www\.youtube\.com|googlevideo|\*/);
});

test('sitemap: the cemetery, ZOMBIES, and one page per stone and zombie', () => {
  const urls = graveyardSitemapUrls(DATA);
  assert.deepEqual(urls, ['GRAVEYARD', 'GRAVEYARD ZOMBIES', 'GRAVEYARD LEH', 'GRAVEYARD BBI', 'GRAVEYARD GMZ'].map((c) => `https://bloombroke.com/?${new URLSearchParams({ c })}`));
  const all = sitemapUrls();
  const real = loadGraveyardData();
  for (const e of [...real.stones, ...real.zombies]) assert.ok(all.includes(`https://bloombroke.com/?c=GRAVEYARD+${e.ticker}`), e.ticker);
  assert.equal(new Set(all).size, all.length, 'no duplicates');
});

test('ON THIS DAY: the New York date, earlier years only; the line and the link', () => {
  assert.deepEqual(onThisDay(DATA.stones, '2026-09-15').map((e) => e.ticker), ['LEH']);
  assert.deepEqual(onThisDay(DATA.stones, '2026-09-23').map((e) => e.ticker), ['BBI'], 'no anniversary field: the date');
  assert.deepEqual(onThisDay(DATA.stones, '2008-09-15'), [], 'not the day itself');
  assert.deepEqual(onThisDay(DATA.stones, '2026-09-16'), []);
  assert.deepEqual(onThisDay(DATA.stones, 'nope'), []);
  assert.equal(onThisDayLine(LEH), '15 Sep 2008: Lehman Brothers filed for bankruptcy. F to pay respects');
  assert.equal(onThisDayLine({ ...LEH, anniversary: '2008-09-16' }), '16 Sep 2008: Lehman Brothers. F to pay respects', 'another day: no event words');
  assert.match(onThisDayHtml(LEH), /data-cmd="GRAVEYARD LEH"/);
});

test('ON THIS DAY route: the server New York day; BB_TODAY fakes it for shots', async () => {
  const app = express();
  let day = '2026-09-15';
  mountGraveyard(app, { data: DATA, respects: createRespects(), art: { stone: null, cemetery: null, doodles: [] }, today: () => day });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let d = await (await fetch(`${base}/api/onthisday`)).json();
    assert.equal(d.day, '2026-09-15');
    assert.deepEqual(d.items.map((e) => e.ticker), ['LEH']);
    day = '2026-01-02';
    d = await (await fetch(`${base}/api/onthisday`)).json();
    assert.deepEqual(d.items, []);
  } finally {
    server.close();
  }
});

test('respects: one per stone per address a day, totals only, nothing about the address kept', async () => {
  let t = Date.parse('2026-09-15T12:00:00-04:00');
  const salts = ['s1', 's2'];
  const gate = makeRespectGate({ now: () => t, salt: () => salts.shift() || 'sx' });
  assert.equal(gate.allow('1.2.3.4', 'LEH'), true);
  assert.equal(gate.allow('1.2.3.4', 'LEH'), false, 'once a day');
  assert.equal(gate.allow('1.2.3.4', 'BBI'), true, 'another stone');
  assert.equal(gate.allow('5.6.7.8', 'LEH'), true, 'another address');
  t += 24 * 3600 * 1000;
  assert.equal(gate.allow('1.2.3.4', 'LEH'), true, 'a new New York day');
  assert.equal(gate.size(), 1, 'yesterday is forgotten');
  // The database: a ticker and a total, nothing else.
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../migrations/012_respects.sql', import.meta.url), 'utf8'));
  const cols = db.prepare('PRAGMA table_info(respects)').all().map((c) => c.name);
  assert.deepEqual(cols, ['ticker', 'n']);
  const r = createRespects().attach(db);
  assert.equal(r.bump('LEH'), 1);
  assert.equal(r.bump('LEH'), 2);
  assert.deepEqual(r.counts(), { LEH: 2 });
  const mem = createRespects();
  mem.bump('BBI');
  assert.deepEqual(mem.counts(), { BBI: 1 });
});

test('respects route: same origin, known stones only, the day gate and a per-address limit', async () => {
  const app = express();
  app.set('trust proxy', 'loopback');
  mountGraveyard(app, { data: DATA, respects: createRespects(), art: { doodles: [] }, publicUrl: 'https://bloombroke.com' });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, origin = base) => fetch(`${base}/api/respect`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  try {
    let r = await post({ ticker: 'leh' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ticker: 'LEH', n: 1, counted: true });
    r = await post({ ticker: 'LEH' });
    assert.deepEqual(await r.json(), { ticker: 'LEH', n: 1, counted: false }, 'once a day per address');
    assert.equal((await post({ ticker: 'GMZ' })).status, 200, 'a zombie too');
    assert.equal((await post({ ticker: 'AAPL' })).status, 400, 'only stones');
    assert.equal((await post({ ticker: 'LEH' }, 'https://evil.test')).status, 403);
    assert.deepEqual(await (await fetch(`${base}/api/respects`)).json(), { counts: { LEH: 1, GMZ: 1 } });
    let last = 200;
    for (let i = 0; i < 40; i += 1) last = (await post({ ticker: 'BBI' })).status;
    assert.equal(last, 429, 'a per-address limit');
  } finally {
    server.close();
  }
});

test('cemetery: rows back to front, size by peak value, arrows walk, Enter and T in the screen', () => {
  const list = [...DATA.stones, { ...BBI, ticker: 'AAA', date: '2011-01-01' }, { ...BBI, ticker: 'BBB', date: '2012-01-01' }, { ...BBI, ticker: 'CCC', date: '2013-01-01' }];
  const spots = layout(list, { rows: 2 });
  assert.equal(spots.length, 5);
  assert.deepEqual(spots.map((s) => s.row), [0, 0, 0, 1, 1], 'oldest at the back');
  for (const s of spots) assert.ok(s.x >= 4 && s.x <= 96 && s.y > 0 && s.y < 100);
  assert.ok(spots[3].size > spots[1].size, 'the front row is bigger');
  const right = stepStone(spots, 0, 'ArrowRight');
  assert.equal(spots[right].row, 0);
  assert.notEqual(right, 0);
  assert.equal(spots[stepStone(spots, 0, 'ArrowDown')].row, 1);
  assert.equal(stepStone(spots, 0, 'ArrowUp'), 0, 'no row above: stays');
  assert.equal(stepStone([], 0, 'ArrowLeft'), -1);
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.match(src, /metaNote\('ARROWS ENTER'\)\} \$\{code\('GRAVEYARD TABLE', 'T TABLE'\)\}/, 'hints in the title strip, 4 words');
  assert.match(src, /max-width: 639px/, 'a phone gets the table');
});

test('router: GRAVEYARD views and stones', () => {
  for (const v of GRAVEYARD_VIEWS) assert.deepEqual(parseCommand(`graveyard ${v}`).args, { view: v });
  assert.deepEqual(parseCommand('GRAVEYARD LEH').args, { ticker: 'LEH' });
  assert.deepEqual(parseCommand('GRAVEYARD').args, {});
});

test('zombies and the table', () => {
  const z = zombiesHtml(DATA.zombies);
  assert.match(z, /RETURNED/);
  assert.match(z, /data-cmd="GRAVEYARD GMZ"/);
  const t = graveyardTable(DATA.stones, { BBI: 5, LEH: 2 }, { mourned: true });
  assert.ok(t.indexOf('GRAVEYARD BBI') < t.indexOf('GRAVEYARD LEH'), 'most mourned first');
  const n = graveyardTable(DATA.stones, {}, {});
  assert.ok(n.indexOf('GRAVEYARD BBI') < n.indexOf('GRAVEYARD LEH'), 'newest first');
});

test('stone pages: seoTitle, a description from the facts, canonical, LAST WEBSITE link', async () => {
  const deps = { graveyard: DATA.stones, zombies: DATA.zombies, block: parseBlocklist(''), today: () => '2026-09-15' };
  const m = nosuchMeta('GRAVEYARD LEH', deps);
  assert.equal(m.title, 'Lehman Brothers (LEH): the 2008 bankruptcy | Bloombroke');
  assert.equal(m.url, 'https://bloombroke.com/?c=GRAVEYARD+LEH');
  assert.match(m.description, /^LEH\. Lehman Brothers\. Listed 1994\. Filed for bankruptcy 15 Sep 2008\. Chapter 11 after subprime losses\./);
  assert.equal(stoneDescription(LEH), m.description);
  assert.match(nosuchMeta('GRAVEYARD BBI', deps).title, /^BBI\. Blockbuster\. Filed for bankruptcy 23 Sep 2010\. \| GRAVEYARD/);
  assert.match(nosuchMeta('GRAVEYARD GMZ', deps).description, /Listed again 18 Nov 2010\./);
  assert.match(nosuchMeta('GRAVEYARD TODAY', deps).image, /\/og\/onthisday\.png$/);
  assert.equal(nosuchMeta('GRAVEYARD TODAY', { ...deps, today: () => '2026-01-02' }), null);
  assert.match(sourcesHtml(LEH), /<a class="gv-last" href="https:\/\/web\.archive\.org\/web\/20080915000000\/http:\/\/www\.lehman\.com\/" target="_blank" rel="noopener noreferrer">LAST WEBSITE<\/a>/);
  assert.doesNotMatch(sourcesHtml(BBI), /LAST WEBSITE/);
  for (const v of Object.values(m)) { assert.doesNotMatch(v, BANNED); assert.doesNotMatch(v, /—/); }
});

test('cards: tombstone v2, a zombie and ON THIS DAY render; the site card on other days', async () => {
  const site = Buffer.from('site');
  let day = '2026-09-15';
  const renders = [];
  const cards = makeNoSuchCards({
    graveyard: DATA.stones, zombies: DATA.zombies, art: artOnDisk('/nonexistent'), today: () => day, block: parseBlocklist(''),
    fallback: async () => site, render: async (tree) => { renders.push(JSON.stringify(tree)); return Buffer.from(`c${renders.length}`); },
  });
  assert.equal((await cards.tombstone('GMZ')).maxAge, 86400);
  assert.match(renders[0], /RETURNED/);
  const o = await cards.onthisday();
  assert.equal(o.maxAge, 3600);
  assert.match(renders[1], /ON THIS DAY, 18 YEARS AGO/);
  day = '2026-01-02';
  const none = await cards.onthisday();
  assert.deepEqual([none.png, none.maxAge], [site, 300]);
  const tree = JSON.stringify(await tombstoneTree(LEH));
  assert.match(tree, /Too big to fail/);
  assert.doesNotMatch(tree, BANNED);
});

test('house rules in the new files', () => {
  const files = ['../public/screens/graveyard.js', '../public/graveyard.css', '../lib/graveyard.js', '../migrations/012_respects.sql'];
  const src = files.map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, BANNED);
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, /amber|orange/i);
  assert.doesNotMatch(src, /\bbuy\b|\bsell\b|will (rise|fall|collapse)/i, 'history, not advice');
});
