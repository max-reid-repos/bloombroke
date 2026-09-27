// "No such ticker XLY. Did you mean XLY?" A real ETF must never be turned away when the
// symbol list has it, and the did-you-mean list must never offer the words typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInput } from '../public/resolve.js';
import { parseCommand, tickerToCheck } from '../public/app.js';
import { parseLookup } from '../data/search.js';
import { makeQuotes, normalizeTicker, stockQuoteOrGap, fetchStockRows } from '../data/quotes.js';
import { createCache } from '../data/cache.js';
import { LISTED_TICKERS } from '../public/known-tickers.js';

const SECTOR_SPDRS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const BIG = ['SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'ARKK', 'SMH', 'GLD', 'TLT', 'BRK.B'];
// NYSE Arca and Cboe BZX listings, and an ETN and a closed-end fund.
const OTHER = [
  ['GBTC', 'ETF', 'NYSE Arca'], ['SPLG', 'ETF', 'NYSE Arca'], ['FBTC', 'ETF', 'CBOE'], ['ARKB', 'ETF', 'CBOE'],
  ['UVXY', 'ETF', 'CBOE'], ['VXX', 'ETN', 'CBOE'], ['PDI', 'CF', 'NYSE'],
];
const ALL = [...SECTOR_SPDRS.map((t) => [t, 'ETF', 'NYSE Arca']), ...BIG.map((t) => [t, t === 'BRK.B' ? 'STOCK' : 'ETF', 'NYSE Arca']), ...OTHER];

// What the CNBC symbol lookup sends for a prefix: the ticker, a longer one, a Toronto copy.
const lookupBody = (t, issueType) => [{ TotalMatchAvailable: '3' },
  { symbolName: t, countryCode: 'US', issueType, exchangeName: 'NYSE Arca', companyName: `${t} Fund` },
  { symbolName: `${t.replace('.', '')}X`.slice(0, 5), countryCode: 'US', issueType: 'ETF', companyName: `${t} Plus ETF` },
  { symbolName: `${t}-CA`, countryCode: 'CA', issueType: 'STOCK', companyName: `${t} Canada` }];

// The quote check said no (a gap in the quote source); the symbol lookup has the ticker.
const gapDeps = (t, issueType) => ({
  search: async () => parseLookup(lookupBody(t, issueType)),
  checkTicker: async () => false,
});

test('XLY class: every listed ETF and stock parses as a quote, never as a registry name', () => {
  for (const [t] of ALL) {
    const cmd = parseCommand(t);
    assert.equal(cmd.name, 'QUOTE', t);
    assert.equal(cmd.args.ticker, t, t);
    assert.equal(normalizeTicker(t), t, `${t} is not shadowed by an instrument`);
    assert.equal(normalizeTicker(t.toLowerCase()), t);
  }
  assert.equal(tickerToCheck(parseCommand('XLY')), 'XLY', 'XLY is asked about, not assumed');
});

test('XLY class: the symbol lookup keeps US ETFs, ETNs and closed-end funds on every exchange', () => {
  for (const [t, issueType] of ALL) {
    const rows = parseLookup(lookupBody(t, issueType));
    assert.equal(rows[0]?.id, t, t);
    assert.ok(!rows.some((r) => r.id.endsWith('-CA')), 'foreign copies stay out');
  }
  assert.equal(parseLookup(lookupBody('VXX', 'ETN'))[0].kind, 'etf');
  assert.equal(parseLookup(lookupBody('PDI', 'CF'))[0].kind, 'stock');
  assert.deepEqual(parseLookup([{}, { symbolName: 'VFIAX', countryCode: 'US', issueType: 'MUTF' }]), [], 'types we cannot open stay out');
});

test('XLY class: a ticker the lookup has runs, even when the quote check said no', async () => {
  for (const [t, issueType] of ALL) {
    // The big ETFs the browser knows are never asked about: the router shows them.
    if (LISTED_TICKERS.has(t)) { assert.equal(tickerToCheck(parseCommand(t)), null, t); continue; }
    for (const typed of [t, t.toLowerCase()]) {
      const r = await resolveInput(typed, gapDeps(t, issueType));
      assert.deepEqual(r, { confident: true, from: typed, command: t }, typed);
    }
  }
  const news = await resolveInput('XLY NEWS', gapDeps('XLY', 'ETF'));
  assert.deepEqual(news, { confident: true, from: 'XLY NEWS', command: 'XLY NEWS' });
});

test('XLY class: a ticker nobody has stays unknown', async () => {
  const deps = { search: async () => parseLookup([{}, { symbolName: 'XLYI', countryCode: 'US', issueType: 'ETF', companyName: 'Cons Disc Prem Inc ETF' }]), checkTicker: async () => false };
  const r = await resolveInput('XLQQ', deps);
  assert.equal(r.confident, false);
  assert.ok(!r.symbols.some((s) => s.cmd === 'XLQQ'));
});

test('did you mean: never the symbol or command that was typed', async () => {
  // The quote check says yes, so the resolver has nothing new: it must not offer XLY back.
  const deps = { search: async () => parseLookup(lookupBody('XLY', 'ETF')), checkTicker: async () => true };
  for (const typed of ['XLY', 'xly', ' xly ', 'XLY NEWS', 'xly  news']) {
    const r = await resolveInput(typed, deps);
    const want = typed.trim().replace(/\s+/g, ' ').toUpperCase();
    assert.equal(r.confident, false, typed);
    assert.ok(![...r.symbols, ...r.commands].some((s) => s.cmd.toUpperCase() === want), `${typed}: ${JSON.stringify(r)}`);
  }
});

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const row = (symbol, extra = {}) => ({ symbol, code: 0, name: `${symbol} ETF`, last: '110.56', change: '0.24', change_pct: '+0.22%', exchange: 'NYSE Arca', ...extra });

test('root cause: a row missing from the answer is a data gap (503), never an unknown ticker (404)', async () => {
  // A list call where the source left XLY out of its batch.
  let answer = [row('XLK')];
  const q = makeQuotes({ fetchImpl: async () => json({ FormattedQuoteResult: { FormattedQuote: answer } }), cache: createCache({ retryMs: 0 }) });
  const list = await q.getQuoteList(['XLK', 'XLY']);
  assert.deepEqual(list.quotes.map((x) => x.ticker), ['XLK']);
  assert.deepEqual(list.missing, ['XLY'], 'the list still shows it as missing');
  // The next single quote must not read "unknown" out of the cache.
  answer = [row('XLY')];
  const one = await q.getQuote('XLY');
  assert.equal(one?.ticker, 'XLY');
  assert.equal(one.exchange, 'NYSE Arca');

  // Inside the retry window the gap is an outage (the route answers 503), not a 404.
  answer = [row('XLK')];
  const q2 = makeQuotes({ fetchImpl: async () => json({ FormattedQuoteResult: { FormattedQuote: answer } }), cache: createCache() });
  await q2.getQuoteList(['XLK', 'XLY']);
  answer = [row('XLY')];
  await assert.rejects(q2.getQuote('XLY'), /no row/);
});

test('root cause: an empty answer or a row with no price throws; code 1 is unknown', async () => {
  const quotes = (rows) => makeQuotes({ fetchImpl: async () => json({ FormattedQuoteResult: { FormattedQuote: rows } }), cache: createCache() });
  await assert.rejects(quotes([]).getQuote('XLY'), /no row/);
  await assert.rejects(quotes([row('XLY', { last: '--' })]).getQuote('XLY'), /no price/);
  assert.equal(await quotes([{ symbol: 'ZZZQX', code: 1 }]).getQuote('ZZZQX'), null);
  assert.equal(await quotes([{ symbol: 'FRC', code: 3 }]).getQuote('FRC'), null);
  assert.equal(stockQuoteOrGap(row('XLY'), 'XLY').last, 110.56);
  assert.equal(stockQuoteOrGap({ symbol: 'X', code: 1 }, 'X'), null);
});

test('root cause: the source said "no such symbol" for XLY once; it is asked again before a 404', async () => {
  // Seen live: a fresh server's first XLY call came back { symbol: 'XLY', code: 1 }.
  const answers = [[{ symbol: 'XLY', code: 1 }], [row('XLY')]];
  const calls = [];
  const q = makeQuotes({ fetchImpl: async (url) => { calls.push(new URL(url).searchParams.get('symbols')); return json({ FormattedQuoteResult: { FormattedQuote: answers.shift() || [] } }); }, cache: createCache() });
  const one = await q.getQuote('XLY');
  assert.equal(one?.ticker, 'XLY');
  assert.deepEqual(calls, ['XLY', 'XLY']);

  // In a list: only the symbols that came back unknown are asked again, in one call.
  const listCalls = [];
  const flaky = new Set(['XLY', 'XLRE']);
  const list = makeQuotes({
    fetchImpl: async (url) => {
      const syms = new URL(url).searchParams.get('symbols').split('|');
      listCalls.push(syms);
      const first = listCalls.length === 1;
      return json({ FormattedQuoteResult: { FormattedQuote: syms.map((s) => (s === 'ZZZQX' || (first && flaky.has(s)) ? { symbol: s, code: 1 } : row(s))) } });
    },
    cache: createCache(),
  });
  const r = await list.getQuoteList(['XLK', 'XLY', 'XLRE', 'ZZZQX']);
  assert.deepEqual(r.quotes.map((x) => x.ticker), ['XLK', 'XLY', 'XLRE']);
  assert.deepEqual(r.missing, ['ZZZQX']);
  assert.deepEqual(listCalls, [['XLK', 'XLY', 'XLRE', 'ZZZQX'], ['XLY', 'XLRE', 'ZZZQX']]);
});

test('root cause: a symbol unknown twice stays unknown, and a failed recheck keeps the first answer', async () => {
  let n = 0;
  const q = makeQuotes({ fetchImpl: async () => { n += 1; return json({ FormattedQuoteResult: { FormattedQuote: [{ symbol: 'ZZZQX', code: 1 }] } }); }, cache: createCache() });
  assert.equal(await q.getQuote('ZZZQX'), null);
  assert.equal(n, 2);
  let m = 0;
  const rows = await fetchStockRows(async () => { m += 1; return m === 1 ? json({ FormattedQuoteResult: { FormattedQuote: [{ symbol: 'XLY', code: 1 }] } }) : json({}, 500); }, ['XLY']);
  assert.deepEqual(rows, [{ symbol: 'XLY', code: 1 }]);
});

test('root cause: the recheck goes past the source cache with its own URL', async () => {
  const urls = [];
  let n = 0;
  await fetchStockRows(async (url) => { urls.push(new URL(url)); n += 1; return json({ FormattedQuoteResult: { FormattedQuote: [n === 1 ? { symbol: 'XLY', code: 1 } : row('XLY')] } }); }, ['XLY'], () => 1790000000000);
  assert.equal(urls.length, 2);
  assert.equal(urls[0].searchParams.get('recheck'), null, 'first asks share the cached answer');
  assert.equal(urls[1].searchParams.get('recheck'), '1790000000000');
  assert.equal(urls[1].searchParams.get('symbols'), 'XLY');
});
