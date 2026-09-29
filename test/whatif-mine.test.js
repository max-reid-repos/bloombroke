// WHATIF with your own purchase (MY, Pro): the words, the trading-day rule, the maths
// against the catalogue engine, the gate, the share image and the share link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseMine, formWords, mineLabel, mineShort, parseAmount, dateLabel, parseDateWord, MineError, MINE_EXAMPLES,
} from '../public/whatif-mine.js';
import { onOrAfter, onOrBefore, firstOfMonths, loadMine, compact, compactBytes, dropLeadingEmpty, makeDaily } from '../data/whatif-mine.js';
import { resolveTokens, whatifCommand } from '../data/whatif.js';
import { getWhatif, catalog } from '../data/whatif-service.js';
import { normalizeWhatif, certModel, whatifTokens } from '../data/whatif-cert.js';
import { readdirSync } from 'node:fs';
import { getCert, whatifPng, makeRateLimit, mineModels, minePngs, MINE_MEMORY } from '../lib/og.js';
import { createCache } from '../data/cache.js';
import { planWhatif, commandFor, shareLinks, ownInputHtml, ownWords, OWN_PLACEHOLDER } from '../public/screens/whatif.js';
import * as screenMod from '../public/screens/whatif.js';
import { PRO_ROWS, FREE_ROWS, LIVE } from '../public/screens/pro.js';
import { findCommand } from '../public/registry.js';

const NOW = new Date('2026-09-27T12:00:00Z');
const prices = JSON.parse(readFileSync(new URL('../data/whatif-prices.json', import.meta.url), 'utf8'));

// Weekday closes from `from` to `to`, price by a rule: a fake daily-bar source.
function weekdays(from, to, price) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const day = d.toISOString().slice(0, 10);
    out.push([day, price(day)]);
  }
  return out;
}
const quote = (last, extra = {}) => async (t) => ({ last: typeof last === 'function' ? last(t) : last, asOf: '2026-09-25T20:00:00Z', kind: 'stock', type: 'STOCK', name: `${t} Inc.`, ...extra });

// ---- The words -------------------------------------------------------------------------

test('parser: one-off and habit forms, canonical words and generated labels', () => {
  const one = (s) => parseMine(s.split(' '), NOW).mine[0];
  const a = one('MY 1200 AAPL 2015');
  assert.equal(a.kind, 'once');
  assert.equal(a.amount, 1200);
  assert.equal(a.date.day, '2015-01-01');
  assert.deepEqual(a.words, ['MY', '1200', 'AAPL', '2015']);
  assert.equal(mineLabel(a), '$1,200 in AAPL, 2015');
  assert.equal(mineLabel(one('MY 1200 AAPL 2015-03')), '$1,200 in AAPL, MAR 2015');
  assert.equal(mineLabel(one('MY $1,200 AAPL 2015-03-02')), '$1,200 in AAPL, 2 MAR 2015');
  assert.deepEqual(one('MY $1,200 AAPL 2015-03-02').words, ['MY', '1200', 'AAPL', '2015-03-02']);
  const h = one('MY 5 A DAY SBUX SINCE 2018');
  assert.deepEqual([h.kind, h.per, h.start, h.end], ['monthly', 'day', '2018-01', '2026-09']);
  assert.equal(mineLabel(h), '$5 a day in SBUX since 2018');
  assert.equal(mineShort(h), '$5 a day in SBUX');
  const w = one('MY 20 A WEEK KO SINCE 2016-06 TO 2022');
  assert.deepEqual([w.per, w.start, w.end], ['week', '2016-06', '2022-12']);
  assert.equal(mineLabel(w), '$20 a week in KO since JUN 2016 to 2022');
  assert.equal(one('MY 50 A MONTH SPY SINCE 2020 TO 2020-03').end, '2020-03');
  // The ticker A (Agilent) is a ticker, not the word A.
  assert.equal(one('MY 100 A 2015').ticker, 'A');
  // Mixed with catalogue words, in any place.
  const { mine, rest } = parseMine(['IPHONE6', 'MY', '100', 'NVDA', '2020', 'LATTE:3Y', 'MY', '5', 'A', 'WEEK', 'KO', 'SINCE', '2019'], NOW);
  assert.deepEqual(rest, ['IPHONE6', 'LATTE:3Y']);
  assert.equal(mine.length, 2);
  assert.equal(parseAmount('$1,200'), 1200);
  assert.ok(Number.isNaN(parseAmount('12a')));
  assert.equal(dateLabel(parseDateWord('2015-12')), 'DEC 2015');
});

test('parser: bad input gets a plain message', () => {
  const bad = (s) => assert.throws(() => parseMine(s.split(' '), NOW), MineError, s);
  const msg = (s) => { try { parseMine(s.split(' '), NOW); } catch (e) { return e.message; } return ''; };
  bad('MY');
  bad('MY 1200 AAPL');
  assert.match(msg('MY 0 AAPL 2015'), /from \$1 to \$10,000,000/);
  assert.match(msg('MY 10000001 AAPL 2015'), /from \$1 to \$10,000,000/);
  assert.match(msg('MY abc AAPL 2015'), /not an amount/);
  assert.match(msg('MY 1200.50 AAPL 2015'), /whole dollars/, 'whole dollars only: the ribbon and the spent line agree');
  assert.match(msg('MY 5 A DAY SBUX SINCE 2018 TO 2099'), /TO 2099 is in the future/);
  assert.equal(parseMine('MY 5 A DAY SBUX SINCE 2018 TO 2026'.split(' '), NOW).mine[0].end, '2026-09', 'this year runs to this month');
  assert.match(msg('MY 100 AAPL 2026-09-27'), /is today/);
  assert.match(msg('MY 1 A 2015 MY 1 B 2015 MY 1 C 2015 MY 1 D 2015'), /Up to 3 stocks of your own/);
  // Today is the New York date: at 02:00 UTC on 1 Oct it is still 30 Sep in New York.
  assert.match((() => { try { parseMine('MY 100 AAPL 2026-10-01'.split(' '), new Date('2026-10-01T02:00:00Z')); } catch (e) { return e.message; } return ''; })(), /in the future/);
  assert.match(msg('MY 100 TOOLONGX 2015'), /does not look like a ticker/);
  assert.match(msg('MY 100 AAPL 2015-13'), /not a date/);
  assert.match(msg('MY 100 AAPL 2015-02-30'), /not a date/);
  assert.match(msg('MY 100 AAPL 2027'), /in the future/);
  assert.match(msg('MY 5 A DAY SBUX 2018'), /takes SINCE/);
  assert.match(msg('MY 5 A DAY SBUX SINCE 2018-03-02'), /year or a month/);
  assert.match(msg('MY 5 A DAY SBUX SINCE 2020 TO 2019'), /TO has to be after SINCE/);
  assert.match(msg('MY 5 A DAY SBUX SINCE 1970'), /50 years or fewer/);
  assert.doesNotThrow(() => parseMine('MY 5 A DAY SBUX SINCE 1976-10'.split(' '), NOW), '50 years exactly');
  // Through the engine: the same message, as a WHATIF error.
  assert.throws(() => resolveTokens(['MY', '0', 'AAPL', '2015'], catalog, NOW), { code: 'bad_mine' });
  // The form builds the same words.
  assert.deepEqual(formWords({ amount: '1,200', ticker: 'aapl', date: '2015-03', how: 'ONCE' }, NOW), ['MY', '1200', 'AAPL', '2015-03']);
  assert.deepEqual(formWords({ amount: '5', ticker: 'sbux', date: '2018', how: 'DAY', to: '2022' }, NOW), ['MY', '5', 'A', 'DAY', 'SBUX', 'SINCE', '2018', 'TO', '2022']);
  assert.throws(() => formWords({ amount: '', ticker: 'X', date: '2015' }, NOW), MineError);
  // An empty or odd field gets a plain line about that field, never the command syntax.
  const said = (f) => { try { formWords(f, NOW); return ''; } catch (e) { return e.message; } };
  assert.equal(said({ amount: '', ticker: 'AAPL', date: '2015' }), 'Type an amount, like 15.');
  assert.equal(said({ amount: 'ten', ticker: 'AAPL', date: '2015' }), 'Type the amount in whole dollars, like 15.');
  assert.equal(said({ amount: '15', ticker: '', date: '2015', how: 'WEEK' }), 'Type a stock ticker, like AAPL.');
  assert.equal(said({ amount: '15', ticker: 'toolong', date: '2015' }), 'TOOLONG is not a ticker. Try one like AAPL.');
  assert.equal(said({ amount: '15', ticker: 'AAPL', date: '', how: 'WEEK' }), 'Type a year, like 2015.');
  assert.equal(said({ amount: '15', ticker: 'AAPL', date: '' }), 'Type a date, like 2015 or 2015-03.');
  for (const f of [{ amount: '', ticker: 'AAPL', date: '2015' }, { amount: '15', ticker: 'AAPL', date: 'x', how: 'WEEK' }]) assert.doesNotMatch(said(f), /WHATIF MY/);
});

test('labels are made from numbers, tickers and dates only: no typed words reach a card', () => {
  const words = 'MY 1200 AAPL 2015-03 MY 5 A DAY SBUX SINCE 2018 TO 2022'.split(' ');
  for (const m of parseMine(words, NOW).mine) {
    assert.match(mineLabel(m), /^\$[\d,.]+( a (day|week|month))? in [A-Z.]{1,8}(, | since )[A-Z0-9 ]+( to [A-Z0-9 ]+)?$/);
  }
  // Anything that is not one of those words is refused, never shown.
  assert.throws(() => parseMine(['MY', '100', 'HELLO<b>', '2015'], NOW), MineError);
  assert.equal(whatifTokens('WHATIF MY 100 AAPL 2015 <script>'), null, 'the ?c= guard still stops markup');
});

// ---- Trading days and the schedule ----------------------------------------------------

test('trading-day rule: a date means its first trading day on or after it', () => {
  const closes = [['2015-01-02', 10], ['2015-01-05', 11], ['2015-03-02', 12], ['2015-03-03', 13]];
  assert.deepEqual(onOrAfter(closes, '2015-01-01'), { date: '2015-01-02', close: 10 }, '2015: the first trading day of the year');
  assert.deepEqual(onOrAfter(closes, '2015-01-03'), { date: '2015-01-05', close: 11 }, 'a Saturday: the Monday after');
  assert.deepEqual(onOrAfter(closes, '2015-03-01'), { date: '2015-03-02', close: 12 }, '2015-03: the first trading day of the month');
  assert.deepEqual(onOrAfter(closes, '2015-03-03'), { date: '2015-03-03', close: 13 });
  assert.equal(onOrAfter(closes, '2015-04-01'), null);
  // An exact day: its close, or the last trading day before (as in the catalogue).
  const sep = [['2026-09-24', 1], ['2026-09-25', 2], ['2026-09-28', 3]];
  assert.deepEqual(onOrBefore(sep, '2026-09-26'), { date: '2026-09-25', close: 2 }, 'Saturday: Friday\'s close');
  assert.deepEqual(onOrBefore(sep, '2026-09-25'), { date: '2026-09-25', close: 2 });
  assert.equal(onOrBefore(sep, '2026-09-23'), null);
  // Placeholder bars with no trades before real trading are not a first date.
  assert.deepEqual(dropLeadingEmpty([{ v: 1 }, { v: 1, x: 0 }, { v: 2, x: 10 }, { v: 3 }]), [{ v: 2, x: 10 }, { v: 3 }]);
  assert.deepEqual(dropLeadingEmpty([{ v: 1 }, { v: 2 }]), [{ v: 1 }, { v: 2 }], 'no volume at all: all kept');
  // Kept compactly: 4 bytes a day and 8 a close.
  const c = compact(sep);
  assert.ok(c.days instanceof Int32Array && c.closes instanceof Float64Array);
  assert.equal(compactBytes(c), 3 * 12);
  assert.deepEqual(firstOfMonths(closes, '2015-01'), { '2015-01': { date: '2015-01-02', close: 10 }, '2015-03': { date: '2015-03-02', close: 12 } });
});

test('habit schedule: one buy a month on the first trading day, of that month\'s spend', async () => {
  // A price of 10 in Jan 2020, 20 in Feb, 40 in Mar, 50 after.
  const px = (d) => ({ '2020-01': 10, '2020-02': 20, '2020-03': 40 }[d.slice(0, 7)] ?? 50);
  const dailyImpl = async () => weekdays('2019-06-03', '2026-09-25', px);
  const d = await getWhatif(['MY', '5', 'A', 'DAY', 'XYZ', 'SINCE', '2020', 'TO', '2020-03'], { quoteImpl: quote(60), dailyImpl, now: NOW, risk: true, chartImpl: async () => null });
  const r = d.rows[0];
  // 31, 29 (2020 is a leap year) and 31 days at $5.
  assert.equal(r.paid, 155 + 145 + 155);
  assert.equal(r.buys, 3);
  const shares = 155 / 10 + 145 / 20 + 155 / 40;
  assert.ok(Math.abs(r.shares - shares) < 1e-12);
  assert.ok(Math.abs(r.value - shares * 60) < 1e-9);
  assert.deepEqual([r.from, r.to], ['2020-01', '2020-03']);
  // A week: 52 weeks over 12 months; a month: the amount itself.
  const wk = await getWhatif(['MY', '20', 'A', 'WEEK', 'XYZ', 'SINCE', '2020-01', 'TO', '2020-01'], { quoteImpl: quote(60), dailyImpl, now: NOW });
  assert.ok(Math.abs(wk.rows[0].paid - 20 * 52 / 12) < 1e-9);
  const mo = await getWhatif(['MY', '100', 'A', 'MONTH', 'XYZ', 'SINCE', '2020-02', 'TO', '2020-03'], { quoteImpl: quote(60), dailyImpl, now: NOW });
  assert.equal(mo.rows[0].paid, 200);
  assert.ok(Math.abs(mo.rows[0].shares - (100 / 20 + 100 / 40)) < 1e-12);
  // REPLAY ends on the table's numbers.
  const last = d.replay.points[d.replay.points.length - 1];
  assert.equal(last.stock, d.total.value);
  assert.equal(last.spent, d.total.paid);
});

// ---- Split-adjusted maths, against the catalogue ----------------------------------------

// A daily source built from the catalogue's own baked closes, for AAPL.
const bakedAapl = async () => {
  const pts = Object.values(prices.monthly.AAPL).map((m) => [m.date, m.close]);
  pts.push([prices.buys.iphone6.date, prices.buys.iphone6.close]);
  return [...new Map(pts.sort((a, b) => a[0].localeCompare(b[0]))).entries()].map(([d, v]) => [d, v]);
};

test('split-adjusted: MY 649 AAPL on the iPhone 6 day equals the catalogue iPhone 6 row', async () => {
  const quoteImpl = quote(341.07);
  const cat = await getWhatif(['IPHONE6'], { quoteImpl, now: NOW });
  const mine = await getWhatif(['MY', '649', 'AAPL', '2014-09-19'], { quoteImpl, dailyImpl: bakedAapl, now: NOW });
  const [a, b] = [cat.rows[0], mine.rows[0]];
  assert.equal(b.bought, a.bought);
  assert.equal(b.close, a.close);
  assert.equal(b.shares, a.shares);
  assert.equal(b.value, a.value);
  // AAPL closed at $100.96 on 19 Sep 2014; the 4:1 split of 31 Aug 2020 makes it 25.24.
  assert.equal(b.close, 100.96 / 4);
  // Both in one run: the totals add up.
  const both = await getWhatif(['IPHONE6', 'MY', '649', 'AAPL', '2014-09-19'], { quoteImpl, dailyImpl: bakedAapl, now: NOW });
  assert.equal(both.rows.length, 2);
  assert.ok(Math.abs(both.total.value - 2 * a.value) < 1e-9);
});

test('split-adjusted: NVDA across its 10:1 split (10 Jun 2024), recomputed by hand', async () => {
  // Raw closes: 3 Jun 2024 $1,150.00 (before the split), 10 Jun 2024 $121.79 (after).
  const raw = { '2024-06-03': 1150.0, '2024-06-10': 121.79 };
  const dailyImpl = async () => weekdays('2024-05-01', '2026-09-25', (d) => (raw[d] !== undefined ? (d < '2024-06-10' ? raw[d] / 10 : raw[d]) : 130));
  const d = await getWhatif(['MY', '1000', 'NVDA', '2024-06-03'], { quoteImpl: quote(224.58), dailyImpl, now: NOW });
  const r = d.rows[0];
  // By hand: $1,000 / ($1,150 / 10) = 8.695652... shares; x $224.58 = $1,952.87.
  assert.ok(Math.abs(r.shares - 1000 / 115) < 1e-12);
  assert.equal(Math.round(r.value * 100) / 100, 1952.87);
  assert.equal(r.bought, '2024-06-03');
  // A Saturday buys at Friday's close (the last trading day before).
  const sat = await getWhatif(['MY', '1000', 'NVDA', '2024-06-08'], { quoteImpl: quote(224.58), dailyImpl, now: NOW });
  assert.equal(sat.rows[0].bought, '2024-06-07');
  assert.ok(Math.abs(sat.rows[0].shares - 1000 / 130) < 1e-12);
  // A month buys on its first trading day: June 2024 is Monday 3 June.
  const june = await getWhatif(['MY', '1000', 'NVDA', '2024-06'], { quoteImpl: quote(224.58), dailyImpl, now: NOW });
  assert.equal(june.rows[0].bought, '2024-06-03');
});

test('independent recompute: MY 1200 AAPL 2015 and $5 a day since 2018, from the closes alone', async () => {
  const closes = await bakedAapl();
  const dailyImpl = async () => closes;
  const d = await getWhatif(['MY', '1200', 'AAPL', '2015'], { quoteImpl: quote(341.07), dailyImpl, now: NOW });
  // The first AAPL close in 2015 in these closes is 2 Jan 2015.
  const first = closes.find(([day]) => day >= '2015-01-01');
  assert.equal(d.rows[0].bought, first[0]);
  assert.ok(Math.abs(d.rows[0].value - (1200 / first[1]) * 341.07) < 1e-9);

  let paid = 0;
  let shares = 0;
  for (let y = 2018; y <= 2026; y += 1) {
    for (let m = 1; m <= 12; m += 1) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (key > '2026-09') break;
      // September 2026 is still running on 27 Sep: 27 days so far.
      const spend = 5 * (key === '2026-09' ? 27 : new Date(Date.UTC(y, m, 0)).getUTCDate());
      const c = closes.find(([day]) => day.slice(0, 7) === key)?.[1] ?? 341.07;
      paid += spend;
      shares += spend / c;
    }
  }
  const h = await getWhatif(['MY', '5', 'A', 'DAY', 'AAPL', 'SINCE', '2018'], { quoteImpl: quote(341.07), dailyImpl, now: NOW });
  assert.ok(Math.abs(h.rows[0].paid - paid) < 1e-9);
  assert.ok(Math.abs(h.rows[0].value - shares * 341.07) < 1e-6);
});

test('validation: a stock or ETF with history covering the date', async () => {
  const dailyImpl = async () => weekdays('2015-06-01', '2026-09-25', () => 10);
  await assert.rejects(getWhatif(['MY', '100', 'XYZ', '2015'], { quoteImpl: quote(12), dailyImpl, now: NOW }), /history here starts on 2015-06-01/);
  await assert.rejects(getWhatif(['MY', '5', 'A', 'DAY', 'XYZ', 'SINCE', '2015-05'], { quoteImpl: quote(12), dailyImpl, now: NOW }), /starts on 2015-06-01/);
  await assert.rejects(getWhatif(['MY', '100', 'GOLD', '2020'], { quoteImpl: quote(4000, { kind: 'spot', type: 'INDEX' }), dailyImpl, now: NOW }), /not a stock or an ETF/);
  await assert.rejects(getWhatif(['MY', '100', 'VFIAX', '2020'], { quoteImpl: quote(700, { type: 'FUND' }), dailyImpl, now: NOW }), /not a stock or an ETF/);
  await assert.rejects(getWhatif(['MY', '100', 'ZZZZZ', '2020'], { quoteImpl: async () => null, dailyImpl: async () => [], now: NOW }), /No stock called ZZZZZ/);
  // A live quote that fails: the last daily close, marked stale.
  const stale = await getWhatif(['MY', '100', 'XYZ', '2020'], { quoteImpl: async () => { throw new Error('down'); }, dailyImpl, now: NOW });
  assert.equal(stale.stale, true);
  assert.equal(stale.rows[0].price, 10);
  // The daily data is loaded once per ticker, even for two items.
  let calls = 0;
  const counted = async () => { calls += 1; return weekdays('2015-06-01', '2026-09-25', () => 10); };
  await loadMine(parseMine('MY 100 XYZ 2016 MY 5 A WEEK XYZ SINCE 2017'.split(' '), NOW).mine, { quoteImpl: quote(12), dailyImpl: counted });
  assert.equal(calls, 1);
});

// ---- The gate, the screen words and the registry -------------------------------------------

test('free for everyone: no Pro gate, the FREE list says so', async () => {
  // Owner, 27 Sep 2026: your own purchase is free (it is the most shared thing on the site).
  assert.ok(FREE_ROWS.some(([n, st, c]) => n === 'WHATIF with your own purchase' && st === LIVE && c === 'WHATIF'));
  assert.equal(PRO_ROWS.find(([n]) => n === 'WHATIF with your own purchase'), undefined);
  assert.equal(screenMod.mineAllowed, undefined, 'no gate in the screen');
  const src = readFileSync('public/screens/whatif.js', 'utf8');
  assert.doesNotMatch(src, /isPro|Pro feature/);
  // The YOUR OWN line shows for a free user: one input, Enter runs it.
  assert.match(ownInputHtml(), new RegExp(`<input id="wi-own-in" class="wi-own-in" type="text" maxlength="80" placeholder="${OWN_PLACEHOLDER}"`));
  assert.doesNotMatch(ownInputHtml(), /btn-solid|type="submit"/, 'Enter runs it: no white button, no submit button');
  assert.match(ownInputHtml(), /<button type="button" class="btn wi-own-add" data-own-add title="Add it to the basket">ADD<\/button>/, 'ADD: an outline key for the basket');
  // The server never gates: a free visitor (no key) gets the result.
  const d = await getWhatif(['MY', '649', 'AAPL', '2014-09-19'], { quoteImpl: quote(341.07), dailyImpl: bakedAapl, now: NOW });
  assert.equal(d.mine, true);
  assert.match(d.source, /Daily closes from a market data provider, split-adjusted, price only/);
  // The screen plan: a result, the words sent written the canonical way.
  const cat = { products: catalog.products.map((p) => ({ ...p, kind: 'once' })), recurring: catalog.recurring.map((r) => ({ ...r, kind: 'monthly' })) };
  const plan = planWhatif(['IPHONE6', 'MY', '$1,200', 'AAPL', '2015'], cat);
  assert.equal(plan.mode, 'result');
  assert.deepEqual(plan.words, ['IPHONE6', 'MY', '1200', 'AAPL', '2015']);
  assert.equal(planWhatif(['MY', '0', 'AAPL', '2015'], cat).mode, 'error');
  assert.equal(planWhatif(['EDIT', 'MY', '1200', 'AAPL', '2015'], cat).mode, 'picker');
  assert.equal(commandFor(new Map([['iphone6', '']]), cat, plan.mine), 'WHATIF IPHONE6 MY 1200 AAPL 2015');
  // HELP examples and the usage line come from the registry.
  const reg = findCommand('WHATIF');
  for (const e of MINE_EXAMPLES) assert.ok(reg.examples.includes(e), e);
  assert.match(reg.syntax, /MY <amount> <ticker> <date>/);
});

// ---- Share link and share image -----------------------------------------------------------

test('share link round trip: the same command, the same result', async () => {
  const deps = { quoteImpl: quote(341.07), dailyImpl: bakedAapl, now: NOW };
  const typed = 'WHATIF my 5 a day aapl since 2018 iphone6 MY 1200 AAPL 2015-03';
  const norm = normalizeWhatif(typed, catalog);
  assert.equal(norm.command, 'WHATIF IPHONE6 MY 5 A DAY AAPL SINCE 2018 MY 1200 AAPL 2015-03', 'catalogue first, then your own in order');
  const d = await getWhatif(norm.tokens, deps);
  const m = certModel(d, catalog, norm.command);
  const links = shareLinks(m, 'https://bloombroke.com');
  const back = new URL(links.url).searchParams.get('c');
  assert.equal(back, norm.command);
  const again = normalizeWhatif(back, catalog);
  assert.equal(again.command, norm.command);
  const d2 = await getWhatif(again.tokens, deps);
  assert.equal(d2.total.value, d.total.value);
  assert.equal(whatifCommand(resolveTokens(again.tokens, catalog, NOW).picks), norm.command);
  // The certificate words are all generated.
  assert.equal(m.doodle, 'box', 'the biggest spend ($5 a day) picks the doodle');
  const solo = certModel(await getWhatif(['MY', '1200', 'AAPL', '2015'], deps), catalog, 'WHATIF MY 1200 AAPL 2015');
  assert.equal(solo.ribbon, '$1,200 in AAPL');
  assert.equal(solo.doodle, 'box');
  assert.equal(solo.share, 'My $1,200 in AAPL would be ' + solo.big + ' in AAPL Inc. stock today.');
  assert.equal(normalizeWhatif('WHATIF MY 0 AAPL 2015', catalog), null, 'a bad MY item makes no card');
});

test('/og/whatif.png renders for your own purchase', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-og-mine-'));
  try {
    const deps = { catalog, getWhatif: (t) => getWhatif(t, { quoteImpl: quote(341.07), dailyImpl: bakedAapl, now: NOW }), cacheDir: dir };
    const m = await getCert('WHATIF MY 5 A DAY AAPL SINCE 2018', deps);
    assert.match(m.ribbon, /of \$5 a day in AAPL$/);
    const png = await whatifPng('WHATIF MY 5 A DAY AAPL SINCE 2018', deps, { ip: '203.0.113.9' });
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.ok(png.length > 20000);
    // Nothing of your own goes to disk: the cards live in a bounded memory LRU.
    assert.deepEqual(readdirSync(dir), []);
    assert.ok(minePngs.size >= 1 && minePngs.size <= MINE_MEMORY.pngs);
    assert.ok(mineModels.size >= 1 && mineModels.size <= MINE_MEMORY.models);
    // Over the per-address limit, a new card of your own is the site card instead.
    const refuse = () => false;
    const other = await whatifPng('WHATIF MY 7 A DAY AAPL SINCE 2019', deps, { ip: '203.0.113.9', allow: refuse });
    assert.notDeepEqual(other, png);
    // An already rendered card is served from memory, limit or not.
    assert.equal(await whatifPng('WHATIF MY 5 A DAY AAPL SINCE 2018', deps, { ip: '203.0.113.9', allow: refuse }), png);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('limits: renders per address, and the daily closes cache bounded by bytes', async () => {
  let t = 0;
  const allow = makeRateLimit({ renders: 2, windowMs: 1000, addresses: 2 }, () => t);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false, 'the third in the window');
  assert.equal(allow('b'), true, 'another address');
  t = 1500;
  assert.equal(allow('a'), true, 'a new window');

  // Each ticker's closes cost 12 bytes a day; the cache drops the oldest over its budget.
  const bars = (n) => ({ barData: { priceBars: Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2020, 0, 6) + i * 86_400_000);
    const s = d.toISOString().slice(0, 10).replace(/-/g, '');
    return { tradeTimeinMills: d.getTime(), tradeTime: `${s}000000`, close: 10 + i, open: 10 + i, high: 10 + i, low: 10 + i, volume: i === 0 ? 0 : 100 };
  }) } });
  const fetchImpl = async () => ({ ok: true, headers: new Map(), text: async () => JSON.stringify(bars(50)), json: async () => bars(50), body: null });
  const cache = createCache({ lru: true, weigh: compactBytes, maxWeight: 1000 });
  const daily = makeDaily({ fetchImpl, cache, now: () => NOW });
  const a = await daily('AAA');
  assert.ok(a.days instanceof Int32Array);
  assert.ok(a.days.length > 20 && a.days.length < 50, 'weekend placeholders and the leading no-trade bar dropped');
  assert.ok(compactBytes(a) < 1000);
  await daily('BBB');
  await daily('CCC');
  // 3 x ~430 bytes > 1000: only the newest stay.
  let calls = 0;
  const counting = makeDaily({ fetchImpl: async (...x) => { calls += 1; return fetchImpl(...x); }, cache, now: () => NOW });
  await counting('CCC');
  assert.equal(calls, 0, 'the newest is still cached');
  await counting('AAA');
  assert.equal(calls, 1, 'the oldest was dropped');
});
