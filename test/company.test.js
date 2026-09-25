import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCache } from '../data/cache.js';
import { parseInsiders, insiderKind, makeInsiders } from '../data/insiders.js';
import { parseOwners, makeOwners } from '../data/owners.js';
import { parseShorts, makeShorts } from '../data/shorts.js';
import { parseBeats } from '../data/beats.js';
import { parseSubmissions, filterFilings, describeFiling, formFamily, filingUrl, makeFilings } from '../data/filings.js';
import { parseValue, parseFundMap, cnbcDay, makeValue } from '../data/value.js';
import { parseIpoMonth, mergeIpoMonths, priceRange, monthOf } from '../data/ipos.js';
import { parseSplits, parseRatio, parseExDiv, nextWeekdays, makeSplits } from '../data/splits.js';
import { CompanyDataError, symbolOf } from '../data/company-kit.js';
import { makeScreen, withFund } from '../data/screen.js';
import { parseCond, parseScreenArgs, applyScreen, needsCnbc, screenWords } from '../public/screener.js';
import { parseCommand, suggest, tickerFunctions, FUNCTION_BAR, TICKER_FUNCTIONS, COMMANDS } from '../public/app.js';
import { COMPANY, COMPANY_FUNCTIONS, matchCompany } from '../public/company.js';
import { findCommand } from '../public/registry.js';
import { parse as parseFilings, inputOf as filingsInput } from '../public/screens/filings.js';
import { parse as parseExdiv } from '../public/screens/exdiv.js';
import { priceText } from '../public/screens/ipos.js';
import { valueGroups } from '../public/screens/value.js';

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// ---- sources ------------------------------------------------------------------

test('insiders: Nasdaq rows, kinds, value = shares x price, 3 and 12 month totals', () => {
  const d = parseInsiders(fx('nasdaq-insiders-aapl.json').data);
  assert.ok(d.rows.length >= 3);
  const plan = d.rows.find((r) => r.kind === 'PLAN SELL');
  assert.match(plan.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(plan.value, Math.round(plan.shares * plan.price * 100) / 100);
  const opt = d.rows.find((r) => r.kind === 'OPTION');
  assert.equal(opt.price, null, 'no price on file');
  assert.equal(opt.value, null, 'no value without a price');
  assert.equal(d.totals.m3.buys, 0);
  assert.equal(d.totals.m12.sells, 37);
  assert.equal(d.totals.m12.netShares, -1217466);
  assert.equal(insiderKind('Buy'), 'BUY');
  assert.equal(insiderKind('Sell'), 'SELL');
  assert.equal(insiderKind('Automatic Sell'), 'PLAN SELL');
  assert.equal(insiderKind('Acquisition (Non Open Market)'), 'AWARD');
  assert.equal(insiderKind('Disposition (Non Open Market)'), 'DISPOSED');
  assert.equal(parseInsiders(null), null);
});

test('owners: holders, % of shares from the source outstanding, summary counts', () => {
  const d = parseOwners(fx('nasdaq-owners-aapl.json').data);
  assert.equal(d.summary.institutionalPct, 76.57);
  assert.equal(d.summary.sharesOutstanding, 14594e6);
  assert.equal(d.summary.totalValue, 3753723e6);
  assert.ok(d.summary.total.holders > 1000);
  assert.ok(Number.isFinite(d.summary.new.holders) && Number.isFinite(d.summary.soldOut.holders));
  const top = d.rows[0];
  assert.equal(top.holder, 'Vanguard Group Inc');
  assert.equal(top.pctOfShares, Math.round((top.shares / 14594e6) * 1e6) / 1e4);
  assert.equal(top.value % 1000, 0, 'value from thousands');
  assert.match(top.asOf, /^\d{4}-\d{2}-\d{2}$/);
});

test('shorts: rows newest first with change against the settlement before', () => {
  const d = parseShorts(fx('nasdaq-shorts-aapl.json').data);
  assert.equal(d.rows.length, 5);
  assert.ok(d.rows[0].date > d.rows[1].date);
  assert.equal(d.rows[0].change, d.rows[0].shortInterest - d.rows[1].shortInterest);
  assert.equal(d.rows.at(-1).change, null);
  assert.equal(d.rows[0].daysToCover, 2.85);
  assert.equal(parseShorts(null), null, 'NYSE stocks: no data');
});

test('beats: reported EPS, consensus and surprise as published', () => {
  const d = parseBeats(fx('nasdaq-beats-aapl.json').data);
  assert.equal(d.rows.length, 4);
  assert.deepEqual(d.rows[0], { quarter: 'Jun 2026', reported: '2026-07-30', eps: 1.91, consensus: 1.88, surprisePct: 1.6 });
  assert.equal(parseBeats({ earningsSurpriseTable: { rows: null } }), null);
});

test('filings: SEC submissions, plain-English forms, chips and sec.gov links', () => {
  const d = parseSubmissions(fx('sec-submissions-aapl.json'));
  assert.equal(d.cik, 320193);
  assert.ok(d.rows.every((r, i) => i === 0 || d.rows[i - 1].filed >= r.filed), 'newest first');
  const q = d.rows.find((r) => r.form === '10-Q');
  assert.equal(q.family, '10-Q');
  assert.equal(q.description, 'Quarterly report');
  assert.match(q.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\/\d{18}\/\S+$/);
  assert.equal(formFamily('10-K/A'), '10-K');
  assert.equal(formFamily('144'), null);
  assert.equal(describeFiling('8-K', '2.02,9.01', ''), 'Current report: Results of operations');
  assert.equal(describeFiling('8-K/A', '5.02', ''), 'Current report: Directors or officers change (amended)');
  assert.equal(describeFiling('4', '', 'FORM 4'), 'Insider: change in holdings');
  assert.equal(filingUrl(1, 'bad', 'x.htm'), null);
  assert.equal(filingUrl(1, '0000000000-26-000001', '../x'), 'https://www.sec.gov/Archives/edgar/data/1/000000000026000001/');
  const f = filterFilings(d.rows, '4');
  assert.ok(f.rows.length && f.rows.every((r) => r.family === '4'));
  assert.equal(f.counts.ALL, d.rows.length);
  assert.equal(filterFilings(d.rows, 'ALL', 3).rows.length, 3);
});

test('value: CNBC fund fields as given, nothing computed; missing stays null', () => {
  const rows = fx('cnbc-fund.json').FormattedQuoteResult.FormattedQuote;
  const aapl = parseValue(rows.find((r) => r.symbol === 'AAPL'));
  assert.equal(aapl.pe, Number(rows[0].pe));
  assert.ok(Number.isFinite(aapl.forwardPe) && Number.isFinite(aapl.roe) && Number.isFinite(aapl.debtToEquity));
  assert.match(aapl.yearHighDate, /^20\d\d-\d\d-\d\d$/);
  const spy = parseValue(rows.find((r) => r.symbol === 'SPY'));
  assert.equal(spy.pe, null, 'a fund has no P/E');
  assert.equal(parseValue(rows.find((r) => r.symbol === 'ZZZZQ')), null);
  assert.equal(cnbcDay('09/22/26'), '2026-09-22');
  const m = parseFundMap(rows);
  assert.equal(m.get('KO').divYield, Number(rows.find((r) => r.symbol === 'KO').dividendyield.replace('%', '')));
  assert.ok(!m.has('ZZZZQ'));
  const g = valueGroups({ ...spy });
  assert.equal(g[0][1].find(([k]) => k === 'P/E (trailing)')[1], '--');
});

test('ipos: three lists, price ranges, months merged without repeats', () => {
  const one = parseIpoMonth(fx('nasdaq-ipos.json').data);
  assert.equal(one.upcoming.length, 3);
  assert.ok(one.priced.length && one.filed.length);
  assert.deepEqual(priceRange('40.00-44.00'), { low: 40, high: 44 });
  assert.deepEqual(priceRange('10.00'), { low: 10, high: 10 });
  assert.deepEqual(priceRange(''), { low: null, high: null });
  const merged = mergeIpoMonths([one, one, { upcoming: [], priced: [], filed: [] }]);
  assert.equal(merged.upcoming.length, one.upcoming.length, 'no repeats');
  assert.ok(merged.priced.every((r, i) => i === 0 || merged.priced[i - 1].date >= r.date));
  assert.equal(monthOf('2026-12-31', 1), '2027-01');
  assert.equal(monthOf('2026-01-31', -1), '2025-12');
  assert.equal(priceText(40, 44), '$40.00-44.00');
  assert.equal(priceText(null, null), '--');
});

test('splits and ex-dividend: ratios, dates, weekdays', () => {
  const s = parseSplits(fx('nasdaq-splits.json').data);
  assert.ok(s.rows.every((r, i) => i === 0 || s.rows[i - 1].date <= r.date));
  assert.deepEqual(parseRatio('3 : 1'), { ratio: '3:1', reverse: false });
  assert.deepEqual(parseRatio('1:150'), { ratio: '1:150', reverse: true });
  const x = parseExDiv(fx('nasdaq-exdiv.json').data);
  assert.equal(x.length, 4);
  assert.ok(x.every((r) => r.exDate === '2026-09-28' && Number.isFinite(r.dividend)));
  assert.deepEqual(parseExDiv({ calendar: { rows: null } }), []);
  assert.deepEqual(nextWeekdays('2026-09-26', 3), ['2026-09-28', '2026-09-29', '2026-09-30']);
  assert.equal(symbolOf('BRK/B'), 'BRK.B');
  assert.equal(symbolOf(null), null);
});

// ---- services -----------------------------------------------------------------

test('services: unknown symbol is not_found, a dead source is unavailable, then stale', async () => {
  const unknown = { data: null, status: { rCode: 400, bCodeMessage: [{ code: 1001 }] } };
  const a = makeInsiders({ fetchImpl: async () => json(unknown), cache: createCache() });
  await assert.rejects(a.getInsiders('ZZZZQ'), (e) => e instanceof CompanyDataError && e.code === 'not_found');
  await assert.rejects(a.getInsiders('not a ticker!'), (e) => e.code === 'bad_symbol');

  let up = true;
  let t = 0;
  const cache = createCache({ now: () => t, retryMs: 10 });
  const o = makeOwners({ fetchImpl: async () => (up ? json(fx('nasdaq-owners-aapl.json')) : json({}, 500)), cache });
  const first = await o.getOwners('aapl');
  assert.equal(first.ticker, 'AAPL');
  assert.equal(first.stale, false);
  assert.match(first.source, /Nasdaq/);
  up = false;
  t += 2 * 24 * 3600_000;
  const second = await o.getOwners('AAPL');
  assert.equal(second.stale, true, 'stale-if-error');

  const s = makeShorts({ fetchImpl: async () => json({}, 503), cache: createCache() });
  await assert.rejects(s.getShorts('AAPL'), (e) => e.code === 'unavailable');
});

test('filings service: ticker to CIK, then the list, with the SEC user agent', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push([url, opts.headers['User-Agent']]);
    if (url.endsWith('company_tickers.json')) return json({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } });
    return json(fx('sec-submissions-aapl.json'));
  };
  const f = makeFilings({ fetchImpl, cache: createCache(), gapMs: 0 });
  const d = await f.getFilings('AAPL', '10-q');
  assert.equal(d.form, '10-Q');
  assert.ok(d.rows.every((r) => r.family === '10-Q'));
  assert.ok(seen.every(([, ua]) => ua === 'Bloombroke dev@bloombroke.com'));
  assert.match(seen[1][0], /CIK0000320193\.json$/);
  await assert.rejects(f.getFilings('MSFT'), (e) => e.code === 'not_found');
  assert.equal((await f.getFilings('AAPL', 'NOPE')).form, 'ALL');
});

test('value and exdiv services', async () => {
  const v = makeValue({ fetchImpl: async () => json(fx('cnbc-fund.json')), cache: createCache() });
  const d = await v.getValue('AAPL');
  assert.equal(d.ticker, 'AAPL');
  assert.equal(d.source, 'CNBC quote service');
  const m = await v.getFundMap(['AAPL', 'KO', 'SPY'], { batch: 2 });
  assert.ok(m.has('AAPL'));

  const days = [];
  const sp = makeSplits({
    fetchImpl: async (url) => { days.push(url); return json(fx('nasdaq-exdiv.json')); },
    cache: createCache(),
    now: () => Date.parse('2026-09-26T15:00:00Z'),
  });
  const x = await sp.getExDiv();
  assert.deepEqual(x.days.map((y) => y.date), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  const one = await sp.getExDiv('2026-09-28');
  assert.equal(one.single, true);
  assert.equal(one.days.length, 1);
});

// ---- SCREEN P/E and dividend yield ----------------------------------------------

const ROWS = [
  { symbol: 'AAA', name: 'A', last: 10, changePct: 1, marketCap: 5e10, volume: 1e6, sector: 'Technology', industry: '', country: 'United States' },
  { symbol: 'BBB', name: 'B', last: 20, changePct: -1, marketCap: 4e10, volume: 1e6, sector: 'Technology', industry: '', country: 'United States' },
  { symbol: 'CCC', name: 'C', last: 30, changePct: 0, marketCap: 3e10, volume: 1e6, sector: 'Finance', industry: '', country: 'United States' },
];
const FUND = new Map([['AAA', { pe: 18, divYield: 3.1 }], ['BBB', { pe: 45, divYield: null }]]);

test('screen: PE and DIV filters keep only rows where the number exists', () => {
  assert.deepEqual(parseCond('DIV>2%'), { field: 'DIV', op: '>', value: 2, text: 'DIV>2' });
  assert.equal(parseCond('YIELD>=1').field, 'DIV');
  assert.equal(parseCond('PE<30B'), null, 'no size suffix on P/E');
  const rows = withFund(ROWS, FUND);
  assert.equal(rows[2].pe, null);
  const sym = (spec) => applyScreen(rows, parseScreenArgs(spec)).map((r) => r.symbol);
  assert.deepEqual(sym('PE<30'), ['AAA']);
  assert.deepEqual(sym('PE>0'), ['AAA', 'BBB'], 'CCC has no P/E: left out');
  assert.deepEqual(sym('DIV>2'), ['AAA']);
  assert.deepEqual(sym('SORT PE LOW'), ['AAA', 'BBB', 'CCC'], 'missing sinks');
  assert.equal(needsCnbc(parseScreenArgs('PE<30')), true);
  assert.equal(needsCnbc(parseScreenArgs('SORT DIV')), true);
  assert.equal(needsCnbc(parseScreenArgs('MCAP>10B')), false);
  assert.equal(screenWords(parseScreenArgs('div>2 mcap>10b pe<30')), 'MCAP>10B PE<30 DIV>2');
});

test('screen service: CNBC numbers only fetched when asked for, and labelled', async () => {
  const body = { data: { rows: ROWS.map((r) => ({ symbol: r.symbol, name: r.name, lastsale: `$${r.last}`, pctchange: `${r.changePct}%`, marketCap: String(r.marketCap), volume: String(r.volume), sector: r.sector, industry: '', country: r.country })) } };
  let fundCalls = 0;
  const s = makeScreen({ fetchImpl: async () => json(body), cache: createCache(), getFundMap: async (syms) => { fundCalls += 1; assert.equal(syms.length, 3); return FUND; } });
  const plain = await s.getScreen('MCAP>1B');
  assert.equal(fundCalls, 0);
  assert.equal(plain.cnbc, false);
  const pe = await s.getScreen('PE<30');
  assert.equal(fundCalls, 1);
  assert.deepEqual(pe.rows.map((r) => r.symbol), ['AAA']);
  assert.match(pe.source, /P\/E and dividend yield from CNBC, may be missing for some stocks/);
  await s.getScreen('DIV>1');
  assert.equal(fundCalls, 1, 'cached for an hour');
});

// ---- router and help ------------------------------------------------------------

test('router: company commands, ticker first, function bar, help', () => {
  assert.deepEqual(parseCommand('insiders aapl'), { name: 'INSIDERS', args: { ticker: 'AAPL' }, error: undefined, input: 'INSIDERS AAPL' });
  assert.equal(parseCommand('AAPL INSIDERS').name, 'INSIDERS');
  assert.equal(parseCommand('AAPL INSIDERS').input, 'INSIDERS AAPL');
  assert.equal(parseCommand('MSFT OWNERS').args.ticker, 'MSFT');
  assert.equal(parseCommand('AAPL FILINGS 10K').input, 'FILINGS AAPL 10-K');
  assert.equal(parseCommand('FILINGS AAPL').input, 'FILINGS AAPL');
  assert.equal(parseCommand('FILINGS AAPL 13F').error, 'usage');
  assert.equal(parseCommand('VALUE').error, 'usage');
  assert.equal(parseCommand('VALUE AAPL').name, 'VALUE', 'VALUE is a command, not a ticker');
  assert.equal(parseCommand('TSLA SHORTS').name, 'SHORTS');
  assert.equal(parseCommand('KO BEATS').name, 'BEATS');
  assert.equal(parseCommand('IPOS').name, 'IPOS');
  assert.equal(parseCommand('SPLITS').name, 'SPLITS');
  assert.deepEqual(parseCommand('EXDIV').args, { day: null });
  assert.equal(parseCommand('EXDIV 2026-10-01').args.day, '2026-10-01');
  assert.equal(parseCommand('EXDIV SOON').error, 'usage');
  assert.deepEqual(parseExdiv(['2026-02-30']), { error: 'usage' });
  assert.deepEqual(parseFilings(['AAPL', '8K']), { ticker: 'AAPL', form: '8-K' });
  assert.equal(filingsInput({ ticker: 'AAPL', form: 'ALL' }), 'FILINGS AAPL');
  assert.equal(matchCompany('NOPE', []), null);
  for (const fn of COMPANY_FUNCTIONS) {
    assert.ok(TICKER_FUNCTIONS.includes(fn));
    assert.ok(FUNCTION_BAR.includes(fn));
  }
  const bar = tickerFunctions('AAPL');
  assert.ok(bar.filter((f) => COMPANY_FUNCTIONS.includes(f.fn)).every((f) => f.ready && f.cmd === `AAPL ${f.fn}`));
  for (const c of COMPANY) {
    const h = findCommand(c.name);
    assert.ok(h && COMMANDS.some((x) => x.name === c.name && x.hint === h.summary), `${c.name} is in HELP`);
    for (const e of h.examples) {
      const p = parseCommand(e);
      assert.equal(p.name, c.name, e);
      assert.equal(p.error, undefined, e);
    }
  }
  assert.ok(suggest('INS').some((s) => s.name === 'INSIDERS' && s.value === 'INSIDERS '));
  assert.equal(suggest('OWNERS ')[0].usage, true);
  assert.ok(suggest('EX').some((s) => s.name === 'EXDIV'));
});

// ---- copy rules -----------------------------------------------------------------

test('copy rules for the company files: no banned words, no advice words, no em dashes, no amber', () => {
  const files = [
    'data/company-kit.js', 'data/insiders.js', 'data/owners.js', 'data/filings.js', 'data/shorts.js', 'data/beats.js',
    'data/value.js', 'data/ipos.js', 'data/splits.js', 'public/company.js', 'public/screens/company-kit.js',
    ...['insiders', 'owners', 'filings', 'shorts', 'beats', 'value', 'ipos', 'splits', 'exdiv'].map((n) => `public/screens/${n}.js`),
    'public/commands.css', 'public/screener.js', 'public/screens/screen.js', 'data/screen.js',
  ];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s, /amber|#ffb|hsl\((3\d|4\d|5\d),/i, `${f}: amber`);
    // The fetch option `signal` (abort) is code, not wording.
    const words = s.replace(/\.signal\b|\bsignal(?=:)/g, '');
    assert.doesNotMatch(words, /\brecommend|\bratings?\b|price target|\bsignals?\b|\bideas?\b|\bundervalued|\bovervalued|strong buy/i, `${f}: advice wording`);
  }
});
