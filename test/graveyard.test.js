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
import { wireNoSuch } from '../public/screens/nosuch.js';
import { stoneYears, respectsText, onThisDayLine, ytEmbed, periodText, sectionOf, SECTIONS, siteCaption, timelinePoints, cliffOf, GRAVEYARD_VIEWS } from '../public/nosuch.js';
import {
  stoneHtml, stonePageHtml, stoneSlots, stoneFacts, peakLineHtml, moreLinks, siteLabel, candlesHtml, candlesFor, MAX_CANDLES, revealText, engraving, shortName, diedVerb,
  rowsOf, rowHtml, plotHtml, cemeteryHtml, heroPick, heroLine, stepGrid, liveHtml, loadLive, tipText, HINT, STONE_HINT, ROWS, wireRespects, showRespects,
  graveyardTable, onThisDayHtml, sourcesHtml, pageSources, sceneKeys, respectStatus, timelineHtml,
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
  assert.equal(ZOM.tradesAs, 'GMX', 'the ticker it trades under today');
  assert.equal(cleanEntry({ ...ZOM, tradesAs: 'gm x' }).tradesAs, undefined, 'a misshapen ticker is dropped');
  assert.equal(cleanEntry({ ...LEH, tradesAs: 'LEH' }).tradesAs, undefined, 'a stone never trades');
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

test('stone: years, candles, the words on its face; zombies say RETURNED', () => {
  assert.equal(stoneYears(LEH), '1994 - 2008');
  assert.equal(stoneYears(BBI), '2010');
  assert.equal(stoneYears(ZOM), '2009 - 2010');
  // One candle per respect, 12 at most; none at zero (just the ground).
  assert.deepEqual([0, -1, NaN, 1, 2, 11, 12, 13, 1e9].map(candlesFor), [0, 0, 0, 1, 2, 11, 12, 12, MAX_CANDLES]);
  assert.equal(MAX_CANDLES, 12);
  assert.equal(candlesHtml(0), '');
  assert.equal((candlesHtml(8).match(/<svg class="gv-candle/g) || []).length, 8);
  assert.equal((candlesHtml(500).match(/<svg/g) || []).length, 12);
  assert.match(candlesHtml(3, { fresh: true }), /gv-candle is-new[^]*$/, 'the one just lit rises in');
  assert.equal((candlesHtml(3, { fresh: true }).match(/is-new/g) || []).length, 1);
  assert.doesNotMatch(candlesHtml(5), /style=|\dpx/, 'no inline sizes');
  const html = stoneHtml(withArt(LEH, { stone: '/img/graveyard/stone.webp', doodles: ['LEH'] }), { n: 3 });
  assert.match(html, /R\.I\.P\./);
  assert.match(html, /Too big to fail\. Failed\./);
  assert.match(html, /doodle-leh\.webp/);
  assert.match(html, /has-art/);
  assert.equal((html.match(/class="gv-candle[ "]/g) || []).length, 3, 'three respects, three candles');
  assert.doesNotMatch(stoneHtml(LEH, { n: 0 }), /class="gv-candle[ "]|\d respect/, 'zero: no candles, no count');
  assert.match(stoneHtml(ZOM), /RETURNED/);
  assert.doesNotMatch(stoneHtml(ZOM), /R\.I\.P\./);
  assert.doesNotMatch(stoneHtml(BBI), /<img/, 'no art yet: a drawn stone, no images');
  // The engraving keeps R.I.P., the ticker, the name and the years; a sentence repeating
  // the filing is not cut twice.
  assert.equal(engraving({ epitaph: '158 years. Filed 15 Sep 2008.' }), '158 years.');
  assert.equal(engraving({ epitaph: 'Filed Jun 2009. Back on the NYSE Nov 2010.' }), 'Back on the NYSE Nov 2010.');
  assert.equal(engraving({ epitaph: '$2.4 billion of debt. Back on the NYSE, 2010.' }), '$2.4 billion of debt. Back on the NYSE, 2010.');
  assert.equal(engraving({}), '');
  const real = withArt(loadGraveyardData().stones.find((e) => e.ticker === 'LEH'), { stone: '/img/graveyard/stone.webp', doodles: ['LEH'] });
  const face = stoneHtml(real);
  for (const bit of ['R.I.P.', '>LEH<', 'Lehman Brothers', '1850 - 2008', '158 years.']) assert.ok(face.includes(bit), bit);
  assert.doesNotMatch(face.split('<div class="gv-face">')[1], /Filed/, 'no separate "Filed ..." engraving (the aria-label reads it once)');
  // The small stone (the cemetery): the ticker only, and never a word under 11 px.
  const small = stoneHtml(real, { small: true });
  assert.match(small, /<div class="gv-face"><span class="gv-tk">LEH<\/span><\/div>/);
  assert.doesNotMatch(small, /RETURNED|R\.I\.P\.|gv-candles/);
});

test('RIP WHATIF: the sourced peak line, hidden when null', () => {
  assert.equal(peakLineHtml(LEH), '<p class="gv-whatif">$1,000 at the peak (Feb 2007) was worth $2 by Sep 2008</p>');
  assert.ok(pageSources(LEH).includes('https://example.test/leh-final'), 'its sources are under SOURCES');
  assert.equal(peakLineHtml({ ...LEH, peakSrc: [] }), '', 'no source, no line');
  assert.equal(peakLineHtml(BBI), '');
  assert.doesNotMatch(stonePageHtml(BBI, 0), /gv-cliff|card-facts/, 'no line, no facts');
  assert.doesNotMatch(stonePageHtml(LEH, 0), /gv-cliff/, 'one fact, not a tile and a chart');
  assert.deepEqual(stoneFacts(LEH), [{ label: 'Peak', value: '$85.80' }, { label: '$1,000 at peak, by Sep 2008', value: '$2', cls: 'down' }]);
});

test('video: a "Watch the video" link; nothing from YouTube or Google before a click', () => {
  const e = withArt(LEH, { doodles: ['LEH'] });
  const [watch] = moreLinks({ ...e, video: { ...e.video, channel: 'CBS' } });
  assert.match(watch, /^<button type="button" class="card-link gv-watch" data-yt="AAAAAAAAAAA" aria-label="Play: Lehman files for bankruptcy \(CBS\)">Watch the video<\/button>$/);
  const page = stonePageHtml(e, 0);
  for (const h of [watch, page]) {
    assert.doesNotMatch(h, /<iframe|<script/);
    assert.doesNotMatch(h, /ytimg|youtube|google|googlevideo|gstatic/i, 'no request to any Google or YouTube host before the click');
  }
  assert.doesNotMatch(page, /gv-video|gv-play|PLAY VIDEO/, 'no video still in the page');
  assert.deepEqual(moreLinks(BBI), [], 'a bad id: no link');
  assert.equal(ytEmbed('AAAAAAAAAAA'), 'https://www.youtube-nocookie.com/embed/AAAAAAAAAAA?autoplay=1&rel=0');
  assert.equal(ytEmbed('<x>'), null);
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /ytimg|youtube\.com\/iframe_api|www\.youtube\.com\/embed/, 'no stills from YouTube, no YouTube script');
});

test('CSP: only the video still and the no-cookie player are added', () => {
  const csp = securityHeaders()['Content-Security-Policy'];
  const dir = (name) => csp.split('; ').find((d) => d.startsWith(`${name} `));
  assert.equal(dir('img-src'), "img-src 'self' data: https://*.google-analytics.com https://www.googletagmanager.com", 'no YouTube stills (GA4 only)');
  assert.equal(dir('frame-src'), "frame-src 'self' https://www.youtube-nocookie.com");
  assert.equal(dir('script-src'), "script-src 'self' https://datafa.st https://analytics.ahrefs.com https://static.cloudflareinsights.com https://www.googletagmanager.com", 'no YouTube script');
  // The only wildcards are GA4's own hosts (test/ga4.test.js).
  assert.doesNotMatch(csp.replace(/https:\/\/\*\.(google-analytics\.com|analytics\.google\.com)/g, ''), /ytimg|www\.youtube\.com|googlevideo|\*/);
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

test('cemetery: rows by era, front terrace first, then CAME BACK; names under the stones', () => {
  const real = loadGraveyardData();
  const by = {};
  for (const e of real.stones) (by[sectionOf(e)] ||= []).push(e.ticker);
  assert.deepEqual(by.BOUGHT.sort(), ['ATVI', 'LNKD', 'NSCP', 'TOY', 'TWTR', 'WFM', 'YHOO']);
  assert.deepEqual(by.DOTCOM.sort(), ['ENE', 'IPET', 'WBVN', 'WCOM']);
  assert.ok(by.CRISIS.includes('LEH') && by.CRISIS.includes('BSC'), 'crisis rescues stay in the crisis');
  assert.equal(SECTIONS.map((x) => x.label).join(' | '), 'DOT-COM | 2008 CRISIS | RECENT | BOUGHT OUT');
  const rows = rowsOf(real.stones, real.zombies);
  assert.deepEqual(rows.map((r) => r.label), ['RECENT', '2008 CRISIS', 'DOT-COM', 'BOUGHT OUT', 'CAME BACK']);
  assert.deepEqual(ROWS.map((r) => r.id), ['RECENT', 'CRISIS', 'DOTCOM', 'BOUGHT', 'BACK']);
  assert.equal(rows.flatMap((r) => r.stones).length, real.stones.length + real.zombies.length, 'every stone once');
  for (const r of rows) assert.deepEqual(r.stones.map((e) => e.date), [...r.stones.map((e) => e.date)].sort().reverse(), `${r.label}: newest first`);
  assert.deepEqual(rowsOf(DATA.stones, []).map((r) => r.id), ['RECENT', 'CRISIS'].filter((id) => DATA.stones.some((e) => sectionOf(e) === id)), 'empty rows left out');
  // The company name under each stone; the ticker on the stone.
  const html = cemeteryHtml(rows, { stone: '/img/graveyard/stone.webp', yard: '/img/graveyard/cemetery-empty.webp' }, heroPick([...real.stones, ...real.zombies], '2026-09-29'));
  for (const e of real.stones) {
    const plot = new RegExp(`data-cmd="GRAVEYARD ${e.ticker}"[^>]*>[\\s\\S]*?<span class="gv-tk">${e.ticker}</span>[\\s\\S]*?<span class="gv-pname">${e.name.replace(/[.&()]/g, (c) => (c === '&' ? '&amp;' : `\\${c}`))}</span>`);
    assert.match(html, plot, `${e.ticker}: its name under it`);
  }
  assert.equal((html.match(/class="gv-plot is-bought"/g) || []).length, 7, 'the bought-out stones keep their look');
  assert.match(html, /<span class="gv-row-name">BOUGHT OUT<\/span> <span class="gv-row-n num">7<\/span><span class="gv-key"><span class="gv-swatch" aria-hidden="true"><\/span>pale stone: sold, not bankrupt<\/span>/, 'a tiny key in its label');
  assert.equal((html.match(/<img class="gv-art" src="\/img\/graveyard\/stone\.webp"/g) || []).length, real.stones.length + real.zombies.length, 'one stone drawing everywhere');
  assert.equal((html.match(/<section class="gv-row"/g) || []).length, 5);
  assert.doesNotMatch(html, /gv-sign|gv-corner|ZOMBIES|respect/, 'no signposts, no floating button, no "0 respects"');
  // The CSS: 88 px stones, 13 px names, 11 px at the least inside the picture, the sky band.
  const css = readFileSync(new URL('../public/screens/graveyard.css', import.meta.url), 'utf8');
  assert.match(css, /\.gv-plot \.gv-stone \{ width: 88px;/);
  assert.match(css, /\.gv-pname \{\n  max-width: 100%; font-size: 13px;/);
  assert.match(css, /\.gv-stone\.is-small \.gv-tk \{ font-size: max\(13px, 25cqw\); \}/, 'the ticker on a small stone: 13 px or more');
  assert.match(css, /\.gv-sky \{ position: relative; height: 160px;/);
  assert.match(css, /@media \(max-width: 599px\) \{\n  \.gv-sky \{ height: 120px; \}/);
  assert.match(css, /\.gv-hero-line \{ font-size: 24px;/);
  for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(m[1]) >= 11, `nothing under 11 px: ${m[0]}`);
  assert.match(css, /html:not\(\.is-embed\) \.view > \.panel\.gv-panel:not\(\[hidden\]\) \{ flex: 0 1 auto !important; \}/, 'the panel ends after the last row: no void');
});

test('cemetery: the sky band opens LATEST, or ON THIS DAY only on a real anniversary (New York day)', () => {
  const real = loadGraveyardData();
  const all = [...real.stones, ...real.zombies];
  const latest = heroPick(all, '2026-09-29');
  assert.equal(latest.kicker, 'Latest');
  assert.equal(latest.e.ticker, 'NKLA', 'the most recent death');
  assert.equal(heroLine(latest.e), 'Nikola · NKLA · filed 2025');
  const otd = heroPick(all, '2026-09-15');
  assert.deepEqual([otd.kicker, otd.e.ticker], ['On this day', 'LEH']);
  assert.equal(heroLine(otd.e), 'Lehman Brothers · LEH · filed 2008');
  assert.equal(heroPick(all, '2008-09-15').kicker, 'Latest', 'the day itself is not an anniversary');
  assert.deepEqual(heroPick(all, '2026-07-21').e.ticker, 'TOY', 'two on one day (WCOM 2002, TOY 2005): the newer');
  assert.equal(heroPick(all, '2026-06-01').e.ticker, 'GM', 'a filing that came back is a real filing too');
  assert.equal(heroPick(all, '').kicker, 'Latest', 'no day: LATEST');
  assert.equal(heroPick([], '2026-09-15'), null);
  const html = cemeteryHtml(rowsOf(real.stones, real.zombies), { stone: '/s.webp', yard: '/img/graveyard/cemetery-empty.webp' }, latest);
  assert.match(html, /<div class="gv-sky">\s*<img class="gv-sky-art" src="\/img\/graveyard\/cemetery-empty\.webp" width="1536" height="1024" alt="">/, 'the band is cut from the painting');
  assert.match(html, /<a class="gv-hero" href="\?c=GRAVEYARD\+NKLA" data-cmd="GRAVEYARD NKLA" data-hero>\s*<span class="tag gv-kicker">Latest<\/span>\s*<span class="gv-hero-line"><span class="gv-hero-name">Nikola<\/span> · NKLA · filed 2025 <kbd data-enter title="Enter in the empty command bar opens it">Enter<\/kbd><\/span>/);
  // The badge follows the stone Enter opens (the sky band's by default).
  const gsrc = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.match(gsrc, /if \(badge\) badge\.hidden = on !== heroAt;/);
  assert.match(gsrc, /pick\(heroAt, \{ scroll: false \}\);/, 'the sky band\'s stone is picked from the start');
  // The verbs for each way to die.
  assert.deepEqual(['Filed for bankruptcy', 'Bought by Microsoft', 'Seized, sold to JPMorgan', 'Bank closed by regulators', 'Taken private', 'Shut down', 'Announced shutdown', 'Delisted from Nasdaq', 'Core business sold to Verizon'].map((what) => diedVerb({ what })),
    ['filed', 'bought out', 'seized', 'seized', 'went private', 'shut down', 'shut down', 'delisted', 'bought out']);
  // The screen asks for today's New York date.
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.match(src, /heroPick\(\[\.\.\.data\.entries, \.\.\.data\.zombies\], nyToday\(\)\)/);
});

test('cemetery: CAME BACK row: a one-line name, the years, the live price; no numbers when quotes fail', async () => {
  const real = loadGraveyardData();
  assert.deepEqual(real.zombies.filter((z) => z.tradesAs).map((z) => `${z.ticker}:${z.tradesAs}`), ['GM:GM', 'HTZ:HTZ', 'DAL:DAL', 'AMR:AAL', 'PCG:PCG', 'UAL:UAL']);
  const amr = real.zombies.find((z) => z.ticker === 'AMR');
  assert.equal(shortName(amr), 'American Airlines');
  assert.equal(shortName(real.zombies.find((z) => z.ticker === 'MRV')), 'Marvel');
  assert.equal(shortName(real.zombies.find((z) => z.ticker === 'GM')), 'General Motors');
  const plot = plotHtml(amr, 3, '/s.webp');
  assert.match(plot, /<span class="gv-pname">American Airlines<\/span><span class="gv-back">died 2011 · back 2013<\/span><span class="gv-live" data-live="AAL"><\/span>/);
  assert.doesNotMatch(plotHtml(real.zombies.find((z) => z.ticker === 'TX'), 0, '/s.webp'), /gv-live/, 'no longer trades: no price slot');
  // The price: the live one, with its change; the other ticker named when it differs.
  const q = { ticker: 'AAL', last: 13.48, change: -0.05, changePct: -0.33 };
  assert.equal(liveHtml(amr, q), 'AAL <span class="num">$13.48</span> <span class="num down">−0.33%</span>');
  const gm = real.zombies.find((z) => z.ticker === 'GM');
  assert.equal(liveHtml(gm, { last: 79.84, changePct: 1.2 }), '<span class="num">$79.84</span> <span class="num up">+1.20%</span>');
  assert.equal(liveHtml(gm, null), '');
  assert.equal(liveHtml(gm, { last: null }), '', 'no price, no numbers');
  // A stale quote never looks live: dim, with the day of its last trade, no change.
  assert.equal(liveHtml(gm, { last: 79.84, changePct: 1.2, stale: true, asOf: '2026-09-26T16:00:00.000-0400' }), '<span class="gv-stale"><span class="num">$79.84</span> on 26 Sep</span>');
  assert.equal(liveHtml(amr, { last: 13.48, changePct: -0.3, stale: true, asOf: '2026-09-26' }), '<span class="gv-stale">AAL <span class="num">$13.48</span> on 26 Sep</span>');
  assert.equal(liveHtml(gm, { last: 79.84, stale: true }), '', 'stale without a day: nothing');
  assert.doesNotMatch(liveHtml(gm, { last: 79.84, changePct: 1.2, stale: true, asOf: '2026-09-26' }), /up|down|%/);
  // One /api/quotes call; a failure leaves the slots empty.
  const slots = new Map(real.zombies.filter((z) => z.tradesAs).map((z) => [z.tradesAs, { innerHTML: '' }]));
  const el = { isConnected: true, querySelector: (s) => slots.get(/data-live="([A-Z]+)"/.exec(s)?.[1]) || null };
  const asked = [];
  await loadLive(el, real.zombies, { fetchImpl: async (u) => { asked.push(u); return { ok: true, json: async () => ({ quotes: [{ ticker: 'GM', last: 79.84, change: -0.8, changePct: -1 }] }) }; } });
  assert.deepEqual(asked, ['/api/quotes?s=GM,HTZ,DAL,AAL,PCG,UAL']);
  assert.equal(slots.get('GM').innerHTML, '<span class="num">$79.84</span> <span class="num down">−1.00%</span>');
  assert.equal(slots.get('HTZ').innerHTML, '', 'no quote for it: nothing');
  for (const s of slots.values()) s.innerHTML = '';
  await loadLive(el, real.zombies, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.ok([...slots.values()].every((s) => s.innerHTML === ''), 'quotes fail: no numbers');
  await loadLive(el, real.zombies, { fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  assert.ok([...slots.values()].every((s) => s.innerHTML === ''), 'a 503: no numbers');
  const css = readFileSync(new URL('../public/screens/graveyard.css', import.meta.url), 'utf8');
  assert.match(css, /\.gv-plot\.is-back \.gv-pname \{ display: block; white-space: nowrap; \}/, 'one line on a desktop');
});

test('cemetery: ZOMBIES is an alias for the CAME BACK row; the separate screen and button are gone', () => {
  assert.deepEqual(parseCommand('GRAVEYARD ZOMBIES').args, { view: 'ZOMBIES' }, 'the command stays');
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.match(src, /renderCemetery\(el, data, ctx, \{ at: view === 'ZOMBIES' \? 'BACK' : '' \}\)/);
  assert.match(src, /if \(at === 'BACK'\) \{\s*const row = el\.querySelector\('#gv-row-BACK'\);\s*if \(row\) \{\s*row\.scrollIntoView\?\.\(\{ block: 'start' \}\);/);
  assert.doesNotMatch(src, /zombiesHtml|gv-corner|'GRAVEYARD ZOMBIES', 'ZOMBIES'|Graveyard: zombies/, 'no ZOMBIES screen or button');
  const row = rowHtml(rowsOf([], DATA.zombies)[0], '/s.webp');
  assert.match(row, /<section class="gv-row" data-row="BACK" id="gv-row-BACK">/);
});

test('cemetery: arrows move, Enter opens, TABLE lists; the hover shows respects only above zero', () => {
  assert.equal(HINT, 'Enter opens · Esc, then arrows move · TABLE lists');
  assert.equal(STONE_HINT, 'Esc, then F pays respects · Esc back');
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.match(src, /ctx\.status\(HINT\);/);
  assert.doesNotMatch(src, /ESC THEN ARROWS/);
  assert.match(src, /meta: `\$\{metaNote\(`\$\{all\.length\} STONES`\)\} · \$\{code\('GRAVEYARD TABLE', 'TABLE'\)\}`/, 'the strip: N STONES · TABLE');
  // Stones on two lines of a row (wrapped) and the next row.
  const pts = [{ x: 0, y: 0 }, { x: 116, y: 0 }, { x: 232, y: 0 }, { x: 0, y: 180 }, { x: 116, y: 180 }, { x: 0, y: 400 }];
  assert.equal(stepGrid(pts, 1, 'ArrowRight'), 2);
  assert.equal(stepGrid(pts, 2, 'ArrowRight'), 3, 'on to the next line');
  assert.equal(stepGrid(pts, 0, 'ArrowLeft'), 0);
  assert.equal(stepGrid(pts, 5, 'ArrowRight'), 5);
  assert.equal(stepGrid(pts, 2, 'ArrowDown'), 4, 'the nearest on the line below');
  assert.equal(stepGrid(pts, 4, 'ArrowDown'), 5);
  assert.equal(stepGrid(pts, 4, 'ArrowUp'), 1);
  assert.equal(stepGrid(pts, 0, 'ArrowUp'), 0);
  assert.equal(stepGrid([], 0, 'ArrowLeft'), -1);
  assert.equal(stepGrid(pts, -1, 'ArrowDown'), 0);
  // The hover label: how and when; the respects only above zero, never "0 respects".
  assert.equal(tipText(LEH, 0), 'filed 2008');
  assert.equal(tipText(LEH, 3), 'filed 2008 · 3 respects');
  assert.equal(tipText(LEH, 1), 'filed 2008 · 1 respect');
  assert.doesNotMatch(plotHtml(LEH, 0, '/s.webp', { n: 0 }), /respect/);
  assert.match(plotHtml(LEH, 0, '/s.webp', { n: 12 }), /<span class="gv-tip" data-tip>filed 2008 · 12 respects<\/span>/);
});

test('cemetery: the phone gets the rows, 4 stones a line with their names; TABLE one tap away', () => {
  const css = readFileSync(new URL('../public/screens/graveyard.css', import.meta.url), 'utf8');
  const phone = css.slice(css.indexOf('@media (max-width: 599px) {'));
  assert.match(phone, /\.gv-row-stones \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(phone, /\.gv-plot \.gv-stone \{ width: 64px; \}/);
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /matchMedia/, 'the same scene on a phone, not the table');
  assert.match(src, /if \(view === 'TABLE' \|\| view === 'MOURNED' \|\| t\) \{ renderTable\(/);
});

test('stone page: the words left, the stone (one picture) right; the old media row is gone', () => {
  const real = loadGraveyardData().stones;
  const leh = withArt(real.find((e) => e.ticker === 'LEH'), { stone: '/img/graveyard/stone.webp', doodles: ['LEH'], sites: ['LEH'] });
  assert.equal(siteCaption(leh.wayback), 'lehman.com, Sep 2008 · Internet Archive');
  assert.equal(siteLabel(leh.wayback), 'lehman.com in 2008');
  assert.equal(siteLabel('nope'), '');
  const page = stonePageHtml(leh, 0);
  assert.match(page, /^<section class="card card-wide card-split gv-card" aria-label="Graveyard: Lehman Brothers"><div class="card-art"><div class="gv-card-stone"><figure class="gv-stone has-art"/);
  assert.equal((page.match(/<figure class="gv-stone/g) || []).length, 1, 'one picture');
  assert.doesNotMatch(page, /gv-site|gv-screen|gv-card-media|gv-video|gv-cliff|100%/, 'no tablet frame, no video still, no "100%" tile');
  assert.doesNotMatch(page.split('<details')[0], /\d respects?/, 'no "0 respects"');
  const srcs = [...page.matchAll(/\b(?:src|srcset|data-src|poster)="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(srcs.length >= 2 && srcs.every((u) => u.startsWith('/img/graveyard/')), `every image is ours: ${srcs.join(' ')}`);
  assert.doesNotMatch(page, /<iframe|<script|<link|<object|<embed/, 'nothing that loads by itself');
  // The last homepage: our own copy opened full size; no copy: the archive's page.
  assert.match(page, /<a class="card-link" href="\/img\/graveyard\/sites\/leh\.webp" target="_blank" rel="noopener">lehman\.com in 2008<\/a>/);
  const bare = withArt(real.find((e) => e.ticker === 'LEH'), { doodles: [], sites: [] });
  assert.match(stonePageHtml(bare, 0), /<a class="card-link" href="https:\/\/web\.archive\.org\/web\/20080913111928\/http:\/\/www\.lehman\.com:80\/" target="_blank" rel="noopener noreferrer">lehman\.com in 2008<\/a>/);
  assert.match(stonePageHtml(bare, 0), /LAST WEBSITE/, 'and the text link under SOURCES');
  assert.doesNotMatch(sourcesHtml(leh, { linkSite: false }), /LAST WEBSITE/);
  // The timeline stays in + Details; the cliff from the RIP WHATIF line.
  assert.deepEqual(timelinePoints(leh).map((p) => `${p.label} ${p.when}`), ['FOUNDED 1850', 'PEAK 2 Feb 2007', 'FILED 15 Sep 2008', 'SHARES CANCELLED 6 Mar 2012']);
  assert.match(page.split('<details class="how card-more">')[1], /class="gv-tl"/);
  const nscp = real.find((e) => e.ticker === 'NSCP');
  assert.deepEqual(timelinePoints(nscp).map((p) => p.label), ['LISTED', 'PEAK', 'ACQUIRED'], 'a same-day delisting is left out');
  assert.deepEqual(cliffOf(leh), { from: '$1,000', peak: 'Feb 2007', to: '$0', by: 'Mar 2012' });
  assert.match(timelineHtml(leh), /gv-cliff/);
  assert.equal(cliffOf({}), null);
  const gm = loadGraveyardData().zombies.find((z) => z.ticker === 'GM');
  assert.ok(timelinePoints(gm).some((p) => p.label === 'CAME BACK'));
  // The CSS: the stone column on the right from 1100 px, first below that.
  const css = readFileSync(new URL('../public/screens/graveyard.css', import.meta.url), 'utf8');
  assert.match(css, /\.gv-card\.card-split > \.card-art \{ order: 2; \}/);
  assert.match(css, /@media \(max-width: 1099px\) \{\n  \.gv-card-stone \{ width: 200px; \}/, 'a phone: the stone first, about 280 px tall');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.gv-flame, \.gv-candle\.is-new \{ animation: none; \} \}/, 'reduced motion: still candles');
});

test('stone page: respects hidden at zero; F lights a candle and reveals the count', async () => {
  assert.equal(revealText(1), 'You are the first');
  assert.equal(revealText(0), 'You are the first');
  assert.equal(revealText(2), 'You and 1 other');
  assert.equal(revealText(13), 'You and 12 others');
  assert.equal(revealText(1235), 'You and 1,234 others');
  const page = stonePageHtml(LEH, 12);
  assert.match(page, /<p class="card-note"><span class="gv-count" data-reveal hidden><\/span><\/p>/, 'nothing before the press');
  assert.doesNotMatch(page, /\d+ respects?|You and|first/, 'no count before the press');
  assert.equal((page.match(/class="gv-candle[ "]/g) || []).length, 12, 'the candles show what others paid');
  // The press: a fake page, the respect answered by the server.
  const reveal = { hidden: true, textContent: '' };
  const candles = { innerHTML: '' };
  const stone = { classList: { add() {} } };
  let onClick = null;
  const el = {
    isConnected: true, dataset: {}, classList: { add() {} },
    querySelector: (s) => ({ '[data-reveal]': reveal, '[data-candles]': candles, '.gv-stone': stone }[s] || null),
    addEventListener: (t, fn) => { if (t === 'click') onClick = fn; }, removeEventListener() {},
  };
  const doc = { getElementById: () => null, addEventListener() {}, removeEventListener() {} };
  const saved = { fetch: globalThis.fetch, document: globalThis.document };
  const said = [];
  try {
    globalThis.document = doc;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ticker: 'LEH', n: 13, counted: true }) });
    const stop = wireRespects(el, 'LEH', { status: (...a) => said.push(a) });
    onClick({ target: { closest: (s) => (s === '[data-respect]' ? {} : null) } });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(reveal.hidden, false);
    assert.equal(reveal.textContent, 'You and 12 others');
    assert.equal((candles.innerHTML.match(/<svg/g) || []).length, 12, 'capped at 12; the count is in words');
    assert.match(candles.innerHTML, /is-new/, 'the new candle');
    assert.deepEqual(said, [['LEH: RESPECTS PAID', '']]);
    // A slower load of the old count does not take the candle back.
    showRespects(el, 2);
    assert.equal((candles.innerHTML.match(/<svg/g) || []).length, 12);
    // Refused (offline): nothing revealed.
    const r2 = { hidden: true, textContent: '' };
    const el2 = { ...el, dataset: {}, querySelector: (s) => ({ '[data-reveal]': r2, '[data-candles]': candles, '.gv-stone': stone }[s] || null) };
    let click2 = null;
    el2.addEventListener = (t, fn) => { if (t === 'click') click2 = fn; };
    globalThis.fetch = async () => ({ ok: false });
    wireRespects(el2, 'LEH', { status: (...a) => said.push(a) });
    click2({ target: { closest: () => ({}) } });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(r2.hidden, true);
    assert.deepEqual(said.at(-1), ['RESPECTS NOT SAVED. TRY AGAIN', 'warn']);
    stop();
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
  }
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.match(src, /ctx\.status\(STONE_HINT\);/);
});

test('router: GRAVEYARD views and stones', () => {
  for (const v of GRAVEYARD_VIEWS) assert.deepEqual(parseCommand(`graveyard ${v}`).args, { view: v });
  assert.deepEqual(parseCommand('GRAVEYARD LEH').args, { ticker: 'LEH' });
  assert.deepEqual(parseCommand('GRAVEYARD').args, {});
});

test('ON THIS DAY rows and the table', () => {
  const row = rowHtml({ id: 'TODAY', label: 'On this day', stones: [LEH, BBI] }, '/s.webp');
  assert.match(row, /data-cmd="GRAVEYARD LEH"/);
  assert.match(row, /<span class="gv-pname">Blockbuster<\/span>/);
  const t = graveyardTable(DATA.stones, { BBI: 5, LEH: 2 }, { mourned: true });
  assert.ok(t.indexOf('GRAVEYARD BBI') < t.indexOf('GRAVEYARD LEH'), 'most mourned first');
  const n = graveyardTable(DATA.stones, {}, {});
  assert.ok(n.indexOf('GRAVEYARD BBI') < n.indexOf('GRAVEYARD LEH'), 'newest first');
  // Respects: the count above zero, an empty cell at zero (never "0").
  const cells = (html) => [...html.matchAll(/<td class="num ns-what">([^<]*)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(cells(n), ['', ''], 'zero: empty cells');
  assert.deepEqual(cells(graveyardTable(DATA.stones, { LEH: 1234 }, {})), ['', '1,234']);
  assert.deepEqual(cells(graveyardTable(DATA.stones, { LEH: 0, BBI: -1 }, {})), ['', '']);
  const g = graveyardTable(loadGraveyardData().stones, {}, { grouped: true });
  const heads = [...g.matchAll(/<tr class="gv-sec"><th scope="rowgroup" colspan="6">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(heads, ['BOUGHT OUT', 'RECENT', '2008 CRISIS', 'DOT-COM'], 'grouped by the same sections');
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
  // Enter in the EMPTY bar opens the stone picked (the cemetery's barEnter); with text in the
  // bar, or its suggestion list open, Enter runs the bar; F in the bar is typing.
  const q = fakePage();
  const opened = [];
  const stopQ = sceneKeys(q.scene, () => false, { doc: q.doc, barEnter: () => { opened.push('stone'); return true; } });
  let ev = q.press('Enter');
  assert.equal(ev.defaultPrevented && ev.stopped, true, 'Enter from the empty bar opens the stone');
  assert.deepEqual(opened, ['stone']);
  q.bar.value = 'AAPL';
  ev = q.press('Enter');
  assert.equal(ev.defaultPrevented || ev.stopped, false, 'Enter with text runs the text');
  q.bar.value = '';
  for (const ch of 'FX') { ev = q.press(ch); assert.equal(ev.defaultPrevented || ev.stopped, false, `${ch} in the bar is typing`); }
  ev = q.press('F');
  assert.equal(ev.defaultPrevented, false, 'F in the empty bar types F');
  stopQ();
  const list = { hidden: false };
  const doc2 = { ...q.doc, getElementById: (id) => (id === 'cmd' ? q.bar : id === 'suggest' ? list : null) };
  const stop2 = sceneKeys(q.scene, () => false, { doc: doc2, barEnter: () => { opened.push('again'); return true; } });
  assert.equal(q.press('Enter').defaultPrevented, false, 'a suggestion open: Enter picks it, as always');
  assert.deepEqual(opened, ['stone'], 'nothing opened with the list open');
  stop2();
  const x = p.press('x', p.scene);
  assert.equal(x.defaultPrevented, false, 'other keys still go to the bar');
  const field = { closest: () => ({}) };
  assert.equal(p.press('F', field).defaultPrevented, false, 'never in another field');
  assert.equal(p.scene.tabIndex, -1);
  assert.equal(p.scene.dataset.ownFocus, '', 'a click on the scene keeps the focus there');
  stop();
  assert.equal(p.listeners.length, 0);
});

test('scene keys: the stone, cemetery and table screens use them; hints in the status line', () => {
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.equal((src.match(/addEventListener\('keydown'/g) || []).length, 1, 'one key listener, in sceneKeys');
  assert.equal((src.match(/sceneKeys\(el,/g) || []).length, 3, 'stone (with respects), cemetery, table');
  assert.match(src, /\['Keys', 'Esc, then F pays respects\.'\]/, 'the stone card says it in + Details');
  assert.match(src, /if \(ev\.key === 't' \|\| ev\.key === 'T'\) \{ ctx\.run\('GRAVEYARD TABLE'\); return true; \}/, 'T lists');
});

test('the LEH card (NO SUCH): wireNoSuch lights the candles but never writes a count before F', async () => {
  const leh = withArt(loadGraveyardData().stones.find((e) => e.ticker === 'LEH'), { stone: '/img/graveyard/stone.webp', doodles: ['LEH'] });
  const reveal = { hidden: true, textContent: '' };
  const candles = { innerHTML: '' };
  const el = {
    isConnected: true, dataset: {}, classList: { add() {} },
    querySelector: (sel) => ({ '[data-reveal]': reveal, '[data-candles]': candles }[sel] || null),
    querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
  };
  const saved = { fetch: globalThis.fetch, document: globalThis.document };
  try {
    globalThis.document = { getElementById: () => null, addEventListener() {}, removeEventListener() {} };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ counts: { LEH: 12 } }) });
    const stop = wireNoSuch(el, 'LEH', { grave: leh });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal((candles.innerHTML.match(/<svg class="gv-candle/g) || []).length, 12, 'the candles for what others paid');
    assert.equal(reveal.hidden, true, 'the count stays hidden');
    assert.equal(reveal.textContent, '', 'no count written');
    stop();
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
  }
  const src = readFileSync(new URL('../public/screens/nosuch.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /data-count|respectsText/, 'no count text in NO SUCH');
});
