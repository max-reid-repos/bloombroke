// Provenance: the envelope on every /api answer, the freshness dot's tooltip and list,
// the DATA, STATUS and CHANGES screens, and honest gaps (Oct 2025 CPI).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SEEN_AS_OF, nyCloseIso, etagOf, envelope, isoOf, combine, provenanceFor, provenanceJson, ROUTES, DATASETS, DELAYS, LICENCES, dataRows,
  weirdDataset, statusGroups, upstreamState, STATUS_GROUPS, gaugeEnvelope, weirdEnvelope, liveDelay, mountProvenanceRoutes, MDP,
} from '../lib/provenance.js';
import { dotTitle, popoverHtml, worstOf, ageWords, asOfWords, delayWord, flatten, MAX_PARTS, lastUpdateWords } from '../public/provenance.js';
import { createCache, cacheStats, callerName } from '../data/cache.js';
import { GAUGES } from '../data/weird/index.js';
import { makeCpi, CPI_GAPS } from '../data/cpi.js';
import { cpiLoader, cpiGapNote } from '../data/whatif.js';
import { bls } from '../data/whatif-service.js';
import { dataTable, secLine, parse as parseData, ageTitle } from '../public/screens/data.js';
import { statusGrid, proOnlyHtml, stateHtml, PRO_ONLY_LINE } from '../public/screens/status.js';
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

// Vendor names never leave the server in DATA, STATUS, the dot or the envelope.
const VENDORS = /CNBC|Nasdaq|NASDAQ|Yahoo|Cboe|CBOE|CoinGecko|Frankfurter|Forex ?Factory|Seeking Alpha|Queue-Times|ApeWisdom|pizzint|Polymarket|Drewry|Forbes|DICJ|IMF|PortWatch|FRED|Freddie|New York Fed|NY Fed|MarketWatch|Dow Jones|Business ?Wire|PR ?Newswire|GlobeNewswire|Reddit|Algolia|Hacker News|App Store|Wikimedia|iShares|EDGAR Online/;
// Links allowed: US government, the ECB (its terms require it be cited), credits a licence requires.
const GOV_URL = /^https:\/\/([a-z0-9-]+\.)*(sec\.gov|bls\.gov|treasury\.gov|federalreserve\.gov|noaa\.gov|cdc\.gov|ecb\.europa\.eu|naturalearthdata\.com|github\.com\/TheEconomist)\b/;

test('every data route has a sample here, and every sample gets a complete envelope', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(ROUTES).sort(), 'a new route needs a sample and an envelope');
  const ids = new Set(DATASETS.map((d) => d.id));
  for (const [path, body] of Object.entries(SAMPLES)) {
    const p = provenanceFor(path, body, { now: NOW });
    assert.ok(p, `${path}: an envelope`);
    for (const k of ['source', 'as_of', 'fetched_at', 'age_seconds', 'delay']) assert.ok(p[k] !== undefined && p[k] !== '', `${path}: ${k}`);
    assert.ok(DELAYS.includes(p.delay), `${path}: delay ${p.delay}`);
    // A link only for a named public source; a class has none.
    for (const part of p.parts || [p]) if (part.source_url) assert.match(part.source_url, GOV_URL, `${path}: ${part.source_url}`);
    assert.ok(Number.isFinite(Date.parse(p.as_of)) && Number.isFinite(Date.parse(p.fetched_at)), `${path}: ISO times`);
    assert.ok(p.age_seconds >= 0);
    for (const part of p.parts || [p]) assert.ok(ids.has(part.dataset), `${path}: dataset ${part.dataset} is a DATA row`);
    assert.doesNotMatch(JSON.stringify(p), VENDORS, `${path}: no vendor name in the envelope`);
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
  assert.equal(provenanceFor('/api/weird/canal', g, { now: NOW }).source, 'public web data', 'a class, not the vendor');
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
  assert.equal(SEEN_AS_OF.get('quotes').as_of, '2026-09-25T20:00:00.000Z', 'DATA learns the data age from the answers given');
});

// ---- the dot -----------------------------------------------------------------------------

const env = (over) => ({ ...envelope({ source: 'CNBC quote service', source_url: 'u', as_of: '2026-09-25T19:59:50.000Z', fetched_at: UPD, delay: 'real-time', now: NOW }), receivedAt: NOW, ...over });

test('dot tooltip: "SOURCE · as of HH:MM:SS ET · checked Ns ago · class", the worst live part', () => {
  assert.equal(dotTitle([env({})], { now: NOW }), 'CNBC quote service · as of 15:59:50 ET · checked 30s ago · real-time');
  // Market closed: checked seconds ago, but the data is Friday's close. Two ages, never mixed.
  const sunday = Date.parse('2026-09-27T07:00:00.000Z');
  const closed = env({ as_of: '2026-09-25T20:00:00.000Z', fetched_at: new Date(sunday - 6000).toISOString(), receivedAt: sunday, age_seconds: 6 });
  assert.equal(dotTitle([closed], { now: sunday }), 'CNBC quote service · last update Sep 25 16:00 ET · checked 6s ago · real-time');
  assert.match(popoverHtml([closed], { now: sunday }), /real-time · checked 6s ago · last update Sep 25 16:00 ET/);
  assert.doesNotMatch(popoverHtml([env({})], { now: NOW }), /last update/, 'fresh data: no second age');
  assert.equal(lastUpdateWords('2026-09-25T00:00:00.000Z', sunday), 'Sep 25', 'a day with no time');
  const mixed = [env({}), env({ source: 'CNBC bars service', delay: 'end-of-day' }), env({ source: 'Futures', delay: 'delayed-10m' })];
  assert.match(dotTitle(mixed, { now: NOW }), /^Futures .* delayed 10m$/, 'live prices: the slowest live class, not the daily bars');
  assert.match(dotTitle([env({ delay: 'quarterly', source: 'SEC EDGAR', as_of: '2026-07-31T00:00:00.000Z' })], { now: NOW }), /^SEC EDGAR · last update Jul 31 · checked 30s ago · quarterly$/);
  assert.match(dotTitle([env({})], { now: NOW + 90_000 }), /checked (120s|2m) ago/, 'the age keeps counting after the answer arrived');
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

test('DATA rows: every field filled, a source class, no licence column, no vendor names', () => {
  const gauges = GAUGES.map((g) => ({ id: g.id, source: g.source }));
  const rows = dataRows({ stats: [], gauges, weird: [], edgar: null, now: NOW });
  assert.equal(rows.length, DATASETS.length + GAUGES.length);
  for (const r of rows) {
    for (const k of ['id', 'group', 'name', 'source', 'coverage', 'history', 'cadence', 'delay', 'gaps']) assert.ok(r[k], `${r.id}: ${k}`);
    assert.equal(r.licence, undefined, `${r.id}: the licence stays on the server`);
    assert.ok(DELAYS.includes(r.delay), `${r.id}: delay`);
    if (r.url) assert.match(r.url, GOV_URL, `${r.id}: a link only for a named public source`);
  }
  assert.doesNotMatch(JSON.stringify(rows), VENDORS, 'no vendor name in DATA');
  const html = dataTable(rows);
  assert.doesNotMatch(html, VENDORS);
  assert.doesNotMatch(html, /Licence|third-party terms|public domain/, 'no licence column');
  const src = (id) => rows.find((r) => r.id === id).source;
  assert.deepEqual(['quotes', 'fx', 'calendar', 'news', 'weird-pizza', 'bbrk', 'sec-facts', 'cpi', 'treasury', 'news-macro', 'weird-beige', 'weird-sick', 'weird-bigmac', 'weird-waffle'].map(src),
    [MDP, 'reference FX rates (ECB)', 'exchange calendars', 'news publishers', 'public web data', 'our own counters', 'SEC EDGAR', 'BLS', 'US Treasury', 'Federal Reserve Board, BLS', 'Federal Reserve Board', 'CDC', 'The Economist (CC BY 4.0)', 'National Hurricane Center; stores © OpenStreetMap contributors (ODbL)'],
    'government sources named, licence credits kept, the rest a class');
  assert.equal(rows.find((r) => r.id === 'quotes').url, undefined, 'no link to a vendor');
  const fresh = dataRows({ stats: [], gauges, weird: [], edgar: null, seen: new Map(), now: NOW });
  assert.ok(fresh.every((r) => r.age_seconds === null && r.checked_seconds === null), 'nothing loaded: no age, never a made-up one');
  assert.deepEqual(LICENCES, ['public domain', 'credit required', 'share-alike', 'third-party terms']);
  const lic = (id) => [...DATASETS].find((d) => d.id === id)?.licence ?? weirdDataset({ id: id.replace('weird-', '') }).licence;
  assert.deepEqual(['sec-facts', 'cpi', 'treasury', 'nyfed', 'fx', 'crypto', 'economy', 'mortgage', 'quotes', 'geo', 'weird-waffle', 'weird-bigmac', 'weird-panic', 'weird-canal'].map(lic),
    ['public domain', 'public domain', 'public domain', 'third-party terms', 'credit required', 'third-party terms', 'third-party terms', 'third-party terms', 'third-party terms', 'public domain', 'share-alike', 'credit required', 'public domain', 'third-party terms']);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'ids are unique');
  assert.match(rows.find((r) => r.id === 'cpi').gaps, /Oct 2025 not published/);
  assert.match(rows.find((r) => r.id === 'whatif').gaps, /carry Sep 2025 forward/);
  assert.equal(weirdDataset({ id: 'odds', source: 'Polymarket' }).name.split(':')[0], 'CHANCES');
});

test('DATA rows: data age from the last answer, checked age from the caches, WEIRD and EDGAR', () => {
  const stats = [{ name: 'quotes', okAt: NOW - 12_000, failAt: 0, ms: 300 }];
  const seen = new Map([['quotes', { as_of: new Date(NOW - 7200_000).toISOString(), at: NOW }]]);
  const rows = dataRows({ stats, seen, gauges: [{ id: 'canal', source: 'IMF PortWatch' }], weird: [{ id: 'canal', asOf: '2026-09-20', updated: new Date(NOW - 60_000).toISOString() }], edgar: { okAt: NOW - 3000, newestAt: NOW - 40_000 }, now: NOW });
  const q = rows.find((r) => r.id === 'quotes');
  assert.deepEqual([q.age_seconds, q.checked_seconds], [7200, 12], 'the data is 2 h old, the source was asked 12 s ago');
  const c = rows.find((r) => r.id === 'weird-canal');
  assert.equal(c.checked_seconds, 60);
  assert.equal(c.as_of, '2026-09-20T00:00:00.000Z');
  const f = rows.find((r) => r.id === 'sec-feed');
  assert.deepEqual([f.age_seconds, f.checked_seconds], [40, 3]);
  const html = dataTable(rows, { lit: 'quotes' });
  assert.match(html, /<tr id="data-quotes" class="is-lit">/);
  assert.match(html, /title="Checked 12s ago · last update [^"]+">2h</);
  assert.equal(ageTitle({ checked_seconds: null, as_of: null }), 'Not checked since the server started');
  assert.equal(secLine({ seen_within_seconds: 42 }), 'SEC filings: seen within ~42s of acceptance');
  assert.equal(secLine(null), 'SEC filings: seen within -- of acceptance');
  assert.deepEqual(parseData(['CPI']), { id: 'cpi' });
  assert.deepEqual(parseData(['A', 'B']), { error: 'usage' });
});

test('STATUS: grouped like HOME, one row per item by its own name, no source names', () => {
  const s = (over) => ({ name: 'quotes', okAt: 0, failAt: 0, ms: 0, ...over });
  assert.equal(upstreamState(['quotes'], [s({ okAt: 10, ms: 200 })]).state, 'OK');
  assert.equal(upstreamState(['quotes'], [s({ okAt: 10, ms: 9000 })]).state, 'SLOW');
  assert.equal(upstreamState(['quotes'], [s({ okAt: 10, failAt: 20 })]).state, 'FAILING');
  assert.equal(upstreamState(['quotes'], []).state, '--');
  const weird = GAUGES.map((g) => ({ id: g.id, ok: g.id !== 'pizza', source: g.source, updated: UPD }));
  const groups = statusGroups({ stats: [s({ okAt: NOW - 5000, ms: 100 })], weird, edgar: { okAt: NOW, failAt: 0 }, now: NOW });
  assert.deepEqual(groups.map((g) => g.group), ['PRICES', 'CHARTS', 'COMPANY DATA', 'SEC', 'MACRO', 'NEWS', 'WEIRD', 'OUR COUNTERS']);
  assert.equal(groups[0].rows[0].name, 'Quotes');
  assert.equal(groups[0].rows[0].last_ok_seconds, 5);
  const w = groups.find((g) => g.group === 'WEIRD').rows;
  assert.equal(w.length, GAUGES.length);
  assert.deepEqual([w[0].name, w[1].name, w[1].state], ['Hormuz ships', 'Pentagon pizza', 'FAILING']);
  assert.ok(w.every((r) => !/^WEIRD/.test(r.name)), 'the group header says WEIRD once');
  assert.equal(groups.find((g) => g.group === 'SEC').rows.find((r) => r.name === 'Latest filings feed').state, 'OK');
  assert.doesNotMatch(JSON.stringify(groups), VENDORS, 'no vendor name in STATUS');
  assert.doesNotMatch(JSON.stringify(groups), /@|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'no personal data');
  const html = statusGrid(groups);
  assert.equal((html.match(/<tr class="group-row">/g) || []).length, 8, 'one header row per group');
  assert.match(html, /<th colspan="3" scope="rowgroup">WEIRD<\/th>/);
  assert.match(html, /<span class="sx-dot" data-state="ok" aria-hidden="true"><\/span><span class="sx-word sx-ok">OK<\/span>/);
  assert.match(html, /data-state="failing"[^>]*><\/span><span class="sx-word sx-failing">FAILING/);
  assert.doesNotMatch(html, VENDORS);
  assert.match(stateHtml('--'), /data-state="none".*>--</);
  assert.equal(PRO_ONLY_LINE, 'STATUS is part of Pro.');
  assert.match(proOnlyHtml(), /STATUS is part of Pro\. <a class="code" href="\?c=PRO" data-cmd="PRO">PRO<\/a>/);
});

test('STATUS: the server answers 403 without an active Pro key, the groups with one', async () => {
  const routes = {};
  const app = { get: (path, fn) => { routes[path] = fn; } };
  mountProvenanceRoutes(app, { weird: async () => [], isPro: (req) => req.key === 'good' });
  const call = async (key) => {
    const res = { code: 200, headers: {}, set(h, v) { this.headers[h] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes['/api/status']({ key, get: () => key }, res);
    return res;
  };
  const free = await call(null);
  assert.deepEqual([free.code, free.body.error, free.body.message], [403, 'pro_only', 'STATUS is part of Pro.']);
  assert.equal(free.body.groups, undefined, 'nothing about the feeds without Pro');
  const pro = await call('good');
  assert.equal(pro.code, 200);
  assert.ok(Array.isArray(pro.body.groups));
  assert.equal(pro.headers['Cache-Control'], 'no-store');
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

// ---- review fixes: weekend data age, bar closes, ETag, WEIRD size ------------------------------

// A Sunday answer as CNBC sends it: stocks and indexes dated Friday, a coin a minute ago,
// SILVER stamped in the future.
const SUNDAY = Date.parse('2026-09-27T07:00:00.000Z');
const SUN_UPD = new Date(SUNDAY).toISOString();
const sundayMarkets = {
  instruments: [
    { id: 'SPX', kind: 'index', us: true, realTime: true, asOf: '2026-09-25' },
    { id: 'EURUSD', kind: 'fx', realTime: true, asOf: '2026-09-25T16:59:00.000-0400' },
    { id: 'BTC', kind: 'crypto', realTime: true, asOf: '2026-09-27T06:59:00.000Z' },
    { id: 'SILVER', kind: 'spot', realTime: true, asOf: '2026-09-27T23:59:00.000Z' },
  ],
  updated: SUN_UPD,
};

test('weekend: the real-time part is as old as its oldest row, never dated after the fetch', () => {
  const p = provenanceFor('/api/markets', sundayMarkets, { now: SUNDAY + 6000 });
  assert.equal(p.as_of, '2026-09-25T00:00:00.000Z', 'Friday: the coin and the future-dated SILVER hide nothing');
  assert.equal(p.age_seconds, 6);
  assert.match(dotTitle([{ ...p, receivedAt: SUNDAY + 6000 }], { now: SUNDAY + 6000 }), /last update Sep 25 · checked 6s ago · real-time/);
  // A lone future-dated quote is capped at the fetch time.
  const silver = provenanceFor('/api/quote', { ...sundayMarkets.instruments[3], updated: SUN_UPD }, { now: SUNDAY });
  assert.equal(silver.as_of, SUN_UPD);
  assert.equal(envelope({ source: 's', source_url: 'u', as_of: '2030-01-01', fetched_at: SUN_UPD, delay: 'real-time', now: SUNDAY }).as_of, SUN_UPD);
});

test('end-of-day bars: as_of is the last bar\'s 16:00 New York close (daylight saving too)', () => {
  const bar = (day, hh) => Date.parse(`${day}T${hh}:00:00.000Z`); // New York midnight
  assert.equal(nyCloseIso('2026-09-25'), '2026-09-25T20:00:00.000Z', 'EDT');
  assert.equal(nyCloseIso('2026-01-29'), '2026-01-29T21:00:00.000Z', 'EST');
  assert.equal(provenanceFor('/api/chart', { ticker: 'AAPL', bar: '1D', points: [{ t: bar('2026-09-25', '04') }], updated: SUN_UPD }, { now: SUNDAY }).as_of, '2026-09-25T20:00:00.000Z');
  const cmp = { series: [{ points: [{ t: bar('2026-09-24', '04') }, { t: bar('2026-09-25', '04') }] }, { points: [{ t: bar('2026-09-25', '04') }] }], updated: SUN_UPD };
  assert.equal(provenanceFor('/api/compare', cmp, { now: SUNDAY }).as_of, '2026-09-25T20:00:00.000Z');
  const why = provenanceFor('/api/why', { asOf: '2026-09-25', secOk: true, updated: SUN_UPD }, { now: SUNDAY });
  assert.equal(why.parts.find((x) => x.dataset === 'bars').as_of, '2026-09-25T20:00:00.000Z', 'not the fetch time');
  assert.equal(provenanceFor('/api/history', { rows: [{ date: '2026-09-25' }], updated: SUN_UPD }, { now: SUNDAY }).as_of, '2026-09-25T20:00:00.000Z');
  // A bar for today, before the close: capped at the fetch.
  const midday = Date.parse('2026-09-25T15:00:00.000Z');
  assert.equal(provenanceFor('/api/chart', { ticker: 'AAPL', bar: '1D', points: [{ t: bar('2026-09-25', '04') }], updated: new Date(midday).toISOString() }, { now: midday }).as_of, new Date(midday).toISOString());
});

test('ETag: the same answer a second later has the same tag (ages left out), so 304s work', () => {
  const tagAt = (t) => {
    let headers = {};
    const res = { statusCode: 200, get: (h) => headers[h], set: (h, v) => { headers[h] = v; }, json: (b) => b };
    provenanceJson({ now: () => t })({ method: 'GET', originalUrl: '/api/quote', query: {} }, res, () => {});
    const body = res.json({ ...sundayMarkets.instruments[0], updated: SUN_UPD });
    return { tag: headers.ETag, age: body.provenance.age_seconds };
  };
  const a = tagAt(SUNDAY + 1000);
  const b = tagAt(SUNDAY + 9000);
  assert.notEqual(a.age, b.age, 'the body still carries age_seconds');
  assert.equal(a.tag, b.tag);
  assert.match(a.tag, /^W\/"/);
  assert.notEqual(etagOf({ a: 1 }), etagOf({ a: 2 }));
});

test('WEIRD: the envelope adds little (compact per-gauge parts)', () => {
  const gauges = GAUGES.map((g) => ({ id: g.id, ok: true, source: g.source, asOf: '2026-09-20', updated: SUN_UPD }));
  const p = weirdEnvelope(gauges, SUNDAY);
  assert.equal(p.parts.length, GAUGES.length);
  for (const x of p.parts) assert.deepEqual(Object.keys(x).filter((k) => k !== 'note' && k !== 'source_url'), ['dataset', 'delay']);
  assert.ok(JSON.stringify(p).length < 3500, `about ${JSON.stringify(p).length} bytes for ${GAUGES.length} gauges`);
  // The dot's list still works from a compact part: it takes the answer's times.
  const flat = flatten([{ ...p, parts: p.parts.slice(0, 2), receivedAt: SUNDAY }]);
  assert.ok(flat.every((x) => x.as_of && x.fetched_at && x.source));
});

test('the dot and its list: source classes only; headlines keep their publisher', async () => {
  const envs = Object.entries(SAMPLES).map(([path, body]) => ({ ...provenanceFor(path, body, { now: NOW }), receivedAt: NOW }));
  const html = popoverHtml(envs, { now: NOW, max: 100 });
  assert.doesNotMatch(html, VENDORS, 'no vendor in the popover');
  assert.match(html, /market data provider/);
  assert.match(html, /SEC EDGAR/, 'government sources keep their names');
  for (const e of envs) assert.doesNotMatch(dotTitle([e], { now: NOW }), VENDORS);
  // A headline still names its publisher: that is attribution, not a data source list.
  const { newsList } = await import('../public/screens/news.js');
  assert.match(newsList([{ title: 'Stocks rise', link: 'https://example.com/a', source: 'CNBC', time: UPD }]), />CNBC</);
});
