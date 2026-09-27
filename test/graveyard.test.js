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
import { stoneYears, flowersFor, respectsText, onThisDayLine, ytEmbed, periodText, MAX_FLOWERS, GRAVEYARD_VIEWS } from '../public/nosuch.js';
import {
  stoneHtml, stonePageHtml, peakLineHtml, videoHtml, flowersHtml, layout, stepStone, zombiesHtml, graveyardTable, onThisDayHtml, sourcesHtml, pageSources,
  sceneKeys, respectStatus,
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

test('dates: quarters, months, spans and days read as words', () => {
  assert.equal(periodText('2003-Q4'), 'Q4 2003');
  assert.equal(periodText('1995-12'), 'Dec 1995');
  assert.equal(periodText('2007-02-02'), '2 Feb 2007');
  assert.equal(periodText('1999'), '1999');
  assert.equal(periodText('2000-03/2000-05'), 'Mar to May 2000');
  assert.equal(periodText('1998-05/1998-07'), 'May to Jul 1998');
  assert.equal(periodText('junk'), '');
  const wm = loadGraveyardData().stones.find((e) => e.ticker === 'WM');
  assert.equal(periodText(wm.peak.date), 'Q4 2003');
  assert.match(stoneDescription(wm), /Peak price \$[\d.,]+ a share \(Q4 2003\)\./, 'an intraday high is a price, not a close');
});

test('real data: no Wikipedia; the dates on a stone never contradict its epitaph', () => {
  const text = readFileSync(new URL('../data/graveyard.json', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /wikipedia/i);
  const real = loadGraveyardData();
  const leh = real.stones.find((e) => e.ticker === 'LEH');
  assert.equal(stoneYears(leh), '1850 - 2008', 'the company life, when the founding is sourced');
  assert.equal(stoneYears(real.stones.find((e) => e.ticker === 'NSCP')), '1995 - 1999', 'else the listed years');
  assert.equal(stoneYears(real.stones.find((e) => e.ticker === 'ENE')), '2001', 'else the year it died');
  for (const e of [...real.stones, ...real.zombies]) {
    if (e.founded) assert.ok(e.foundedSrc?.length, `${e.ticker} founded src`);
    if (e.listed) assert.ok(e.listedSrc?.length || e.src.length, `${e.ticker} listed src`);
    const start = e.founded || e.listed || null;
    const died = Number(e.date.slice(0, 4));
    const end = e.zombie ? Number(e.back.date.slice(0, 4)) : died + 1;
    for (const y of (e.epitaph || '').match(/\b(1[89]\d\d|20\d\d)\b/g) || []) {
      assert.ok(Number(y) <= end && (!start || Number(y) >= start), `${e.ticker}: ${y} in "${e.epitaph}" fits ${stoneYears(e)}`);
    }
    const age = /(\d+) years/.exec(e.epitaph || '');
    if (age) assert.ok(start && Math.abs(Number(age[1]) - (died - start)) <= 1, `${e.ticker}: "${e.epitaph}" matches ${stoneYears(e)}`);
  }
});

test('real data: research merged, every fact with its sources, zombies came back', () => {
  const real = loadGraveyardData();
  assert.equal(real.stones.length, 34);
  assert.equal(real.zombies.length, 10);
  for (const e of [...real.stones, ...real.zombies]) {
    if (e.peakLine) assert.ok(e.peakSrc.length && e.peak && e.final, `${e.ticker} peakLine has its prices and sources`);
    if (e.cause) assert.ok(e.causeSrc?.length, `${e.ticker} cause src`);
    if (e.anniversary) assert.ok(e.anniversarySrc?.length, `${e.ticker} anniversary src`);
    if (e.keyFacts) assert.ok(e.keyFactsSrc?.length, `${e.ticker} facts src`);
    if (e.zombie) assert.ok(e.back.src?.length && e.back.date > e.date, `${e.ticker} came back later, sourced`);
  }
  assert.equal(real.zombies.find((z) => z.ticker === 'AMR').peakLine, undefined, 'a null peakLine stays hidden');
  assert.equal(real.stones.find((e) => e.ticker === 'WBVN').video, undefined);
  assert.ok(real.stones.filter((e) => e.video).length >= 33);
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
  assert.equal(peakLineHtml(LEH), '<p class="gv-whatif">$1,000 at the peak (Feb 2007) was worth $2 by Sep 2008</p>');
  assert.ok(pageSources(LEH).includes('https://example.test/leh-final'), 'its sources are under SOURCES');
  assert.equal(peakLineHtml({ ...LEH, peakSrc: [] }), '', 'no source, no line');
  assert.equal(peakLineHtml(BBI), '');
  assert.doesNotMatch(stonePageHtml(BBI, 0), /gv-whatif/);
  assert.match(stonePageHtml(LEH, 0), /gv-whatif/);
});

test('video: our own art and a play mark; nothing from YouTube or Google before a click', () => {
  const e = withArt(LEH, { doodles: ['LEH'] });
  const html = videoHtml({ ...e, video: { ...e.video, channel: 'CBS' } });
  assert.match(html, /<button type="button" class="gv-video" data-yt="AAAAAAAAAAA"/);
  assert.match(html, /src="\/img\/graveyard\/doodle-leh\.webp"/, 'our own drawing');
  assert.match(html, /PLAY VIDEO · CBS/);
  const page = stonePageHtml(e, 0);
  for (const h of [html, page]) {
    assert.doesNotMatch(h, /<iframe|<script/);
    assert.doesNotMatch(h, /ytimg|youtube|google|googlevideo|gstatic/i, 'no request to any Google or YouTube host before the click');
  }
  assert.equal(videoHtml(BBI), '');
  assert.equal(ytEmbed('AAAAAAAAAAA'), 'https://www.youtube-nocookie.com/embed/AAAAAAAAAAA?autoplay=1&rel=0');
  assert.equal(ytEmbed('<x>'), null);
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /ytimg|youtube\.com\/iframe_api|www\.youtube\.com\/embed/, 'no stills from YouTube, no YouTube script');
  assert.match(page, /class="gv-page has-video"/, 'desk: the video in its own column');
});

test('CSP: only the video still and the no-cookie player are added', () => {
  const csp = securityHeaders()['Content-Security-Policy'];
  const dir = (name) => csp.split('; ').find((d) => d.startsWith(`${name} `));
  assert.equal(dir('img-src'), "img-src 'self' data:", 'no YouTube stills');
  assert.equal(dir('frame-src'), "frame-src 'self' https://www.youtube-nocookie.com");
  assert.equal(dir('script-src'), "script-src 'self' https://datafa.st https://static.cloudflareinsights.com", 'no YouTube script');
  assert.doesNotMatch(csp, /ytimg|www\.youtube\.com|googlevideo|\*/);
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
  assert.equal(onThisDayLine(LEH), '15 Sep 2008: Lehman Brothers filed for bankruptcy.', 'no F promise on HOME: F does nothing there');
  assert.equal(onThisDayLine({ ...LEH, anniversary: '2008-09-16' }), '16 Sep 2008: Lehman Brothers.', 'another day: no event words');
  const real = loadGraveyardData().stones;
  assert.deepEqual(onThisDay(real, '2026-07-21').map((e) => e.ticker).sort(), ['TOY', 'WCOM'], 'two on one day: both');
  assert.deepEqual(onThisDay(real, '2026-10-15').map((e) => e.ticker).sort(), ['RAD', 'SHLD']);
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
  assert.equal(gate.allow('1.2.3.4', 'LEH'), 'ok');
  assert.equal(gate.allow('1.2.3.4', 'LEH'), 'seen', 'once a day');
  assert.equal(gate.allow('1.2.3.4', 'BBI'), 'ok', 'another stone');
  assert.equal(gate.allow('5.6.7.8', 'LEH'), 'ok', 'another address');
  const small = makeRespectGate({ now: () => t, maxKeys: 1 });
  assert.equal(small.allow('a', 'LEH'), 'ok');
  assert.equal(small.allow('b', 'LEH'), 'full', 'a full table: try later, not "already paid"');
  assert.deepEqual(respectStatus('LEH', { counted: false, busy: true }), ['RESPECTS ARE BUSY, TRY LATER', 'warn']);
  assert.deepEqual(respectStatus('LEH', { counted: false }), ['LEH: ALREADY PAID TODAY', '']);
  assert.deepEqual(respectStatus('LEH', { counted: true }), ['LEH: RESPECTS PAID', '']);
  t += 24 * 3600 * 1000;
  assert.equal(gate.allow('1.2.3.4', 'LEH'), 'ok', 'a new New York day');
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
  assert.match(src, /metaNote\('ESC THEN ARROWS'\)\} \$\{code\('GRAVEYARD TABLE', 'TABLE'\)\}/, 'hints in the title strip, 4 words');
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
  assert.match(nosuchMeta('GRAVEYARD GMZ', deps).description, /Came back 18 Nov 2010\./);
  assert.match(m.description, /Peak close \$85\.80 a share \(2 Feb 2007\)\./);
  assert.match(nosuchMeta('GRAVEYARD TODAY', deps).image, /\/og\/onthisday\.png\?d=2026-09-15$/, 'the share keeps its day');
  const z = nosuchMeta('GRAVEYARD ZOMBIES', deps);
  assert.equal(z.url, 'https://bloombroke.com/?c=GRAVEYARD+ZOMBIES', 'ZOMBIES has its own canonical');
  assert.match(z.title, /^Zombies: 1 companies/);
  assert.match(z.description, /Zombie Motors/);
  assert.equal(nosuchMeta('GRAVEYARD TODAY', { ...deps, today: () => '2026-01-02' }), null);
  assert.match(sourcesHtml(LEH), /<a class="gv-last" href="https:\/\/web\.archive\.org\/web\/20080915000000\/http:\/\/www\.lehman\.com\/" target="_blank" rel="noopener noreferrer">LAST WEBSITE<\/a>/);
  const src = sourcesHtml(LEH);
  assert.match(src, /<details class="gv-sources"><summary>SOURCES \(3\)<\/summary><ul><li>/, 'one small SOURCES (N)');
  assert.match(src, /example\.test 2/, 'the same host twice is numbered');
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
  assert.doesNotMatch(renders[1], /more on this day/);
  await cards.onthisday('2026-09-15');
  assert.equal(renders.length, 2, 'kept');
  day = '2026-09-16';
  const y = await cards.onthisday('2026-09-15');
  assert.equal(y.maxAge, 3600, 'yesterday still draws: a share from yesterday');
  const old = await cards.onthisday('2025-09-15');
  assert.deepEqual([old.png, old.maxAge], [site, 300], 'no other day draws');
  assert.ok(cards.otdCache.size <= 2, 'today and yesterday only');
  day = '2026-01-02';
  const none = await cards.onthisday();
  assert.deepEqual([none.png, none.maxAge], [site, 300]);
  // Two on one day: the first, and "and 1 more".
  const two = makeNoSuchCards({
    graveyard: [LEH, { ...BBI, date: '2010-09-15', anniversary: '2010-09-15' }], zombies: [], art: artOnDisk('/nonexistent'), today: () => '2026-09-15', block: parseBlocklist(''),
    fallback: async () => site, render: async (tree) => { renders.push(JSON.stringify(tree)); return Buffer.from('x'); },
  });
  await two.onthisday();
  assert.match(renders[renders.length - 1], /and 1 more on this day/);
  const tree = JSON.stringify(await tombstoneTree(LEH));
  assert.match(tree, /Too big to fail/);
  assert.doesNotMatch(tree, BANNED);
});

test('house rules in the new files', () => {
  const files = ['../public/screens/graveyard.js', '../public/graveyard.css', '../public/screens/graveyard.css', '../lib/graveyard.js', '../migrations/012_respects.sql'];
  const src = files.map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, BANNED);
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, /amber|orange/i);
  assert.doesNotMatch(src, /\bbuy\b|\bsell\b|will (rise|fall|collapse)/i, 'history, not advice');
});

// A tiny stand-in for the page: the command bar, the suggestion list and one scene.
function fakePage() {
  const listeners = [];
  const bar = { id: 'cmd', value: '', closest: () => null };
  const suggest = { hidden: true };
  let focused = null;
  const scene = {
    isConnected: true, dataset: {}, classList: { add() {} }, tabIndex: 0,
    focus() { focused = scene; }, addEventListener() {}, removeEventListener() {}, closest: () => null,
  };
  const doc = {
    getElementById: (id) => (id === 'cmd' ? bar : id === 'suggest' ? suggest : null),
    addEventListener: (t, fn) => listeners.push(fn),
    removeEventListener: (t, fn) => listeners.splice(listeners.indexOf(fn), 1),
  };
  const press = (key, target = bar) => {
    const ev = { key, target, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
    for (const fn of [...listeners]) fn(ev);
    return ev;
  };
  return { bar, scene, doc, press, focused: () => focused, listeners };
}

test('scene keys: never while the command bar has the focus (F, FX, T, TSLA, arrow history)', () => {
  const p = fakePage();
  const used = [];
  const stop = sceneKeys(p.scene, (ev) => { used.push(ev.key); return ['f', 'F', 't', 'T', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.key); }, { doc: p.doc });
  // Typing in the bar: F (Ford), FX, T (AT&T), TSLA, FEEDBACK, and arrow-key history.
  for (const word of ['F', 'FX', 'T', 'TSLA', 'FEEDBACK']) {
    for (const ch of word) {
      const ev = p.press(ch);
      assert.equal(ev.defaultPrevented || ev.stopped, false, `${word}: ${ch} reaches the bar`);
      p.bar.value += ch;
    }
    p.bar.value = '';
  }
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter']) {
    const ev = p.press(k);
    assert.equal(ev.defaultPrevented || ev.stopped, false, `${k} stays with the bar (history, run)`);
  }
  assert.deepEqual(used, [], 'the scene saw nothing');
  // Esc in an empty bar moves the focus to the scene; then F, T and the arrows are the scene's.
  p.bar.value = 'AB';
  assert.equal(p.press('Escape').defaultPrevented, false, 'Esc with text: the bar clears it as usual');
  assert.equal(p.focused(), null);
  p.bar.value = '';
  assert.equal(p.press('Escape').defaultPrevented, true);
  assert.equal(p.focused(), p.scene);
  for (const k of ['F', 'T', 'ArrowUp', 'Enter']) {
    const ev = p.press(k, p.scene);
    assert.equal(ev.defaultPrevented && ev.stopped, true, `${k} on the scene`);
  }
  assert.deepEqual(used, ['F', 'T', 'ArrowUp', 'Enter']);
  const x = p.press('x', p.scene);
  assert.equal(x.defaultPrevented, false, 'other keys still go to the bar');
  const field = { closest: () => ({}) };
  assert.equal(p.press('F', field).defaultPrevented, false, 'never in another field');
  assert.equal(p.scene.tabIndex, -1);
  assert.equal(p.scene.dataset.ownFocus, '', 'a click on the scene keeps the focus there');
  stop();
  assert.equal(p.listeners.length, 0);
});

test('scene keys: the stone, cemetery and table screens use them; hints in the title strip', () => {
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.equal((src.match(/addEventListener\('keydown'/g) || []).length, 1, 'one key listener, in sceneKeys');
  assert.equal((src.match(/sceneKeys\(el,/g) || []).length, 3, 'stone (with respects), cemetery, table');
  assert.match(src, /metaNote\('ESC THEN F'\)/);
  assert.match(src, /metaNote\('ESC THEN ARROWS'\)/);
});
