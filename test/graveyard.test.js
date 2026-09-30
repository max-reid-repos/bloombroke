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
  stoneHtml, stonePageHtml, stoneFacts, peakLineHtml, videoHtml, siteHtml, candlesHtml, candlesFor, MAX_CANDLES, revealText, engraving, diedVerb,
  layout, stepStone, boxes, signBoxes, clashes, stageFor, STONE_W, AREAS, BAND, cemeteryHtml, latestHtml, heroPick, heroLine, zombiesHtml, tipText, STONE_HINT,
  wireRespects, showRespects, graveyardTable, onThisDayHtml, sourcesHtml, pageSources, sceneKeys, respectStatus, timelineHtml,
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

test('video: our own art and a play mark; nothing from YouTube or Google before a click', () => {
  const e = withArt(LEH, { doodles: ['LEH'] });
  const html = videoHtml({ ...e, video: { ...e.video, channel: 'CBS' } });
  assert.match(html, /<button type="button" class="gv-video gv-box" data-yt="AAAAAAAAAAA"/, 'a real button: Enter on it plays it');
  assert.match(html, /src="\/img\/graveyard\/doodle-leh\.webp"/, 'our own drawing');
  assert.match(html, /<span class="gv-play" aria-hidden="true"><\/span>/);
  assert.match(html, /PLAY VIDEO · CBS/);
  const page = stonePageHtml(e, 0);
  for (const h of [html, page]) {
    assert.doesNotMatch(h, /<iframe|<script/);
    assert.doesNotMatch(h, /ytimg|youtube|google|googlevideo|gstatic/i, 'no request to any Google or YouTube host before the click');
  }
  assert.match(page, /<span class="gv-cap gv-vlabel">PLAY VIDEO<\/span>/, 'no channel given: the label alone, inside the box');
  assert.match(html, /<span class="gv-cap gv-vlabel">PLAY VIDEO · CBS<\/span>/, 'the caption inside the box');
  assert.match(page, /<div class="gv-media n1"><button type="button" class="gv-video gv-box"/, 'the video in the media row');
  // The poster is our own doodle, never a frame of the video: nothing is fetched before a click.
  assert.doesNotMatch(html, /i\.ytimg|img\.youtube|\/vi\//);
  assert.equal(videoHtml(BBI), '', 'a bad id: no video');
  assert.equal(ytEmbed('AAAAAAAAAAA'), 'https://www.youtube-nocookie.com/embed/AAAAAAAAAAA?autoplay=1&rel=0');
  assert.equal(ytEmbed('<x>'), null);
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /ytimg|youtube\.com\/iframe_api|www\.youtube\.com\/embed/, 'no stills from YouTube, no YouTube script');
  assert.match(src, /b\.replaceWith\(f\);/, 'the click swaps the button for the player');
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

test('cemetery v3: every stone in one section, back to front; the mapping', () => {
  const real = loadGraveyardData().stones;
  const by = {};
  for (const e of real) (by[sectionOf(e)] ||= []).push(e.ticker);
  assert.deepEqual(Object.keys(by).sort(), ['BOUGHT', 'CRISIS', 'DOTCOM', 'RECENT']);
  assert.equal(Object.values(by).flat().length, real.length, 'every stone once');
  assert.equal(new Set(Object.values(by).flat()).size, real.length);
  assert.deepEqual(by.BOUGHT.sort(), ['ATVI', 'LNKD', 'NSCP', 'TOY', 'TWTR', 'WFM', 'YHOO']);
  assert.deepEqual(by.DOTCOM.sort(), ['ENE', 'IPET', 'WBVN', 'WCOM']);
  assert.ok(by.CRISIS.includes('LEH') && by.CRISIS.includes('BSC'), 'crisis rescues stay in the crisis');
  assert.ok(by.RECENT.includes('SIVB') && by.RECENT.includes('NKLA'));
  const spots = layout(real);
  assert.equal(spots.length, real.length);
  const y = (sec) => Math.max(...spots.filter((sp) => sp.sec === sec).map((sp) => sp.y));
  assert.ok(y('DOTCOM') < y('CRISIS') && y('CRISIS') < y('RECENT'), 'back terrace high, front low');
  const size = (t) => spots.find((sp) => sp.e.ticker === t).size;
  assert.ok(size('SIVB') > size('LEH') && size('LEH') > size('WCOM'), 'perspective: the front is larger');
  assert.ok(size('LEH') > size('CFC'), 'famous ones a bit larger');
  const more = layout(real, { counts: { CFC: 5000 } });
  const cfc = more.find((sp) => sp.e.ticker === 'CFC').size;
  assert.ok(cfc > size('CFC') && cfc <= size('CFC') * 1.11, 'respects grow a stone, capped');
  assert.equal(SECTIONS.map((x) => x.label).join(' | '), 'DOT-COM | 2008 CRISIS | RECENT | BOUGHT OUT', 'four signposts');
});

test('cemetery v3: no overlaps and nothing cut off at 1536x730 and 1280x720 (and wider, and shorter)', () => {
  const real = loadGraveyardData().stones;
  // The scene inside the panel at those windows (the yard's own size, measured in the browser).
  // Also the yard at common windows (measured in the browser): 1366x650 (a 1366x768 laptop
  // less the browser bar), 1920x700, 1536x600, 1280x1024 and 1024x768; and 40 px shorter
  // under the LATEST line (1440x900: 1414x684).
  for (const [w, h] of [[1428, 560], [1172, 550], [1428, 760], [1000, 420], [1394, 730], [1234, 550], [1428, 910], [1428, 952],
    [1320, 480], [1418, 530], [1418, 430], [1234, 823], [998, 598], [1394, 690], [1414, 684]]) {
    for (const counts of [{}, Object.fromEntries(real.map((e) => [e.ticker, 1e6]))]) {
      const list = [...boxes(layout(real, { counts }), w, h), ...signBoxes(w, h)];
      assert.deepEqual(clashes(list, w, h), [], `${w}x${h}`);
    }
  }
  const st = stageFor(1428, 560);
  assert.ok(st.sw >= 1428 && st.sh >= 560 && st.top <= 0 && st.top >= 560 - st.sh, 'the painting covers the scene');
  // Too wide and short for all four rows: narrower than the scene, never cut through a row.
  const low = stageFor(1418, 430);
  assert.ok(low.sw < 1418 && low.left > 0 && low.top <= 0 && low.top >= 430 - low.sh);
  assert.ok(low.top + (BAND[0] / 100) * low.sh >= 0 && low.top + (BAND[1] / 100) * low.sh <= 430 + 1e-9, 'the whole band shows');
  const css = readFileSync(new URL('../public/screens/graveyard.css', import.meta.url), 'utf8');
  assert.match(css, /\.gv-yard \{[^}]*height: min\([^;]*calc\(100cqw \/ 1\.5\)\);/, 'never taller than w / 1.5');
});

test('cemetery v3: bigger stones, a gentle perspective, readable tickers', () => {
  const real = loadGraveyardData().stones;
  const spots = layout(real);
  const min = (sec) => Math.min(...spots.filter((sp) => sp.sec === sec).map((sp) => sp.size));
  // At 1440x900 the painting is 1394 px wide: the smallest stone of a terrace is wide
  // enough for its ticker, which never goes under 13 px (the CSS floor).
  for (const sec of ['DOTCOM', 'CRISIS', 'RECENT', 'BOUGHT']) {
    const px = (STONE_W / 100) * 1394 * min(sec);
    assert.ok(px >= 44, `${sec}: ${px.toFixed(0)} px wide`);
  }
  assert.ok(min('DOTCOM') >= 0.75 && min('RECENT') <= 1.2, 'gentle, not extreme');
  const css = readFileSync(new URL('../public/screens/graveyard.css', import.meta.url), 'utf8');
  assert.match(css, /\.gv-stone\.is-small \.gv-tk \{ font-size: max\(13px, 25cqw\); \}/, 'a font floor: 13 px');
  // Nothing under 11 px anywhere on the GRAVEYARD screens: the signposts are 11 px now.
  for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(m[1]) >= 11, `nothing under 11 px: ${m[0]}`);
  assert.match(css, /\.gv-sign \{[^}]*font-size: 11px;/);
  assert.match(css, /\.gv-tl-l \{ display: block; font-size: 11px;/);
});

test('cemetery v3: an 8th bought-out stone and a long RECENT row still fit, no stacking', () => {
  const real = loadGraveyardData().stones;
  const bought = real.find((e) => sectionOf(e) === 'BOUGHT');
  const recent = real.find((e) => sectionOf(e) === 'RECENT');
  const more = (base, n, tag, from) => Array.from({ length: n }, (_, i) => ({ ...base, ticker: `${tag}${i}`, date: `${from + i}-01-02` }));
  for (const extra of [1, 2]) {
    const list = [...real, ...more(bought, extra, 'BO', 2014)];
    const spots = layout(list);
    const at = spots.filter((sp) => sp.sec === 'BOUGHT').map((sp) => `${sp.x},${sp.y}`);
    assert.equal(new Set(at).size, at.length, `${extra} more: every bought-out stone has its own place`);
    for (const [w, h] of [[1428, 560], [1394, 730], [1000, 420]]) {
      assert.deepEqual(clashes([...boxes(spots, w, h), ...signBoxes(w, h)], w, h), [], `${extra} more at ${w}x${h}`);
    }
  }
  // Many more on both: the wrapped line starts past the side plot's last stone.
  const both = [...real, ...more(bought, 3, 'BX', 2014), ...more(recent, 5, 'RX', 2016)];
  const bs = layout(both);
  assert.ok(bs.filter((sp) => sp.sec === 'BOUGHT').length >= 10 && bs.filter((sp) => sp.sec === 'RECENT').length >= 18);
  const lastBought = Math.max(...bs.filter((sp) => sp.sec === 'BOUGHT').map((sp) => sp.x));
  const back = bs.filter((sp) => sp.sec === 'RECENT' && sp.y === AREAS.RECENT.wrap.y);
  assert.ok(back.length && Math.min(...back.map((sp) => sp.x)) > lastBought + AREAS.BOUGHT.step, 'past the side plot');
  for (const counts of [{}, Object.fromEntries(both.map((e) => [e.ticker, 1e6]))]) {
    for (const [w, h] of [[1428, 560], [1394, 730], [1320, 480], [998, 598], [1000, 420]]) {
      assert.deepEqual(clashes([...boxes(layout(both, { counts }), w, h), ...signBoxes(w, h)], w, h), [], `both at ${w}x${h}`);
    }
  }
  // Six more recent deaths: two lines on the front terrace, not smaller stones.
  const long = [...real, ...more(recent, 6, 'RC', 2016)];
  const spots = layout(long);
  const rec = spots.filter((sp) => sp.sec === 'RECENT');
  assert.equal(new Set(rec.map((sp) => sp.y)).size, 2, 'two lines');
  assert.ok(Math.min(...rec.map((sp) => sp.size)) >= AREAS.RECENT.scale - 1e-9, 'no shrinking');
  for (const counts of [{}, Object.fromEntries(long.map((e) => [e.ticker, 1e6]))]) {
    for (const [w, h] of [[1428, 560], [1394, 730], [1172, 550], [1000, 420], [1428, 952]]) {
      assert.deepEqual(clashes([...boxes(layout(long, { counts }), w, h), ...signBoxes(w, h)], w, h), [], `wrapped at ${w}x${h}`);
    }
  }
});

test('cemetery: the LATEST line opens LATEST, or ON THIS DAY only on a real anniversary (New York day)', () => {
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
  // One line of text above the painting, never inside it: name · ticker · filed year · Enter.
  const html = cemeteryHtml(layout(real.stones), { stone: '/s.webp', yard: '/img/graveyard/cemetery-empty.webp' }, latest);
  assert.match(html, /^<p class="gv-latest"><a class="gv-hero" href="\?c=GRAVEYARD\+NKLA" data-cmd="GRAVEYARD NKLA" data-hero><span class="tag gv-kicker">Latest<\/span> <span class="gv-hero-name">Nikola<\/span> · NKLA · filed 2025 <kbd data-enter title="Enter in the empty command bar opens it">Enter<\/kbd><\/a><\/p><div class="gv-yard has-art">/);
  assert.doesNotMatch(html.slice(html.indexOf('<div class="gv-yard')), /gv-latest|gv-hero|data-enter/, 'nothing of it on the painting');
  assert.equal(latestHtml(null), '', 'no stones: no line');
  // Enter opens the stone picked, else the LATEST line's; from the empty command bar too.
  const gsrc = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.match(gsrc, /const e = on >= 0 \? spots\[on\]\.e : hero\?\.e;/);
  assert.match(gsrc, /\}, \{ barEnter: open \}\)\);/);
  assert.match(gsrc, /if \(badge\) badge\.hidden = spots\[on\]\.e !== hero\?\.e;/, 'the badge only while Enter opens it');
  // The yard is 40 px shorter for the line, so the page does not scroll at 1440x900.
  const css = readFileSync(new URL('../public/screens/graveyard.css', import.meta.url), 'utf8');
  assert.match(css, /\.gv-latest \{[^}]*height: 40px;/);
  assert.match(css, /height: min\(clamp\(380px, calc\(100vh - 159px - var\(--dock-h\)\), 952px\), calc\(100cqw \/ 1\.5\)\);/);

  // The verbs for each way to die.
  assert.deepEqual(['Filed for bankruptcy', 'Bought by Microsoft', 'Seized, sold to JPMorgan', 'Bank closed by regulators', 'Taken private', 'Shut down', 'Announced shutdown', 'Delisted from Nasdaq', 'Core business sold to Verizon'].map((what) => diedVerb({ what })),
    ['filed', 'bought out', 'seized', 'seized', 'went private', 'shut down', 'shut down', 'delisted', 'bought out']);
  // The screen asks for today's New York date.
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.match(src, /heroPick\(\[\.\.\.data\.entries, \.\.\.data\.zombies\], nyToday\(\)\)/);
});

test('ZOMBIES: its own screen, and the button on the painting', () => {
  assert.deepEqual(parseCommand('GRAVEYARD ZOMBIES').args, { view: 'ZOMBIES' });
  const z = zombiesHtml(DATA.zombies);
  assert.match(z, /<a class="gv-plot is-flat" href="\?c=GRAVEYARD\+GMZ" data-cmd="GRAVEYARD GMZ"/);
  assert.match(z, /<span class="gv-zname">[^<]+<\/span>/);
  assert.equal(zombiesHtml([]), '<p class="panel-msg">No zombies yet.</p>');
  assert.match(cemeteryHtml(layout(DATA.stones), { stone: '/s.webp' }), /<p class="gv-corner"><a class="code" href="\?c=GRAVEYARD\+ZOMBIES" data-cmd="GRAVEYARD ZOMBIES">ZOMBIES<\/a><\/p>/);
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.match(src, /if \(view === 'ZOMBIES'\) \{\s*el\.innerHTML = panel\('1', 'Graveyard: zombies', zombiesHtml\(data\.zombies\)/);
  assert.doesNotMatch(src, /gv-row|gv-sky|gv-live|loadLive|liveHtml|stepGrid/, 'the rows, the sky band and the live prices are gone');
});

test('cemetery v3: arrows walk rows back to front, the label says name, year and respects above zero', () => {
  const spots = layout(loadGraveyardData().stones);
  const leh = spots.findIndex((sp) => sp.e.ticker === 'LEH');
  const right = stepStone(spots, leh, 'ArrowRight');
  assert.equal(spots[right].row, spots[leh].row);
  assert.ok(spots[right].x > spots[leh].x);
  assert.ok(spots[stepStone(spots, leh, 'ArrowDown')].row > spots[leh].row);
  assert.ok(spots[stepStone(spots, leh, 'ArrowUp')].row < spots[leh].row);
  assert.equal(stepStone([], 0, 'ArrowLeft'), -1);
  assert.equal(tipText(spots[leh].e, 3), 'Lehman Brothers · 2008 · 3 respects');
  assert.equal(tipText(spots[leh].e, 1), 'Lehman Brothers · 2008 · 1 respect');
  assert.equal(tipText(spots[leh].e, 0), 'Lehman Brothers · 2008', 'never "0 respects"');
  assert.doesNotMatch(tipText(LEH, 0), /respect/);
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.match(src, /metaNote\('ESC THEN ARROWS'\)\} \$\{code\('GRAVEYARD TABLE', 'TABLE'\)\}/, 'hints in the title strip, 4 words');
  assert.match(src, /ctx\.status\(`GRAVEYARD: \$\{data\.entries\.length\} STONES`\);/);
  const t = graveyardTable(loadGraveyardData().stones, {}, { grouped: true });
  const heads = [...t.matchAll(/<tr class="gv-sec"><th scope="rowgroup" colspan="6">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(heads, ['BOUGHT OUT', 'RECENT', '2008 CRISIS', 'DOT-COM'], 'the phone table, by the same sections');
});

test('cemetery: under 600 px wide the table is the default, grouped by section', () => {
  const src = readFileSync(new URL('../public/screens/graveyard.js', import.meta.url), 'utf8');
  assert.match(src, /const phone = \(\) => typeof matchMedia === 'function' && matchMedia\('\(max-width: 599px\)'\)\.matches;/, 'the breakpoint is 599');
  assert.doesNotMatch(src, /const phone = [^\n]*639/);
  assert.match(src, /if \(view === 'TABLE' \|\| view === 'MOURNED' \|\| t \|\| phone\(\)\) \{ renderTable\(el, data, ctx, \{ mourned: view === 'MOURNED', miss, grouped: !view && !t \}\); return; \}/);
});

test('stone page: the words left, the stone right; the video and the last homepage under the story', () => {
  const real = loadGraveyardData().stones;
  const leh = withArt(real.find((e) => e.ticker === 'LEH'), { stone: '/img/graveyard/stone.webp', doodles: ['LEH'], sites: ['LEH'] });
  assert.equal(siteCaption(leh.wayback), 'lehman.com, Sep 2008 · Internet Archive');
  const site = siteHtml(leh);
  assert.match(site, /<a class="gv-site gv-box" href="https:\/\/web\.archive\.org\/web\/20080913111928\/http:\/\/www\.lehman\.com:80\/" target="_blank" rel="noopener noreferrer"/);
  assert.match(site, /src="\/img\/graveyard\/sites\/leh\.webp"/, 'our own copy, nothing from the archive before a click');
  assert.match(site, /<span class="gv-cap gv-sitecap">lehman\.com, Sep 2008 · Internet Archive<\/span>/, 'the caption inside the box');
  assert.doesNotMatch(site, /gv-screen/, 'no monitor frame');
  const page = stonePageHtml(leh, 0);
  assert.match(page, /^<section class="card card-wide card-split gv-card" aria-label="Graveyard: Lehman Brothers"><div class="card-art"><div class="gv-card-stone"><figure class="gv-stone has-art"/);
  assert.equal((page.match(/<figure class="gv-stone/g) || []).length, 1, 'one stone');
  // Under both columns, the card's last child: the video, then the homepage, two boxes of
  // one size. Pictures, not text links. The share links under the stone.
  assert.match(page, /<div class="card-media"><p class="gv-story">[^<]*<\/p><\/div>/);
  assert.match(page, /<\/div><div class="gv-media n2"><button type="button" class="gv-video gv-box"[\s\S]*?<\/button><a class="gv-site gv-box"[\s\S]*?<\/a><\/div><\/section>$/);
  assert.match(page, /<div class="gv-card-stone"><figure class="gv-stone[\s\S]*?<\/figure><p class="gv-share"><a class="card-link"[^>]*data-share="grave" data-via="x">SHARE ON X<\/a><span class="gv-sep" aria-hidden="true">·<\/span><button[^>]*>COPY LINK<\/button><\/p><\/div>/, 'SHARE under the stone');
  assert.doesNotMatch(page, /gv-more|gv-watch|Watch the video|lehman\.com in 2008/, 'no line of text links');
  assert.doesNotMatch(page.split('<details')[0], /\d respects?/, 'no "0 respects"');
  const srcs = [...page.matchAll(/\b(?:src|srcset|data-src|poster)="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(srcs.length >= 4 && srcs.every((u) => u.startsWith('/img/graveyard/')), `every image is ours: ${srcs.join(' ')}`);
  assert.doesNotMatch(page, /<iframe|<script|<link|<object|<embed/, 'nothing that loads by itself');
  // No copy of the homepage: the video alone, and the text link under SOURCES.
  const bare = withArt(real.find((e) => e.ticker === 'LEH'), { doodles: [], sites: [] });
  assert.equal(siteHtml(bare), '');
  assert.match(stonePageHtml(bare, 0), /<div class="gv-media n1"><button type="button" class="gv-video gv-box"/);
  assert.match(stonePageHtml(bare, 0), /LAST WEBSITE/, 'the text link under SOURCES');
  assert.doesNotMatch(sourcesHtml(leh, { linkSite: false }), /LAST WEBSITE/);
  // The real art on disk: a stone without a video shows the homepage alone, one without a
  // copy of it the video alone, one with neither no media row (never an empty frame).
  const art = artOnDisk();
  const data = loadGraveyardData();
  for (const e of [...data.stones, ...data.zombies].map((x) => withArt(x, art))) {
    const html = stonePageHtml(e, 0);
    const v = Boolean(ytEmbed(e.video?.id));
    const s = Boolean(e.wayback && e.art.site);
    assert.equal(html.includes('class="gv-video gv-box"'), v, `${e.ticker}: video`);
    assert.equal(html.includes('class="gv-site gv-box"'), s, `${e.ticker}: homepage`);
    assert.equal(html.includes('class="gv-media'), v || s, `${e.ticker}: a media row only with media`);
    if (v || s) assert.ok(html.includes(`class="gv-media n${Number(v) + Number(s)}"`), `${e.ticker}: one box per thing it has`);
  }
  for (const t of ['WBVN', 'SIX', 'DAL', 'TX']) assert.doesNotMatch(stonePageHtml(withArt([...data.stones, ...data.zombies].find((x) => x.ticker === t), art), 0), /gv-video/, `${t}: no video`);
  for (const t of ['MRV', 'TX']) assert.doesNotMatch(stonePageHtml(withArt([...data.stones, ...data.zombies].find((x) => x.ticker === t), art), 0), /gv-site/, `${t}: no archived homepage`);
  for (const t of ['WBVN', 'CC', 'BBI', 'RAD', 'AMR']) assert.doesNotMatch(stonePageHtml(withArt([...data.stones, ...data.zombies].find((x) => x.ticker === t), art), 0), /gv-site/, `${t}: no site image`);
  assert.doesNotMatch(stonePageHtml(withArt([...data.stones, ...data.zombies].find((x) => x.ticker === 'WBVN'), art), 0), /gv-media/, 'WBVN: neither, no row, no empty frame');
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
  // The CSS: the stone column on the right from 1100 px, first below that; the media row.
  const css = readFileSync(new URL('../public/screens/graveyard.css', import.meta.url), 'utf8');
  assert.match(css, /\.gv-card\.card-split > \.card-art \{ order: 2; \}/);
  assert.match(css, /@media \(max-width: 1099px\) \{\n  \.gv-card-stone \{ width: 200px; \}/, 'a phone: the stone first, about 280 px tall');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.gv-flame, \.gv-candle\.is-new \{ animation: none; \} \}/, 'reduced motion: still candles');
  // Two boxes of one size: half the row each, 16:9, one border, the caption inside.
  assert.ok(css.includes('.gv-media { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; width: 100%; }'), 'half the row each; one box alone keeps its half');
  assert.match(css, /\.gv-box \{\n  position: relative; display: block; width: 100%; aspect-ratio: 16 \/ 9;[^}]*border: 1px solid var\(--rule-strong\);/);
  assert.match(css, /\.gv-cap \{\n  position: absolute; left: 0; right: 0; bottom: 0;[^}]*font-size: 11px;[^}]*text-transform: uppercase;/);
  assert.match(css, /\.gv-site img \{[^}]*object-fit: cover; object-position: top;/, 'the masthead, cropped');
  assert.match(css, /\.gv-card\.card-split > \.gv-media \{ order: 3; grid-column: 1 \/ -1; \}/, 'under both columns');
  assert.match(css, /@media \(max-width: 639px\) \{\n  \.gv-media \{ grid-template-columns: minmax\(0, 1fr\);/, 'a phone: stacked, full width');
  assert.doesNotMatch(css, /gv-screen|gv-card-media|--gv-h[:;)]/, 'no monitor frame, no first-view sizing');
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
  const row = zombiesHtml([LEH, BBI]);
  assert.match(row, /data-cmd="GRAVEYARD LEH"/);
  assert.match(row, /<span class="gv-zname">Blockbuster<\/span>/);
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
