// WHATIF v2: VICES items and their prices, the CPI data, REPLAY maths, SAVE VIDEO
// detection, the shelf picker and the worst-drop date range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  monthlyCost, seriesAt, cpiLoader, replaySeries, resolveTokens, SHELF_WORDS as SERVER_SHELF_WORDS, PER_MONTH,
} from '../data/whatif.js';
import { getWhatif, catalog as liveCatalog } from '../data/whatif-service.js';
import { blsMonths, fredMonths, crossCheck } from '../scripts/build-bls-monthly.js';
import { normalizeWhatif, certModel, DOODLES } from '../data/whatif-cert.js';
import { getCert, whatifPng } from '../lib/og.js';
import {
  planWhatif, shelvesOf, shelfItems, SHELVES, SHELF_WORDS, dropRange, riskLine, dropList, replayHtml, cardHtml, commandFor,
  videoHtml, shareHtml, shareLinks, resultSentence, resultHtml, fmtUsd, niceMonth, niceDay, shortCompany,
  HINDSIGHT_NOTE, RESULT_NOTE, PICKER_INTRO, PICKER_KEYS,
} from '../public/screens/whatif.js';
import { parseMine } from '../public/whatif-mine.js';
import { frameAt, durationMs, scaleOf, isBehind, fmtCounter, labelYs, LINE_KEYS } from '../public/whatif-replay.js';
import {
  videoSupport, recorderType, encoderConfig, videoFilename, timeline, fmtMoney, RACE_FRAMES, HOLD_FRAMES, FPS, VIDEO_NEEDS, CODECS,
  encodeFrames, makeVideo,
} from '../public/whatif-video.js';

const json = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const catalog = json('whatif-products.json');
const prices = json('whatif-prices.json');
const bls = json('bls-monthly.json');
const NOW = new Date('2026-09-27T12:00:00Z');
const VICES = ['beer', 'soda', 'chips', 'betting'];
const item = (id) => catalog.recurring.find((r) => r.id === id);
// Fixed "today" prices, so nothing touches the network.
const LAST = { AAPL: 335.92, SBUX: 93.65, MCD: 236.5, BUD: 78, KO: 87.81, PEP: 128.63, DKNG: 22.02, NFLX: 71.72, PTON: 4.79, TSLA: 377.94 };
const quoteImpl = async (t) => ({ last: LAST[t] ?? 100, asOf: '2026-09-25T20:00:00Z' });
const chartImpl = async () => null;
const screen = (tokens) => getWhatif(tokens, { quoteImpl, chartImpl, risk: true, now: NOW });

// ---- VICES: sources and prices ----------------------------------------------------

test('VICES: each item names its company, ticker and a dated source; the unit price is sourced', () => {
  for (const id of VICES) {
    const r = item(id);
    assert.ok(r, id);
    assert.deepEqual(r.shelves, ['vices'], id);
    assert.match(r.src, /^https:\/\//, id);
    assert.ok(r.company && r.ticker && r.note, id);
    // Either a BLS average price series (with its id in the note) or a set amount.
    if (r.series) {
      assert.ok(bls.series[r.series.id], `${id}: ${r.series.id} is baked`);
      assert.match(r.note, new RegExp(r.series.id), `${id}: the note names the series`);
      assert.equal(r.src, `https://data.bls.gov/timeseries/${r.series.id}`);
    } else {
      assert.deepEqual(r.prices, [{ from: '2020-05', usd: 20 }]);
      assert.match(r.note, /set \$20 a week, not a price/);
    }
  }
  assert.deepEqual(item('bigmac').shelves, ['habits', 'vices'], 'the Big Mac is on both shelves');
  assert.deepEqual([item('beer').ticker, item('soda').ticker, item('chips').ticker, item('betting').ticker], ['BUD', 'KO', 'PEP', 'DKNG']);
  // A six-pack is six 12 oz cans: 4.5 times the 16 oz price.
  assert.equal(item('beer').series.units, 72 / 16);
});

test('VICES: every monthly close is checked against Yahoo, from the first real trading day', () => {
  for (const id of VICES) {
    const r = item(id);
    const m = prices.monthly[r.ticker];
    const keys = Object.keys(m).sort();
    assert.equal(keys[0], r.start, `${id}: starts at ${r.start}`);
    for (const k of keys) {
      const row = m[k];
      assert.equal(row.verified, true, `${r.ticker} ${k}`);
      assert.ok(Math.abs(row.close - row.check) / row.check <= 0.01, `${r.ticker} ${k}: CNBC ${row.close} vs Yahoo ${row.check}`);
      assert.equal(row.date.slice(0, 7), k);
      if (r.listed) assert.ok(row.date >= r.listed, `${r.ticker} ${k}: after the listing`);
    }
    assert.ok(prices.last[r.ticker]?.verified, `${r.ticker}: last close verified`);
  }
  // AB InBev's US listing and DraftKings' first day (press releases, 11 Sep 2009 and 23 Apr 2020).
  assert.equal(item('beer').listed, '2009-09-16');
  assert.equal(item('betting').listed, '2020-04-24');
  assert.equal(prices.monthly.BUD['2009-10'].date, '2009-10-01');
  assert.equal(prices.monthly.DKNG['2020-05'].date, '2020-05-01');
});

test('VICES: split history is known for every new ticker', () => {
  assert.deepEqual(prices.splits.KO, [{ date: '2012-08-13', ratio: '2:1' }]);
  for (const t of ['BUD', 'PEP', 'DKNG']) assert.deepEqual(prices.splits[t], [], t);
});

test('every one-off ticker has checked monthly closes from its first purchase, for REPLAY', () => {
  const firstBuy = {};
  for (const p of catalog.products) {
    const d = prices.buys[p.id].date;
    if (!firstBuy[p.ticker] || d < firstBuy[p.ticker]) firstBuy[p.ticker] = d;
  }
  for (const [t, d] of Object.entries(firstBuy)) {
    const m = prices.monthly[t];
    const keys = Object.keys(m).sort();
    assert.equal(keys[0], d.slice(0, 7), `${t}: from the month of the first purchase`);
    assert.ok(m[keys[0]].date >= d, `${t}: no close from before the first purchase`);
    for (const k of keys) assert.equal(m[k].verified, true, `${t} ${k}`);
  }
  assert.equal(prices.monthly.PTON['2019-09'].date, '2019-09-26', 'no bar from before Peloton listed');
});

test('monthly costs from BLS average prices, and a set amount', () => {
  const v = bls.series.APU0000720111.values;
  assert.equal(monthlyCost(item('beer'), '2020-03', catalog, bls), 4.5 * v['2020-03'] * PER_MONTH.week);
  assert.equal(monthlyCost(item('soda'), '2024-02', catalog, bls), bls.series.APU0000FN1102.values['2024-02'] * 29);
  assert.equal(monthlyCost(item('chips'), '2015-06', catalog, bls), bls.series.APU0000718311.values['2015-06'] * PER_MONTH.week);
  assert.equal(monthlyCost(item('betting'), '2021-01', catalog, bls), 20 * PER_MONTH.week);
  // October 2025 was never published (US government shutdown): September's price holds.
  assert.equal(v['2025-10'], undefined);
  assert.equal(monthlyCost(item('beer'), '2025-10', catalog, bls), monthlyCost(item('beer'), '2025-09', catalog, bls));
  // A month not out yet uses the latest one.
  assert.equal(seriesAt(bls.series.APU0000720111, '2026-09'), v['2026-08']);
  assert.throws(() => monthlyCost(item('beer'), '2020-03', catalog, null), /no APU0000720111 price/);
});

test('VICES results from baked prices', async () => {
  for (const t of ['BEER', 'SODA:3Y', 'CHIPS:2010-2015', 'BETTING']) {
    const d = await screen([t]);
    assert.equal(d.rows.length, 1, t);
    assert.ok(d.total.paid > 0 && d.total.value > 0, t);
  }
  const b = await screen(['BETTING']);
  assert.equal(b.rows[0].from, '2021-10', 'default 5 years');
  const soda = await screen(['SODA:10Y']);
  assert.equal(soda.rows[0].from, '2018-04');
  assert.equal(soda.rows[0].clamped, true);
  assert.equal(soda.rows[0].startNote, 'Starts April 2018, when the BLS price series starts.');
});

// ---- CPI -------------------------------------------------------------------------

test('CPI loader: monthly CPI-U from BLS, checked against FRED', () => {
  const cpi = cpiLoader(bls);
  assert.equal(bls.series.CUUR0000SA0.fred, 'CPIAUCNS');
  assert.equal(cpi.first, '2007-01');
  assert.equal(cpi.last, '2026-08');
  // Values seen in both BLS and FRED on 27 Sep 2026.
  assert.equal(cpi.at('2014-09'), 238.031);
  assert.equal(cpi.at('2026-08'), 334.98);
  assert.equal(cpi.at('2025-10'), cpi.at('2025-09'), 'the missing month keeps the one before');
  assert.equal(cpi.at('2027-01'), cpi.at('2026-08'), 'a month not out yet uses the latest');
  assert.equal(cpi.at('2000-01'), cpi.at('2007-01'));
  assert.throws(() => cpiLoader({ series: {} }), /CPI data missing/);
  // No other gap: every month from the first to the last, except October 2025.
  for (const s of Object.values(bls.series)) {
    const keys = Object.keys(s.values).sort();
    let [y, m] = keys[0].split('-').map(Number);
    const missing = [];
    for (;;) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      if (k > keys[keys.length - 1]) break;
      if (!(k in s.values)) missing.push(k);
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
    assert.deepEqual(missing, ['2025-10'], s.name);
  }
});

test('BLS build: parses both sources and stops on a mismatch or a missing month', () => {
  const body = {
    status: 'REQUEST_SUCCEEDED',
    Results: { series: [{ seriesID: 'X', data: [{ year: '2020', period: 'M02', value: '2.5' }, { year: '2020', period: 'M13', value: '9' }, { year: '2020', period: 'M01', value: '2.4' }] }] },
  };
  assert.deepEqual(blsMonths(body), { X: { '2020-02': 2.5, '2020-01': 2.4 } });
  assert.throws(() => blsMonths({ status: 'REQUEST_NOT_PROCESSED' }), /BLS/);
  assert.deepEqual(fredMonths('observation_date,X\n2020-01-01,2.4\n2020-02-01,.\n'), { '2020-01': 2.4 });
  assert.deepEqual(crossCheck('X', { '2020-01': 2.4 }, { '2020-01': 2.4 }, 2020), []);
  assert.equal(crossCheck('X', { '2020-01': 2.4 }, { '2020-01': 2.5 }, 2020).length, 1);
  assert.equal(crossCheck('X', { '2020-01': 2.4 }, {}, 2020).length, 1);
});

// ---- REPLAY maths ------------------------------------------------------------------

// A small world: one stock, prices by hand, CPI up 10% a month.
const FIX = {
  catalog: {
    products: [{ id: 'gizmo', ticker: 'GZM', price: 100 }],
    recurring: [{ id: 'sub', ticker: 'SUB', per: 'month', prices: [{ from: '2020-01', usd: 10 }] }],
  },
  prices: {
    built: '2020-04-02',
    monthly: {
      GZM: { '2020-01': { close: 10 }, '2020-02': { close: 20 }, '2020-03': { close: 5 }, '2020-04': { close: 8 } },
      SUB: { '2020-01': { close: 1 }, '2020-02': { close: 2 }, '2020-03': { close: 4 }, '2020-04': { close: 5 } },
    },
  },
  bls: { series: { CUUR0000SA0: { values: { '2020-01': 100, '2020-02': 110, '2020-03': 121, '2020-04': 133.1 } } } },
};

test('replay: line values at month points, and the last point is the table', () => {
  const now = new Date('2020-04-20T12:00:00Z');
  const sub = { id: 'sub', kind: 'monthly', ticker: 'SUB', from: '2020-01', to: '2020-03', price: 6 };
  // Shares: 10/1 + 10/2 + 10/4 = 17.5; worth 17.5 x 6 = 105.
  sub.shares = 17.5; sub.paid = 30; sub.value = 105;
  const gizmo = { id: 'gizmo', kind: 'once', ticker: 'GZM', bought: '2020-01-15', close: 10, paid: 100, shares: 10, price: 9, value: 90 };
  const result = { rows: [gizmo, sub], total: { paid: 130, value: 195 } };
  const r = replaySeries(result, { ...FIX, now, asOf: '2020-04-17T20:00:00Z' });
  const at = (d) => r.points.find((p) => p.d === d);
  // 1 Jan: the first habit buy; the gizmo is not bought yet.
  assert.deepEqual(at('2020-01-01'), { d: '2020-01-01', stock: 10, jar: 10, spent: 10 });
  // 15 Jan: the gizmo, at its own close (worth what was paid); the habit keeps January's close.
  assert.deepEqual(at('2020-01-15'), { d: '2020-01-15', stock: 110, jar: 110, spent: 110 });
  // 1 Feb: 10 gizmo shares at 20, 15 habit shares at 2; the jar's January dollars lose 10%.
  const feb = at('2020-02-01');
  assert.equal(feb.stock, 230);
  assert.equal(feb.spent, 120);
  assert.equal(feb.jar, Math.round((110 * 100 / 110 + 10) * 100) / 100);
  // 1 Apr: the habit ended in March; shares 17.5 at 5, gizmo 10 at 8.
  const apr = at('2020-04-01');
  assert.equal(apr.stock, 167.5);
  assert.equal(apr.spent, 130);
  // Today: exactly the totals.
  const last = r.points[r.points.length - 1];
  assert.equal(last.d, '2020-04-17');
  assert.equal(last.stock, 195);
  assert.equal(last.spent, 130);
  assert.equal(last.now, true);
  assert.equal(r.cpi.last, '2020-04');
  // Spent never falls; time runs forward.
  for (let i = 1; i < r.points.length; i += 1) {
    assert.ok(r.points[i].spent >= r.points[i - 1].spent);
    assert.ok(r.points[i].d >= r.points[i - 1].d);
  }
});

test('replay on real data: the final values equal the result table exactly', async () => {
  for (const tokens of [['IPHONE6'], ['IPHONE6', 'LATTE:3Y'], ['BIGMAC:10Y', 'BEER'], ['NETFLIX:2015-2020', 'MODEL3'], ['PELOTON'], ['SODA:10Y', 'CHIPS', 'BETTING']]) {
    const d = await screen(tokens);
    const pts = d.replay.points;
    const last = pts[pts.length - 1];
    assert.equal(last.stock, d.total.value, `${tokens}: stock`);
    assert.equal(last.spent, d.total.paid, `${tokens}: spent`);
    // The same maths without the override agrees too.
    assert.ok(Math.abs(d.rows.reduce((n, r) => n + r.shares * r.price, 0) - last.stock) < 1e-6);
    assert.ok(last.jar > 0 && last.jar <= last.spent, `${tokens}: cash loses to inflation`);
    // A one-off is worth what was paid on the day it was bought.
    for (const r of d.rows.filter((x) => x.kind === 'once')) {
      const day = pts.find((p) => p.d === r.bought);
      assert.ok(day, `${r.id}: its purchase day is a point`);
    }
  }
  const one = await screen(['IPHONE6']);
  const day = one.replay.points.find((p) => p.d === '2014-09-19');
  assert.equal(day.stock, 649);
  assert.equal(day.spent, 649);
  assert.equal(day.jar, 649);
  // 1 Oct 2014: the 25.713 shares at that day's close.
  const oct = one.replay.points.find((p) => p.d === '2014-10-01');
  assert.equal(oct.stock, Math.round(one.rows[0].shares * prices.monthly.AAPL['2014-10'].close * 100) / 100);
  // The share image path does not build the race.
  const plain = await getWhatif(['IPHONE6'], { quoteImpl, now: NOW });
  assert.equal(plain.replay, undefined);
});

test('replay player maths: time-linear frames, the end is the last point exactly', () => {
  const pts = [{ d: '2020-01-01', stock: 0, jar: 0, spent: 0 }, { d: '2020-01-11', stock: 100, jar: 50, spent: 10 }, { d: '2020-01-31', stock: 300, jar: 40, spent: 30 }];
  const mid = frameAt(pts, 1 / 6);
  assert.equal(mid.i, 0);
  assert.ok(Math.abs(mid.stock - 50) < 1e-9);
  assert.ok(Math.abs(frameAt(pts, 0.5).stock - 150) < 1e-9);
  const end = frameAt(pts, 1);
  assert.equal(end.done, true);
  assert.equal(end.stock, 300);
  assert.equal(frameAt(pts, 2).stock, 300);
  assert.equal(frameAt(pts, 0).stock, 0);
  assert.deepEqual(scaleOf(pts), { top: 300, bottom: 30 });
  assert.equal(isBehind({ stock: 5, spent: 10 }), true);
  assert.equal(isBehind({ stock: 0, spent: 0 }), false);
  assert.equal(fmtCounter(Date.parse('2014-09-19T12:00:00Z')), '19 SEP 2014');
  assert.equal(durationMs(pts), 8054);
  assert.equal(durationMs(new Array(230)), 12000);
  assert.equal(durationMs([]), 8000);
});

// ---- SAVE VIDEO --------------------------------------------------------------------

test('video: feature detection picks WebCodecs, then MediaRecorder MP4, else a plain line', async () => {
  class Canvas {}
  Canvas.prototype.captureStream = () => {};
  const recorder = (types) => Object.assign(function MR() {}, { isTypeSupported: (t) => types.includes(t) });
  assert.equal(videoSupport({ VideoEncoder: function E() {}, VideoFrame: function F() {} }), 'webcodecs');
  assert.equal(videoSupport({ MediaRecorder: recorder(['video/mp4']), HTMLCanvasElement: Canvas }), 'recorder');
  assert.equal(recorderType({ MediaRecorder: recorder(['video/mp4;codecs=avc1', 'video/mp4']), HTMLCanvasElement: Canvas }), 'video/mp4;codecs=avc1');
  assert.equal(videoSupport({ MediaRecorder: recorder(['video/webm']), HTMLCanvasElement: Canvas }), null, 'WebM only is not enough');
  assert.equal(videoSupport({ MediaRecorder: recorder(['video/mp4']) }), null, 'no canvas capture');
  assert.equal(videoSupport({}), null);
  assert.equal(VIDEO_NEEDS, 'Saving a video needs Chrome, Edge or Safari.');
  // The first H.264 profile the encoder accepts at 1080x1080.
  const seen = [];
  const g = { VideoEncoder: { isConfigSupported: async (c) => { seen.push(c.codec); return { supported: c.codec === CODECS[1] }; } } };
  const config = await encoderConfig(g);
  assert.equal(config.codec, CODECS[1]);
  assert.deepEqual([config.width, config.height, config.framerate], [1080, 1080, 30]);
  assert.deepEqual(seen, CODECS.slice(0, 2));
  assert.equal(await encoderConfig({ VideoEncoder: { isConfigSupported: async () => { throw new Error('no'); } } }), null);
});

test('video: file name, length and money format', () => {
  assert.equal(videoFilename('WHATIF BIGMAC:10Y'), 'bloombroke-whatif-bigmac-10y.mp4');
  assert.equal(videoFilename('WHATIF IPHONE6 LATTE:3Y'), 'bloombroke-whatif-iphone6-latte-3y.mp4');
  assert.equal(videoFilename('WHATIF NETFLIX:2015-2024'), 'bloombroke-whatif-netflix-2015-2024.mp4');
  assert.equal(videoFilename(''), 'bloombroke-whatif.mp4');
  assert.equal(FPS, 30);
  assert.equal((RACE_FRAMES + HOLD_FRAMES) / FPS, 10, 'about 10 seconds');
  assert.deepEqual(timeline(0), { race: 0, stamp: 0 });
  assert.deepEqual(timeline(RACE_FRAMES), { race: 1, stamp: 0 });
  assert.equal(timeline(RACE_FRAMES + 9).stamp, 1);
  assert.equal(fmtMoney(15133.2), '$15,133');
  assert.equal(fmtMoney(649), '$649.00');
});

test('video and replay files: plain copy, self-hosted muxer', () => {
  for (const f of ['public/whatif-replay.js', 'public/whatif-video.js', 'public/screens/whatif.js', 'data/whatif.js', 'scripts/build-bls-monthly.js']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /amber|orange/i, f);
  }
  const video = readFileSync('public/whatif-video.js', 'utf8');
  assert.match(video, /import\('\.\/vendor\/mp4-muxer\.js'\)/, 'the muxer is loaded from this site');
  assert.doesNotMatch(video, /https?:\/\/(?!github)/, 'no outside hosts');
  assert.match(readFileSync('public/vendor/mp4-muxer.js', 'utf8'), /MIT License[\s\S]*Copyright \(c\) 2023 Vanilagy/);
});

// A fake VideoEncoder: counts frames, can fail on a given frame, records close().
function fakeEncoder({ failAt = -1 } = {}) {
  const log = { encoded: 0, closed: 0, flushed: 0, frames: 0, framesClosed: 0 };
  class Encoder {
    constructor({ error }) { this.error = error; this.state = 'unconfigured'; this.encodeQueueSize = 0; }
    configure() { this.state = 'configured'; }
    encode() { if (log.encoded === failAt) throw new Error('encoder broke'); log.encoded += 1; }
    async flush() { log.flushed += 1; }
    close() { this.state = 'closed'; log.closed += 1; }
  }
  class Frame { constructor() { log.frames += 1; } close() { log.framesClosed += 1; } }
  return { Encoder, Frame, log };
}
const pause = () => Promise.resolve();

test('video: the encoder always closes, and leaving mid-encode stops without a file', async () => {
  // A full run: every frame encoded and closed, flushed once, encoder closed once.
  const ok = fakeEncoder();
  await encodeFrames({ Encoder: ok.Encoder, Frame: ok.Frame, canvas: {}, draw: () => {}, config: {}, onChunk: () => {}, total: 20, pause });
  assert.deepEqual(ok.log, { encoded: 21, closed: 1, flushed: 1, frames: 21, framesClosed: 21 });

  // The viewer leaves at frame 5: an AbortError, no flush, the encoder closed.
  const ac = new AbortController();
  const gone = fakeEncoder();
  await assert.rejects(encodeFrames({
    Encoder: gone.Encoder, Frame: gone.Frame, canvas: {}, config: {}, onChunk: () => {}, total: 300, pause, signal: ac.signal,
    draw: (i) => { if (i === 5) ac.abort(); },
  }), { name: 'AbortError' });
  assert.equal(gone.log.flushed, 0);
  assert.equal(gone.log.closed, 1);
  assert.ok(gone.log.encoded <= 6);
  assert.equal(gone.log.frames, gone.log.framesClosed, 'every frame released');

  // An encode that throws still closes the encoder and the frame.
  const bad = fakeEncoder({ failAt: 3 });
  await assert.rejects(encodeFrames({ Encoder: bad.Encoder, Frame: bad.Frame, canvas: {}, draw: () => {}, config: {}, onChunk: () => {}, total: 20, pause }), /encoder broke/);
  assert.equal(bad.log.closed, 1);
  assert.equal(bad.log.frames, bad.log.framesClosed);

  // An error reported by the encoder's error callback stops the loop too.
  const cb = fakeEncoder();
  class Late extends cb.Encoder { encode(f, o) { super.encode(f, o); if (cb.log.encoded === 2) this.error(new Error('async fail')); } }
  await assert.rejects(encodeFrames({ Encoder: Late, Frame: cb.Frame, canvas: {}, draw: () => {}, config: {}, onChunk: () => {}, total: 20, pause }), /async fail/);
  assert.equal(cb.log.closed, 1);

  // Already left: makeVideo stops before any work.
  const left = new AbortController();
  left.abort();
  await assert.rejects(makeVideo({ m: {}, replay: { points: [] }, command: 'WHATIF X' }, { signal: left.signal, g: {} }), { name: 'AbortError' });
});

test('screen: a video made after leaving is never downloaded; the jar is slate, not amber', () => {
  const screenSrc = readFileSync('public/screens/whatif.js', 'utf8');
  assert.match(screenSrc, /signal: ctx\.signal/);
  assert.match(screenSrc, /if \(ctx\.signal\?\.aborted \|\| !box\.isConnected\) return;\s*\n\s*downloadBlob/);
  const video = readFileSync('public/whatif-video.js', 'utf8');
  const jar = /jar: '#([0-9A-Fa-f]{6})'/.exec(video)[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(jar.slice(i, i + 2), 16));
  assert.ok(b > r && b >= g, `jar pencil #${jar} is blue-grey`);
});

// ---- Picker: shelves ----------------------------------------------------------------

test('shelves: every item on a shelf; tabs and shelf words', async () => {
  const cat = { products: liveCatalog.products.map((p) => ({ ...p, kind: 'once' })), recurring: liveCatalog.recurring.map((r) => ({ ...r, kind: 'monthly' })) };
  assert.deepEqual(SHELVES, ['GADGETS', 'CARS', 'GAMES', 'HABITS', 'VICES']);
  const by = Object.fromEntries([...cat.products, ...cat.recurring].map((p) => [p.id, shelvesOf(p)]));
  assert.deepEqual(by.iphone6, ['GADGETS']);
  assert.deepEqual(by.peloton, ['GADGETS']);
  assert.deepEqual(by.models, ['CARS']);
  assert.deepEqual([by.ps5, by.switch, by.rtx4090, by.quest2], [['GAMES'], ['GAMES'], ['GAMES'], ['GAMES']]);
  assert.deepEqual(by.latte, ['HABITS']);
  assert.deepEqual(by.bigmac, ['HABITS', 'VICES']);
  assert.deepEqual(shelfItems(cat, 'VICES').map((p) => p.id), ['bigmac', 'beer', 'soda', 'chips', 'betting']);
  for (const [id, s] of Object.entries(by)) assert.ok(s.length && s.every((x) => SHELVES.includes(x)), id);

  assert.deepEqual(SHELF_WORDS, SERVER_SHELF_WORDS, 'client and server know the same shelf words');
  const vices = planWhatif(['VICES'], cat);
  assert.equal(vices.mode, 'picker');
  assert.equal(vices.shelf, 'VICES');
  assert.equal(vices.picks.size, 0);
  assert.equal(planWhatif([], cat).shelf, 'GADGETS');
  assert.equal(planWhatif(['EDIT', 'BEER:5Y'], cat).shelf, 'VICES');
  assert.equal(planWhatif(['CAR'], cat).shelf, 'CARS');
  assert.equal(planWhatif(['CAR'], cat).picks.size, 4, 'CAR still picks every Tesla');
  assert.equal(planWhatif(['IPHONE'], cat).mode, 'picker');
  assert.equal(planWhatif(['IPHONE6', 'LATTE:3Y'], cat).mode, 'result');
  assert.equal(commandFor(new Map([['beer', '5']]), cat), 'WHATIF BEER:5Y');
  // The server opens the picker too, and no share card is made for a shelf word.
  assert.deepEqual(resolveTokens(['VICES'], liveCatalog).families, ['VICES']);
  assert.equal((await getWhatif(['VICES'], { quoteImpl })).picker, true);
  assert.equal(normalizeWhatif('WHATIF VICES', liveCatalog), null);

  // A card: the doodle and name; the year and price once picked; a habit card keeps its years box.
  const once = cardHtml({ ...cat.products.find((p) => p.id === 'iphone6') }, new Map());
  assert.match(once, /doodle-phones\.webp/);
  assert.match(once, /iPhone 6<\/span>/);
  assert.match(once, /data-meta hidden>2014 \$649\.00/);
  const habit = cardHtml({ ...cat.recurring.find((p) => p.id === 'beer') }, new Map([['beer', '3Y']]));
  assert.match(habit, /data-spec="beer"/);
  assert.match(habit, /value="3Y"/);
  assert.match(habit, /aria-selected="true"/);
});

test('every catalog doodle exists; each vice has its own art', () => {
  for (const p of [...catalog.products, ...catalog.recurring]) {
    assert.ok(DOODLES.includes(p.doodle), `${p.id}: ${p.doodle}`);
    assert.ok(existsSync(`public/img/whatif/doodle-${p.doodle}.webp`), `${p.id}: doodle-${p.doodle}.webp`);
  }
  assert.deepEqual(VICES.map((id) => item(id).doodle), ['beer', 'soda', 'chips', 'betting']);
});

// ---- Worst drop: a date range --------------------------------------------------------

test('worst drop: the high and the low month, so a past drop never reads as now', () => {
  assert.equal(dropRange({ peakMonth: '2025-02', month: '2026-09' }), 'FEB 2025 TO SEP 2026');
  assert.equal(dropRange({ peakMonth: '2025-02', month: 'now' }), 'FEB 2025 TO TODAY');
  assert.equal(dropRange({ month: '2020-03' }), 'MAR 2020');
  assert.equal(dropRange({ month: null }), '');
  const one = { rows: [{}], risk: { worst: { pct: -31.2, peakMonth: '2025-02', month: '2026-09', name: 'x', ticker: 'X' } } };
  assert.equal(riskLine(one), 'Worst drop along the way: −31% (FEB 2025 TO SEP 2026), based on month-end prices.');
  assert.equal(dropList([{ name: 'iPhone 6', worstDrop: { pct: -30.7, peakMonth: '2018-08', month: '2018-12' } }]),
    'Worst drop along the way, by holding, month-end prices: iPhone 6 −31% (AUG 2018 TO DEC 2018).');
});

test('replay block: the chart alone, its lines named on it; SAVE VIDEO in the SHARE menu', async () => {
  const d = await screen(['BIGMAC:10Y']);
  d.cert = certModel(d, liveCatalog, 'WHATIF BIGMAC:10Y');
  const r = replayHtml(d);
  assert.match(r, /^<div class="wi-replay"><canvas class="wr-canvas" role="img" aria-label="Replay from [^"]+ to today: stock \$[\d,.]+, cash in a jar \$[\d,.]+, spent \$[\d,.]+\."><\/canvas><\/div>$/);
  assert.doesNotMatch(r, /data-wr|STOCK <span|data-video|data-replay|<kbd>/, 'no number strip and no buttons on the chart');
  assert.equal(replayHtml({ ...d, replay: null }), '');
  // The names at the lines' ends: in order, 12 px apart, inside the chart.
  assert.deepEqual(LINE_KEYS, ['stock', 'jar', 'spent']);
  assert.deepEqual(labelYs([40, 44, 100], { gap: 12, top: 10, bottom: 110 }), [40, 52, 100]);
  assert.deepEqual(labelYs([100, 5, 108], { gap: 12, top: 10, bottom: 110 }), [98, 10, 110], 'kept inside, still 12 apart');
  // SAVE VIDEO where the browser can, one plain line where it cannot.
  assert.equal(videoHtml(d, 'webcodecs'), '<button type="button" class="wi-mi" role="menuitem" data-video>Save video</button>');
  assert.match(videoHtml(d, null), /Saving a video needs Chrome, Edge or Safari\./);
  assert.equal(videoHtml({ ...d, cert: null }, 'webcodecs'), '');
  // SHARE: one primary button; its menu: Post on X, Save video, Download image, Copy link, Embed.
  const links = shareLinks(d.cert, 'https://bloombroke.com');
  const html = shareHtml(d, links, videoHtml(d, 'webcodecs'));
  assert.equal((html.match(/btn-solid/g) || []).length, 1);
  assert.match(html, /^<div class="wi-sharebox"><button type="button" class="btn card-btn btn-solid" id="wi-share-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="wi-menu">SHARE<\/button><div class="wi-menu" id="wi-menu" role="menu" aria-label="Share" hidden>/);
  const order = ['Post on X', 'Save video', 'Download image', 'Copy link', 'Embed'].map((w) => html.indexOf(`>${w}<`));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), String(order));
  // Each item keeps what the share count listens for (ga4.js SHARES); SHARE itself is not a share.
  assert.match(html, /<a class="wi-mi" role="menuitem" href="https:\/\/x\.com\/intent\/post\?[^"]+" target="_blank"/);
  assert.match(html, /<a class="wi-mi" role="menuitem" href="\/og\/whatif\.png\?c=[^"]+" download="bloombroke-whatif\.png">/);
  assert.match(html, /data-copy="https:\/\/bloombroke\.com\/\?c=WHATIF\+BIGMAC%3A10Y">Copy link</);
  assert.match(html, /data-embed="WHATIF BIGMAC:10Y"/);
  assert.doesNotMatch(html, /id="share"|data-share/);
  assert.doesNotMatch(shareHtml({ ...d, mine: true }, links), /data-embed/, 'no Embed for your own purchase');
  assert.match(html, /<span class="wi-vmsg" data-vmsg role="status"><\/span>$/);
  const ga = readFileSync('public/ga4.js', 'utf8');
  for (const sel of ['a[href^="https://x.com/intent/"]', 'a[download][href^="/og/"]', "'[data-video]'", '[data-embed]', '[data-copy]']) assert.ok(ga.includes(sel), sel);
});

test('WHATIF result: a split card page, the certificate the hero, one sentence, SHARE; the rest in + Details', async () => {
  assert.equal(niceMonth('2015-01'), 'Jan 2015');
  assert.equal(niceDay('2015-01-02'), '2 Jan 2015');
  assert.equal(shortCompany('Apple Inc.'), 'Apple');
  assert.equal(shortCompany("McDonald's"), "McDonald's");
  // The sentence: what was paid, when, and what it is worth as the maker's stock. The
  // amounts are the engine's totals, formatted as everywhere (fmtUsd): nothing recomputed.
  const total = { paid: 9159.4, value: 48864, multiple: 5.33 };
  const mine = parseMine(['MY', '15', 'A', 'WEEK', 'AAPL', 'SINCE', '2015'], NOW).mine;
  const habit = { rows: [{ id: mine[0].id, kind: 'monthly', mine: {}, company: 'Apple Inc.', ticker: 'AAPL', from: '2015-01', to: '2026-09' }], total, cert: { ribbon: '141 months of $15 a week in AAPL' } };
  assert.equal(resultSentence(habit, mine), 'You paid $9,159 since Jan 2015. As Apple stock it is worth $48,864 today.');
  const once = parseMine(['MY', '1200', 'AAPL', '2015'], NOW).mine;
  assert.equal(resultSentence({ rows: [{ id: once[0].id, kind: 'once', mine: {}, company: 'Apple Inc.', ticker: 'AAPL', bought: '2015-01-02' }], total }, once), 'You paid $9,159 on 2 Jan 2015. As Apple stock it is worth $48,864 today.');
  const until = parseMine(['MY', '15', 'A', 'WEEK', 'TSM', 'SINCE', '2015', 'TO', '2020'], NOW).mine;
  assert.equal(resultSentence({ rows: [{ id: until[0].id, kind: 'monthly', mine: {}, company: 'Taiwan Semiconductor Manufacturing Company', ticker: 'TSM', from: '2015-01', to: '2020-01' }], total }, until),
    'You paid $9,159, Jan 2015 to Jan 2020. As TSM stock it is worth $48,864 today.', 'a long name goes by its ticker');
  const phone = await screen(['IPHONE6']);
  phone.cert = certModel(phone, liveCatalog, 'WHATIF IPHONE6');
  assert.equal(resultSentence(phone), `You paid $649.00 in Sep 2014. As Apple stock it is worth ${fmtUsd(phone.total.value)} today.`);
  const mac = await screen(['BIGMAC:10Y']);
  mac.cert = certModel(mac, liveCatalog, 'WHATIF BIGMAC:10Y');
  assert.match(resultSentence(mac), /^You paid \$[\d,]+ since [A-Z][a-z]{2} \d{4}\. As McDonald's stock it is worth \$[\d,]+ today\.$/);
  const mix = await screen(['IPHONE6', 'LATTE:3Y']);
  mix.cert = certModel(mix, liveCatalog, 'WHATIF IPHONE6 LATTE:3Y');
  assert.match(resultSentence(mix), /^You paid \$[\d,]+ in all\. As stock in 2 companies they are worth \$[\d,]+ today\.$/);

  // The page: the certificate (a picture) in the art slot, the sentence, SHARE, the note,
  // the race, REPLAY and CHANGE PICKS; no hero number, no quip, no title strip.
  const links = shareLinks(phone.cert, 'https://bloombroke.com');
  const html = resultHtml(phone, { key: 'WHATIF IPHONE6', links, video: videoHtml(phone, 'webcodecs') });
  assert.match(html, /^<section class="card card-split wi-result" aria-label="WHATIF result"><div class="card-art"><figure class="wi-cert" role="img" aria-label="A certificate: iPhone 6, worth \$[\d,]+ today\./);
  assert.match(html, /<p class="card-sub"><span class="wi-line">You paid \$649\.00 in Sep 2014\.<\/span> <span class="wi-line">As Apple stock it is worth \$[\d,]+ today\.<\/span><\/p>/);
  assert.match(html, /<div class="card-act"><div class="wi-sharebox">/);
  assert.ok(html.includes(`<p class="card-note">${RESULT_NOTE}</p>`));
  assert.match(html, /<p class="card-links"><button type="button" class="card-link" data-replay title="Replay \(Space\)">REPLAY<\/button> <a class="card-link" href="\?c=WHATIF\+EDIT\+IPHONE6" data-cmd="WHATIF EDIT IPHONE6">CHANGE PICKS<\/a><\/p>/);
  assert.doesNotMatch(html, /card-hero|wi-hero|hero-value|wi-quip|START OVER<\/a><\/p><\/div><\/section>$/);
  // One amount at a time: above + Details, outside the certificate, the worth is said once.
  const top = html.split('<details')[0].replace(/<figure[\s\S]*?<\/figure>/, '').replace(/aria-label="[^"]*"/g, '');
  assert.equal(top.split(fmtUsd(phone.total.value)).length - 1, 1, 'the worth once, in the sentence');
  assert.doesNotMatch(top, /<table/, 'one thing: the table is in + Details');
  const more = html.split('<details class="how card-more">')[1];
  assert.match(more, /<table class="grid-table wi-table">/);
  assert.doesNotMatch(more, /<tfoot/, 'no TOTAL row: the sentence says it');
  assert.ok(more.indexOf(`<li>${HINDSIGHT_NOTE}</li>`) > 0, 'the small print, word for word, in + Details');
  assert.match(more, /data-cmd="WHATIF">START OVER<\/a>/, 'START OVER in + Details');
  // Two or more things: the list under the chart (its words are the list's), not in + Details.
  const two = resultHtml(mix, { key: 'WHATIF IPHONE6 LATTE:3Y', links: shareLinks(mix.cert, 'https://bloombroke.com') });
  assert.match(two.split('<details')[0], /<div class="card-media"><div class="wi-receipt">\s*<table class="grid-table wi-table">/);
  assert.doesNotMatch(two.split('<details')[1], /<table/);
  // Your own purchase: no Embed; no certificate: no SHARE, one column.
  assert.doesNotMatch(resultHtml({ ...phone, mine: true }, { key: 'WHATIF MY 649 AAPL 2014', links }), /data-embed/);
  assert.match(resultHtml({ ...phone, cert: null }, { key: 'WHATIF IPHONE6' }), /^<section class="card wi-result"/);
  // The race: only the certificate and the chart move; the sentence and the list wait.
  const css = readFileSync('public/screens/whatif.css', 'utf8');
  assert.ok(css.includes('.wi-result.is-racing .card-sub, .wi-result.is-racing .wi-receipt { visibility: hidden; }'));
  const src = readFileSync('public/screens/whatif.js', 'utf8');
  assert.match(src, /const replay = \(\) => \{\n\s+card\?\.classList\.add\('is-racing'\);/, 'REPLAY races the same way');
  assert.match(src, /onDone: \(\) => \{\n\s+card\?\.classList\.remove\('is-racing'\);/, 'the end (or reduced motion, at once) shows them');
  assert.doesNotMatch(src, /hero-value|wi-x|data-wr=/, 'nothing else rolls');
  assert.match(src, /panel\('1', WHATIF_TITLE, resultHtml\(d, \{ key, links, mine: plan\.mine, video: videoHtml\(d\) \}\), \{ cls: 'panel-solo wi-panel' \}\)/, 'no title strip');
  // The picker: one short line, two key hints.
  assert.equal(PICKER_INTRO, 'Pick what you bought. See what the stock would be worth now.');
  assert.equal(PICKER_KEYS, 'SPACE PICK · ENTER RUN');
  assert.doesNotMatch(src, /In the stock, that is|hero-unit">TODAY|How is this calculated\?|Notes and sources<\/summary>/);
});

// ---- The share image still renders ------------------------------------------------------

test('/og/whatif.png still renders, for a vice too', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-og-v2-'));
  try {
    const deps = { catalog: liveCatalog, getWhatif: (t) => getWhatif(t, { quoteImpl, now: NOW }), cacheDir: dir };
    const m = await getCert('WHATIF BEER:10Y', deps);
    assert.equal(m.doodle, 'beer');
    for (const c of ['WHATIF BEER:10Y', 'WHATIF IPHONE6 LATTE:3Y']) {
      const png = await whatifPng(c, deps);
      assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], c);
      assert.ok(png.length > 20000, c);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the month still running counts only the days so far (day and week habits)', async () => {
  const latte = catalog.recurring.find((r) => r.id === 'latte');
  const netflix = catalog.recurring.find((r) => r.id === 'netflix');
  const full = monthlyCost(latte, '2026-09', catalog, bls);
  assert.ok(Math.abs(monthlyCost(latte, '2026-09', catalog, bls, '2026-09-27') - full * 27 / 30) < 1e-9);
  assert.equal(monthlyCost(latte, '2026-08', catalog, bls, '2026-09-27'), monthlyCost(latte, '2026-08', catalog, bls), 'a past month in full');
  assert.ok(Math.abs(monthlyCost(item('beer'), '2026-09', catalog, bls, '2026-09-27') - monthlyCost(item('beer'), '2026-09', catalog, bls) * 27 / 30) < 1e-9);
  assert.equal(monthlyCost(netflix, '2026-09', catalog, bls, '2026-09-27'), monthlyCost(netflix, '2026-09', catalog, bls), 'a monthly bill is paid in full');
  // Through the service: the New York date of `now`.
  const d = await screen(['LATTE:5Y']);
  let paid = 0;
  for (let k = '2021-10'; k <= '2026-09'; k = k.slice(5) === '12' ? `${Number(k.slice(0, 4)) + 1}-01` : `${k.slice(0, 5)}${String(Number(k.slice(5)) + 1).padStart(2, '0')}`) {
    paid += monthlyCost(latte, k, catalog, bls, '2026-09-27');
  }
  assert.ok(Math.abs(d.rows[0].paid - paid) < 1e-9);
});
