import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, suggest, symbolSuggestions, toQuery, fromQuery } from '../public/app.js';
import { INSTRUMENTS, resolveInstrument, matchInstrument, searchInstruments, FX_MAJOR_IDS, YIELD_IDS, instrumentById } from '../public/instruments.js';
import { freshTag, freshnessParts, statusLine, lastTradeLine, category } from '../public/freshness.js';
import { statRows, changeText } from '../public/screens/quote.js';
import { marketsTable, marketsColumns } from '../public/screens/markets.js';
import { fxTable } from '../public/screens/home.js';
import { ratesRows } from '../public/screens/rates.js';
import { changeFrom, withLive } from '../public/screens/chart.js';

test('registry: unique ids and aliases, every tape and markets row is known', () => {
  const keys = INSTRUMENTS.flatMap((i) => [i.id, ...i.aliases].map((k) => k.toUpperCase()));
  assert.equal(new Set(keys).size, keys.length, 'no alias points at two instruments');
  const tape = INSTRUMENTS.filter((i) => i.tape);
  assert.ok(tape.length >= 15 && tape.length <= 20, `tape has ${tape.length}`);
  assert.ok(INSTRUMENTS.filter((i) => i.markets).length >= 25);
  for (const id of [...FX_MAJOR_IDS, ...YIELD_IDS]) assert.ok(instrumentById(id), id);
  assert.ok(!resolveInstrument('SENSEX'), 'Sensex has no data at the source, so it is left out');
});

test('aliases: readable names open the right screen', () => {
  const open = (s) => { const c = parseCommand(s); return c.name === 'QUOTE' ? c.args.ticker : c.name; };
  assert.equal(open('gold'), 'GOLD');
  assert.equal(open('EUR/USD'), 'EURUSD');
  assert.equal(open('eurusd'), 'EURUSD');
  assert.equal(open('S&P 500'), 'SPX');
  assert.equal(open('s&p500'), 'SPX');
  assert.equal(open('euro stoxx 50'), 'STOXX50');
  assert.equal(open('hang seng'), 'HSI');
  assert.equal(open('bitcoin'), 'BTC');
  assert.equal(open('oil'), 'WTI');
  assert.equal(open('natural gas'), 'NATGAS');
  assert.equal(open('dollar'), 'DXY');
  assert.equal(open('us10y'), 'US10Y');
  assert.equal(open('HOME'), 'HOME', 'commands win');
  assert.equal(open('MARKETS'), 'MARKETS');
  assert.deepEqual(matchInstrument(['EURO', 'STOXX', '50', '5Y']).used, 3);
  assert.equal(searchInstruments('eur')[0].id, 'EURUSD');
});

test('symbol commands: presets, custom ranges and their ?c= form', () => {
  assert.deepEqual(parseCommand('gold 5y').args, { ticker: 'GOLD', range: '5Y' });
  assert.equal(parseCommand('gold 5y').input, 'GOLD 5Y');
  assert.deepEqual(parseCommand('AAPL 2020-01-01 2024-12-31').args, { ticker: 'AAPL', from: '2020-01-01', to: '2024-12-31' });
  assert.equal(parseCommand('aapl from 2020-01-01').input, 'AAPL FROM 2020-01-01');
  assert.deepEqual(parseCommand('aapl from 2020-01-01').args, { ticker: 'AAPL', from: '2020-01-01', to: null });
  assert.equal(parseCommand('SPX MAX').args.range, 'MAX');
  assert.equal(parseCommand('eur/usd ytd').input, 'EURUSD YTD');
  assert.equal(parseCommand('AAPL 2021-02-30').error, 'date');
  assert.equal(parseCommand('AAPL 2021-02-30').name, 'QUOTE', 'the screen explains the bad date');
  assert.equal(parseCommand('AAPL 2024-01-01 2023-01-01').error, 'order');
  assert.equal(parseCommand('GOLD PRICE').name, 'UNKNOWN');
  assert.equal(fromQuery(toQuery('AAPL 2020-01-01 2024-12-31')), 'AAPL 2020-01-01 2024-12-31');
  assert.equal(parseCommand(fromQuery('?c=S%26P+500')).args.ticker, 'SPX');
});

test('suggestions: symbols after two letters, commands first', () => {
  assert.deepEqual(suggest('go').map((s) => s.value), ['GOLD', 'GOLDFUT'], 'spot gold first, then the futures');
  assert.equal(suggest('ho')[0].value, 'HOME');
  assert.ok(suggest('bit').some((s) => s.value === 'BTC'));
  const merged = symbolSuggestions([{ id: 'GOLD', name: 'Gold', kind: 'future' }, { id: 'AAPL', name: 'Apple Inc.', kind: 'stock' }], [{ value: 'GOLD' }]);
  assert.deepEqual(merged.map((s) => [s.value, s.hint]), [['AAPL', 'Apple Inc. · stock']]);
});

test('freshness: RT and DLY tags, and an honest status line', () => {
  assert.match(freshTag({ realTime: true }), />RT</);
  assert.match(freshTag({ realTime: false }), />DLY</);
  assert.equal(freshTag({}), '');
  assert.equal(category({ kind: 'index', us: true }), 'US INDEXES');
  assert.equal(category({ kind: 'index', us: false }), 'NON-US INDEXES');
  assert.deepEqual(freshnessParts([
    { kind: 'stock', realTime: true },
    { kind: 'future', realTime: false },
  ]), ['US STOCKS REAL TIME', 'FUTURES DELAYED']);
  assert.deepEqual(freshnessParts([
    { kind: 'index', us: true, realTime: true },
    { kind: 'index', us: true, realTime: false },
    { kind: 'fx', realTime: true },
  ]), ['FX REAL TIME', 'SOME US INDEXES DELAYED'], 'a mixed bucket is never called real time');
  const line = statusLine('2026-09-25T14:09:50Z', false, [{ kind: 'stock', realTime: true }, { kind: 'future', realTime: false }]);
  assert.equal(line, 'UPDATED 10:09:50 ET · US STOCKS REAL TIME · FUTURES DELAYED');
  assert.match(statusLine('2026-09-25T14:09:50Z', true, []), /^LAST KNOWN DATA 10:09:50 ET$/);
  const now = new Date('2026-09-25T15:00:00Z');
  assert.equal(lastTradeLine({ asOf: '2026-09-25T10:04:44.000-0400', realTime: false, kind: 'future' }, now), 'LAST TRADE 10:04:44 ET · DELAYED ABOUT 10 MIN');
  assert.equal(lastTradeLine({ asOf: '2026-09-24T15:59:59.000-0400', realTime: true, kind: 'stock' }, now), 'LAST TRADE 2026-09-24 15:59:59 ET · REAL TIME');
  assert.equal(lastTradeLine({ asOf: '2026-09-24', realTime: false, kind: 'index' }, now), 'CLOSE 2026-09-24 · DELAYED');
});

test('instrument screen: the fields fit the kind', () => {
  const base = { last: 100, change: 1, changePct: 1, low52: 80, high52: 120, prevClose: 99, open: 99.5, low: 98, high: 101, pe: 30, marketCap: '1T', volume: '1M' };
  const keys = (d) => statRows(d).map(([k]) => k);
  assert.ok(keys({ ...base, kind: 'stock' }).includes('P/E'));
  assert.ok(!keys({ ...base, kind: 'index' }).includes('P/E'), 'no P/E for an index');
  assert.ok(!keys({ ...base, kind: 'future' }).includes('Mkt cap'));
  assert.ok(keys({ ...base, kind: 'fx', decimals: 4 }).includes('Day range'));
  assert.equal(changeText({ kind: 'yield', change: 0.019, changePct: 0.4, last: 5.2, decimals: 3 }), '+1.9 bp');
  assert.equal(changeText({ kind: 'fx', change: 0.0018, changePct: 0.16, last: 1.14, decimals: 4 }), '+0.0018 +0.16%');
});

test('every instrument row opens its screen, by click or Enter', () => {
  const rows = [{ id: 'GOLD', name: 'Gold', group: 'Commodities', last: 1, change: 1, changePct: 1, decimals: 2, realTime: false }];
  for (const html of [marketsTable(rows), marketsColumns(rows)]) {
    assert.match(html, /<tr class="row-link" data-cmd="GOLD" tabindex="0">/);
    assert.match(html, />DLY</);
  }
  assert.match(fxTable([{ id: 'EURUSD', pair: 'EUR/USD', last: 1.1, change: 0, changePct: 0, decimals: 4, realTime: true }]), /data-cmd="EURUSD" tabindex="0"/);
  const rates = ratesRows({ yields: [{ id: 'US10Y', name: 'US 10-year Treasury', last: 5.1, change: 0.01, asOf: null }] });
  assert.equal(rates[0].cmd, 'US10Y');
});

test('chart: change vs the range start, live point appended only after the last bar', () => {
  assert.deepEqual(changeFrom(100, 110), { dir: 'up', text: '+10.00 +10.00%', pct: 10 });
  assert.equal(changeFrom(5.0, 5.25, { bp: true }).text, '+25.0 bp');
  const pts = [{ t: 1, v: 1 }, { t: 2, v: 2 }];
  assert.equal(withLive(pts, { t: 3, v: 3 }, { range: '1Y' }).length, 3);
  assert.equal(withLive(pts, { t: 2, v: 3 }, { range: '1Y' }).length, 2);
  assert.equal(withLive(pts, { t: 3, v: 3 }, { from: '2020-01-01', to: '2021-01-01' }).length, 2, 'a closed range stays closed');
});

test('instrument header: short exchange names', async () => {
  const { metaLine } = await import('../public/screens/quote.js');
  assert.equal(metaLine({ exchange: 'CEC:Commodities Exchange Centre', currency: 'USD', kind: 'future' }), 'COMEX  USD  FUTURES');
  assert.equal(metaLine({ exchange: 'Exchange', currency: null, kind: 'fx' }), 'CURRENCY PAIR');
  assert.equal(metaLine({ exchange: 'NASDAQ', currency: 'USD', kind: 'stock', type: 'STOCK' }), 'NASDAQ  USD  STOCK');
});
