// Provenance: the envelope on every /api answer, the freshness dot's tooltip and list,
// the DATA, STATUS and CHANGES screens, and honest gaps (Oct 2025 CPI).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  envelope, isoOf, combine, provenanceFor, provenanceJson, ROUTES, DATASETS, DELAYS, LICENCES, dataRows,
  weirdDataset, statusRows, upstreamState, UPSTREAMS, gaugeEnvelope, weirdEnvelope, liveDelay,
} from '../lib/provenance.js';
import { dotTitle, popoverHtml, worstOf, ageWords, asOfWords, delayWord, flatten, MAX_PARTS } from '../public/provenance.js';
import { createCache, cacheStats, callerName } from '../data/cache.js';
import { GAUGES } from '../data/weird/index.js';
import { makeCpi, CPI_GAPS } from '../data/cpi.js';
import { cpiLoader, cpiGapNote } from '../data/whatif.js';
import { bls } from '../data/whatif-service.js';
import { dataTable, secLine, parse as parseData } from '../public/screens/data.js';
import { statusTable } from '../public/screens/status.js';
import { changesTable } from '../public/screens/changes.js';
import { parseCommand, FKEYS } from '../public/app.js';

const NOW = Date.parse('2026-09-25T20:00:30.000Z');
const UPD = '2026-09-25T20:00:00.000Z';

// ---- the envelope ------------------------------------------------------------------------

test('envelope: MCP field names plus delay; age is now minus fetched_at, never below 0', () => {
  const e = envelope({ source: 'SEC EDGAR', source_url: 'https://www.sec.gov/', as_of: '2026-07-31', fetched_at: UPD, delay: 'quarterly', note: 'n', dataset: 'sec-facts', now: NOW });
  assert.deepEqual(Object.keys(e), ['source', 'source_url', 'as_of', 'fetched_at', 'age_seconds', 'delay', 'note', 'dataset']);
  assert.equal(e.as_of, '2026-07-31T00:00:00.000Z');
  assert.equal(e.age_seconds, 30);
  assert.equal(envelope({ source: 'x', source_url: 'y', fetched_at: NOW + 5000, delay: 'static', now: NOW }).age_seconds, 0);
  assert.equal(envelope({ source: 'x', source_url: 'y', delay: 'bogus', now: NOW }).delay, 'static', 'an unknown class is never passed on');
  assert.equal(isoOf('2025-10'), '2025-10-01T00:00:00.000Z');
  assert.equal(isoOf('nope'), null);
});

test('combine: the worst part on top (slowest class, then oldest), every part kept', () => {
  const a = envelope({ source: 'A', source_url: 'u', fetched_at: UPD, delay: 'real-time', now: NOW });
  const b = envelope({ source: 'B', source_url: 'u', fetched_at: UPD, delay: 'delayed-15m', now: NOW });
  const c = combine([a, b, null]);
  assert.equal(c.source, 'B');
  assert.equal(c.parts.length, 2);
  assert.equal(combine([a]), a);
  assert.equal(combine([]), null);
});

// One sample answer per route: each must get a full envelope with a known class.
const Q = (over) => ({ asOf: '2026-09-25T16:00:00.000-0400', realTime: true, ...over });
const SAMPLES = {
  '/api/markets': { instruments: [Q({ kind: 'stock' }), Q({ kind: 'future', realTime: false }), Q({ kind: 'index', realTime: false })], updated: UPD },
  '/api/fxmajors': { pairs: [Q({ kind: 'fx' })], updated: UPD },
  '/api/quote': Q({ kind: 'stock', updated: UPD }),
  '/api/quotes': { quotes: [Q({})], updated: UPD },
  '/api/world': { indexes: [Q({ realTime: false })], updated: UPD },
  '/api/sectors': { sectors: [Q({})], updated: UPD },
  '/api/bonds': { bonds: [Q({ realTime: false })], updated: UPD },
  '/api/commodities': { commodities: [Q({ realTime: false })], updated: UPD },
  '/api/movers': { gainers: [], updated: UPD },
  '/api/heatmap': { stocks: [], updated: UPD },
  '/api/fishtank': { stocks: [], updated: UPD },
  '/api/crypto': { coins: [{ asOf: UPD }], updated: UPD },
  '/api/fx': { date: '2026-09-25', updated: UPD },
  '/api/fxmatrix': { date: '2026-09-25', live: { EUR: 1 }, updated: UPD },
  '/api/curve': { tenors: [Q({})], officialDate: '2026-09-25', updated: UPD },
  '/api/rates': { yields: [Q({})], yieldsUpdated: UPD, fed: { date: '2026-09-24' }, fedUpdated: UPD, mortgage: { date: '2026-09-24' }, mortgageUpdated: UPD, updated: UPD },
  '/api/fedpath': { months: [], fed: { date: '2026-09-24' }, updated: UPD },
  '/api/chart': { ticker: 'AAPL', bar: '1D', points: [{ t: Date.parse('2026-09-25T04:00:00Z'), v: 1 }], updated: UPD },
  '/api/compare': { series: [], updated: UPD },
  '/api/history': { rows: [{ date: '2026-09-25' }], updated: UPD },
  '/api/chart-events': { earnings: [], updated: UPD },
  '/api/chart-news': { items: [{ time: UPD }], updated: UPD },
  '/api/tickernews': { items: [{ time: UPD }], updated: UPD },
  '/api/why': { secOk: true, logSince: UPD, updated: UPD },
  '/api/cpi': { latest: { year: 2026, month: 8 }, updated: UPD },
  '/api/news': { items: [{ time: UPD }], updated: UPD },
  '/api/whatif': { asOf: '2026-09-25', replay: { cpi: { gap: 'Gap sentence.' } }, updated: UPD },
  '/api/whatif/catalog': { built: '2026-09-27' },
  '/api/funding': { asOf: '2026-09-25', updated: UPD },
  '/api/financials': { quarterly: { periods: [{ filed: '2026-07-31' }] }, annual: { periods: [{ filed: '2025-10-31' }] }, updated: UPD },
  '/api/screen': { asOf: '2026-09-24', updated: UPD },
  '/api/breadth': { sessionDate: '2026-09-24', exchangesUpdated: UPD, sp100Updated: UPD, updated: UPD },
  '/api/earnings': { updated: UPD },
  '/api/beats': { updated: UPD },
  '/api/calendar': { updated: UPD },
  '/api/profile': { updated: UPD },
  '/api/dividends': { exDate: '2026-08-10', updated: UPD },
  '/api/insiders': { rows: [{ date: '2026-09-01' }], updated: UPD },
  '/api/owners': { updated: UPD },
  '/api/filings': { rows: [{ accepted: '2026-09-24T22:30:07.000Z', filed: '2026-09-24' }], updated: UPD },
  '/api/shorts': { rows: [{ date: '2026-09-15' }], updated: UPD },
  '/api/value': { asOf: '2026-09-25', updated: UPD },
  '/api/ipos': { updated: UPD },
  '/api/splits': { updated: UPD },
  '/api/exdiv': { updated: UPD },
  '/api/options': { asOf: UPD, updated: UPD },
  '/api/economy': { series: [{ date: '2026-08-01' }], updated: UPD },
  '/api/search': { results: [] },
  '/api/trending': { updated: UPD, rows: [] },
  '/api/bbrk': { updated: UPD, day: '2026-09-25', counts: {} },
  '/api/guess/today': { n: 1 },
  '/api/guess/check': { ok: true },
  '/api/guess/reveal': { ticker: 'AAPL' },
};

test('every data route has a sample here, and every sample gets a complete envelope', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(ROUTES).sort(), 'a new route needs a sample and an envelope');
  const ids = new Set(DATASETS.map((d) => d.id));
  for (const [path, body] of Object.entries(SAMPLES)) {
    const p = provenanceFor(path, body, { now: NOW });
    assert.ok(p, `${path}: an envelope`);
    for (const k of ['source', 'source_url', 'as_of', 'fetched_at', 'age_seconds', 'delay']) assert.ok(p[k] !== undefined && p[k] !== '', `${path}: ${k}`);
    assert.ok(DELAYS.includes(p.delay), `${path}: delay ${p.delay}`);
    assert.match(p.source_url, /^https:\/\//, `${path}: source_url`);
    assert.ok(Number.isFinite(Date.parse(p.as_of)) && Number.isFinite(Date.parse(p.fetched_at)), `${path}: ISO times`);
    assert.ok(p.age_seconds >= 0);
    for (const part of p.parts || [p]) assert.ok(ids.has(part.dataset), `${path}: dataset ${part.dataset} is a DATA row`);
  }
});

test('delay classes: RT rows real-time, futures delayed 10m, other delayed rows 15m; the worst on top', () => {
  const p = provenanceFor('/api/markets', SAMPLES['/api/markets'], { now: NOW });
  assert.equal(p.delay, 'delayed-15m');
  assert.deepEqual(p.parts.map((x) => x.delay).sort(), ['delayed-10m', 'delayed-15m', 'real-time']);
  assert.equal(provenanceFor('/api/commodities', SAMPLES['/api/commodities'], { now: NOW }).delay, 'delayed-10m');
  assert.equal(provenanceFor('/api/quote', SAMPLES['/api/quote'], { now: NOW }).delay, 'real-time');
  assert.equal(provenanceFor('/api/chart', SAMPLES['/api/chart'], { now: NOW }).delay, 'end-of-day', 'daily bars');
  assert.equal(provenanceFor('/api/chart', { ...SAMPLES['/api/chart'], bar: '5M' }, { now: NOW }).delay, 'real-time', 'a US stock intraday');
  assert.equal(liveDelay('DAX'), 'delayed-15m');
  assert.equal(provenanceFor('/api/chart', SAMPLES['/api/chart'], { now: NOW }).note, 'split-adjusted, not dividend-adjusted');
  assert.equal(provenanceFor('/api/rates', SAMPLES['/api/rates'], { now: NOW }).delay, 'weekly', 'mortgages are the slowest part');
  assert.equal(provenanceFor('/api/nope', { a: 1 }), null);
  assert.equal(provenanceFor('/api/markets', [1, 2]), null);
});

test('WEIRD: one envelope per gauge, one summary line on top', () => {
  const g = { id: 'canal', ok: true, source: 'IMF PortWatch', asOf: '2026-09-20', updated: UPD };
  const e = gaugeEnvelope(g, NOW);
  assert.equal(e.dataset, 'weird-canal');
  assert.equal(e.delay, 'daily');
  assert.equal(gaugeEnvelope({ id: 'x', ok: false }), null, 'NO DATA has no envelope');
  const all = weirdEnvelope([g, { ...g, id: 'eggs', source: 'FRED' }, { ...g, id: 'lipstick', source: 'FRED' }], NOW);
  assert.equal(all.source, 'WEIRD gauges, one source each');
  assert.equal(all.delay, 'monthly', 'the class most gauges have');
  assert.equal(all.parts.length, 3);
  assert.equal(provenanceFor('/api/weird/canal', g, { now: NOW }).source, 'IMF PortWatch');
  assert.match(gaugeEnvelope({ ...g, id: 'eggs' }, NOW).note, /Oct 2025 not published/);
});

test('the middleware: 2xx objects get provenance; errors and routes without one do not', () => {
  const run = (path, status, body) => {
    let sent;
    const res = { statusCode: status, json: (b) => { sent = b; return b; } };
    provenanceJson({ now: () => NOW })({ originalUrl: `${path}?s=AAPL`, query: {} }, res, () => {});
    res.json(body);
    return sent;
  };
  assert.equal(run('/api/quote', 200, SAMPLES['/api/quote']).provenance.dataset, 'quotes');
  assert.equal(run('/api/quote', 200, SAMPLES['/api/quote']).last, undefined, 'the answer is otherwise as it was');
  assert.equal(run('/api/quote', 503, { error: 'unavailable' }).provenance, undefined);
  assert.equal(run('/api/sponsors', 200, { items: [] }).provenance, undefined);
});

// ---- the dot -----------------------------------------------------------------------------

const env = (over) => ({ ...envelope({ source: 'CNBC quote service', source_url: 'u', as_of: '2026-09-25T19:59:50.000Z', fetched_at: UPD, delay: 'real-time', now: NOW }), receivedAt: NOW, ...over });

test('dot tooltip: "SOURCE · as of HH:MM:SS ET · Ns old · class", the worst live part', () => {
  assert.equal(dotTitle([env({})], { now: NOW }), 'CNBC quote service · as of 15:59:50 ET · 30s old · real-time');
  const mixed = [env({}), env({ source: 'CNBC bars service', delay: 'end-of-day' }), env({ source: 'Futures', delay: 'delayed-10m' })];
  assert.match(dotTitle(mixed, { now: NOW }), /^Futures .* delayed 10m$/, 'live prices: the slowest live class, not the daily bars');
  assert.match(dotTitle([env({ delay: 'quarterly', source: 'SEC EDGAR', as_of: '2026-07-31T00:00:00.000Z' })], { now: NOW }), /^SEC EDGAR · as of Jul 31 · 30s old · quarterly$/);
  assert.match(dotTitle([env({})], { now: NOW + 90_000 }), /120s old|2m old/, 'the age keeps counting after the answer arrived');
  assert.match(dotTitle([env({})], { now: NOW, stale: true }), /last known data$/);
  assert.equal(dotTitle([], { now: NOW }), '');
  assert.equal(worstOf([]), null);
  assert.deepEqual([ageWords(42), ageWords(300), ageWords(7200), ageWords(200000), ageWords(NaN)], ['42s', '5m', '2h', '2d', '--']);
  assert.equal(asOfWords('2026-09-24T19:59:50.000Z', NOW), 'Sep 24 15:59:50 ET');
  assert.deepEqual(['real-time', 'delayed-15m', 'end-of-day', 'x'].map(delayWord), ['real-time', 'delayed 15m', 'end of day', '--']);
});

test('dot popover: one line per source linking to its DATA row, then All sources: DATA', () => {
  const html = popoverHtml([env({ dataset: 'quotes' }), env({ source: 'SEC EDGAR', delay: 'quarterly', dataset: 'sec-facts' }), env({ dataset: 'quotes' })], { now: NOW });
  assert.equal((html.match(/<li>/g) || []).length, 2, 'the same source and class once');
  assert.match(html, /data-cmd="DATA QUOTES"/);
  assert.match(html, /data-cmd="DATA SEC-FACTS"/);
  assert.match(html, /All sources: DATA<\/a>$/);
  const many = Array.from({ length: 12 }, (_, i) => env({ source: `S${i}` }));
  assert.match(popoverHtml(many, { now: NOW }), /\+4 more/);
  // An answer with many parts (WEIRD) stays one line.
  const w = { ...env({ source: 'WEIRD gauges, one source each' }), parts: Array.from({ length: MAX_PARTS + 1 }, (_, i) => env({ source: `G${i}` })) };
  assert.equal(flatten([w]).length, 1);
  assert.doesNotMatch(html, /<script|on\w+=/);
});

// ---- DATA, STATUS, CHANGES ----------------------------------------------------------------

test('DATA rows: every field filled, a known licence and class, every WEIRD gauge listed', () => {
  const gauges = GAUGES.map((g) => ({ id: g.id, source: g.source }));
  const rows = dataRows({ stats: [], gauges, weird: [], edgar: null, now: NOW });
  assert.equal(rows.length, DATASETS.length + GAUGES.length);
  for (const r of rows) {
    for (const k of ['id', 'group', 'name', 'source', 'url', 'licence', 'coverage', 'history', 'cadence', 'delay', 'gaps']) assert.ok(r[k], `${r.id}: ${k}`);
    assert.ok(LICENCES.includes(r.licence), `${r.id}: licence ${r.licence}`);
    assert.ok(DELAYS.includes(r.delay), `${r.id}: delay`);
    assert.match(r.url, /^https:\/\//);
    assert.equal(r.age_seconds, null, 'nothing loaded: no age, never a made-up one');
  }
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'ids are unique');
  assert.match(rows.find((r) => r.id === 'cpi').gaps, /Oct 2025 not published/);
  assert.match(rows.find((r) => r.id === 'whatif').gaps, /carry Sep 2025 forward/);
  assert.equal(weirdDataset({ id: 'odds', source: 'Polymarket' }).name.split(':')[0], 'CHANCES');
});

test('DATA rows: the measured age comes from the caches, the WEIRD values and the EDGAR watcher', () => {
  const stats = [{ name: 'quotes', okAt: NOW - 12_000, failAt: 0, ms: 300 }];
  const rows = dataRows({ stats, gauges: [{ id: 'canal', source: 'IMF PortWatch' }], weird: [{ id: 'canal', updated: new Date(NOW - 60_000).toISOString() }], edgar: { okAt: NOW - 3000 }, now: NOW });
  assert.equal(rows.find((r) => r.id === 'quotes').age_seconds, 12);
  assert.equal(rows.find((r) => r.id === 'weird-canal').age_seconds, 60);
  assert.equal(rows.find((r) => r.id === 'sec-feed').age_seconds, 3);
  const html = dataTable(rows, { lit: 'quotes' });
  assert.match(html, /<tr id="data-quotes" class="is-lit">/);
  assert.match(html, />12s</);
  assert.match(html, /restricted: display only/);
  assert.equal(secLine({ seen_within_seconds: 42 }), 'SEC filings: seen within ~42s of acceptance');
  assert.equal(secLine(null), 'SEC filings: seen within -- of acceptance');
  assert.deepEqual(parseData(['CPI']), { id: 'cpi' });
  assert.deepEqual(parseData(['A', 'B']), { error: 'usage' });
});

test('STATUS: OK, SLOW, FAILING or -- per upstream, from the caches only', () => {
  const s = (over) => ({ name: 'quotes', okAt: 0, failAt: 0, ms: 0, ...over });
  assert.equal(upstreamState(['quotes'], [s({ okAt: 10, ms: 200 })]).state, 'OK');
  assert.equal(upstreamState(['quotes'], [s({ okAt: 10, ms: 9000 })]).state, 'SLOW');
  assert.equal(upstreamState(['quotes'], [s({ okAt: 10, failAt: 20 })]).state, 'FAILING');
  assert.equal(upstreamState(['quotes'], []).state, '--');
  const rows = statusRows({ stats: [s({ okAt: NOW - 5000, ms: 100 })], weird: [{ id: 'canal', ok: true, source: 'IMF PortWatch', updated: UPD }], edgar: { okAt: NOW, failAt: 0 }, now: NOW });
  assert.equal(rows.length, UPSTREAMS.length + 2);
  assert.equal(rows[0].last_ok_seconds, 5);
  const html = statusTable(rows);
  assert.match(html, /CNBC quote service/);
  assert.match(html, /st-ok">OK/);
  assert.doesNotMatch(JSON.stringify(rows), /@|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'no personal data');
});

test('CHANGES: the hand-kept list is valid, plain and newest first', () => {
  const file = JSON.parse(readFileSync(new URL('../data/changes.json', import.meta.url), 'utf8'));
  assert.ok(file.items.length >= 10);
  for (const x of file.items) {
    assert.match(x.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(x.text.length > 5 && x.text.length < 160);
  }
  const html = changesTable([{ date: '2026-09-25', text: 'Old' }, { date: '2026-09-27', text: 'New <b>' }]);
  assert.ok(html.indexOf('New') < html.indexOf('Old'));
  assert.match(html, /New &lt;b&gt;/);
});

test('DATA, SOURCES, STATUS, CHANGES are commands, not function keys', () => {
  assert.equal(parseCommand('DATA').name, 'DATA');
  assert.equal(parseCommand('SOURCES').name, 'DATA');
  assert.deepEqual(parseCommand('DATA CPI').args, { id: 'cpi' });
  assert.equal(parseCommand('STATUS').name, 'STATUS');
  assert.equal(parseCommand('CHANGES').name, 'CHANGES');
  assert.ok(!FKEYS.some((k) => ['DATA', 'STATUS', 'CHANGES'].includes(k.cmd)));
});

// ---- caches ---------------------------------------------------------------------------------

test('cache stats: each module named, loads and failures counted; forget drops one key', async () => {
  const c = createCache({ name: 'test-prov' });
  await c.cached('a', 60_000, async () => 1);
  await assert.rejects(c.cached('b', 60_000, async () => { throw new Error('down'); }));
  const s = cacheStats().find((x) => x.name === 'test-prov');
  assert.equal(s.loads, 1);
  assert.equal(s.fails, 1);
  assert.equal(s.error, 'down');
  assert.ok(s.okAt > 0 && s.failAt >= s.okAt);
  assert.equal(c.forget('a'), true);
  assert.equal(c.has('a'), false);
  let n = 0;
  await c.cached('a', 60_000, async () => { n += 1; return 2; });
  assert.equal(n, 1, 'loaded again after forget');
  assert.equal(callerName('Error\n    at x (file:///srv/app/data/cache.js:1:1)\n    at makeQuotes (file:///srv/app/data/quotes.js:360:5)'), 'quotes');
  assert.equal(callerName('Error\n    at y (file:///srv/app/data/lists.js:1:1)\n    at z (file:///srv/app/data/world.js:9:1)'), 'world');
  assert.equal(callerName('Error\n    at q (file:///srv/app/data/weird/canal.js:3:1)'), 'weird/canal');
});

// ---- honest gaps: Oct 2025 CPI -------------------------------------------------------------

test('CPI: Oct 2025 is listed as a gap with its reason, never filled in', async () => {
  const { getCpi } = makeCpi({ fetchImpl: async () => { throw new Error('offline'); } });
  const d = await getCpi({ amount: '100', year: '2000' });
  assert.deepEqual(d.gaps.map((g) => g.month), ['2025-10']);
  assert.match(d.gaps[0].reason, /shutdown/);
  assert.equal(CPI_GAPS[0].label, 'Oct 2025');
  assert.ok(!d.series.some((p) => p.d === '2025-10'), 'no made-up October point');
  assert.match(provenanceFor('/api/cpi', d, { now: NOW }).note, /Oct 2025 not published/);
});

test('WHATIF: the missing month is carried forward, and said so once in Details and the envelope', () => {
  const cpi = cpiLoader(bls);
  assert.ok(cpi.missing.includes('2025-10'));
  assert.equal(bls.series.CUUR0000SA0.values['2025-10'], undefined, 'the baked file keeps the hole');
  assert.equal(cpi.at('2025-10'), bls.series.CUUR0000SA0.values['2025-09'], 'the maths carries September forward');
  const note = cpiGapNote(cpi.missing, '2024-01', '2026-09');
  assert.match(note, /^BLS never published CPI-U or average prices for Oct 2025 \(US government shutdown\), so Sep 2025 is carried forward for that month\.$/);
  assert.equal(cpiGapNote(cpi.missing, '2026-01', '2026-09'), '', 'a replay after the gap says nothing');
  assert.match(provenanceFor('/api/whatif', SAMPLES['/api/whatif'], { now: NOW }).note, /Gap sentence/);
  // One sentence inside Details only: the screen renders it in the small-print list.
  const src = readFileSync(new URL('../public/screens/whatif.js', import.meta.url), 'utf8');
  assert.equal((src.match(/cpi\?\.gap/g) || []).length, 1);
});

// ---- house rules ------------------------------------------------------------------------------

test('provenance files: no banned brand word, no em dash, no emoji, no amber', () => {
  const files = ['../lib/provenance.js', '../public/provenance.js', '../public/screens/data.js', '../public/screens/status.js', '../public/screens/changes.js', '../data/changes.json', '../data/edgarwatch.js'];
  for (const f of files) {
    const s = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(s, new RegExp(['Bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, f);
    assert.doesNotMatch(s, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, f);
    assert.doesNotMatch(s, /amber|orange|#ffa500|#ffbf00/i, f);
  }
  const words = JSON.stringify(DATASETS).toLowerCase();
  assert.doesNotMatch(words, /\b(buy|sell|hold) (it|now|this)\b|\brecommend/);
});
