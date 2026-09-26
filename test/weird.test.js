// WEIRD gauges: parsers on trimmed live fixtures (test/fixtures/weird, captured Sep 26
// 2026), the maths (moon, haversine, hot dog), and NO DATA when a source fails. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as canal from '../data/weird/canal.js';
import * as pizza from '../data/weird/pizza.js';
import * as degen from '../data/weird/degen.js';
import * as waffle from '../data/weird/waffle.js';
import * as panic from '../data/weird/panic.js';
import * as hiring from '../data/weird/hiring.js';
import * as hotdog from '../data/weird/hotdog.js';
import * as omens from '../data/weird/omens.js';
import * as undies from '../data/weird/undies.js';
import * as bigmac from '../data/weird/bigmac.js';
import { truePhase, lunation, moonPhase } from '../data/weird/moon.js';
import { makeWeird, GAUGES, gaugeById, summarize } from '../data/weird/index.js';
import { parseFredCsv } from '../data/economy.js';
import { UA, signedPct, sourceClient, MAX_BYTES } from '../data/weird/source.js';
import { tileBody } from '../public/screens/weird.js';
import { CPI_RETRY_MS } from '../data/cpi.js';
import { WEIRD_GAUGES } from '../public/screens/weird-gauges.js';
import { findCommand } from '../public/registry.js';
import { parseCommand } from '../public/app.js';

const fx = (f) => readFileSync(new URL(`./fixtures/weird/${f}`, import.meta.url), 'utf8');
const fxj = (f) => JSON.parse(fx(f));

test('canal: Hormuz 7-day average against the 1-year average, plus the latest day', () => {
  const asOf = canal.latestDate(fxj('canal-top.json'));
  assert.equal(asOf, '2026-09-20');
  const daily = canal.parseDaily(fxj('canal-daily.json'));
  const avgs = canal.parseAverages(fxj('canal-avg.json'));
  assert.equal(Object.keys(avgs).length, 6);
  const g = canal.build(daily, avgs, asOf);
  // Sep 14 to 20: 2, 2, 1, 3, 7, 6, 1 ships -> 22 / 7 = 3.14.
  assert.ok(Math.abs(g.rows[0].week - 22 / 7) < 1e-9);
  assert.equal(g.headline, 'HORMUZ 3 SHIPS/DAY');
  assert.match(g.line, /^7-day average; 1-year average \d+$/);
  assert.equal(g.rows[0].name, 'Hormuz');
  assert.equal(g.rows[0].total, 1);
  assert.equal(g.rows[0].tanker, 0);
  assert.ok(g.rows[0].avgTotal > 20 && g.rows[0].avgTotal < 60, String(g.rows[0].avgTotal));
  assert.ok(Math.abs(g.rows[0].vsAvg - ((22 / 7) / g.rows[0].avgTotal - 1) * 100) < 1e-9);
  assert.equal(canal.week7([{ date: '2026-09-20', total: 5 }], '2026-09-20'), null, 'fewer than 7 days: no average');
  assert.throws(() => canal.build({}, avgs, asOf), (e) => e.code === 'no_data');
  assert.equal(g.rows.find((r) => r.name === 'Suez').total, 42);
  assert.ok(g.spark.length >= 2);
  assert.throws(() => canal.parseDaily({ error: { message: 'Invalid query' } }), /Invalid query/);
});

test('pizza: the data URL carries the same 30-second cache-buster as the site', () => {
  assert.equal(pizza.dataUrl(Date.parse('2026-09-26T05:51:31.535Z')), 'https://www.pizzint.watch/api/dashboard-data?_t=1790401890000');
});

test('pizza: an empty feed is NO DATA, a full one parses', () => {
  assert.throws(() => pizza.parse(fxj('pizza-empty.json')), (e) => e.code === 'no_data');
  const p = pizza.parse({
    success: true, overall_index: 42, defcon_level: 4, active_spikes: 1, timestamp: '2026-09-26T02:17:42.784Z',
    data: [{ name: 'Dominos Pizza', current_popularity: 80, percentage_of_usual: 160, is_spike: true }],
  });
  const g = pizza.build(p);
  assert.equal(g.headline, 'DEFCON 4');
  assert.equal(g.places[0].vsUsual, 160);
  assert.equal(g.credit, 'pizzint.watch');
});

test('degen: ranks in the top 100, or not in it', () => {
  const g = degen.build(degen.parse(fxj('degen.json')));
  const by = Object.fromEntries(g.apps.map((a) => [a.name, a.rank]));
  assert.equal(by.Kalshi, 12);
  assert.equal(by.Polymarket, 25);
  assert.equal(by.Robinhood, null);
  assert.equal(g.headline, 'KALSHI #12');
  assert.equal(g.size, 100);
  assert.equal(degen.build({ apps: [{ name: 'Kalshi', rank: null }], size: 100, asOf: null }).headline, 'NONE IN TOP 100');
  assert.throws(() => degen.parse({ feed: { results: [] } }));
});

test('waffle: haversine, bearings and quadrant radii', () => {
  // Atlanta to New York, about 748 miles.
  const d = waffle.haversine(33.749, -84.388, 40.7128, -74.006);
  assert.ok(Math.abs(d - 748) < 5, String(d));
  assert.equal(waffle.haversine(30, -90, 30, -90), 0);
  // One degree of latitude is about 69.1 miles.
  assert.ok(Math.abs(waffle.haversine(30, -90, 31, -90) - 69.1) < 0.2);
  assert.ok(Math.abs(waffle.bearing(30, -90, 31, -90) - 0) < 0.01);
  assert.ok(Math.abs(waffle.bearing(30, -90, 30, -89) - 90) < 1);
  assert.equal(waffle.quadrantOf(45), 'NE');
  assert.equal(waffle.quadrantOf(135), 'SE');
  assert.equal(waffle.quadrantOf(225), 'SW');
  assert.equal(waffle.quadrantOf(315), 'NW');

  const radii = waffle.parseRadii(fx('nhc-advisory-fay.txt'));
  // 34 KT....... 30NE 0SE 0SW 60NW (nautical miles), in miles; not the forecast lines.
  assert.deepEqual(radii, { NE: 35, SE: 0, SW: 0, NW: 69 });
  assert.equal(waffle.parseRadii('MAX SUSTAINED WINDS  30 KT WITH GUSTS TO  40 KT.\nREPEAT...CENTER'), null);

  // A storm at a point: stores 20 miles north count only if the NE/NW radius reaches.
  const storm = { lat: 30, lon: -90 };
  const stores = [[30.29, -90], [29.71, -90]];
  assert.equal(waffle.storesInside(storm, { NE: 25, SE: 0, SW: 0, NW: 25 }, stores), 1);
  assert.equal(waffle.storesInside(storm, 25, stores), 2);
  assert.equal(waffle.storesInside(storm, 10, stores), 0);
});

test('waffle: far storms count zero; no radius counts zero; a failed advisory is unknown, never guessed', async () => {
  const storms = waffle.parseStorms(fxj('nhc-storms.json'));
  assert.equal(storms.length, 5);
  let fetched = 0;
  const rows = await Promise.all(storms.map((s) => waffle.stormRow(s, async () => { fetched += 1; return ''; })));
  assert.equal(fetched, 0, 'every storm on Sep 26 was far from any store');
  const g = waffle.build(rows, '2026-09-26T04:00:00Z');
  assert.equal(g.headline, '0 STORES IN STORMS');
  assert.equal(g.credit, '© OpenStreetMap contributors, ODbL');
  assert.equal(g.partial, false);
  assert.ok(waffle.STORES.length > 1500);
  assert.ok(waffle.STORES.every(([lat, lon]) => lat >= 24.3 && lat <= 49.5 && lon >= -125 && lon <= -66.9), 'contiguous US only');

  const url = 'https://www.nhc.noaa.gov/text/MIATCMAT1.shtml';
  const atl = { id: 'x', name: 'Test', lat: 33.75, lon: -84.39, advisoryUrl: url };
  // The advisory would not load: stores unknown (null), no guessed circle.
  const down = await waffle.stormRow(atl, async () => { throw new Error('down'); });
  assert.equal(down.radiusFrom, 'error');
  assert.equal(down.stores, null);
  assert.throws(() => waffle.build([down], 'x'), (e) => e.code === 'no_data', 'only unknown near storms: NO DATA');
  // A depression: the advisory has no 34 kt line, so zero.
  const td = await waffle.stormRow(atl, async () => 'MAX SUSTAINED WINDS  30 KT WITH GUSTS TO  40 KT.\nREPEAT...CENTER');
  assert.equal(td.radiusFrom, 'none');
  assert.equal(td.stores, 0);
  // Radii from a real advisory text, centred on Atlanta.
  const ts = await waffle.stormRow(atl, async () => fx('nhc-advisory-fay.txt'));
  assert.equal(ts.radiusFrom, 'nhc');
  assert.equal(ts.radius, 69);
  assert.ok(ts.stores > 0);
  // One counted, one unknown: a partial count, clearly marked.
  const mixed = waffle.build([ts, { ...down, id: 'y' }], 'x');
  assert.equal(mixed.partial, true);
  assert.match(mixed.headline, /IN STORMS \(PARTIAL\)$/);
  // Only NHC advisory links are fetched.
  let asked = 0;
  const odd = await waffle.stormRow({ ...atl, advisoryUrl: 'https://evil.test/x' }, async () => { asked += 1; return ''; });
  assert.equal(asked, 0);
  assert.equal(odd.radiusFrom, 'error');
  assert.equal(waffle.advisoryAllowed(url), true);
  assert.equal(waffle.advisoryAllowed('http://www.nhc.noaa.gov/x'), false);
});

test('panic: latest day against the 30 days before, per article and in total', () => {
  const rec = panic.parse(fxj('wiki-recession.json'));
  assert.equal(rec.length, 40);
  assert.match(rec[0].date, /^\d{4}-\d{2}-\d{2}$/);
  const scaled = (k) => rec.map((p) => ({ date: p.date, views: p.views * k }));
  const g = panic.build({ Recession: rec, Stock_market_crash: scaled(2), Stagflation: scaled(1), Bank_run: scaled(1) });
  const v = panic.vsAverage(rec.map((p) => p.views));
  assert.ok(Math.abs(g.pct - v.pct) < 1e-9, 'same shape, same % change');
  assert.equal(g.articles.length, 4);
  assert.equal(g.asOf, '2026-09-25');
  assert.equal(g.headline, signedPct(v.pct, 0));
  assert.equal(panic.vsAverage([1, 1, 1], 30), null);
  assert.throws(() => panic.build({ Recession: rec.slice(0, 10), Stock_market_crash: [], Stagflation: [], Bank_run: [] }), (e) => e.code === 'no_data');
  assert.match(panic.url('Bank_run', Date.UTC(2026, 8, 26)), /Bank_run\/daily\/2026052\d\/20260925$/);
});

test('hiring: seekers per job post by month', () => {
  assert.deepEqual(hiring.classify('Ask HN: Who is hiring? (September 2026)'), { kind: 'hiring', month: '2026-09' });
  assert.deepEqual(hiring.classify('Ask HN: Who wants to be hired? (August 2026)'), { kind: 'seeking', month: '2026-08' });
  assert.equal(hiring.classify('Ask HN: Freelancer? Seeking freelancer? (September 2026)'), null);
  const months = hiring.parse(fxj('hn-whoishiring.json'));
  assert.equal(months[0].month, '2026-09');
  assert.equal(months[0].hiring, 397);
  assert.equal(months[0].seeking, 575);
  const g = hiring.build(months, Date.parse('2026-09-26T00:00:00Z'));
  assert.equal(g.headline, '1.45 PER JOB');
  assert.equal(g.month, '2026-09');
  // Three days after the September threads: too fresh, so August is the headline.
  const early = hiring.build(months, Date.parse('2026-09-04T00:00:00Z'));
  assert.equal(early.month, '2026-08');
  assert.equal(early.headline, `${(564 / 379).toFixed(2)} PER JOB`);
  assert.throws(() => hiring.build([]), (e) => e.code === 'no_data');
});

test('hotdog: $1.50 x latest CPI / 1985 average CPI', () => {
  assert.equal(hotdog.adjusted(200, 100), 3);
  assert.ok(Math.abs(hotdog.adjusted(107.6, 107.6) - 1.5) < 1e-12);
  const obs = parseFredCsv(fx('fred-cpiaucsl.csv'));
  const annual = hotdog.annualAverages(obs);
  assert.ok(Math.abs(annual[1985] - 107.6) < 0.2, String(annual[1985]));
  const g = hotdog.build(obs);
  assert.equal(g.cpiNow, 334.131);
  assert.ok(Math.abs(g.price - (1.5 * 334.131) / annual[1985]) < 1e-9);
  assert.equal(g.headline, `$${g.price.toFixed(2)}`);
  assert.equal(g.headline, '$4.66');
  assert.throws(() => hotdog.build(obs.filter((o) => !o.date.startsWith('1985'))), (e) => e.code === 'no_data');
});

test('moon: new and full moons of 2026 within minutes of the published times', () => {
  const near = (ms, iso, minutes = 15) => assert.ok(Math.abs(ms - Date.parse(iso)) < minutes * 60_000, `${new Date(ms).toISOString()} vs ${iso}`);
  const at = (iso) => lunation(Date.parse(iso));
  // Eclipse days: annular Feb 17, total solar Aug 12 (new); total lunar Mar 3, partial Aug 28 (full).
  near(at('2026-02-18T00:00:00Z').prev, '2026-02-17T12:01:00Z');
  near(at('2026-08-13T00:00:00Z').prev, '2026-08-12T17:37:00Z');
  near(truePhase(at('2026-03-01T00:00:00Z').k + 0.5), '2026-03-03T11:38:00Z');
  near(truePhase(at('2026-08-20T00:00:00Z').k + 0.5), '2026-08-28T04:18:00Z');
  assert.equal(moonPhase(Date.parse('2026-09-26T12:00:00Z')).name, 'Full moon');
  assert.equal(moonPhase(Date.parse('2026-08-12T20:00:00Z')).name, 'New moon');
  assert.equal(moonPhase(Date.parse('2026-09-15T00:00:00Z')).name, 'Waxing crescent');
  assert.equal(moonPhase(Date.parse('2026-10-03T00:00:00Z')).name, 'Last quarter');
  const lit = moonPhase(Date.parse('2026-09-26T16:50:00Z')).lit;
  assert.ok(lit > 0.99);
});

test('omens: sky and sunspots parse; the moon shows even when both feeds fail', () => {
  const sky = omens.parseSky(fxj('nws-knyc.json'));
  assert.equal(sky.text, 'Light Rain');
  const sun = omens.parseSunspots(fxj('swpc-sunspots.json'));
  assert.equal(sun[sun.length - 1].month, '2026-08');
  assert.equal(sun[sun.length - 1].ssn, 76);
  const t = Date.parse('2026-09-26T12:00:00Z');
  const g = omens.build({ moon: moonPhase(t), sky: null, sun: null, now: t });
  assert.equal(g.headline, 'FULL MOON');
  assert.equal(g.sky, null);
  assert.equal(g.sunspots, null);
  assert.throws(() => omens.parseSky({ properties: { textDescription: '', temperature: { value: null } } }));
});

test('undies: year-on-year and month-on-month from BLS', () => {
  const rows = undies.parse(fxj('bls-undies.json'));
  const g = undies.build(rows);
  assert.equal(g.month, '2026-08');
  assert.equal(g.index, 194.315);
  const aug25 = rows.find((r) => r.month === '2025-08').value;
  assert.ok(Math.abs(g.yoy - (194.315 / aug25 - 1) * 100) < 1e-9);
  assert.ok(Math.abs(g.mom - (194.315 / 194.91 - 1) * 100) < 1e-9);
  assert.match(g.headline, /^[+−]?\d+\.\d% YOY$/);
  assert.throws(() => undies.parse({ status: 'REQUEST_NOT_PROCESSED', message: ['daily threshold'] }), /threshold/);
});

test('bigmac: latest date, most over and under valued against the dollar', () => {
  const p = bigmac.parse(fx('bigmac.csv'));
  assert.equal(p.latest, '2026-07-01');
  const g = bigmac.build(p);
  assert.equal(g.over[0].name, 'Switzerland');
  assert.equal(g.headline, 'SWITZERLAND +45%');
  assert.equal(g.under[0].name, 'India');
  assert.equal(g.usPrice, 6.22);
  assert.deepEqual(g.usPrices.map((x) => x.price), [6.01, 6.22]);
  assert.ok(!g.rows.some((r) => r.iso3 === 'USA'));
  assert.equal(g.credit, 'The Economist, CC BY 4.0');
});

test('a failed or empty source gives NO DATA with the source name, never a guess', async () => {
  const w = makeWeird({ fetchImpl: async () => { throw new Error('offline'); }, lastGoodDir: null });
  const one = await w.getGauge('canal');
  assert.deepEqual(one, { id: 'canal', ok: false, headline: 'NO DATA', source: 'IMF PortWatch' });
  assert.equal(await w.getGauge('nope'), null);
  const all = await w.getWeird({ wait: 2000 });
  assert.equal(all.gauges.length, GAUGES.length);
  for (const g of all.gauges) {
    if (g.id === 'omens') { assert.equal(g.ok, true, 'the moon needs no source'); continue; }
    if (g.id === 'waffle') continue;
    assert.equal(g.ok, false, g.id);
    assert.equal(g.headline, 'NO DATA');
    assert.ok(g.source, g.id);
  }
  // Waffle needs NHC: its failure is NO DATA too.
  assert.equal(all.gauges.find((g) => g.id === 'waffle').ok, false);

  const empty = makeWeird({ fetchImpl: async () => new Response(fx('pizza-empty.json'), { status: 200 }), lastGoodDir: null });
  assert.equal((await empty.getGauge('pizza')).headline, 'NO DATA');
});

test('summary: slow gauges come back pending, fast ones in full; requests carry our User-Agent', async () => {
  const seen = [];
  const slow = { id: 'slow', source: 'Slow', ttl: 1000, load: () => new Promise((r) => setTimeout(r, 200, { headline: 'LATE' })) };
  const fast = { id: 'fast', source: 'Fast', ttl: 1000, load: async (get) => { await get.json('https://fast.test/x'); return { headline: 'OK', line: 'x', spark: [1, 2], asOf: '2026-09-25', source: 'Fast', extra: [1, 2, 3] }; } };
  const w = makeWeird({ gauges: [slow, fast], lastGoodDir: null, fetchImpl: async (url, opts) => { seen.push(opts.headers['User-Agent']); return new Response('{}'); } });
  const s = await w.getWeird({ wait: 50 });
  assert.equal(s.gauges[0].pending, true);
  assert.equal(s.gauges[1].headline, 'OK');
  assert.equal(s.gauges[1].extra, undefined, 'the summary is compact');
  assert.deepEqual(seen, [UA]);
  assert.equal((await w.getGauge('slow')).headline, 'LATE');
  assert.deepEqual(summarize({ id: 'x', ok: false, headline: 'NO DATA', source: 'S' }), { id: 'x', ok: false, headline: 'NO DATA', source: 'S' });
});

test('every gauge has a command, a screen entry and a registry entry', () => {
  assert.deepEqual(WEIRD_GAUGES.map((g) => g.id), GAUGES.map((g) => g.id));
  for (const g of WEIRD_GAUGES) {
    assert.ok(gaugeById(g.id));
    const r = findCommand(g.command);
    assert.ok(r, g.command);
    assert.equal(r.category, 'Weird data');
    assert.equal(parseCommand(g.command).name, g.command);
    assert.ok(g.method && g.method.length, `${g.id} has a method note`);
  }
  assert.equal(parseCommand('WEIRD').name, 'WEIRD');
  assert.equal(parseCommand('BURGER').name, 'BIGMAC');
});

test('weird copy rules: no banned brand word, no em dashes', () => {
  const files = [
    ...readdirSync('data/weird').filter((f) => f.endsWith('.js')).map((f) => `data/weird/${f}`),
    'public/screens/weird.js', 'public/screens/weird-gauges.js', 'public/commands-weird.js',
  ];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
  }
});

test('sources: bodies over 5 MB are refused, by header or while streaming', async () => {
  const big = 'x'.repeat(MAX_BYTES + 10);
  const declared = sourceClient(async () => new Response('{}', { headers: { 'content-length': String(MAX_BYTES + 1) } }));
  await assert.rejects(declared.text('https://a.test/x'), /over 5 MB/);
  const streamed = sourceClient(async () => new Response(new ReadableStream({
    start(c) { for (let i = 0; i < 6; i += 1) c.enqueue(new TextEncoder().encode('x'.repeat(1024 * 1024))); c.close(); },
  })));
  await assert.rejects(streamed.json('https://a.test/x'), /over 5 MB/);
  const small = sourceClient(async () => new Response('{"a":1}'));
  assert.deepEqual(await small.json('https://a.test/x'), { a: 1 });
  assert.equal(await sourceClient(async () => new Response(big.slice(0, 1000))).text('https://a.test/x'), 'x'.repeat(1000));
  assert.equal(CPI_RETRY_MS, 6 * 60 * 60_000, 'CPI waits 6 hours after a BLS failure');
});

test('last good value: served stale with its own date after a failure or a restart; NO DATA only with none', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'weird-'));
  try {
    let up = true;
    const g = { id: 'pz', source: 'pizzint.watch', ttl: 1, retryMs: 1, load: async () => {
      if (!up) throw Object.assign(new Error('empty'), { code: 'no_data' });
      return { headline: 'DEFCON 4', line: 'x', asOf: '2026-09-25T22:00:00.000Z', source: 'pizzint.watch' };
    } };
    const first = makeWeird({ gauges: [g], lastGoodDir: dir });
    const good = await first.getGauge('pz');
    assert.equal(good.stale, false);
    // A restart (new instance, empty memory) while the source is empty.
    up = false;
    const again = makeWeird({ gauges: [g], lastGoodDir: dir });
    const last = await again.getGauge('pz');
    assert.equal(last.ok, true);
    assert.equal(last.stale, true);
    assert.equal(last.headline, 'DEFCON 4');
    assert.equal(last.asOf, '2026-09-25T22:00:00.000Z');
    assert.equal(last.updated, good.updated);
    const none = makeWeird({ gauges: [{ ...g, id: 'other' }], lastGoodDir: dir });
    assert.equal((await none.getGauge('other')).headline, 'NO DATA');
    // The tile dims it and says when it is from.
    const gauge = WEIRD_GAUGES.find((x) => x.id === 'pizza');
    const html = tileBody(gauge, { ...last, id: 'pizza' });
    assert.match(html, /wd-big is-stale/);
    assert.match(html, /last reading 18:00 ET SEP 25/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('degen: the tile and the detail carry no links and no images', () => {
  const d = { id: 'degen', ok: true, stale: false, ...degen.build(degen.parse(fxj('degen.json'))) };
  assert.ok(!('title' in d.apps[0]), 'app titles are not sent');
  const gauge = WEIRD_GAUGES.find((x) => x.id === 'degen');
  for (const html of [tileBody(gauge, d), gauge.detail(d).html]) {
    assert.doesNotMatch(html, /href/i);
    assert.doesNotMatch(html, /<img/i);
  }
});
