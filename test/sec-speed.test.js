// SEC speed: the EDGAR watcher drops a company's cached SEC data when a new filing
// appears; FINANCIALS numbers link to their filing; PRE/MKT/AH/WKD tags from EDGAR's
// acceptance time; earnings 8-Ks tagged preliminary until the 10-Q or 10-K.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCurrentFeed, makeEdgarWatch, makeInvalidator, median, currentUrl, WATCH_FORMS, edgarOpen, CLOSED_CHECK_MS } from '../data/edgarwatch.js';
import { SEC_UA, buildFinancials } from '../data/financials.js';
import { parseSubmissions } from '../data/filings.js';
import { earningsFrom8K, finalReport } from '../data/chart-events.js';
import { sessionTag, sessionHtml } from '../public/provenance.js';
import { sessionOf } from '../lib/provenance.js';
import { statementTable, cellTitle, valueHtml, filedFrom } from '../public/screens/financials.js';
import { filingsTable, acceptedEt } from '../public/screens/filings.js';
import { itemHtml } from '../public/screens/why.js';

// ---- the feed -------------------------------------------------------------------------

const entry = (form, name, cik, role, acc, updated) => `<entry><title>${form} - ${name} (${String(cik).padStart(10, '0')}) (${role})</title>
  <link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}/${acc}-index.htm"/>
  <summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-09-24 </summary><updated>${updated}</updated>
  <id>urn:tag:sec.gov,2008:accession-number=${acc}</id></entry>`;
const feed = (...entries) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Latest Filings</title><updated>2026-09-24T16:31:00-04:00</updated>${entries.join('')}</feed>`;

test('feed: company entries only (the filer or the issuer), with the acceptance time in UTC', () => {
  const rows = parseCurrentFeed(feed(
    entry('4', 'Apple Inc.', 320193, 'Issuer', '0001140361-26-037584', '2026-09-24T18:30:07-04:00'),
    entry('4', 'Cook Timothy D', 1214156, 'Reporting', '0001140361-26-037584', '2026-09-24T18:30:07-04:00'),
    entry('8-K', 'Other Co', 99, 'Filer', '0000000099-26-000001', '2026-09-24T16:30:00-04:00'),
  ), '4');
  assert.deepEqual([...rows], [{ form: '4', cik: 320193, role: 'Issuer', accession: '0001140361-26-037584', accepted: '2026-09-24T22:30:07.000Z' }]);
  assert.equal(parseCurrentFeed('<feed>junk</feed>', '8-K').length, 0);
  assert.match(currentUrl('10-Q'), /type=10-Q&.*owner=include&count=100&output=atom$/);
  assert.deepEqual(WATCH_FORMS, ['8-K', '10-Q', '10-K', '20-F', '6-K', '4']);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

// A fetch that answers from a list per URL, recording each request.
function mockFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    const list = answers[new URL(url).searchParams.get('type')] || [];
    const a = list.length > 1 ? list.shift() : list[0];
    if (a === 'fail') return { ok: false, status: 503, headers: { get: () => null } };
    if (a === 304) return { ok: false, status: 304, headers: { get: () => null } };
    return { ok: true, status: 200, headers: { get: (h) => (h === 'etag' ? '"v1"' : null) }, text: async () => a || feed() };
  };
  return { fetchImpl, calls };
}

test('watcher: the first answer is a baseline; a new filing after it invalidates, with its delay', async () => {
  let t = Date.parse('2026-09-24T20:31:00.000Z');
  const first = feed(entry('10-Q', 'Apple Inc.', 320193, 'Filer', '0000320193-26-000001', '2026-09-24T16:20:00-04:00'));
  const second = feed(
    entry('10-Q', 'Apple Inc.', 320193, 'Filer', '0000320193-26-000002', '2026-09-24T16:30:15-04:00'),
    entry('10-Q', 'Apple Inc.', 320193, 'Filer', '0000320193-26-000001', '2026-09-24T16:20:00-04:00'),
  );
  const { fetchImpl, calls } = mockFetch({ '10-Q': [first, second] });
  const seen = [];
  let queued = 0;
  const lanes = [];
  const w = makeEdgarWatch({ fetchImpl, forms: ['10-Q'], secQueue: (fn, opts) => { queued += 1; lanes.push(opts?.low); return fn(); }, now: () => t, onFiling: (f) => seen.push(f), log: () => {} });
  await w.pollAll();
  assert.equal(seen.length, 0, 'baseline: nothing invalidated');
  t = Date.parse('2026-09-24T20:30:57.000Z');
  await w.pollAll();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].accession, '0000320193-26-000002');
  assert.equal(seen[0].cik, 320193);
  assert.equal(seen[0].delaySeconds, 42, 'seen 42 s after EDGAR accepted it');
  assert.equal(w.stats().medianDelay, 42);
  assert.equal(w.stats().samples, 1);
  assert.equal(queued, 2, 'every request through the SEC queue');
  assert.deepEqual(lanes, [true, true], 'in its low lane, behind the site');
  assert.equal(calls[0].headers['User-Agent'], SEC_UA);
  assert.equal(calls[1].headers['If-None-Match'], '"v1"', 'conditional after the first answer');
});

const THURSDAY = Date.parse('2026-09-24T15:00:00.000Z'); // 11:00 ET, EDGAR open

test('watcher: a failing feed backs off and is counted; a 304 costs nothing', async () => {
  const { fetchImpl } = mockFetch({ '8-K': ['fail', 304] });
  const w = makeEdgarWatch({ fetchImpl, forms: ['8-K'], secQueue: (fn) => fn(), every: 30_000, now: () => THURSDAY, log: () => {} });
  await w.pollAll();
  assert.equal(w.stats().forms['8-K'].gap, 60_000);
  assert.ok(w.stats().failAt > 0);
  await w.pollAll();
  assert.equal(w.stats().forms['8-K'].gap, 30_000, 'reset after a good answer');
});

test('invalidation: submissions always; companyfacts on 10-Q/10-K/20-F/6-K; insiders on Form 4; flags otherwise; repeated later', async () => {
  const dropped = [];
  const forget = {
    financials: (cik) => dropped.push(`facts:${cik}`), filings: (cik) => dropped.push(`subs:${cik}`),
    insiders: (t) => dropped.push(`ins:${t}`), chartEvents: (t) => dropped.push(`ev:${t}`),
  };
  const timers = [];
  const inv = makeInvalidator({ tickerOf: async (cik) => (cik === 320193 ? 'AAPL' : null), forget, timers: { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {} } });
  await inv({ form: '10-Q', cik: 320193 });
  assert.deepEqual(dropped, ['subs:320193', 'facts:320193', 'ev:AAPL']);
  dropped.length = 0;
  await inv({ form: '4', cik: 320193 });
  assert.deepEqual(dropped, ['subs:320193', 'ins:AAPL']);
  dropped.length = 0;
  await inv({ form: '8-K/A', cik: 320193 });
  assert.deepEqual(dropped, ['subs:320193', 'ev:AAPL']);
  assert.deepEqual(timers.map((x) => x.ms), [300_000, 1_800_000, 300_000, 1_800_000, 300_000, 1_800_000]);
  await inv({ form: '10-Q', cik: 320193 });
  assert.equal(timers.length, 6, 'a repeat already waiting is not added twice');
  dropped.length = 0;
  timers[0].fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(dropped, ['subs:320193', 'facts:320193', 'ev:AAPL'], 'the repeat drops again');
});

test('the real caches forget one company: FILINGS, FINANCIALS, INSIDERS, chart events', async () => {
  const { makeFilings } = await import('../data/filings.js');
  let n = 0;
  const body = JSON.parse(readFileSync(new URL('./fixtures/sec-submissions-aapl.json', import.meta.url), 'utf8'));
  const fetchImpl = async (url) => {
    n += 1;
    const j = /company_tickers/.test(url) ? { 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } } : body;
    return { ok: true, status: 200, json: async () => j };
  };
  const f = makeFilings({ fetchImpl, gapMs: 0 });
  await f.getFilings('AAPL');
  await f.getFilings('AAPL');
  assert.equal(n, 2, 'tickers and submissions, cached');
  f.forget(320193);
  await f.getFilings('AAPL');
  assert.equal(n, 3, 'the submissions again after a new filing');
});

// ---- PRE / MKT / AH / WKD -----------------------------------------------------------------

test('session tag: New York time, daylight saving both ways, weekends and holidays', () => {
  const cases = [
    ['2026-07-30T20:30:28.000Z', 'AH', '16:30 EDT'],
    ['2026-07-31T10:01:02.000Z', 'PRE', '06:01 EDT'],
    ['2026-07-31T13:29:59.000Z', 'PRE', '09:29 EDT'],
    ['2026-07-31T13:30:00.000Z', 'MKT', '09:30 EDT'],
    ['2026-07-31T19:59:00.000Z', 'MKT', '15:59 EDT'],
    ['2026-01-29T14:29:00.000Z', 'PRE', '09:29 EST: winter, one hour later in UTC'],
    ['2026-01-29T14:31:00.000Z', 'MKT', '09:31 EST'],
    ['2026-01-29T21:00:00.000Z', 'AH', '16:00 EST'],
    ['2026-03-06T14:31:00.000Z', 'MKT', 'Friday before the March switch, EST'],
    ['2026-03-09T13:31:00.000Z', 'MKT', 'Monday after the switch, EDT'],
    ['2026-11-02T14:31:00.000Z', 'MKT', 'Monday after the November switch, EST'],
    ['2026-09-26T15:00:00.000Z', 'WKD', 'Saturday'],
    ['2026-09-28T02:00:00.000Z', 'WKD', 'Sunday 22:00 ET, Monday in UTC'],
    ['2026-09-26T02:00:00.000Z', 'AH', 'Friday 22:00 ET, Saturday in UTC'],
    ['', '', 'no time'],
  ];
  for (const [iso, want, why] of cases) assert.equal(sessionTag(iso), want, `${iso}: ${why}`);
  assert.equal(sessionOf('2026-11-26T15:00:00.000Z'), 'WKD', 'Thanksgiving: market closed');
  assert.equal(sessionOf('2026-11-27T18:30:00.000Z'), 'AH', '13:30 on an early-close day');
  assert.equal(sessionOf('2026-11-27T17:30:00.000Z'), 'MKT', '12:30 on an early-close day');
  assert.equal(sessionHtml('AH', '16:30:28 ET'), ' <span class="tod" data-prov title="Accepted after the close (16:30:28 ET)">AH</span>');
  assert.equal(sessionHtml(''), '');
  assert.equal(acceptedEt('2026-07-30T20:30:28.000Z'), '16:30:28 ET');
});

test('filings rows, WHY rows and E flags carry the tag', () => {
  const body = JSON.parse(readFileSync(new URL('./fixtures/sec-submissions-aapl.json', import.meta.url), 'utf8'));
  const rows = parseSubmissions(body).rows;
  assert.ok(rows.every((r) => ['PRE', 'MKT', 'AH', 'WKD', ''].includes(r.session)));
  const html = filingsTable(rows.slice(0, 5));
  assert.match(html, /class="tod" data-prov title="Accepted [^"]+ ET\)">(PRE|MKT|AH|WKD)</);
  assert.match(itemHtml({ kind: 'FILING', session: 'AH', date: '2026-07-30', time: '2026-07-30T20:30:28.000Z', text: '8-K: earnings', source: 'SEC EDGAR' }), /<span class="why-tag">SEC<\/span> <span class="tod"[^>]*>AH</);
  assert.doesNotMatch(itemHtml({ kind: 'NEWS', date: '2026-07-30', text: 'x', source: 'CNBC' }), /class="tod"/);
});

// ---- earnings: preliminary until the 10-Q or 10-K ---------------------------------------------

test('earnings 8-K: tagged 8-K until the 10-Q or 10-K is filed, then that form', () => {
  const k8 = (filed, session = 'AH') => ({ form: '8-K', filed, items: ['2.02'], url: 'https://www.sec.gov/a', session });
  const reports = [
    { form: '10-K', filed: '2025-10-31', period: '2025-09-27' },
    { form: '10-Q', filed: '2026-01-30', period: '2025-12-27' },
    { form: '10-Q', filed: '2026-05-01', period: '2026-03-28' },
    { form: '10-Q', filed: '2026-07-31', period: '2026-06-27' },
  ];
  const rows = [k8('2025-10-30'), k8('2026-01-29'), k8('2026-04-30'), k8('2026-07-30'), k8('2026-10-29', 'PRE')];
  const out = earningsFrom8K(rows, reports);
  assert.deepEqual(out.map((e) => [e.date, e.form, e.session]), [
    ['2025-10-30', '10-K', 'AH'],
    ['2026-01-29', '10-Q', 'AH'],
    ['2026-04-30', '10-Q', 'AH'],
    ['2026-07-30', '10-Q', 'AH'],
    ['2026-10-29', '8-K', 'PRE'],
  ]);
  assert.equal(finalReport('2026-10-29', reports), '8-K', 'no report yet: preliminary');
  assert.equal(finalReport('2020-01-01', reports), null, 'the list does not reach back: unknown, no tag');
  assert.equal(finalReport('2026-01-29', []), null);
});

// ---- FINANCIALS: every number links to its filing ---------------------------------------------

test('financials: each value names and links its filing; worked-out values get a one-character mark', () => {
  const PINS = JSON.parse(readFileSync(new URL('./fixtures/sec-companyfacts-pins.json', import.meta.url), 'utf8'));
  const r = buildFinancials(PINS['0000320193']);
  const d = { ...r, cik: 320193, title: 'Apple Inc.' };
  const i = r.annual.periods.findIndex((p) => p.label === 'FY2024');
  const rev = r.annual.values.revenue[i];
  assert.match(rev.accn, /^\d{10}-\d{2}-\d{6}$/, 'the accession travels with the value');
  assert.equal(filedFrom(rev), `From ${rev.form} filed ${rev.filed} (accession ${rev.accn})`);
  assert.match(cellTitle(rev), /^From 10-K filed \d{4}-\d{2}-\d{2} \(accession \d{10}-\d{2}-\d{6}\), us-gaap:/);
  const html = statementTable(d, 'annual', 'income');
  assert.match(html, new RegExp(`<a class="fin-v" href="https://www\\.sec\\.gov/Archives/edgar/data/320193/${rev.accn.replace(/-/g, '')}/${rev.accn}-index\\.htm" target="_blank" rel="noopener noreferrer">391,035</a>`));
  // Q4: the full year minus Q1 to Q3.
  const q = r.quarterly;
  const q4 = q.values.revenue[q.periods.findIndex((p) => p.label === 'Q4 FY2025')];
  assert.equal(q4.derived, true);
  assert.match(cellTitle(q4), /^Worked out: the full year minus Q1 to Q3\. From 10-K filed/);
  assert.match(valueHtml(320193, q4, '102,466'), /102,466<sup class="fin-d" data-prov aria-hidden="true">\*<\/sup><\/a>$/);
  // Free cash flow: worked out, linked to the operating cash flow filing.
  const cf = (tag, val) => ({ [tag]: { units: { USD: [{ start: '2024-09-29', end: '2025-09-27', val, form: '10-K', filed: '2025-10-31', fy: 2025, fp: 'FY', accn: '0000000001-25-000010' }] } } });
  const fc = buildFinancials({ cik: 1, entityName: 'X', facts: { 'us-gaap': { ...cf('Revenues', 10e6), ...cf('NetCashProvidedByUsedInOperatingActivities', 50e6), ...cf('PaymentsToAcquirePropertyPlantAndEquipment', 20e6) } } });
  const fcf = fc.annual.values.freeCashFlow[0];
  assert.equal(fcf.v, 30e6);
  assert.equal(fcf.calc, 'OCF - capex');
  assert.equal(fcf.accn, '0000000001-25-000010');
  assert.match(cellTitle(fcf), /^Worked out: operating cash flow minus capex\. Operating cash flow: from 10-K filed 2025-10-31 \(accession 0000000001-25-000010\)\.$/);
  assert.match(statementTable({ ...fc, cik: 1 }, 'annual', 'cashflow'), />30<sup class="fin-d"/);
  assert.equal(valueHtml(320193, null, '--'), '--');
  assert.equal(cellTitle(null), 'Not in the filings');
});

test('financials: a restated figure names the restating filing (the latest filing wins)', () => {
  const F = (val, filed, accn) => ({ start: '2024-09-29', end: '2025-09-27', val, form: '10-K', filed, fy: 2025, fp: 'FY', accn });
  const body = { cik: 1, entityName: 'X', facts: { 'us-gaap': { Revenues: { units: { USD: [F(100, '2025-10-31', '0000000001-25-000010'), F(105, '2026-10-30', '0000000001-26-000020')] } } } } };
  const r = buildFinancials(body);
  const c = r.annual.values.revenue[r.annual.periods.length - 1];
  assert.equal(c.v, 105);
  assert.match(cellTitle(c), /filed 2026-10-30 \(accession 0000000001-26-000020\)/);
});

test('watcher: a 429 on one form pauses every form; EDGAR closed hours ask nothing', async () => {
  let t = THURSDAY;
  const answers = { '8-K': [feed()], '10-Q': [feed()] };
  const calls = [];
  const fetchImpl = async (url) => {
    const form = new URL(url).searchParams.get('type');
    calls.push(form);
    if (form === '8-K' && calls.length === 1) return { ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? '120' : null) } };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => answers[form][0] };
  };
  const w = makeEdgarWatch({ fetchImpl, forms: ['8-K', '10-Q'], secQueue: (fn) => fn(), now: () => t, log: () => {} });
  await w.pollAll();
  assert.deepEqual(calls, ['8-K'], 'the 10-Q loop did not ask after SEC said slow down');
  assert.ok(w.stats().pausedUntil >= THURSDAY + 120_000, 'Retry-After honoured for all forms');
  t = THURSDAY + 121_000;
  await w.pollAll();
  assert.deepEqual(calls, ['8-K', '8-K', '10-Q'], 'after the pause both ask again');
  // Hours: 06:00 to 22:00 New York, weekdays only.
  assert.equal(edgarOpen(Date.parse('2026-09-24T09:59:00.000Z')), false, '05:59 ET');
  assert.equal(edgarOpen(Date.parse('2026-09-24T10:00:00.000Z')), true, '06:00 ET');
  assert.equal(edgarOpen(Date.parse('2026-09-25T01:59:00.000Z')), true, '21:59 ET Thursday');
  assert.equal(edgarOpen(Date.parse('2026-09-25T02:00:00.000Z')), false, '22:00 ET');
  assert.equal(edgarOpen(Date.parse('2026-09-27T15:00:00.000Z')), false, 'Sunday');
  assert.equal(edgarOpen(Date.parse('2026-01-29T11:00:00.000Z')), true, '06:00 EST in winter');
  t = Date.parse('2026-09-27T15:00:00.000Z');
  await w.pollAll();
  assert.equal(calls.length, 3, 'nothing asked on a Sunday');
  assert.equal(w.stats().paused, true);
  assert.equal(CLOSED_CHECK_MS, 300_000);
});

test('watcher: overflow counts a full page of entries (100), not company rows', async () => {
  let t = THURSDAY;
  const page = (start) => feed(...Array.from({ length: 100 }, (_, i) => entry('4', i % 2 ? 'Person' : 'Co', 1000 + start + i, i % 2 ? 'Reporting' : 'Issuer', `00000000${String(start + i).padStart(2, '0')}-26-000001`.slice(-20), '2026-09-24T10:59:00-04:00')));
  const { fetchImpl } = mockFetch({ 4: [page(0), page(100)] });
  const w = makeEdgarWatch({ fetchImpl, forms: ['4'], secQueue: (fn) => fn(), now: () => t, log: () => {} });
  const rows = parseCurrentFeed(page(0), '4');
  assert.equal(rows.entries, 100);
  assert.equal(rows.length, 50, 'half the entries are reporting persons');
  await w.pollAll();
  t += 30_000;
  await w.pollAll();
  assert.equal(w.stats().overflow, 1, 'a full page with nothing seen before: some filings may have been missed');
});

test('invalidation: every ticker of the company (class shares)', async () => {
  const dropped = [];
  const forget = { filings: () => {}, financials: () => {}, insiders: (t) => dropped.push(`ins:${t}`), chartEvents: (t) => dropped.push(`ev:${t}`) };
  const inv = makeInvalidator({ tickerOf: async () => ['GOOGL', 'GOOG'], forget, timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  await inv({ form: '10-Q', cik: 1652044 });
  await inv({ form: '4', cik: 1652044 });
  assert.deepEqual(dropped, ['ev:GOOGL', 'ev:GOOG', 'ins:GOOGL', 'ins:GOOG']);
});

test('free cash flow names both filings when capex came from another one', () => {
  const c = { v: 30e6, calc: 'OCF - capex', form: '10-K', filed: '2025-10-31', accn: '0000000001-25-000010', capex: { form: '10-K/A', filed: '2025-12-01', accn: '0000000001-25-000099' } };
  assert.equal(cellTitle(c), 'Worked out: operating cash flow minus capex. Operating cash flow: from 10-K filed 2025-10-31 (accession 0000000001-25-000010). Capex: from 10-K/A filed 2025-12-01 (accession 0000000001-25-000099).');
});
