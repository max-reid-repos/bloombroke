// Hardening: bounded caches, capped upstream fan-out, and the capped fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache, approxBytes, CACHE_DEFAULTS, sweepAll } from '../data/cache.js';
import { makeGate, GateBusy } from '../data/gate.js';
import { makeHistory, HISTORY_CACHE, HISTORY_GATE } from '../data/history.js';
import { makeSearch, SEARCH_GATE } from '../data/search.js';
import { makeCharts, CHART_GATE } from '../data/charts.js';
import { makeCappedFetch, cappedFetch, FetchCapError } from '../data/http.js';
import { makeNewsLog } from '../data/newslog.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const tick = () => new Promise((r) => { setImmediate(r); });

// ---- the shared cache ------------------------------------------------------------

test('cache: a flood of distinct keys stays under the default entry cap', async () => {
  const cache = createCache();
  for (let i = 0; i < CACHE_DEFAULTS.maxEntries * 3; i += 1) {
    await cache.cached(`range:${i}`, 60_000, async () => ({ i }));
  }
  assert.equal(cache.size(), CACHE_DEFAULTS.maxEntries);
  assert.ok(cache.has(`range:${CACHE_DEFAULTS.maxEntries * 3 - 1}`), 'the newest stays');
  assert.ok(!cache.has('range:0'), 'the oldest went');
});

test('cache: big values are capped by their byte estimate', async () => {
  const cache = createCache({ maxBytes: 1024 * 1024 });
  const big = () => ({ rows: Array.from({ length: 5000 }, (_, i) => ({ d: `2026-01-${i}`, c: i })) });
  assert.ok(approxBytes(big()) > 200 * 1024, 'the estimate counts the rows');
  for (let i = 0; i < 50; i += 1) await cache.cached(`k${i}`, 60_000, async () => big());
  assert.ok(cache.weight() <= 1024 * 1024, `weight ${cache.weight()} over the cap`);
  assert.ok(cache.size() >= 1 && cache.size() < 10);
});

test('cache: a custom weigh keeps its own maxWeight', async () => {
  const cache = createCache({ weigh: (v) => v.n, maxWeight: 10 });
  for (let i = 0; i < 20; i += 1) await cache.cached(`k${i}`, 60_000, async () => ({ n: 3 }));
  assert.equal(cache.weight(), 9);
});

test('approxBytes: strings, Maps, Buffers, cycles', () => {
  assert.ok(approxBytes('x'.repeat(1000)) >= 2000);
  assert.ok(approxBytes(new Map([['a', 'x'.repeat(1000)]])) >= 2000);
  assert.ok(approxBytes(Buffer.alloc(10_000)) >= 10_000);
  const a = { b: null };
  a.b = a;
  assert.ok(approxBytes(a) < 1000, 'a cycle is counted once');
});

test('cache: past TTL plus the stale window an entry is gone on read, and a sweep drops it', async () => {
  let t = 0;
  const cache = createCache({ now: () => t, staleMs: 1000, retryMs: 10 });
  await cache.cached('a', 100, async () => 1);
  await cache.cached('b', 100, async () => 2);
  // Inside the stale window a dead source still gets the old value.
  t = 500;
  const stale = await cache.cached('a', 100, async () => { throw new Error('down'); });
  assert.equal(stale.stale, true);
  // Past it, the old value is not served.
  t = 5000;
  await assert.rejects(cache.cached('a', 100, async () => { throw new Error('down'); }), /down/);
  assert.ok(cache.has('b'));
  cache.sweep();
  assert.ok(!cache.has('b'), 'the sweep drops the idle entry');
  assert.ok(!cache.has('a'));
  t = 6000;
  cache.sweep();
  assert.equal(cache.failures(), 0, 'old remembered failures go too');
});

test('cache: sweepAll reaches every live cache', async () => {
  let t = 0;
  const cache = createCache({ now: () => t, staleMs: 10 });
  await cache.cached('x', 10, async () => 1);
  t = 100;
  sweepAll();
  assert.equal(cache.size(), 0);
});

test('cache: a busy gate is not remembered as a failure', async () => {
  const cache = createCache();
  await assert.rejects(cache.cached('k', 1000, async () => { throw new GateBusy(); }), (e) => e.busy === true);
  const ok = await cache.cached('k', 1000, async () => 7);
  assert.equal(ok.value, 7, 'the next call loads at once');
});

// ---- the gate ------------------------------------------------------------------

test('gate: at most `concurrency` running, a bounded queue, busy past it', async () => {
  const gate = makeGate({ concurrency: 2, maxQueue: 3 });
  let running = 0;
  let peak = 0;
  const releases = [];
  const job = () => gate(() => new Promise((r) => {
    running += 1;
    peak = Math.max(peak, running);
    releases.push(() => { running -= 1; r('ok'); });
  }));
  const jobs = Array.from({ length: 10 }, job);
  const settled = Promise.allSettled(jobs);
  await tick();
  assert.deepEqual(gate.stats(), { running: 2, waiting: 3 });
  while (releases.length) { releases.shift()(); await tick(); }
  const out = await settled;
  assert.equal(peak, 2);
  assert.equal(out.filter((o) => o.status === 'fulfilled').length, 5);
  assert.ok(out.filter((o) => o.status === 'rejected').every((o) => o.reason instanceof GateBusy));
  assert.deepEqual(gate.stats(), { running: 0, waiting: 0 });
});

// ---- history, search, charts under a flood of distinct keys ---------------------------

function slowSource(body) {
  let running = 0;
  let peak = 0;
  let calls = 0;
  const pending = [];
  const fetchImpl = (url) => new Promise((r) => {
    calls += 1;
    running += 1;
    peak = Math.max(peak, running);
    pending.push(() => { running -= 1; r(json(typeof body === 'function' ? body(url) : body)); });
  });
  const drain = async () => {
    for (let i = 0; i < 300; i += 1) {
      while (pending.length) pending.shift()();
      await tick();
    }
  };
  return { fetchImpl, drain, stats: () => ({ peak, calls }) };
}

const BARS = { barData: { priceBars: [
  { tradeTime: '20260922000000', open: '1', high: '1', low: '1', close: '1', volume: 1 },
  { tradeTime: '20260924000000', open: '1', high: '2', low: '1', close: '2', volume: 1 },
] } };

test('history: 200 distinct date ranges at once fan out to at most a few upstream calls', async () => {
  const src = slowSource(BARS);
  const { getHistory } = makeHistory({ fetchImpl: src.fetchImpl, now: () => Date.parse('2026-09-25T15:00:00Z') });
  const day = (i) => new Date(Date.parse('2025-01-01') + i * 86_400_000).toISOString().slice(0, 10);
  const calls = Array.from({ length: 200 }, (_, i) => getHistory({ ticker: 'AAPL', from: day(i), to: '2026-09-25' }).then(() => 'ok', (e) => e.code));
  await tick();
  assert.ok(src.stats().peak <= HISTORY_GATE.concurrency);
  await src.drain();
  const out = await Promise.all(calls);
  assert.ok(src.stats().calls <= HISTORY_GATE.concurrency + HISTORY_GATE.maxQueue, `${src.stats().calls} upstream calls`);
  assert.ok(out.includes('unavailable'), 'the rest are told to try again');
  // Busy answers were not remembered: the same range loads on the next try.
  const again = getHistory({ ticker: 'AAPL', from: day(199), to: '2026-09-25' });
  await src.drain();
  assert.equal((await again).ticker, 'AAPL');
});

test('history: the cache holds at most HISTORY_CACHE.maxEntries ranges', async () => {
  const cache = createCache(HISTORY_CACHE);
  const { getHistory } = makeHistory({ fetchImpl: async () => json(BARS), cache, now: () => Date.parse('2026-09-25T15:00:00Z') });
  for (let i = 0; i < HISTORY_CACHE.maxEntries + 150; i += 1) {
    const from = new Date(Date.parse('2024-01-01') + i * 86_400_000).toISOString().slice(0, 10);
    await getHistory({ ticker: 'AAPL', from, to: '2026-09-25' }).catch(() => {});
  }
  assert.equal(cache.size(), HISTORY_CACHE.maxEntries);
});

test('search: a burst of distinct prefixes is capped upstream and degrades, never piles up', async () => {
  const src = slowSource({ data: [] });
  const { search } = makeSearch({ fetchImpl: src.fetchImpl });
  const words = Array.from({ length: 120 }, (_, i) => `Q${i.toString(36).toUpperCase()}X`);
  const calls = words.map((w) => search(w));
  await tick();
  assert.ok(src.stats().peak <= SEARCH_GATE.concurrency);
  await src.drain();
  const out = await Promise.all(calls);
  assert.ok(src.stats().calls <= SEARCH_GATE.concurrency + SEARCH_GATE.maxQueue);
  assert.ok(out.some((r) => r.degraded));
});

test('charts: a burst of distinct symbols and ranges is capped upstream', async () => {
  const src = slowSource(BARS);
  const { getChart } = makeCharts({ fetchImpl: src.fetchImpl, now: () => new Date('2026-09-25T15:00:00Z') });
  const sym = (i) => `Z${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`;
  const calls = Array.from({ length: 150 }, (_, i) => getChart(sym(i), { from: '2024-01-01', to: '2026-01-01' }).then(() => 'ok', (e) => e.code));
  await tick();
  // A load is at most a few upstream calls (chunks plus daily bars).
  assert.ok(src.stats().peak <= CHART_GATE.concurrency * 3, `peak ${src.stats().peak}`);
  await src.drain();
  const out = await Promise.all(calls);
  assert.ok(out.includes('unavailable'));
});

// ---- newslog ---------------------------------------------------------------------

test('newslog: writes keep the open map within maxOpen', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bb-newslog-'));
  try {
    const log = makeNewsLog({ dir, maxOpen: 5 });
    const item = (i) => [{ time: new Date(1_700_000_000_000 + i).toISOString(), title: `Story ${i}`, url: `https://example.com/${i}`, source: 'x' }];
    for (let i = 0; i < 20; i += 1) await log.record(`T${i}`, item(i));
    // No accessor for the map: read the newest and oldest back, both still work.
    assert.equal((await log.read('T19')).length, 1);
    assert.equal((await log.read('T0')).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- capped fetch ------------------------------------------------------------------

function streamOf(chunk, count, onPull = () => {}) {
  let sent = 0;
  return new ReadableStream({
    pull(ctl) {
      onPull();
      if (sent >= count) { ctl.close(); return; }
      sent += 1;
      ctl.enqueue(chunk);
    },
  });
}

test('cappedFetch: an oversized streamed body is cut off, not buffered', async () => {
  let pulls = 0;
  const chunk = new Uint8Array(64 * 1024).fill(65);
  const f = makeCappedFetch({
    fetchImpl: async () => new Response(streamOf(chunk, 10_000, () => { pulls += 1; }), { headers: { 'content-type': 'application/json' } }),
    maxBytes: 1024 * 1024,
  });
  await assert.rejects(f('https://source.example/big.json'), (e) => e instanceof FetchCapError && e.code === 'too_large' && /source\.example/.test(e.message));
  assert.ok(pulls < 40, `read ${pulls} chunks of an endless body`);
});

test('cappedFetch: a declared content-length over the cap is refused before reading', async () => {
  let pulls = 0;
  const f = makeCappedFetch({
    fetchImpl: async () => new Response(streamOf(new Uint8Array(10), 5, () => { pulls += 1; }), { headers: { 'content-type': 'application/json', 'content-length': String(50 * 1024 * 1024) } }),
  });
  await assert.rejects(f('https://source.example/x'), (e) => e.code === 'too_large');
  assert.ok(pulls <= 1);
});

test('cappedFetch: a per-call maxBytes wins', async () => {
  const body = JSON.stringify({ a: 'x'.repeat(5000) });
  const f = makeCappedFetch({ fetchImpl: async () => new Response(body, { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(f('https://s.example/', { maxBytes: 100 }), (e) => e.code === 'too_large');
  const ok = await f('https://s.example/', { maxBytes: 10_000 });
  assert.equal((await ok.json()).a.length, 5000);
});

test('cappedFetch: an unexpected content type is refused; text, JSON, XML, CSV pass', async () => {
  const as = (type) => makeCappedFetch({ fetchImpl: async () => new Response('a,b\n1,2', { headers: type ? { 'content-type': type } : {} }) });
  for (const bad of ['image/png', 'application/pdf', 'application/zip', 'video/mp4']) {
    await assert.rejects(as(bad)('https://s.example/'), (e) => e.code === 'bad_type', bad);
  }
  for (const good of ['text/csv; charset=utf-8', 'application/json', 'application/rss+xml', 'application/atom+xml', 'text/xml', 'application/geo+json', 'text/html', null]) {
    const r = await as(good)('https://s.example/');
    assert.equal(await r.text(), 'a,b\n1,2', String(good));
  }
});

test('cappedFetch: the answer behaves like a fetch Response', async () => {
  const f = makeCappedFetch({ fetchImpl: async () => new Response(JSON.stringify({ ok: 1 }), { status: 503, headers: { 'content-type': 'application/json', etag: '"v1"', 'retry-after': '30' } }) });
  const r = await f('https://s.example/a');
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('etag'), '"v1"');
  assert.equal(r.url, 'https://s.example/a');
  assert.deepEqual(await r.json(), { ok: 1 });
  const nm = makeCappedFetch({ fetchImpl: async () => new Response(null, { status: 304 }) });
  assert.equal((await nm('https://s.example/')).status, 304);
});

test('cappedFetch: no signal from the caller means the default timeout', async () => {
  let seen = null;
  const f = makeCappedFetch({ fetchImpl: async (url, init) => { seen = init.signal; return new Response('{}'); }, timeoutMs: 20 });
  await f('https://s.example/');
  await new Promise((r) => { setTimeout(r, 60); });
  assert.equal(seen.aborted, true);
});

test('every data source defaults to the capped fetch', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const root = path.join(import.meta.dirname, '..');
  const files = [];
  for (const d of ['data', 'data/weird', 'lib', 'lib/mcp']) {
    for (const n of await readdir(path.join(root, d))) if (n.endsWith('.js')) files.push(path.join(d, n));
  }
  const bare = [];
  for (const f of files) {
    if (f === path.join('data', 'http.js')) continue;
    const s = await readFile(path.join(root, f), 'utf8');
    if (/globalThis\.fetch\b|[^.\w]fetch\(/.test(s)) bare.push(f);
  }
  assert.deepEqual(bare, [], 'these call fetch without the cap');
  assert.equal(typeof cappedFetch, 'function');
});

// ---- file permissions -------------------------------------------------------------

test('pro db: folder 0700, database, WAL and SHM 0600, also when they were readable', async () => {
  const { openDb } = await import('../pro/db.js');
  const { mkdirSync, writeFileSync, chmodSync, statSync, mkdtempSync, rmSync } = await import('node:fs');
  const mode = (f) => statSync(f).mode & 0o777;
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-perm-'));
  try {
    // A new database.
    const file = path.join(dir, 'var', 'pro.db');
    const db = openDb(file);
    db.prepare('CREATE TABLE IF NOT EXISTS t (x)').run();
    assert.equal(mode(path.dirname(file)), 0o700);
    for (const f of [file, `${file}-wal`, `${file}-shm`]) assert.equal(mode(f), 0o600, f);
    db.close();
    // A restored copy left world-readable is locked down on the next start.
    chmodSync(path.dirname(file), 0o755);
    chmodSync(file, 0o644);
    const again = openDb(file);
    assert.equal(mode(path.dirname(file)), 0o700);
    assert.equal(mode(file), 0o600);
    again.close();
    // A folder shared with other things keeps its mode; the files are still locked down.
    const shared = path.join(dir, 'shared');
    mkdirSync(shared, { mode: 0o755 });
    chmodSync(shared, 0o755);
    writeFileSync(path.join(shared, 'other.txt'), 'x');
    const { lockDown } = await import('../pro/db.js');
    lockDown(path.join(shared, 'pro.db'), { root: shared });
    assert.equal(mode(shared), 0o755);
    assert.equal(mode(path.join(shared, 'pro.db')), 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guess secret: a readable secret file is put back to 0600', async () => {
  const { loadSecret } = await import('../data/guess.js');
  const { writeFileSync, chmodSync, statSync, mkdtempSync, rmSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-secret-'));
  try {
    const file = path.join(dir, '.cache', 'guess-secret');
    const s = loadSecret({ env: {}, file, log: { error() {} } });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
    chmodSync(file, 0o644);
    writeFileSync(file, `${s}\n`);
    assert.equal(loadSecret({ env: {}, file, log: { error() {} } }), s);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- security headers ----------------------------------------------------------------

test('headers: Permissions-Policy, HSTS without subdomains or preload, CSP object-src and form-action', async () => {
  const { securityHeaders } = await import('../lib/embed.js');
  const h = securityHeaders();
  assert.equal(h['Permissions-Policy'], 'camera=(), microphone=(), geolocation=(), payment=()');
  assert.equal(h['Strict-Transport-Security'], 'max-age=15552000');
  assert.doesNotMatch(h['Strict-Transport-Security'], /includeSubDomains|preload/i);
  const csp = h['Content-Security-Policy'].split('; ');
  for (const d of ["object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'"]) assert.ok(csp.includes(d), d);
});

// ---- DataFast never runs next to a Pro key ------------------------------------------------

test('DataFast: not loaded when a Pro key is in storage or on its way; goal() counts only our totals', async () => {
  const { loadDataFast, goal, proKeyPresent, PRO_KEY_STORAGE } = await import('../public/goal.js');
  const { LS, PENDING_KEY } = await import('../public/pro.js');
  assert.equal(PRO_KEY_STORAGE, LS.key, 'the same storage name as public/pro.js');
  const store = (map) => ({ getItem: (k) => map[k] ?? null });
  const none = { local: store({}), session: store({}), loc: { search: '?c=AAPL' } };
  assert.equal(proKeyPresent(none), false);
  assert.equal(proKeyPresent({ ...none, local: store({ [LS.key]: 'BB-KEY' }) }), true);
  assert.equal(proKeyPresent({ ...none, session: store({ [PENDING_KEY]: 'cs_1' }) }), true, 'the checkout return, before the key lands');
  assert.equal(proKeyPresent({ ...none, loc: { search: '?c=PRO&session_id=cs_1' } }), true);
  assert.equal(proKeyPresent({ local: { getItem() { throw new Error('denied'); } }, session: null, loc: null }), false);

  const doc = { head: { kids: [], appendChild(n) { this.kids.push(n); } }, documentElement: { classList: { contains: () => false } }, querySelector: () => null, createElement: () => ({ setAttribute() {} }) };
  const win = {};
  assert.equal(loadDataFast({ doc, nav: {}, win, pro: () => true }), false);
  assert.equal(doc.head.kids.length, 0, 'no script tag');
  assert.equal(win.datafast, undefined, 'no queue either');
  assert.equal(loadDataFast({ doc, nav: {}, win, pro: () => false }), true, 'non-Pro visitors keep it');

  const calls = [];
  const f = async (...a) => { calls.push(a); return {}; };
  const df = [];
  const w = { datafast: (...a) => df.push(a) };
  assert.deepEqual(goal('guess_shared', { via: 'copy' }, { win: w, nav: {}, fetchImpl: f, pro: () => true }), { datafast: false, counted: true });
  assert.equal(df.length, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(goal('pro_checkout_started', { plan: 'month' }, { win: w, nav: {}, fetchImpl: f, pro: () => false }).datafast, true, 'the checkout goal still reaches DataFast for non-Pro');
});

// ---- follow-ups ----------------------------------------------------------------------

test('cache: steady traffic on a dead source does not stretch the stale window', async () => {
  let t = 0;
  const cache = createCache({ now: () => t, staleMs: 1000, retryMs: 50 });
  await cache.cached('k', 100, async () => 'v');
  const down = async () => { throw new Error('down'); };
  // Every 60 ms a request finds the source down and gets the stale value...
  for (t = 100; t < 1100; t += 60) {
    const got = await cache.cached('k', 100, down);
    assert.equal(got.stale, true, `at ${t}`);
  }
  // ...until fetchedAt + ttl + staleMs (0 + 100 + 1000): then the old value is gone.
  t = 1100;
  await assert.rejects(cache.cached('k', 100, down), /down/);
  assert.equal(cache.has('k'), false);
});

test('gate: a job queued longer than maxWaitMs fails busy', async () => {
  const gate = makeGate({ concurrency: 1, maxQueue: 5, maxWaitMs: 30 });
  let release;
  const first = gate(() => new Promise((r) => { release = r; }));
  const queued = gate(async () => 'late');
  await assert.rejects(queued, (e) => e instanceof GateBusy);
  assert.deepEqual(gate.stats(), { running: 1, waiting: 0 });
  release('done');
  assert.equal(await first, 'done');
  assert.equal(await gate(async () => 'next'), 'next', 'a slot frees as usual');
});

test('precise52: a slow or busy chart never holds the quote', async () => {
  const { precise52 } = await import('../data/range52.js');
  const gold = { ticker: 'XAU=', label: 'GOLD', kind: 'spot', decimals: 2, range52Dp: 2, high52: 10, low52: 0 };
  const t0 = Date.now();
  const slow = await precise52(gold, { chart: () => new Promise(() => {}), waitMs: 40 });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(slow.high52, null, 'an unusable range shows as --');
  const busy = await precise52(gold, { chart: async () => { throw new GateBusy(); } });
  assert.equal(busy.low52, null);
});

test('reloadAfterKey: reloads to PRO only when DataFast or a beacon runs in the page', async () => {
  const { reloadAfterKey, takeShowKeyOnce, SHOW_KEY_ONCE } = await import('../public/goal.js');
  const map = {};
  const session = { getItem: (k) => map[k] ?? null, setItem: (k, v) => { map[k] = v; }, removeItem: (k) => { delete map[k]; } };
  const went = [];
  const loc = { replace: (u) => went.push(u) };
  assert.equal(reloadAfterKey({ doc: { querySelector: () => null }, loc, session }), false);
  assert.equal(went.length, 0);
  assert.equal(reloadAfterKey({ doc: { querySelector: (s) => (s.includes('datafa.st') ? {} : null) }, loc, session, showKey: true }), true);
  assert.deepEqual(went, ['/?c=PRO']);
  assert.equal(map[SHOW_KEY_ONCE], '1');
  assert.equal(takeShowKeyOnce(session), true);
  assert.equal(takeShowKeyOnce(session), false, 'once');
  assert.equal(reloadAfterKey({ doc: { querySelector() { throw new Error('x'); } }, loc, session }), false, 'never throws');
});

// ---- Ahrefs Web Analytics: the same gates as DataFast ----------------------------------------

test('Ahrefs: loaded for a free visitor (async, its data-key); never with GPC, for Pro, in a DESK panel, or twice', async () => {
  const { loadAhrefs, loadDataFast, analyticsBlocked, AHREFS, reloadAfterKey } = await import('../public/goal.js');
  const fakeDoc = ({ embed = false, present = '' } = {}) => ({
    head: { kids: [], appendChild(n) { this.kids.push(n); } },
    documentElement: { classList: { contains: (c) => embed && c === 'is-embed' } },
    querySelector: (sel) => (present && sel.includes(present) ? {} : null),
    createElement: (tag) => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
  });
  const doc = fakeDoc();
  assert.equal(loadAhrefs({ doc, nav: {}, win: {}, pro: () => false }), true);
  const s = doc.head.kids[0];
  assert.equal(s.src, 'https://analytics.ahrefs.com/analytics.js');
  assert.equal(s.async, true);
  assert.equal(s.attrs['data-key'], AHREFS.site);
  assert.match(AHREFS.site, /^[\w/+]{16,}$/);
  // The gates, one by one: each stops Ahrefs exactly where it stops DataFast.
  const cases = [
    ['GPC', { nav: { globalPrivacyControl: true }, pro: () => false }],
    ['Pro', { nav: {}, pro: () => true }],
    ['a DESK panel', { nav: {}, pro: () => false, embed: true }],
  ];
  for (const [name, c] of cases) {
    const d = fakeDoc({ embed: c.embed });
    assert.equal(loadAhrefs({ doc: d, nav: c.nav, win: {}, pro: c.pro }), false, name);
    assert.equal(d.head.kids.length, 0, `${name}: no script tag`);
    assert.equal(loadDataFast({ doc: fakeDoc({ embed: c.embed }), nav: c.nav, win: {}, pro: c.pro }), false, `${name}: DataFast too`);
    assert.equal(analyticsBlocked({ doc: d, nav: c.nav, win: {}, pro: c.pro }), true, name);
  }
  assert.equal(loadAhrefs({ doc: fakeDoc({ present: 'analytics.ahrefs.com' }), nav: {}, win: {}, pro: () => false }), false, 'never twice');
  assert.equal(loadAhrefs({ doc: undefined, nav: {}, win: undefined }), false);
  // Both load on a page, from the same place.
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync('public/goal.js', 'utf8'), /\{ loadDataFast\(\); loadAhrefs\(\); \}/);
  // A key that lands later reloads the page when Ahrefs alone runs, so it stops for Pro.
  const loc = { replaced: null, replace(u) { this.replaced = u; } };
  assert.equal(reloadAfterKey({ doc: { querySelector: (q) => (q.includes('analytics.ahrefs.com') ? {} : null) }, loc, session: null }), true);
  assert.equal(loc.replaced, '/?c=PRO');
});

test('CSP: Ahrefs may load its script and send page views, nothing wider', async () => {
  const { securityHeaders } = await import('../lib/embed.js');
  const dirs = securityHeaders()['Content-Security-Policy'].split('; ');
  assert.ok(dirs.includes("script-src 'self' https://datafa.st https://analytics.ahrefs.com https://static.cloudflareinsights.com"));
  assert.ok(dirs.includes("connect-src 'self' https://datafa.st https://analytics.ahrefs.com https://cloudflareinsights.com"));
  assert.ok(!dirs.some((d) => /ahrefs\.com\/|\*\.ahrefs/.test(d)), 'the origin only');
});
