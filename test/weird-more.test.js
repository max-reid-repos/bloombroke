// WEIRD phase 3b: the 13 extra gauges. Parsers run on trimmed live fixtures
// (test/fixtures/weird, captured Sep 26 2026). No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as billions from '../data/weird/billions.js';
import * as wsb from '../data/weird/wsb.js';
import * as odds from '../data/weird/odds.js';
import * as boxrate from '../data/weird/boxrate.js';
import * as eggs from '../data/weird/eggs.js';
import * as rides from '../data/weird/rides.js';
import * as buzz from '../data/weird/buzz.js';
import * as beige from '../data/weird/beige.js';
import * as trucks from '../data/weird/trucks.js';
import * as boxes from '../data/weird/boxes.js';
import * as lipstick from '../data/weird/lipstick.js';
import * as sick from '../data/weird/sick.js';
import * as macau from '../data/weird/macau.js';
import * as canal from '../data/weird/canal.js';
import { toMonths, changeAt, recentRows } from '../data/weird/fred.js';
import { pool, decodeEntities } from '../data/weird/source.js';
import { parseFredCsv } from '../data/economy.js';
import { GAUGES, lastGoodStore, makeWeird } from '../data/weird/index.js';
import { WEIRD_GAUGES } from '../public/screens/weird-gauges.js';
import { tileBody, commandForNumber, tile } from '../public/screens/weird.js';
import { numberedItem, panelNumberInput, parseCommand } from '../public/app.js';
import { REGISTRY } from '../public/registry.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fx = (f) => readFileSync(new URL(`./fixtures/weird/${f}`, import.meta.url), 'utf8');
const fxj = (f) => JSON.parse(fx(f));
const fred = (f) => toMonths(parseFredCsv(fx(f)));
const NOW = Date.parse('2026-09-26T04:30:00Z');
const noData = (e) => e.code === 'no_data';

test('23 gauges, in the agreed tile order; two-digit numbers open them', () => {
  const order = ['canal', 'pizza', 'degen', 'waffle', 'panic', 'hiring', 'hotdog', 'omens', 'undies', 'bigmac',
    'billions', 'wsb', 'odds', 'boxrate', 'eggs', 'rides', 'buzz', 'beige', 'trucks', 'boxes', 'lipstick', 'sick', 'macau'];
  assert.deepEqual(GAUGES.map((g) => g.id), order);
  assert.deepEqual(WEIRD_GAUGES.map((g) => g.id), order);
  assert.equal(commandForNumber('11'), 'BILLIONS');
  assert.equal(commandForNumber(' 23 '), 'MACAU');
  assert.equal(commandForNumber('24'), null);
  assert.equal(commandForNumber('0'), null);
});

test('billions: biggest one-day move in dollars, from the previous close estimate', () => {
  const p = billions.parse(fxj('forbes-rtb.json'));
  assert.equal(p.asOf, '2026-09-26T04:25:02.627Z');
  const g = billions.build(p);
  assert.equal(g.headline, 'ZUCKERBERG −$8.8B');
  assert.equal(g.moves.length, 10);
  assert.equal(g.moves[1].name, 'Michael Dell');
  assert.ok(g.moves[1].change > 8.3 && g.moves[1].change < 8.4);
  assert.equal(g.richest[0].name, 'Elon Musk');
  assert.ok(Math.abs(g.richest[0].change - (928957.789 - 927938.546338) / 1000) < 1e-9);
  assert.equal(billions.signedB(4100), '+$4.1B');
  assert.equal(billions.signedB(-20), '$0.0B');
  const flat = billions.build({ people: [{ name: 'A B', last: 'B', rank: 1, worth: 100, prev: 100 }], asOf: null, size: 1 });
  assert.equal(flat.headline, 'NO BIG MOVES TODAY');
  assert.throws(() => billions.parse({ error: 'x' }), /unexpected shape/);
  assert.throws(() => billions.build({ people: [], asOf: null, size: 0 }), noData);
});

test('wsb: top tickers by mentions with the 24-hour rank change; names decoded', () => {
  const rows = wsb.parse(fxj('apewisdom-wsb.json'));
  const g = wsb.build(rows, NOW);
  assert.equal(g.rows.length, 10);
  assert.equal(g.rows[0].ticker, 'SPY');
  assert.equal(g.rows[0].name, 'SPDR S&P 500 ETF Trust');
  assert.equal(g.headline, `SPY ${g.rows[0].mentions} MENTIONS`);
  const meta = g.rows.find((r) => r.ticker === 'META');
  assert.equal(meta.moved, meta.rankAgo - meta.rank);
  assert.deepEqual(wsb.parse({ results: [{ rank: 1, ticker: '<b>', mentions: 3 }] }), [], 'odd tickers are dropped');
  assert.throws(() => wsb.build([]), noData);
});

test('wsb: tickers link to our own quote screen only', () => {
  const d = { id: 'wsb', ok: true, ...wsb.build(wsb.parse(fxj('apewisdom-wsb.json')), NOW) };
  const html = WEIRD_GAUGES.find((x) => x.id === 'wsb').detail(d).html;
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 10);
  for (const h of hrefs) assert.match(h, /^\?c=[A-Z0-9.+-]+$/, h);
  assert.match(html, /data-cmd="SPY"/);
});

test('odds: the US recession market for this year and every outcome of the next Fed meeting', () => {
  const rec = odds.pickRecession(fxj('polymarket-recession.json'), NOW);
  assert.equal(rec.question, 'US recession by end of 2026?');
  assert.equal(rec.pct, 9.5);
  const fed = odds.pickFed(fxj('polymarket-fed.json'), NOW);
  assert.equal(fed.title, 'Fed Decision in October?');
  assert.equal(fed.outcomes.length, 5);
  assert.match(fed.outcomes[0].question, /October 2026 meeting/);
  assert.ok(fed.outcomes[0].pct >= fed.outcomes[1].pct);
  const g = odds.build({ recession: rec, fed }, NOW);
  assert.equal(g.headline, 'RECESSION 10%');
  assert.equal(g.line, 'US recession by end of 2026?');
  // After the October meeting, the December one is next.
  assert.equal(odds.pickFed(fxj('polymarket-fed.json'), Date.parse('2026-11-01T00:00:00Z')).title, 'Fed Decision in December?');
  // Next year: no 2027-only market in the fixture, so the soonest open one.
  assert.equal(odds.pickRecession(fxj('polymarket-recession.json'), Date.parse('2027-02-01T00:00:00Z')).question, 'US recession by end of 2027?');
  assert.equal(odds.pickRecession({ events: [] }, NOW), null);
  assert.throws(() => odds.build({ recession: null, fed: null }), noData);
  assert.equal(odds.yesPct({ outcomes: '["Yes","No"]', outcomePrices: '["0.2","0.8"]' }), 20);
  assert.equal(odds.yesPct({ outcomes: '["No","Yes"]', outcomePrices: '["0.2","0.8"]' }), 80);
  assert.equal(odds.yesPct({ outcomes: 'bad', outcomePrices: '[]' }), null);
  assert.equal(odds.pctLabel(0.3), '<1%');
  assert.equal(odds.pctLabel(99.6), '>99%');
});

test('odds: no market links and no market site names in what the page shows', () => {
  const d = { id: 'odds', ok: true, ...odds.build({ recession: odds.pickRecession(fxj('polymarket-recession.json'), NOW), fed: odds.pickFed(fxj('polymarket-fed.json'), NOW) }, NOW) };
  const html = WEIRD_GAUGES.find((x) => x.id === 'odds').detail(d).html + tileBody(WEIRD_GAUGES.find((x) => x.id === 'odds'), d);
  assert.doesNotMatch(html, /href|polymarket\.com|slug/i);
  assert.ok(!JSON.stringify(d).includes('slug'));
});

test('boxrate: the headline dollar figure and date, or NO DATA; never a guess', () => {
  const p = boxrate.parse(fx('drewry-head.html'));
  assert.deepEqual({ usd: p.usd, date: p.date }, { usd: 4468, date: '2026-09-24' });
  const g = boxrate.build(p);
  assert.equal(g.headline, '$4,468');
  assert.equal(g.asOf, '2026-09-24');
  assert.throws(() => boxrate.parse('<meta name="description" content="World Container Index: see the chart.">'), noData);
  assert.throws(() => boxrate.parse('<meta name="description" content="Something else, 24 Sep 2026, $4,468 per 40ft container.">'), noData);
  assert.throws(() => boxrate.parse(''), noData);
  assert.throws(() => boxrate.parse('<meta name="description" content="24 Sep 2026: World Container Index rose to $12 per 40ft container.">'), noData);
  // The price is the composite's own clause, not the first dollar figure.
  const meta = (t) => `<meta name="description" content="${t}">`;
  assert.equal(boxrate.parse(meta('24 Sep 2026: Shanghai to Rotterdam rose 5% to $3,000 per 40ft; Drewry’s World Container Index composite fell 1% to $4,468 per 40ft container.')).usd, 4468);
  assert.equal(boxrate.parse(meta('24 Sep 2026: Drewry’s World Container Index (WCI) remained stable at $2,100 per 40ft container.')).usd, 2100);
  assert.equal(boxrate.parse(meta('24 Sep 2026: Drewry’s World Container Index (WCI) increased by 12% to $5,000 per 40ft container.')).usd, 5000);
  assert.throws(() => boxrate.parse(meta('24 Sep 2026: World Container Index: Shanghai to Rotterdam up to $3,000 per 40ft.')), noData);
  assert.throws(() => boxrate.parse(meta('24 Sep 2026: Shanghai to Genoa $3,900 per 40ft; World Container Index steady.')), noData);
});

test('eggs: latest price, a year before, and the peak', () => {
  const g = eggs.build(fred('fred-eggs.csv'));
  assert.equal(g.price, 2.272);
  assert.equal(g.headline, '$2.27 A DOZEN');
  assert.deepEqual(g.peak, { month: '2025-03', price: 6.227 });
  assert.ok(Math.abs(g.fromPeak - (2.272 / 6.227 - 1) * 100) < 1e-9);
  assert.equal(g.line, 'US city average; −64% from peak');
  assert.equal(g.rows.length, 13);
  assert.throws(() => eggs.build([]), noData);
});

test('fred helpers: year-on-year needs the same month a year before, gaps give null', () => {
  const rows = [{ month: '2025-08', value: 100 }, { month: '2026-07', value: 105 }, { month: '2026-08', value: 110 }];
  assert.ok(Math.abs(changeAt(rows, 2, 12) - 10) < 1e-9);
  assert.equal(changeAt(rows, 1, 12), null);
  assert.equal(recentRows(rows, 2)[0].month, '2026-08');
});

test('lipstick: cosmetics prices year on year; the Oct 2025 gap stays a gap', () => {
  const rows = fred('fred-cosmetics.csv');
  assert.ok(!rows.some((r) => r.month === '2025-10'));
  const g = lipstick.build(rows);
  assert.equal(g.month, '2026-08');
  assert.equal(g.index, 196.741);
  assert.match(g.headline, /^[+−]\d+\.\d% YOY$/);
  assert.equal(g.rows.find((r) => r.month === '2026-10'), undefined);
});

test('boxes: output leads, prices follow, each with its own month; one missing series is fine', () => {
  const g = boxes.build({ output: fred('fred-box-output.csv'), price: fred('fred-box-price.csv') });
  assert.equal(g.series[0].month, '2026-06');
  assert.equal(g.series[1].month, '2026-08');
  assert.equal(g.asOf, '2026-06-01');
  assert.match(g.line, /^Box output vs a year ago \(Jun\); prices [+−]\d+\.\d% \(Aug\)$/);
  const only = boxes.build({ output: null, price: fred('fred-box-price.csv') });
  assert.equal(only.line, 'Box prices vs a year ago (Aug)');
  assert.throws(() => boxes.build({ output: null, price: null }), noData);
});

test('trucks: three freight series, each dated on its own', () => {
  const g = trucks.build({ cass: fred('fred-cass.csv'), truck: fred('fred-truck.csv'), rail: fred('fred-rail.csv') });
  assert.deepEqual(g.rows.map((r) => r.month), ['2026-08', '2026-06', '2026-06']);
  assert.equal(g.rows[0].value, 1.038);
  assert.match(g.headline, /^CASS [+−]\d+\.\d% YOY$/);
  const noCass = trucks.build({ cass: null, truck: fred('fred-truck.csv'), rail: null });
  assert.match(noCass.headline, /^TRUCKS /);
});

test('rides: open rides with a posted wait, closed parks say closed', () => {
  const dl = rides.parsePark(fxj('queue-times-16.json'));
  const mk = rides.parsePark(fxj('queue-times-6.json'));
  const g = rides.build([{ park: rides.PARKS[0], rides: mk }, { park: rides.PARKS[4], rides: dl }]);
  const counted = dl.filter((r) => r.open && r.wait > 0);
  assert.ok(counted.length > 5);
  assert.ok(Math.abs(g.avg - counted.reduce((a, r) => a + r.wait, 0) / counted.length) < 1e-9);
  assert.equal(g.headline, `${Math.round(g.avg)} MIN AVERAGE WAIT`);
  assert.equal(g.parks[0].status, 'closed');
  assert.equal(g.credit, 'Powered by Queue-Times.com');
  const shut = rides.build([{ park: rides.PARKS[0], rides: mk }]);
  assert.equal(shut.headline, 'PARKS CLOSED');
  assert.throws(() => rides.build([{ park: rides.PARKS[0], error: 'down' }]));
  const gauge = WEIRD_GAUGES.find((x) => x.id === 'rides');
  const link = /Powered by <a href="https:\/\/queue-times\.com\/"[^>]*>Queue-Times\.com<\/a>/;
  const tile = tileBody(gauge, { id: 'rides', ok: true, ...g });
  assert.match(tile, link, 'the tile credit links to Queue-Times.com');
  assert.match(tile, /target="_blank" rel="noopener noreferrer"/);
  assert.match(tileBody(gauge, { id: 'rides', ok: false, headline: 'NO DATA', source: 'Queue-Times.com' }), /<a href="https:\/\/queue-times\.com\/"/);
  assert.match(readFileSync('public/screens/weird.js', 'utf8'), /\$\{sourceHtml\(g, d\)\}<\/p>\s*`;\s*const host/, 'the detail footer uses the linked credit too');
  // Other credits stay plain text.
  assert.doesNotMatch(tileBody(WEIRD_GAUGES.find((x) => x.id === 'wsb'), { id: 'wsb', ok: true, headline: 'X', source: 'ApeWisdom', asOf: '2026-09-26' }), /<a /);
});

test('buzz: quarters, hit totals and the headline quarter', () => {
  const qs = buzz.quarters(NOW);
  assert.equal(qs.length, 8);
  assert.deepEqual([qs[0].key, qs[7].key], ['2024-Q4', '2026-Q3']);
  assert.deepEqual([qs[7].start, qs[7].end, qs[7].partial], ['2026-07-01', '2026-09-30', true]);
  assert.equal(qs[6].partial, false);
  assert.deepEqual(buzz.parseTotal(fxj('edgar-ai-2026q3.json')), { count: 1743, capped: false });
  assert.equal(buzz.parseTotal(fxj('edgar-tariff-2025q2.json')).count, 1519);
  assert.equal(buzz.parseTotal({ hits: { total: { value: 10000, relation: 'gte' } } }).capped, true);
  assert.throws(() => buzz.parseTotal({}));
  const u = new URL(buzz.url('artificial intelligence', '2026-07-01', '2026-09-30'));
  assert.equal(u.searchParams.get('q'), '"artificial intelligence"');
  assert.equal(u.searchParams.get('forms'), '10-Q');
  const rows = qs.map((q, i) => ({ ...q, ai: { count: 100 + i }, tariff: { count: 50 }, recession: { count: 20 } }));
  rows[7].ai = { count: 1743 };
  const g = buzz.build(rows, NOW);
  assert.equal(g.headline, '1,743 AI FILINGS');
  assert.equal(g.line, '10-Qs naming AI, Q3 2026 so far');
  // Early in a quarter the last full quarter is the headline.
  const early = buzz.quarters(Date.parse('2026-10-05T00:00:00Z'));
  const eg = buzz.build(early.map((q) => ({ ...q, ai: { count: q.key === '2026-Q3' ? 1800 : 5 }, tariff: { count: 1 }, recession: { count: 1 } })), Date.parse('2026-10-05T00:00:00Z'));
  assert.equal(eg.quarter, 'Q3 2026');
  assert.equal(eg.headline, '1,800 AI FILINGS');
  assert.throws(() => buzz.build([{ ...qs[0], ai: null }], NOW), noData);
});

test('buzz: the search URL uses %20, never an end date past today', () => {
  const today = Date.parse('2026-09-26T04:30:00Z');
  assert.equal(buzz.url('artificial intelligence', '2026-07-01', '2026-09-30', today),
    'https://efts.sec.gov/LATEST/search-index?q=%22artificial%20intelligence%22&forms=10-Q&dateRange=custom&startdt=2026-07-01&enddt=2026-09-26');
  // A past quarter keeps its own end date.
  const past = new URL(buzz.url('tariff', '2026-04-01', '2026-06-30', today));
  assert.equal(past.searchParams.get('enddt'), '2026-06-30');
  assert.equal(past.searchParams.get('q'), '"tariff"');
  // On the last day of a quarter the end date is that day.
  assert.match(buzz.url('recession', '2026-07-01', '2026-09-30', Date.parse('2026-09-30T23:00:00Z')), /enddt=2026-09-30$/);
  assert.doesNotMatch(buzz.url('artificial intelligence', '2026-07-01', '2026-09-30', today), /\+/);
});

test('buzz: a search that fails twice shows as --, the rest still load', async () => {
  const calls = new Map();
  const get = {
    json: async (u) => {
      calls.set(u, (calls.get(u) || 0) + 1);
      const q = new URL(u).searchParams;
      if (q.get('startdt') === '2026-01-01' && q.get('q') === '"recession"') throw new Error('efts.sec.gov HTTP 500');
      if (q.get('startdt') === '2025-07-01' && q.get('q') === '"tariff"' && calls.get(u) === 1) throw new Error('efts.sec.gov HTTP 500');
      return { hits: { total: { value: q.get('q') === '"artificial intelligence"' ? 1743 : 900, relation: 'eq' } } };
    },
  };
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  let g;
  try {
    g = await buzz.load(get, { now: () => NOW, retryWait: 0 });
  } finally {
    console.error = orig;
  }
  assert.equal(g.headline, '1,743 AI FILINGS');
  const q1 = g.rows.find((r) => r.key === '2026-Q1');
  assert.equal(q1.recession, null, 'the failed search is null (-- on screen)');
  assert.equal(q1.ai, 1743);
  assert.equal(g.rows.find((r) => r.key === '2025-Q3').tariff, 900, 'a 500 is retried once');
  assert.equal(g.rows.length, 8);
  assert.match(errs.join('\n'), /1 of 24 searches failed/);
  // Every search failing is an error, so the last good value is served.
  await assert.rejects(buzz.load({ json: async () => { throw new Error('efts.sec.gov HTTP 500'); } }, { now: () => NOW, retryWait: 0 }), /every search failed/);
  // No AI count for the headline quarter: the newest earlier one with a count.
  const qs = buzz.quarters(NOW);
  const rows = qs.map((q) => ({ ...q, ai: { count: 5 }, tariff: { count: 1 }, recession: null }));
  rows[7].ai = null;
  rows[6].ai = null;
  const hg = buzz.build(rows, NOW);
  assert.equal(hg.quarter, 'Q1 2026');
  assert.deepEqual(hg.spark.slice(-3), [5, null, null]);
});

test('beige: the edition list, article text only, and whole-word counts', () => {
  const eds = beige.parseEditions(fx('beige-index.html'), NOW);
  assert.deepEqual(eds.slice(0, 8).map((e) => e.edition), ['202608', '202607', '202605', '202604', '202602', '202601', '202511', '202510']);
  // The id is not the release month: the August 2026 edition came out on September 2.
  assert.deepEqual(eds[0], { edition: '202608', released: '2026-09-02' });
  assert.equal(eds[1].released, '2026-07-15');
  assert.equal(eds[6].released, null, 'no PDF on the index row: read from the summary page');
  assert.equal(beige.pdfDate(fx('beige-202510-summary-pdf.html')), '2025-10-15');
  assert.equal(beige.pdfDate('<a href="x.pdf">'), null);
  // On Sep 1 the edition released Sep 2 is not out yet; on Jul 10, neither is 202607 (Jul 15).
  assert.equal(beige.parseEditions(fx('beige-index.html'), Date.parse('2026-09-01T12:00:00Z'))[0].edition, '202607');
  assert.ok(!beige.parseEditions(fx('beige-index.html'), Date.parse('2026-07-10T00:00:00Z')).some((e) => e.edition === '202607'));
  const text = beige.articleText(fx('beige-202608-summary.html'));
  assert.match(text, /^National Summary/);
  assert.doesNotMatch(text, /menu|footer/i, 'navigation and footer are not counted');
  assert.deepEqual(beige.countWords(text), { uncertain: 3, tariff: 1, slow: 1, recession: 0, ai: 1 });
  assert.deepEqual(beige.countWords('Tariffs and a tariff; uncertainty, uncertain. Slowed, slowly, slowdown; AI, ai, Artificial Intelligence, recessionary, recessions, rain.'),
    { uncertain: 2, tariff: 2, slow: 3, recession: 2, ai: 2 });
  assert.equal(beige.countWords('Tariffing sidewalk AIR said Brazil').tariff, 0);
  const g = beige.build([
    { edition: '202608', released: '2026-09-02', counts: { uncertain: 29, tariff: 24, slow: 38, recession: 1, ai: 25 } },
    { edition: '202607', released: '2026-07-15', counts: { uncertain: 34, tariff: 24, slow: 22, recession: 1, ai: 19 } },
  ]);
  assert.equal(g.headline, 'SLOW 38 TIMES');
  assert.deepEqual(g.spark, [22, 38]);
  assert.equal(g.asOf, '2026-09-02');
  const gauge = WEIRD_GAUGES.find((x) => x.id === 'beige');
  assert.match(tileBody(gauge, { id: 'beige', ok: true, stale: false, ...g }), /FEDERAL RESERVE · SEP 02|Federal Reserve · SEP 02/);
  const html = gauge.detail(g).html;
  assert.match(html, /Sep 2, 2026/);
  assert.doesNotMatch(html, /AUG 2026/);
  assert.throws(() => beige.articleText('<html>no article</html>'));
  assert.throws(() => beige.build([]), noData);
});

test('sick: national median wastewater level per virus, with the 4-week change', () => {
  const g = sick.build(sick.parse(fxj('cdc-wval.json')));
  const covid = g.rows[0];
  // Sep 19 had 820 sites and Sep 12 929, against 1,086 in a full week: both are thin, so
  // the newest week with 90% of a full week is Sep 5 (1,074 sites).
  assert.equal(covid.week, '2026-09-05');
  assert.equal(covid.sites, 1074);
  assert.equal(g.headline, 'COVID 2.7');
  assert.equal(covid.points[covid.points.length - 1].week, '2026-09-05', 'thin weeks are not charted');
  const s = (n) => ({ week: `w${n}`, level: 1, sites: n });
  assert.equal(sick.settledIndex([s(1000), s(1000), s(950), s(600)]), 2);
  assert.equal(sick.settledIndex([s(1000), s(899)]), 0);
  assert.equal(sick.settledIndex([s(1000), s(900)]), 1);
  assert.equal(covid.label, 'COVID');
  assert.equal(g.asOf, covid.week);
  assert.equal(g.headline, `COVID ${covid.level.toFixed(1)}`);
  assert.equal(g.rows.length, 3);
  assert.ok(g.rows.every((r) => Number.isFinite(r.level)));
  assert.ok(covid.points.length <= 26);
  const u = new URL(sick.url(NOW));
  assert.match(u.searchParams.get('$select'), /median\(site_wval\)/);
  assert.throws(() => sick.parse({ message: 'bad query' }), /bad query/);
  assert.throws(() => sick.build({}), noData);
});

test('macau: the latest month against a year before, from the DICJ report', () => {
  const r26 = macau.parse(fx('dicj-2026.xml'));
  assert.equal(r26.year, 2026);
  assert.equal(r26.months.length, 12);
  assert.equal(r26.months[7].value, 21891);
  assert.equal(r26.months[8].value, null, 'September is not out yet');
  const g = macau.build([r26, macau.parse(fx('dicj-2025.xml'))]);
  assert.equal(g.month, '2026-08');
  assert.ok(Math.abs(g.yoy - (21891 / 22156 - 1) * 100) < 1e-9);
  assert.equal(g.headline, '−1.2% YOY');
  assert.equal(g.rows.length, 13);
  assert.equal(g.rows[12].month, '2025-08');
  assert.ok(g.spark.length >= 20);
  // In January the new year's report is empty: the old one still gives December.
  const jan = macau.build([{ ...r26, months: r26.months.map((m) => ({ ...m, value: null, prev: null })) }, macau.parse(fx('dicj-2025.xml'))]);
  assert.equal(jan.month, '2025-12');
  assert.throws(() => macau.parse('<html>moved</html>'));
});

test('source helpers: pool keeps order and stops on failure; entities decode', async () => {
  const seen = [];
  const out = await pool([1, 2, 3, 4, 5], 2, async (x) => { seen.push(x); await new Promise((r) => setTimeout(r, 5)); return x * 2; }, 1);
  assert.deepEqual(out, [2, 4, 6, 8, 10]);
  await assert.rejects(pool([1, 2, 3], 1, async (x) => { if (x === 2) throw new Error('boom'); return x; }), /boom/);
  assert.equal(decodeEntities('S&amp;P &#39;500&#x27; &lt;b&gt;'), "S&P '500' <b>");
});

test('every new tile escapes source text', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const cases = {
    billions: billions.build({ people: [{ name: evil, last: evil, rank: 1, worth: 2000, prev: 1000 }], asOf: null, size: 1 }),
    odds: odds.build({ recession: { question: evil, pct: 5 }, fed: { title: evil, outcomes: [{ question: evil, pct: 5 }] } }, NOW),
    rides: rides.build([{ park: { name: evil, resort: evil }, rides: [{ name: evil, open: true, wait: 20 }] }]),
    wsb: wsb.build([{ rank: 1, ticker: 'SPY', name: evil, mentions: 3, rankAgo: null }], NOW),
  };
  for (const [id, g] of Object.entries(cases)) {
    const gauge = WEIRD_GAUGES.find((x) => x.id === id);
    const html = tileBody(gauge, { id, ok: true, ...g }) + gauge.detail({ id, ok: true, ...g }).html;
    assert.doesNotMatch(html, /<img/, id);
  }
});

test('3a fixes: canal drops repeated dates; last good is read from disk once', () => {
  const day = (date, n) => ({ attributes: { portid: 'chokepoint6', date, n_total: n, n_tanker: 0 } });
  const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
  const body = { features: [...dates.map((d) => day(d, 7)), day('2026-09-20', 7)] };
  const daily = canal.parseDaily(body);
  assert.equal(daily.chokepoint6.length, 7);
  assert.equal(canal.week7(daily.chokepoint6, '2026-09-20'), 7);

  const dir = mkdtempSync(path.join(tmpdir(), 'weird-lg-'));
  try {
    writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ fetchedAt: 1, value: { headline: 'A' } }));
    const store = lastGoodStore(dir);
    assert.equal(store.read('x').value.headline, 'A');
    writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ fetchedAt: 2, value: { headline: 'CHANGED ON DISK' } }));
    assert.equal(store.read('x').value.headline, 'A', 'second read comes from memory');
    store.write('x', { headline: 'B' }, 3);
    assert.equal(store.read('x').value.headline, 'B');
    assert.equal(store.read('none'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WEIRD: 12 and Enter opens gauge 12 (WSB), not the tile maximised; a bare digit stays typing', () => {
  const html = tile(WEIRD_GAUGES[11], 11);
  assert.match(html, /data-cmd="WSB"/);
  assert.match(html, /data-num="12"/);
  assert.doesNotMatch(html, /data-key=/, 'no instant key: 1 then 2 must type 12');
  // The command bar's resolver: the numbered item comes before any panel to maximise.
  const tiles = WEIRD_GAUGES.map((g, i) => ({ num: String(i + 1), cmd: g.command }));
  const root = { querySelector: (sel) => {
    const m = /^\[data-num="(\d+)"\]$/.exec(sel);
    return m ? tiles.find((t) => t.num === m[1]) || null : null;
  } };
  assert.equal(numberedItem(root, panelNumberInput('12')).cmd, 'WSB');
  assert.equal(numberedItem(root, panelNumberInput('23')).cmd, 'MACAU');
  assert.equal(numberedItem(root, 24), null);
  const src = readFileSync('public/app.js', 'utf8');
  assert.match(src, /const item = numberedItem\(screen, n\);\s+if \(item \|\| maximize\(String\(n\)\)\)/);
});

test('WEIRD follows the phase 1 status rules: the clock dot, and a status line only for NO DATA', () => {
  const src = readFileSync('public/screens/weird.js', 'utf8');
  assert.doesNotMatch(src, /statusLine|TYPE A NUMBER|GAUGES`|UPDATED/, 'no clock text or hint in the status line');
  assert.equal((src.match(/ctx\.updated\(d\.updated, d\.stale\)/g) || []).length, 2, 'grid and gauge both set the dot');
  assert.match(src, /ctx\.status\(bad \? `\$\{bad\} NO DATA` : '', bad \? 'warn' : ''\)/);
});

test('WEIRD summary is stale only when every gauge with a value is a last good one', async () => {
  const mk = (id, stale) => ({ id, source: id, ttl: 1, load: async () => { if (stale) throw new Error('down'); return { headline: 'OK' }; } });
  const w = makeWeird({ gauges: [mk('a', false), mk('b', true)], lastGoodDir: null });
  const s = await w.getWeird({ wait: 500 });
  assert.equal(s.stale, false);
});

test('no WEIRD command or alias is a US ticker (SEC lists checked Sep 26 2026)', () => {
  // Names under 6 letters could be tickers; each short one here was checked against the
  // SEC company_tickers.json and company_tickers_mf.json (funds and ETFs) and is not one.
  // BUZZ, ODDS and EGGS are ETF tickers and EGG a stock, so those gauges are BUZZWORD,
  // CHANCES and EGGPRICE.
  const CHECKED_SHORT = ['WEIRD', 'CANAL', 'SHIPS', 'PIZZA', 'DEGEN', 'PANIC', 'OMENS', 'MOON', 'WSB', 'RIDES', 'BEIGE', 'BOXES', 'SICK', 'MACAU'];
  const names = REGISTRY.filter((c) => c.category === 'Weird data').flatMap((c) => [c.name, ...(c.aliases || [])]);
  for (const n of names) if (n.length < 6) assert.ok(CHECKED_SHORT.includes(n), `${n} is short: check it against the SEC ticker lists`);
  for (const t of ['BUZZ', 'ODDS', 'EGGS', 'EGG']) {
    assert.ok(!names.includes(t), t);
    assert.equal(parseCommand(t).name, 'QUOTE', `${t} opens the ticker`);
  }
  assert.equal(parseCommand('BUZZWORD').name, 'BUZZWORD');
  assert.equal(parseCommand('CHANCES').name, 'CHANCES');
  assert.equal(parseCommand('EGGPRICE').name, 'EGGPRICE');
  assert.equal(commandForNumber('13'), 'CHANCES');
});

test('pool: never more than `limit` at once, starts spaced by at least `gapMs`', async () => {
  let running = 0;
  let peak = 0;
  const starts = [];
  await pool([1, 2, 3, 4, 5, 6], 2, async () => {
    starts.push(Date.now());
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 30));
    running -= 1;
  }, 20);
  assert.equal(peak, 2);
  for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] - starts[i - 1] >= 18, `gap ${starts[i] - starts[i - 1]} ms`);
  let calls = 0;
  await assert.rejects(pool([1, 2, 3, 4, 5], 1, async (x) => { calls += 1; if (x === 2) throw new Error('stop'); }, 0), /stop/);
  assert.equal(calls, 2, 'no new work after a failure');
});

test('the disclaimer names every WEIRD source', () => {
  const md = readFileSync('legal/disclaimer.md', 'utf8');
  const line = md.split('\n').find((l) => l.startsWith('- WEIRD gauges:'));
  assert.ok(line);
  for (const s of ['IMF PortWatch', 'pizzint.watch', 'Apple App Store', 'NHC', 'OpenStreetMap (ODbL)', 'Wikimedia', 'Hacker News (Algolia)', 'FRED', 'NWS', 'NOAA SWPC', 'BLS',
    'The Economist (CC BY 4.0)', 'Forbes', 'ApeWisdom', 'Polymarket', 'Drewry', 'Queue-Times.com', 'SEC EDGAR', 'the Federal Reserve', 'CDC', 'DICJ Macau']) assert.ok(line.includes(s), s);
});
