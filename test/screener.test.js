import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScreenArgs, parseScreenCommand, screenWords, screenTokens, parseCond, applyScreen, sortRows, matchSector, matchCountry, sortOf, isEmptySpec,
} from '../public/screener.js';
import { num, cleanName, cleanSymbol, parseScreenerRows, parseAsOf, makeScreen } from '../data/screen.js';
import { createCache } from '../data/cache.js';
import { fmtBig, fmtPrice, rowCmd, formValues, wordsFromForm, sortCmd, resultsTable } from '../public/screens/screen.js';
import { parseCommand, toQuery, fromQuery } from '../public/app.js';

const ROWS = [
  { symbol: 'AAPL', name: 'Apple Inc.', last: 335.92, changePct: -0.326, marketCap: 4.9e12, volume: 24.7e6, sector: 'Technology', industry: 'Computer Manufacturing', country: 'United States' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', last: 224.58, changePct: 2.4, marketCap: 5.4e12, volume: 150e6, sector: 'Technology', industry: 'Semiconductors', country: 'United States' },
  { symbol: 'SOFI', name: 'SoFi Technologies', last: 4.1, changePct: 5.2, marketCap: 4.5e9, volume: 60e6, sector: 'Finance', industry: 'Finance: Consumer Services', country: 'United States' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor', last: 48, changePct: 3.1, marketCap: 9e11, volume: 12e6, sector: 'Technology', industry: 'Semiconductors', country: 'Taiwan' },
  { symbol: 'TINY', name: 'Tiny Co', last: 1.2, changePct: 40, marketCap: 20e6, volume: 1e5, sector: 'Health Care', industry: 'Biotechnology', country: 'United States' },
  { symbol: 'NOCAP', name: 'No Cap', last: 3, changePct: null, marketCap: null, volume: null, sector: '', industry: '', country: '' },
];
const syms = (rows) => rows.map((r) => r.symbol);

test('words: comparisons glue, spaces allowed around the operator', () => {
  assert.deepEqual(screenTokens('mcap > 10b  chg>2'), ['MCAP>10B', 'CHG>2']);
  assert.deepEqual(parseCond('MCAP>10B'), { field: 'MCAP', op: '>', value: 1e10, text: 'MCAP>10B' });
  assert.equal(parseCond('PRICE<$50').value, 50);
  assert.equal(parseCond('CHG<-2%').value, -2);
  assert.equal(parseCond('CHG<-2%').text, 'CHG<-2');
  assert.equal(parseCond('VOL>=1.5M').value, 1.5e6);
  assert.equal(parseCond('MARKETCAP>2T').field, 'MCAP');
  assert.equal(parseCond('PRICE>5B'), null, 'no size suffix on a price');
  assert.equal(parseCond('PE<20'), null, 'no P/E filter');
  assert.equal(parseCond('MCAP>ten'), null);
});

test('the example from the brief parses and round-trips', () => {
  const spec = parseScreenArgs(['SECTOR', 'TECHNOLOGY', 'MCAP>10B', 'CHG>2', 'PRICE<50', 'COUNTRY', 'US']);
  assert.equal(spec.sector, 'TECHNOLOGY');
  assert.equal(spec.country, 'US');
  assert.deepEqual(spec.conds.map((c) => c.text), ['MCAP>10B', 'CHG>2', 'PRICE<50']);
  assert.equal(screenWords(spec), 'SECTOR TECHNOLOGY COUNTRY US MCAP>10B PRICE<50 CHG>2');
  const again = parseScreenArgs(screenWords(spec));
  assert.equal(screenWords(again), screenWords(spec));
});

test('sectors, countries and industries by name or code', () => {
  assert.equal(matchSector('TECH').code, 'TECHNOLOGY');
  assert.equal(matchSector('health care').code, 'HEALTHCARE');
  assert.equal(matchSector('Consumer Staples').code, 'STAPLES');
  assert.equal(matchSector('PIZZA'), null);
  assert.deepEqual(matchCountry('USA'), { code: 'US', name: 'United States' });
  assert.equal(matchCountry('UNITED KINGDOM').code, 'UK');
  assert.equal(matchCountry('GB').code, 'UK');
  assert.equal(matchCountry('ATLANTIS'), null);
  assert.equal(parseScreenArgs('SECTOR HEALTH CARE MCAP>1B').sector, 'HEALTHCARE');
  assert.equal(parseScreenArgs('COUNTRY UNITED STATES PRICE<5').country, 'US');
  assert.equal(parseScreenArgs('INDUSTRY SEMICONDUCTORS SORT CHG').industry, 'SEMICONDUCTORS');
});

test('errors name the bad word', () => {
  assert.deepEqual(parseScreenArgs('SECTOR PIZZA'), { error: 'sector', bad: 'PIZZA' });
  assert.deepEqual(parseScreenArgs('COUNTRY ATLANTIS'), { error: 'country', bad: 'ATLANTIS' });
  assert.deepEqual(parseScreenArgs('PE<20'), { error: 'usage', bad: 'PE<20' });
  assert.deepEqual(parseScreenArgs('SORT COLOR'), { error: 'sort', bad: 'COLOR' });
  assert.equal(parseScreenArgs('GAINERS LOSERS').error, 'preset');
  assert.equal(parseScreenArgs('INDUSTRY').error, 'industry');
});

test('filters: sector, country, industry and numbers; missing numbers never match', () => {
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('SECTOR TECHNOLOGY'))), ['NVDA', 'AAPL', 'TSM']);
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('SECTOR TECHNOLOGY COUNTRY US'))), ['NVDA', 'AAPL']);
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('INDUSTRY SEMI'))), ['NVDA', 'TSM']);
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('MCAP>10B CHG>2 PRICE<50'))), ['TSM']);
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('PRICE<5'))), ['SOFI', 'TINY', 'NOCAP']);
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('MCAP<1T'))), ['TSM', 'SOFI', 'TINY']);
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('VOL>=60M'))), ['NVDA', 'SOFI']);
});

test('presets', () => {
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('LARGECAPS'))), ['NVDA', 'AAPL', 'TSM']);
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('GAINERS'))), ['SOFI', 'TSM', 'NVDA'], 'TINY is under $300M');
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('LOSERS'))), ['AAPL']);
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('PENNY'))), ['SOFI']);
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs('GAINERS SECTOR TECHNOLOGY SORT MCAP'))), ['NVDA', 'TSM']);
  assert.deepEqual(sortOf(parseScreenArgs('LOSERS')), { by: 'CHG', dir: 'LOW' });
  assert.equal(screenWords(parseScreenArgs('gainers')), 'GAINERS');
});

test('sorting: default market cap high, text A first, missing last', () => {
  assert.deepEqual(syms(applyScreen(ROWS, parseScreenArgs(''))), ['NVDA', 'AAPL', 'TSM', 'SOFI', 'TINY', 'NOCAP']);
  assert.deepEqual(syms(sortRows(ROWS, { by: 'CHG', dir: 'LOW' })), ['AAPL', 'NVDA', 'TSM', 'SOFI', 'TINY', 'NOCAP']);
  assert.deepEqual(syms(sortRows(ROWS, { by: 'SYMBOL', dir: 'LOW' })), ['AAPL', 'NOCAP', 'NVDA', 'SOFI', 'TINY', 'TSM']);
  const s = parseScreenArgs('SORT NAME');
  assert.deepEqual(s.sort, { by: 'NAME', dir: 'LOW' });
  assert.equal(screenWords(s), 'SORT NAME');
  assert.equal(screenWords(parseScreenArgs('SORT PRICE LOW')), 'SORT PRICE LOW');
  assert.equal(screenWords(parseScreenArgs('SORT PRICE HIGH')), 'SORT PRICE');
});

test('command bar: SCREEN alone is the form, typed filters are canonical, URL round-trips', () => {
  const empty = parseCommand('screen');
  assert.equal(empty.name, 'SCREEN');
  assert.equal(empty.input, 'SCREEN');
  assert.ok(isEmptySpec(empty.args));
  const c = parseCommand('screen sector tech mcap > 10b chg>2 price<50 country usa');
  assert.equal(c.name, 'SCREEN');
  assert.equal(c.input, 'SCREEN SECTOR TECHNOLOGY COUNTRY US MCAP>10B PRICE<50 CHG>2');
  assert.equal(fromQuery(toQuery(c.input)), c.input);
  assert.equal(parseCommand(fromQuery(toQuery(c.input))).input, c.input);
  assert.equal(parseCommand('SCREEN SECTOR PIZZA').error, 'sector');
  assert.equal(parseCommand('SCREENER GAINERS').input, 'SCREEN GAINERS');
  assert.equal(parseScreenCommand(['LOSERS']).input, 'SCREEN LOSERS');
  assert.equal(parseCommand('FINANCIALS AAPL').name, 'FINANCIALS');
  assert.equal(parseCommand('financials msft balance').input, 'FINANCIALS MSFT BALANCE');
  assert.equal(parseCommand('FINANCIALS').error, 'usage');
});

test('form and command stay in sync', () => {
  const spec = parseScreenArgs('GAINERS SECTOR TECHNOLOGY COUNTRY US MCAP>10B PRICE<50 SORT VOL');
  const v = formValues(spec);
  assert.equal(v.preset, 'GAINERS');
  assert.equal(v.MCAP_min, '10B');
  assert.equal(v.PRICE_max, '50');
  assert.deepEqual(wordsFromForm(v, spec.sort), { words: screenWords(spec) });
  assert.deepEqual(wordsFromForm({ sector: 'ENERGY', MCAP_min: '2b', CHG_max: '-1' }), { words: 'SECTOR ENERGY MCAP>2B CHG<-1' });
  assert.deepEqual(wordsFromForm({}), { words: '' });
  assert.match(wordsFromForm({ PRICE_min: 'cheap' }).error, /not a number/);
  assert.equal(sortCmd(parseScreenArgs('SECTOR ENERGY'), 'MCAP'), 'SCREEN SECTOR ENERGY SORT MCAP LOW');
  assert.equal(sortCmd(parseScreenArgs('SECTOR ENERGY'), 'CHG'), 'SCREEN SECTOR ENERGY SORT CHG');
  assert.equal(sortCmd(parseScreenArgs('SECTOR ENERGY'), 'NAME'), 'SCREEN SECTOR ENERGY SORT NAME');
});

test('results table: rows open quotes, odd symbols do not, text escaped', () => {
  assert.equal(rowCmd('AAPL'), 'AAPL');
  assert.equal(rowCmd('BRK.B'), 'BRK.B');
  assert.equal(rowCmd('ABR^D'), null);
  assert.equal(rowCmd('GOLD'), null, 'GOLD would open gold futures');
  const html = resultsTable([{ ...ROWS[0], name: '<img src=x>' }], parseScreenArgs(''));
  assert.match(html, /data-cmd="AAPL"/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /aria-sort="descending"/);
  assert.doesNotMatch(html, /style=/);
  assert.equal(fmtBig(4.9e12), '4.90T');
  assert.equal(fmtBig(710984898), '711.0M');
  assert.equal(fmtBig(4511), '4.5K');
  assert.equal(fmtBig(null), '--');
  assert.equal(fmtPrice(0.1234), '0.1234');
  assert.equal(fmtPrice(172.84), '172.84');
});

// ---- data ----------------------------------------------------------------------

const NASDAQ = {
  data: {
    asOf: null,
    rows: [
      { symbol: 'AAPL', name: 'Apple Inc. Common Stock', lastsale: '$335.92', netchange: '-1.10', pctchange: '-0.326%', volume: '24733329', marketCap: '4902476945600.00', country: 'United States', ipoyear: '1980', industry: 'Computer Manufacturing', sector: 'Technology', url: '/market-activity/stocks/aapl' },
      { symbol: 'BRK/B', name: 'Berkshire Hathaway Inc.', lastsale: '$480.00', netchange: '1.00', pctchange: '0.2%', volume: '3000000', marketCap: '1000000000000.00', country: 'United States', industry: 'Insurance', sector: 'Finance' },
      { symbol: 'ABR^D', name: 'Arbor Realty Preferred', lastsale: '$18.00', netchange: 'UNCH', pctchange: '', volume: '4511', marketCap: '0.00', country: '', industry: '', sector: '' },
    ],
  },
};

test('Nasdaq rows: numbers parsed, zero caps and blanks are missing', () => {
  const rows = parseScreenerRows(NASDAQ);
  assert.deepEqual(rows[0], { symbol: 'AAPL', name: 'Apple Inc.', last: 335.92, changePct: -0.326, marketCap: 4902476945600, volume: 24733329, sector: 'Technology', industry: 'Computer Manufacturing', country: 'United States' });
  assert.equal(rows[1].symbol, 'BRK.B');
  assert.equal(rows[2].marketCap, null);
  assert.equal(rows[2].changePct, null);
  assert.equal(num('NA'), null);
  assert.equal(num('$1,234.5'), 1234.5);
  assert.equal(cleanName('Alcoa Corporation Common Stock '), 'Alcoa Corporation');
  assert.equal(cleanSymbol('brk/a'), 'BRK.A');
  assert.equal(parseAsOf({ data: { asof: 'Last price as of Sep 24, 2026' } }), '2026-09-24');
  assert.equal(parseAsOf({ data: {} }), null);
  assert.throws(() => parseScreenerRows({ data: { rows: [] } }), /unexpected/);
});

test('service: one download for many screens, limit, errors', async () => {
  let calls = 0;
  const fetchImpl = async (url, opts) => {
    calls += 1;
    assert.match(opts.headers['User-Agent'], /Mozilla/);
    const body = url.includes('download=true') ? NASDAQ : { data: { asof: 'Last price as of Sep 24, 2026' } };
    return { ok: true, status: 200, json: async () => body };
  };
  const { getScreen } = makeScreen({ fetchImpl, cache: createCache() });
  const a = await getScreen('SECTOR TECHNOLOGY');
  assert.equal(a.count, 1);
  assert.equal(a.total, 3);
  assert.equal(a.asOf, '2026-09-24');
  assert.equal(a.spec, 'SECTOR TECHNOLOGY');
  const b = await getScreen('', 1);
  assert.equal(b.count, 3);
  assert.equal(b.rows.length, 1);
  assert.equal(b.rows[0].symbol, 'AAPL');
  assert.equal(calls, 2, 'the universe and its date are fetched once');
  await assert.rejects(getScreen('SECTOR PIZZA'), (e) => e.code === 'sector');
});
