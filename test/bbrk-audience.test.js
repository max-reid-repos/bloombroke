// BBRK for sponsors: the DataFast audience (lib/datafast.js, mocked), the sponsor
// inventory counters, /api/bbrk's contract, the embed_load count, the strip counts, the
// globe, and the screen.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { openDb } from '../pro/db.js';
import { createLimiter } from '../pro/ratelimit.js';
import { createCounters, mountCounters, makeCountGate, inventoryOf, BATCH_MAX } from '../lib/counters.js';
import {
  makeDataFast, shapeAudience, emptyAudience, plan, nyMidnight, countryCode, globeOf, API_BASE, TZ, TTL_MS, GLOBE_MIN, ENV_KEY,
} from '../lib/datafast.js';
import { mountEmbeds } from '../lib/embed-pages.js';
import { stripItems, mountStrip } from '../public/sponsor-strip.js';
import { countOnly, stripShownBatch } from '../public/goal.js';
import { bbrkHtml, heroChange, visitTime, topLine, globeCaption, globeLabel, SOURCE, STRIP, INVENTORY } from '../public/screens/bbrk.js';
import { ortho, dotRadius, startLon, mountGlobe } from '../public/globe.js';
import { build as buildDots, rings } from '../scripts/build-globe-dots.js';

const T0 = Date.parse('2026-09-27T16:00:00Z'); // 12:00 in New York
const KEY = 'df_test_not_a_real_key_1234';

// ---- a mock DataFast ----------------------------------------------------------------
const BODIES = {
  'analytics/overview:today': { status: 'success', data: [{ visitors: 412 }] },
  'analytics/overview:ySoFar': { status: 'success', data: [{ visitors: 377 }] },
  'analytics/overview:week': { status: 'success', data: [{ visitors: 3180 }] },
  'analytics/overview:month': { status: 'success', data: [{ visitors: 10000, avg_session_duration: 96600, visitorBreakdown: { new: 7000, returning: 3000, newPercentage: 70, returningPercentage: 30 } }] },
  'analytics/timeseries': { status: 'success', data: Array.from({ length: 30 }, (_, i) => ({ timestamp: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`, visitors: 100 + i })) },
  'analytics/countries:30': { status: 'success', data: [{ country: 'United States', image: '🇺🇸', visitors: 4120 }, { country: 'United Kingdom', visitors: 890 }, { country: 'Germany', visitors: 610 }] },
  'analytics/countries:7': { status: 'success', data: [{ country: 'United States', image: '🇺🇸', visitors: 1310 }, { country: 'Germany', visitors: 194 }, { country: 'Iceland', visitors: 2 }, { country: 'Atlantis', visitors: 9 }] },
  'analytics/devices': { status: 'success', data: [{ device: 'desktop', visitors: 680 }, { device: 'mobile', visitors: 300 }, { device: 'tablet', visitors: 20 }] },
  'analytics/referrers': { status: 'success', data: [{ referrer: 'x.com', visitors: 2250 }, { referrer: 'Google', visitors: 1830 }, { referrer: 'Direct / None', visitors: 900 }] },
  'analytics/realtime': { status: 'success', data: [{ visitors: 7 }] },
};

function keyOf(url) {
  const u = new URL(url);
  const path = u.pathname.replace('/api/v1/', '');
  const q = u.searchParams;
  if (path === 'analytics/overview') {
    if (q.get('startAt').includes('T')) return `${path}:ySoFar`;
    if (q.get('startAt') === q.get('endAt')) return `${path}:today`;
    return q.get('startAt') === '2026-09-21' ? `${path}:week` : `${path}:month`;
  }
  if (path === 'analytics/countries') return `${path}:${q.get('startAt') === '2026-09-21' ? 7 : 30}`;
  return path;
}

function fakeFetch({ fail = [], hang = [] } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const k = keyOf(url);
    if (hang.includes(k)) return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))));
    if (fail.includes(k)) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => BODIES[k] };
  };
  f.calls = calls;
  return f;
}

test('DataFast: no key (or not a df_ key) means every number is null and nothing is fetched', async () => {
  for (const key of [undefined, '', 'dft_account_token', 'sk_live_x']) {
    const f = fakeFetch();
    const df = makeDataFast({ key, fetchImpl: f, now: () => T0 });
    assert.equal(df.configured, false);
    assert.deepEqual(await df.get(), emptyAudience());
    assert.equal(f.calls.length, 0);
  }
  assert.equal(ENV_KEY, 'DATAFAST_API_KEY');
});

test('DataFast: the calls are read-only GETs with the key as a Bearer token, New York days', async () => {
  const f = fakeFetch();
  await makeDataFast({ key: KEY, fetchImpl: f, now: () => T0, log: () => {} }).get();
  const paths = f.calls.map((c) => new URL(c.url).pathname).sort();
  assert.deepEqual([...new Set(paths)], ['/api/v1/analytics/countries', '/api/v1/analytics/devices', '/api/v1/analytics/overview', '/api/v1/analytics/realtime', '/api/v1/analytics/referrers', '/api/v1/analytics/timeseries']);
  for (const c of f.calls) {
    assert.ok(c.url.startsWith(API_BASE));
    assert.equal(c.init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(c.init.method, undefined, 'GET');
    assert.ok(!c.url.includes(KEY), 'the key is never in a URL');
    if (!c.url.includes('realtime')) assert.equal(new URL(c.url).searchParams.get('timezone'), TZ);
  }
  const p = plan(T0);
  assert.equal(p.today[1].startAt, '2026-09-27');
  assert.equal(p.week[1].startAt, '2026-09-21');
  assert.equal(p.month[1].startAt, '2026-08-29');
  assert.equal(p.ySoFar[1].startAt, '2026-09-26T04:00:00.000Z', 'yesterday from New York midnight');
  assert.equal(p.ySoFar[1].endAt, '2026-09-26T16:00:00.000Z', 'to the same time yesterday');
  assert.equal(nyMidnight('2026-01-15'), Date.parse('2026-01-15T05:00:00Z'), 'winter: UTC-5');
});

test('DataFast: the audience contract, from mocked answers', async () => {
  const a = await makeDataFast({ key: KEY, fetchImpl: fakeFetch(), now: () => T0, log: () => {} }).get();
  assert.deepEqual(a.visitors, { today: 412, yesterdaySoFar: 377, d7: 3180, d30: 10000 });
  assert.equal(a.avgVisitSec, 97);
  assert.equal(a.returningPct, 30);
  assert.equal(a.desktopPct, 68);
  assert.deepEqual(a.countries, [{ name: 'United States', pct: 41.2 }, { name: 'United Kingdom', pct: 8.9 }, { name: 'Germany', pct: 6.1 }]);
  assert.deepEqual(a.referrers.map((r) => r.name), ['x.com', 'Google', 'Direct / None']);
  assert.equal(a.referrers[0].pct, 22.5);
  assert.equal(a.spark30.length, 30);
  assert.equal(a.source, 'DataFast');
  assert.equal(a.as_of, new Date(T0).toISOString());
  assert.equal(a.live, 7);
  for (const k of ['visitors', 'avgVisitSec', 'returningPct', 'desktopPct', 'countries', 'referrers', 'source', 'as_of']) assert.ok(k in a, k);
  for (const k of ['today', 'd7', 'd30']) assert.ok(k in a.visitors, k);
});

test('DataFast globe: country level only; under 3 visitors or off the map folds into other', async () => {
  const a = await makeDataFast({ key: KEY, fetchImpl: fakeFetch(), now: () => T0, log: () => {} }).get();
  assert.deepEqual(a.globe, { window: '7d', countries: [{ cc: 'US', visitors: 1310 }, { cc: 'DE', visitors: 194 }], other: 11 });
  assert.equal(GLOBE_MIN, 3);
  assert.deepEqual(globeOf([{ country: 'Iceland', visitors: 2 }]).countries, [], 'two visitors never show');
  assert.equal(countryCode({ country: 'Anywhere', image: '🇫🇷' }), 'FR', 'the flag first');
  assert.equal(countryCode({ country: 'Czech Republic' }), 'CZ');
  assert.equal(countryCode({ country: 'Singapore' }), 'SG');
  assert.equal(countryCode({ country: 'Atlantis' }), null);
  const json = JSON.stringify(a.globe);
  assert.doesNotMatch(json, /city|lat|lon|region/i, 'no place smaller than a country');
});

test('DataFast: one failed call nulls only its own numbers; the key is never logged', async () => {
  const logs = [];
  const a = await makeDataFast({ key: KEY, fetchImpl: fakeFetch({ fail: ['analytics/devices', 'analytics/overview:today'] }), now: () => T0, log: (m) => logs.push(m) }).get();
  assert.equal(a.desktopPct, null);
  assert.equal(a.visitors.today, null);
  assert.equal(a.visitors.d7, 3180);
  assert.ok(logs.length >= 2);
  for (const m of logs) assert.ok(!m.includes(KEY) && !m.includes('df_'), m);
  const all = await makeDataFast({ key: KEY, fetchImpl: async () => { throw new Error(`boom ${KEY}`); }, now: () => T0, log: (m) => logs.push(m) }).get();
  assert.deepEqual({ ...all, as_of: null }, emptyAudience());
  for (const m of logs) assert.ok(!m.includes(KEY), 'not even from an error message');
});

test('DataFast: a hanging API never holds the page past its wait', async () => {
  const df = makeDataFast({ key: KEY, fetchImpl: fakeFetch({ hang: Object.keys(BODIES) }), now: () => T0, timeoutMs: 200, log: () => {} });
  const t = Date.now();
  const a = await df.get({ wait: 100 });
  assert.ok(Date.now() - t < 1000);
  assert.equal(a.visitors.today, null);
});

test('DataFast: kept 5 minutes; then the last answer at once while it refreshes', async () => {
  let t = T0;
  const f = fakeFetch();
  const df = makeDataFast({ key: KEY, fetchImpl: f, now: () => t, log: () => {} });
  await df.get();
  const first = f.calls.length;
  t += 60_000;
  await df.get();
  assert.equal(f.calls.filter((c) => !c.url.includes('realtime')).length, first - 1, 'no new analytics calls within 5 minutes');
  t += TTL_MS;
  const a = await df.get();
  assert.equal(a.visitors.today, 412, 'the last answer');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(f.calls.length > first, 'refreshed');
});

// ---- counters and /api/bbrk ----------------------------------------------------------
async function serve({ audience = null, max = 5 } = {}) {
  const db = openDb(':memory:');
  const counters = createCounters({ now: () => T0 }).attach(db);
  counters.enable('mcp_call');
  const app = express();
  mountCounters(app, { counters, mode: 'test', now: () => T0, audience, limiter: createLimiter({ max, windowMs: 60_000, now: () => T0, sweepEvery: 0 }) });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body) => (await fetch(`${base}/api/count`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) })).status;
  return { counters, post, base, get: async () => (await fetch(`${base}/api/bbrk`)).json(), close: () => new Promise((r) => server.close(r)) };
}

test('GET /api/bbrk: the audience and inventory contract, -- (null) without DataFast', async () => {
  const s = await serve();
  try {
    const d = await s.get();
    assert.deepEqual(Object.keys(d.inventory), ['stripShown', 'stripClicks', 'embedLoads', 'mcpCalls']);
    for (const v of Object.values(d.inventory)) assert.deepEqual(Object.keys(v), ['today', 'd7']);
    assert.equal(d.audience.source, 'DataFast');
    assert.equal(d.audience.visitors.today, null);
    assert.deepEqual(d.audience.countries, []);
    assert.ok(d.counts && 'whatif_run' in d.counts, 'the old counts stay for the SPONSOR screen');
  } finally { await s.close(); }
  const s2 = await serve({ audience: makeDataFast({ key: KEY, fetchImpl: fakeFetch(), now: () => T0, log: () => {} }) });
  try {
    const d = await s2.get();
    assert.equal(d.audience.visitors.d30, 10000);
    assert.equal(d.audience.countries.length, 3);
  } finally { await s2.close(); }
  const s3 = await serve({ audience: { get: async () => { throw new Error('down'); } } });
  try { assert.equal((await s3.get()).audience.visitors.d7, null); } finally { await s3.close(); }
});

test('POST /api/count: strip_shown in batches of 1 to 20, strip_click one at a time', async () => {
  const s = await serve({ max: 50 });
  try {
    assert.equal(await s.post({ name: 'strip_shown', n: 20 }), 204);
    assert.equal(await s.post({ name: 'strip_shown' }), 204);
    for (const n of [0, 21, 2.5, '3', -1, null]) assert.equal(await s.post({ name: 'strip_shown', n }), 400, String(n));
    assert.equal(await s.post({ name: 'strip_click' }), 204);
    assert.equal(await s.post({ name: 'strip_click', n: 2 }), 400, 'clicks are never batched');
    assert.equal(await s.post({ name: 'whatif_share', n: 5 }), 400);
    const d = await s.get();
    assert.deepEqual(d.inventory.stripShown, { today: 21, d7: 21 });
    assert.deepEqual(d.inventory.stripClicks, { today: 1, d7: 1 });
    assert.equal(BATCH_MAX, 20);
  } finally { await s.close(); }
  const r = await serve({ max: 5 });
  try {
    for (let i = 0; i < 5; i += 1) assert.equal(await r.post({ name: 'strip_shown', n: 20 }), 204);
    assert.equal(await r.post({ name: 'strip_shown', n: 1 }), 429, 'rate limited');
  } finally { await r.close(); }
});

test('inventoryOf: null numbers for a counter that is missing', () => {
  assert.deepEqual(inventoryOf({ mcp_call: null, strip_shown: { today: 3, d7: 9 } }), {
    stripShown: { today: 3, d7: 9 }, stripClicks: { today: null, d7: null }, embedLoads: { today: null, d7: null }, mcpCalls: { today: null, d7: null },
  });
});

test('embed_load: counted on a served /embed page, once per IP per embed a minute; errors do not count', async () => {
  const counters = createCounters({ now: () => T0 }).attach(openDb(':memory:'));
  const gate = makeCountGate({ max: 10 });
  const app = express();
  mountEmbeds(app, { build: 'b', getCert: async () => null, catalog: {}, waitMs: 50, onLoad: (req) => gate.allow(req, `embed:${req.originalUrl}`) && counters.bump('embed_load') });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/embed/guess`)).status, 200);
    assert.equal((await fetch(`${base}/embed/guess`)).status, 200);
    assert.equal(counters.stats().counts.embed_load.today, 1, 'the same IP again within the minute');
    assert.equal((await fetch(`${base}/embed/whatif?c=NOPE`)).status, 404);
    assert.equal((await fetch(`${base}/embed/nothing`)).status, 404);
    assert.equal(counters.stats().counts.embed_load.today, 1);
  } finally { await new Promise((r) => server.close(r)); }
  const src = readFileSync('server.js', 'utf8');
  assert.match(src, /onLoad: \(req\) => embedGate\.allow\(req, `embed:\$\{req\.originalUrl\}`\) && siteCounters\.bump\('embed_load'\)/);
});

// ---- the strip ---------------------------------------------------------------------------
function fakeHost() {
  const ls = {};
  return {
    innerHTML: '', offsetWidth: 0,
    classList: { add() {}, remove() {} },
    addEventListener(t, f) { (ls[t] ||= []).push(f); },
    removeEventListener(t, f) { ls[t] = (ls[t] || []).filter((x) => x !== f); },
    listeners: ls,
  };
}

test('strip: each line shown while visible counts; any click counts; the SPONSOR preview never does', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const shown = [];
    const clicks = [];
    let hidden = false;
    const items = stripItems({ house: [{ text: 'A' }, { text: 'B' }] });
    const s = mountStrip(fakeHost(), items, { rotateMs: 1000, isHidden: () => hidden, onShow: () => shown.push(1), onAnyClick: () => clicks.push(1) });
    assert.equal(shown.length, 1, 'the first line');
    mock.timers.tick(1000);
    assert.equal(shown.length, 2);
    hidden = true;
    mock.timers.tick(3000);
    assert.equal(shown.length, 2, 'nothing while the tab is hidden');
    s.stop();
    const host = fakeHost();
    mountStrip(host, items, { onAnyClick: () => clicks.push(1), onPaidClick: () => {} }).stop;
    const click = (sel) => ({ target: { closest: (q) => (q === sel || (sel === 'paid' && q.startsWith('a.spon-item')) ? {} : null) } });
    for (const f of host.listeners.click) { f(click('a.spon-item')); f(click('paid')); f({ target: { closest: () => null } }); }
    assert.equal(clicks.length, 2, 'house and paid lines, not the empty strip');
  } finally { mock.timers.reset(); }
  assert.doesNotMatch(readFileSync('public/screens/sponsor.js', 'utf8'), /onShow|onAnyClick/, 'the preview counts nothing');
  assert.match(readFileSync('public/app.js', 'utf8'), /onShow: \(\) => shown\.add\(\), onAnyClick: \(\) => countOnly\('strip_click'\)/);
});

test('strip batches: at 20, on flush, never more than 20 in one post', () => {
  const sent = [];
  const b = stripShownBatch({ send: (n) => sent.push(n), everyMs: 0, doc: null, win: null });
  for (let i = 0; i < 45; i += 1) b.add();
  assert.deepEqual(sent, [20, 20]);
  b.flush();
  assert.deepEqual(sent, [20, 20, 5]);
  b.flush();
  assert.equal(sent.length, 3, 'nothing pending, nothing sent');
  const calls = [];
  const f = (url, init) => { calls.push(JSON.parse(init.body)); return Promise.resolve(); };
  assert.equal(countOnly('strip_shown', 7, { fetchImpl: f }), true);
  assert.equal(countOnly('strip_click', 1, { fetchImpl: f }), true);
  assert.equal(countOnly('whatif_run', 1, { fetchImpl: f }), false);
  assert.equal(countOnly('strip_shown', 21, { fetchImpl: f }), false);
  assert.deepEqual(calls, [{ name: 'strip_shown', n: 7 }, { name: 'strip_click' }]);
});

// ---- the globe ---------------------------------------------------------------------------
test('globe: orthographic projection, dot sizes, where it starts', () => {
  const [x, y, z] = ortho(0, 0, 0, 0);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 && Math.abs(z - 1) < 1e-9, 'the centre faces us');
  assert.ok(ortho(180, 0, 0, 0)[2] < 0, 'the far side is hidden');
  assert.ok(ortho(0, 60, 0, 0)[1] < 0, 'north is up');
  assert.equal(dotRadius(0, 10), 0);
  assert.ok(dotRadius(10, 10) > dotRadius(1, 10));
  assert.equal(startLon([{ cc: 'US', visitors: 5 }], { US: [-99, 39] }), -99);
  assert.equal(startLon([], {}), -40);
});

test('globe dots: built from our own Natural Earth map, country centres, no city data', () => {
  assert.deepEqual(rings('M0 0l10 0 0 10z'), [[[0, 0], [10, 0], [10, 10]]]);
  const geo = JSON.parse(readFileSync('public/geo/globe-dots.json', 'utf8'));
  assert.ok(geo.dots.length > 1000 && geo.dots.length < 3000);
  for (const cc of ['US', 'GB', 'FR', 'DE', 'JP', 'AU', 'BR', 'IN', 'SG']) assert.ok(geo.centres[cc], cc);
  assert.ok(geo.centres.FR[0] > -5 && geo.centres.FR[1] > 42, 'France without Guiana');
  const again = buildDots(JSON.parse(readFileSync('public/geo/world-110m.json', 'utf8')));
  assert.equal(again.dots.length, geo.dots.length, 'the shipped file matches the script');
});

test('globe: still with reduced motion, stops while hidden and on stop()', () => {
  const draws = [];
  const frames = [];
  const listeners = {};
  const canvas = {
    width: 0, height: 0,
    getContext: () => new Proxy({}, { get: (t, k) => (k === 'fillRect' ? () => draws.push(1) : () => {}), set: () => true }),
    getBoundingClientRect: () => ({ width: 200 }),
  };
  const win = { getComputedStyle: () => ({ getPropertyValue: () => '' }), devicePixelRatio: 1, requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {} };
  const doc = { hidden: false, addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; } };
  const geo = { dots: [[0, 0], [10, 10]], centres: { US: [-99, 39] } };
  const still = mountGlobe(canvas, geo, [], { reduceMotion: true, win, doc });
  assert.equal(still.running, false);
  assert.equal(frames.length, 0, 'one still frame');
  assert.ok(draws.length > 0);
  still.stop();
  const g = mountGlobe(canvas, geo, [], { win, doc });
  assert.equal(g.running, true);
  doc.hidden = true;
  listeners.visibilitychange();
  assert.equal(g.running, false, 'paused while hidden');
  doc.hidden = false;
  listeners.visibilitychange();
  assert.equal(g.running, true);
  g.stop();
  assert.equal(g.running, false);
  assert.equal(listeners.visibilitychange, undefined);
});

// ---- the screen --------------------------------------------------------------------------
const FULL = {
  mrr: 'MRR $0 (test mode)',
  audience: {
    visitors: { today: 412, yesterdaySoFar: 377, d7: 3180, d30: 11890 },
    spark30: [1, 2, 3, 4], avgVisitSec: 97, returningPct: 31.4, desktopPct: 68.2,
    countries: [{ name: 'United States', pct: 41.2 }, { name: 'Germany', pct: 6.1 }],
    referrers: [{ name: 'x.com', pct: 22.5 }],
    globe: { window: '7d', countries: [{ cc: 'US', visitors: 1310 }], other: 45 }, live: 7,
    source: 'DataFast', as_of: '2026-09-27T16:00:00Z',
  },
  inventory: { stripShown: { today: 1840, d7: 12950 }, stripClicks: { today: 6, d7: 41 }, embedLoads: { today: 58, d7: 390 }, mcpCalls: { today: 23, d7: 160 } },
};
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');
const words = (html) => text(html).split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;

test('BBRK screen: visitors hero, audience, sponsor inventory, MRR; no game counts', () => {
  const html = bbrkHtml(FULL);
  assert.match(html, /<span class="q-last">412<\/span>/);
  assert.match(html, /\+35 \+9\.28%/);
  assert.match(html, /vs yesterday, same time/);
  assert.match(html, /class="spark"/);
  for (const s of ['3,180', '11,890', '1m 37s', '31%', '68%', '$0 (test mode)', 'United States 41% · Germany 6%', 'x.com 23%', '1,840', '12,950', '390', '160']) assert.ok(html.includes(s), s);
  for (const [, label] of INVENTORY) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /WHATIF|GUESS|video|share/i);
  assert.ok(html.includes(SOURCE));
  assert.equal(SOURCE, 'Visitors: DataFast. Strip, embeds, MCP: our server counters. Days in New York time.');
  assert.equal(STRIP, 'OUR OWN SITE NUMBERS. NOT A SECURITY. NOT FOR SALE.');
  const total = words(html) + words(STRIP) + words(globeCaption(FULL)) + 2;
  assert.ok(total < 90, `${total} words`);
});

test('BBRK screen: -- for everything missing, and nothing breaks', () => {
  const html = bbrkHtml(null);
  assert.doesNotMatch(html, /NaN|undefined|null|Infinity/);
  assert.ok((html.match(/--/g) || []).length >= 12);
  assert.doesNotMatch(html, /class="spark"/, 'no sparkline without data');
  assert.equal(globeCaption(null), '7D by country');
  assert.equal(globeCaption(FULL), '7D by country · 7 live now');
  assert.equal(globeLabel(FULL), 'Globe of visitors by country, last 7 days: US 1,310, other 45.');
  assert.deepEqual(heroChange(null, 3), { text: '--', dir: 'flat' });
  assert.deepEqual(heroChange(2, 0), { text: '+2', dir: 'up' });
  assert.equal(visitTime(42), '42s');
  assert.equal(visitTime(null), '--');
  assert.equal(topLine([]), '--');
});

test('copy rules: no banned brand word, no em dash, no emoji, no amber, no advice words', () => {
  for (const f of ['public/screens/bbrk.js', 'public/globe.js', 'lib/datafast.js', 'scripts/build-globe-dots.js']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s.replace(/image: '[^']*'/g, ''), /\p{Extended_Pictographic}/u, `${f}: emoji`);
    assert.doesNotMatch(s, /amber|orange|#f5a|#ffa|#ff9/i, `${f}: amber`);
    assert.doesNotMatch(s, /\b(you should|we recommend|buy now|invest in)\b/i, `${f}: advice`);
  }
});

// ---- units, from a real-shaped DataFast payload (prod, Sep 27 2026) ----------------------
test('DataFast units: avg_session_duration is milliseconds; shares are 0 to 100; buckets in time order', () => {
  const a = shapeAudience({
    month: { status: 'success', data: [{ visitors: 1287, new_visitors: 1101, returning_visitors: 186, visitorBreakdown: { new: 1101, returning: 186, newPercentage: 85.55, returningPercentage: 14.45 }, pageviews: 5310, sessions: 1523, bounce_rate: 38.6, avg_session_duration: 433129.87 }] },
    series: { status: 'success', data: [{ timestamp: '2026-09-27T04:00:00Z', visitors: 90 }, { timestamp: '2026-09-25T04:00:00Z', visitors: 70 }, { timestamp: '2026-09-26T04:00:00Z', visitors: 80 }] },
    devices: { status: 'success', data: [{ device: 'desktop', visitors: 812 }, { device: 'mobile', visitors: 450 }, { device: 'tablet', visitors: 25 }] },
  }, '2026-09-27T16:00:00Z');
  assert.equal(a.avgVisitSec, 433);
  assert.equal(visitTime(a.avgVisitSec), '7m 13s');
  assert.equal(a.returningPct, 14.5, 'from the counts, 0 to 100');
  assert.equal(a.desktopPct, 63.1);
  assert.deepEqual(a.spark30, [70, 80, 90], 'oldest first');
  assert.ok(a.returningPct <= 100 && a.desktopPct <= 100);
  // Only the percentage: used when it is 0 to 100, never a 0 to 1 share read as a percent.
  const p = shapeAudience({ month: { status: 'success', data: [{ visitors: 10, visitorBreakdown: { returningPercentage: 14.45 } }] } }, null);
  assert.equal(p.returningPct, 14.5);
  assert.equal(shapeAudience({ month: { status: 'success', data: [{ visitors: 10, avg_session_duration: -5 }] } }, null).avgVisitSec, null);
});

test('top countries and referrers: fewer than 3 visitors is never named', () => {
  const a = shapeAudience({
    month: { status: 'success', data: [{ visitors: 100 }] },
    countries: { status: 'success', data: [{ country: 'United States', visitors: 60 }, { country: 'Iceland', visitors: 2 }, { country: 'Germany', visitors: 3 }, { country: 'Malta', visitors: 1 }] },
    referrers: { status: 'success', data: [{ referrer: 'x.com', visitors: 40 }, { referrer: 'someones-blog.example', visitors: 2 }, { referrer: 'Google', visitors: 9 }, { referrer: 'tiny.example', visitors: 1 }] },
  }, null);
  assert.deepEqual(a.countries, [{ name: 'United States', pct: 60 }, { name: 'Germany', pct: 3 }]);
  assert.deepEqual(a.referrers, [{ name: 'x.com', pct: 40 }, { name: 'Google', pct: 9 }]);
  assert.equal(plan(T0).referrers[1].limit, '10', 'enough rows to skip the small ones');
  assert.equal(plan(T0).countries[1].limit, '10');
});
