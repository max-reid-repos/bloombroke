// ALERTS: the parser, the crossing logic, the 20-alert limit, the WEIRD gauge numbers,
// the router and the screen's escaping. No network, no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseAlertArgs, parseLevel, resolveAlertSymbol, conditionMet, evaluate, rearm, addAlert, removeAlert,
  markSeen, unseenCount, cleanAlerts, quotesUrl, needsWeird, valuesFrom, firedText, fmtValue, distance,
  leaseFree, ALERT_GAUGES, MAX_ALERTS, LEASE_MS, HONEST_LINE, loadAlerts, saveAlerts, ALERTS_KEY, tickPlan, CHECK_MS,
} from '../public/alerts.js';
import { alertsTable, firedAt } from '../public/screens/alerts.js';
import { parseCommand, urlFor, suggest, COMMANDS, SOON } from '../public/app.js';
import { REGISTRY, findCommand } from '../public/registry.js';
import { WEIRD_GAUGES } from '../public/screens/weird-gauges.js';
import { GAUGES, summarize } from '../data/weird/index.js';
import * as canal from '../data/weird/canal.js';
import * as waffle from '../data/weird/waffle.js';
import * as panic from '../data/weird/panic.js';
import * as hiring from '../data/weird/hiring.js';
import * as hotdog from '../data/weird/hotdog.js';
import * as undies from '../data/weird/undies.js';
import * as odds from '../data/weird/odds.js';
import * as boxrate from '../data/weird/boxrate.js';
import * as eggs from '../data/weird/eggs.js';
import * as rides from '../data/weird/rides.js';
import * as trucks from '../data/weird/trucks.js';
import * as boxes from '../data/weird/boxes.js';
import * as lipstick from '../data/weird/lipstick.js';
import * as sick from '../data/weird/sick.js';
import * as macau from '../data/weird/macau.js';
import * as degen from '../data/weird/degen.js';
import { toMonths } from '../data/weird/fred.js';
import { headlineNumber, signedPct } from '../data/weird/source.js';
import { parseFredCsv } from '../data/economy.js';

const fx = (f) => readFileSync(new URL(`./fixtures/weird/${f}`, import.meta.url), 'utf8');
const fxj = (f) => JSON.parse(fx(f));
const fred = (f) => toMonths(parseFredCsv(fx(f)));
const NOW = Date.parse('2026-09-26T04:30:00Z');
const words = (s) => s.toUpperCase().split(/\s+/).filter(Boolean);
const parsed = (s) => parseAlertArgs(words(s));

test('parser: every symbol kind, gauges, and the level forms', () => {
  assert.deepEqual(parsed(''), { action: 'show' });
  assert.deepEqual(parsed('CLEAR'), { action: 'clear' });
  const cases = [
    ['AAPL > 350', 'quote', 'AAPL', '>', 350],
    ['aapl<300', 'quote', 'AAPL', '<', 300],
    ['SPX > 7800', 'quote', 'SPX', '>', 7800],
    ['S&P 500 > 7,800', 'quote', 'SPX', '>', 7800],
    ['US10Y > 5.2', 'quote', 'US10Y', '>', 5.2],
    ['EURUSD < 1.10', 'quote', 'EURUSD', '<', 1.1],
    ['BTC > 100,000', 'quote', 'BTC', '>', 100000],
    ['GOLD ABOVE 4000', 'quote', 'GOLD', '>', 4000],
    ['APPLE > 350', 'quote', 'AAPL', '>', 350],
    ['BRK.B > 500', 'quote', 'BRK.B', '>', 500],
    ['TSLA >= 400', 'quote', 'TSLA', '>=', 400],
    ['CANAL < 5', 'gauge', 'CANAL', '<', 5],
    ['HORMUZ < 5', 'gauge', 'CANAL', '<', 5],
    ['SHIPS < 5', 'gauge', 'CANAL', '<', 5],
    ['PANIC < -20', 'gauge', 'PANIC', '<', -20],
    ['EGGPRICE > $3.50', 'gauge', 'EGGPRICE', '>', 3.5],
    ['CHANCES > 25%', 'gauge', 'CHANCES', '>', 25],
  ];
  for (const [text, kind, sym, op, level] of cases) {
    const p = parsed(text);
    assert.equal(p.action, 'add', text);
    assert.equal(p.error, undefined, text);
    assert.deepEqual([p.alert.kind, p.alert.sym, p.alert.op, p.alert.level], [kind, sym, op, level], text);
  }
  assert.equal(parsed('CANAL < 5').alert.gauge, 'canal');
  assert.equal(parsed('EURUSD < 1.10').alert.typedDp, 2);
});

test('parser: bad forms say what is wrong', () => {
  for (const t of ['AAPL', 'AAPL 350', '> 350', 'AAPL > ', 'AAPL > 350 NOW', 'AAPL = 350', '350 < AAPL']) {
    assert.ok(parsed(t).error, t);
  }
  assert.equal(parsed('AAPL').error, 'usage');
  assert.equal(parsed('CLEAR ALL').error, 'usage');
  assert.deepEqual(parsed('AAPL > ABC'), { action: 'add', error: 'level', bad: 'ABC' });
  assert.deepEqual(parsed('AAPL > 1.2.3'), { action: 'add', error: 'level', bad: '1.2.3' });
  assert.deepEqual(parsed('NOT A THING > 3'), { action: 'add', error: 'symbol', bad: 'NOT A THING' });
  // Gauges without one clear number: a plain error.
  for (const g of ['PIZZA', 'OMENS', 'MOON', 'BIGMAC', 'WSB', 'WEIRD', 'MACAU', 'DEGEN']) {
    const p = parsed(`${g} > 3`);
    assert.equal(p.error, 'gauge', g);
  }
  assert.equal(parseLevel('1,234.5'), 1234.5);
  assert.equal(parseLevel('−20'), -20);
  assert.ok(Number.isNaN(parseLevel('12,34')));
  assert.ok(Number.isNaN(parseLevel('')));
  assert.equal(resolveAlertSymbol([]).error, 'usage');
});

const base = (over = {}) => ({ id: 'a1', sym: 'AAPL', kind: 'quote', unit: '', name: 'Apple', op: '>', level: 350, dp: 2, vdp: 2, created: 1, state: 'waiting', seen: true, rearmed: false, ...over });

test('crossing: fires once, then stays TRIGGERED; missing values change nothing', () => {
  let list = [base()];
  let r = evaluate(list, { AAPL: 341.07 }, 10);
  assert.equal(r.fired.length, 0);
  assert.equal(r.list[0].last, 341.07);
  r = evaluate(r.list, {}, 20);
  assert.equal(r.list[0].last, 341.07, 'no value: kept');
  r = evaluate(r.list, { AAPL: 350.42 }, 30);
  assert.equal(r.fired.length, 1);
  assert.equal(r.list[0].state, 'triggered');
  assert.equal(r.list[0].firedAt, 30);
  assert.equal(r.list[0].firedValue, 350.42);
  assert.equal(r.list[0].seen, false);
  assert.equal(firedText(r.list[0]), 'AAPL crossed 350.00 · now 350.42');
  list = r.list;
  for (const v of [351, 349, 360]) {
    r = evaluate(list, { AAPL: v }, 40);
    assert.equal(r.fired.length, 0, `no second fire at ${v}`);
    list = r.list;
  }
  assert.equal(list[0].firedValue, 350.42);
  // The level itself does not cross >: strictly above.
  assert.equal(evaluate([base()], { AAPL: 350 }, 1).fired.length, 0);
  assert.equal(evaluate([base({ op: '>=' })], { AAPL: 350 }, 1).fired.length, 1);
  assert.equal(conditionMet('<', NaN, 3), false);
});

test('crossing: a price that jumps past the level between checks still fires; so does one already past', () => {
  const below = evaluate([base({ op: '<', level: 300 })], { AAPL: 341 }, 1);
  assert.equal(below.fired.length, 0);
  const gap = evaluate(below.list, { AAPL: 250 }, 2);
  assert.equal(gap.fired.length, 1, 'a gap down through 300 fires');
  // Created with the condition already true: the first check fires it.
  assert.equal(evaluate([base({ level: 100 })], { AAPL: 341 }, 1).fired.length, 1);
  // Gauges read their own key.
  const g = evaluate([base({ sym: 'CANAL', kind: 'gauge', gauge: 'canal', op: '<', level: 5 })], { CANAL: 1, 'gauge:canal': 3 }, 1);
  assert.equal(g.fired.length, 1);
  assert.equal(g.list[0].last, 3);
});

test('re-arm: back to WAITING; a condition still true waits for a fresh crossing', () => {
  let list = evaluate([base()], { AAPL: 355 }, 1).list;
  assert.equal(list[0].state, 'triggered');
  list = rearm(list, 'a1');
  assert.equal(list[0].state, 'waiting');
  assert.equal(list[0].rearmed, true);
  assert.equal(list[0].firedAt, undefined);
  let r = evaluate(list, { AAPL: 356 }, 2);
  assert.equal(r.fired.length, 0, 'still above: no fire straight after re-arm');
  r = evaluate(r.list, { AAPL: 349 }, 3);
  assert.equal(r.fired.length, 0);
  assert.equal(r.list[0].rearmed, false, 'back below: armed for real');
  r = evaluate(r.list, { AAPL: 351 }, 4);
  assert.equal(r.fired.length, 1, 'a fresh crossing fires');
  // Re-armed when the value is already on the other side: fires on the next crossing.
  const moved = rearm([{ ...r.list[0], last: 340 }], 'a1');
  assert.equal(moved[0].rearmed, false);
  assert.equal(evaluate(moved, { AAPL: 352 }, 5).fired.length, 1);
  // Other alerts are left alone.
  const two = rearm([base({ id: 'x', state: 'triggered' }), base({ id: 'y', state: 'triggered' })], 'x');
  assert.deepEqual(two.map((a) => a.state), ['waiting', 'triggered']);
});

test('limit: 20 alerts at most, no duplicates; remove and seen', () => {
  let list = [];
  for (let i = 0; i < MAX_ALERTS; i += 1) {
    const r = addAlert(list, parsed(`AAPL > ${300 + i}`).alert, { dp: 2, last: 341 }, 1000 + i, `id${i}`);
    assert.equal(r.error, undefined);
    list = r.list;
  }
  assert.equal(list.length, 20);
  const full = addAlert(list, parsed('MSFT > 500').alert, {}, 2000, 'idx');
  assert.equal(full.error, 'full');
  assert.equal(full.list.length, 20);
  assert.equal(addAlert(list.slice(0, 5), parsed('AAPL > 300').alert, {}, 1, 'dup').error, 'duplicate');
  // Storage never holds more than 20, whatever was written there.
  assert.equal(cleanAlerts([...list, ...list.map((a) => ({ ...a, id: `${a.id}b` }))]).length, 20);
  list = removeAlert(list, 'id0');
  assert.equal(list.length, 19);
  assert.equal(addAlert(list, parsed('MSFT > 500').alert, {}, 3, 'ok').list.length, 20);
  const fired = list.map((a, i) => (i < 2 ? { ...a, state: 'triggered', seen: false } : a));
  assert.equal(unseenCount(fired), 2);
  assert.equal(unseenCount(markSeen(fired)), 0);
  assert.equal(markSeen(list), list, 'nothing to mark: the same list');
});

test('add: decimals from the quote, units from the gauge list', () => {
  const y = addAlert([], parsed('US10Y > 5.2').alert, { dp: 3, unit: '%', last: 5.165, name: 'US 10Y yield' }, 5, 'y1').alert;
  assert.equal(fmtValue(y.level, y.unit, y.dp), '5.200%');
  assert.equal(distance(y), '+3.5bp', 'a yield: the gap in basis points');
  assert.equal(distance({ ...y, op: '<', level: 5.1 }), '−6.5bp');
  const g = addAlert([], parsed('CANAL < 5').alert, {}, 5, 'g1').alert;
  assert.deepEqual([g.unit, g.dp, g.gauge, g.name], ['ships/day', 0, 'canal', ALERT_GAUGES.CANAL.name]);
  assert.equal(firedText({ ...g, firedValue: 3 }), 'CANAL crossed 5 ships/day · now 3 ships/day');
  const p = addAlert([], parsed('PANIC > 10').alert, {}, 5, 'p1').alert;
  assert.equal(distance({ ...p, last: -11 }), '+21.0 pts');
  const e = addAlert([], parsed('EGGPRICE > 3').alert, {}, 5, 'e1').alert;
  assert.equal(fmtValue(2.27, e.unit, e.dp), '$2.27');
  assert.equal(distance({ ...e, last: 0 }), '--');
});

test('storage: junk is dropped; the batch URL and the values', () => {
  const good = base();
  const junk = [null, 3, { ...good, id: 'BAD ID' }, { ...good, id: 'b', sym: '<img>' }, { ...good, id: 'c', op: '!=' },
    { ...good, id: 'd', level: 'x' }, { ...good, id: 'e', kind: 'gauge', sym: 'PIZZA', gauge: 'pizza' }, { ...good, id: 'f', state: 'odd' }];
  assert.deepEqual(cleanAlerts([good, ...junk]).map((a) => a.id), ['a1']);
  assert.deepEqual(cleanAlerts('nope'), []);
  const mem = new Map();
  const store = { get: (k, f) => (mem.has(k) ? JSON.parse(mem.get(k)) : f), set: (k, v) => mem.set(k, JSON.stringify(v)) };
  saveAlerts(store, [good, ...junk]);
  assert.deepEqual(loadAlerts(store).map((a) => a.id), ['a1']);
  assert.ok(mem.has(ALERTS_KEY));

  const list = [base(), base({ id: 'b', level: 400 }), base({ id: 'c', sym: 'US10Y' }), base({ id: 'd', sym: 'CANAL', kind: 'gauge', gauge: 'canal' })];
  assert.equal(quotesUrl(list), '/api/quotes?s=AAPL,US10Y', 'one batch, each symbol once');
  assert.equal(quotesUrl([list[3]]), null);
  assert.equal(needsWeird(list), true);
  assert.equal(needsWeird(list.slice(0, 3)), false, '/api/weird only with a gauge alert');
  assert.deepEqual(valuesFrom({ quotes: [{ ticker: 'AAPL', last: 341 }, { ticker: 'X', last: null }] }, { gauges: [{ id: 'canal', ok: true, value: 3 }, { id: 'pizza', ok: false }] }),
    { AAPL: { value: 341, stale: false }, 'gauge:canal': { value: 3, stale: false } });
  assert.deepEqual(valuesFrom({ quotes: [{ ticker: 'AAPL', last: 400, stale: true }] }, { gauges: [{ id: 'canal', ok: true, value: 1, stale: true }] }),
    { AAPL: { value: 400, stale: true }, 'gauge:canal': { value: 1, stale: true } });
});

test('stale values are shown, never fired on', () => {
  const quotes = { quotes: [{ ticker: 'AAPL', last: 400, stale: true }] };
  let r = evaluate([base()], valuesFrom(quotes, null), 10);
  assert.equal(r.fired.length, 0, 'AAPL 400 > 350, but the value is stale');
  assert.equal(r.list[0].state, 'waiting');
  assert.deepEqual([r.list[0].last, r.list[0].stale], [400, true]);
  const html = alertsTable(r.list);
  assert.match(html, /class="num last is-stale"/);
  assert.match(html, /<span class="al-stale">stale<\/span>/);
  r = evaluate(r.list, valuesFrom({ quotes: [{ ticker: 'AAPL', last: 401, stale: false }] }, null), 20);
  assert.equal(r.fired.length, 1, 'fresh again: it fires');
  assert.equal(r.list[0].stale, false);
  const g = evaluate([base({ sym: 'CANAL', kind: 'gauge', gauge: 'canal', op: '<', level: 5 })], valuesFrom(null, { gauges: [{ id: 'canal', ok: true, value: 3, stale: true }] }), 1);
  assert.equal(g.fired.length, 0, 'a stale gauge never fires');
});

test('storage: corrupt numbers are dropped, so the table still renders', () => {
  const [a] = cleanAlerts([base({ state: 'triggered', lastAt: 1e20, firedAt: Infinity, last: 'x', firedValue: 1e300, created: -5 })]);
  assert.equal(a.lastAt, undefined);
  assert.equal(a.last, undefined);
  assert.equal(a.firedValue, undefined);
  assert.equal(a.created, undefined);
  assert.equal(a.firedAt, 0, 'a triggered alert keeps a valid time');
  const html = alertsTable([a]);
  assert.match(html, /TRIGGERED/);
  assert.doesNotMatch(html, /Invalid Date|NaN/);
  assert.equal(cleanAlerts([base({ lastAt: 1e20 })])[0].lastAt, undefined);
});

test('watcher: the leader keeps checking while hidden, once a minute; one tab only', () => {
  const now = 1_000_000;
  const hasAlerts = true;
  // The plan has no hidden input: a hidden leader keeps its lease and checks each minute.
  assert.deepEqual(tickPlan({ hasAlerts, lease: { tab: 't1', at: now - 60_000 }, tab: 't1', now, lastChecked: now - CHECK_MS }), { take: true, check: true });
  assert.deepEqual(tickPlan({ hasAlerts, lease: { tab: 't1', at: now - 5_000 }, tab: 't1', now, lastChecked: now - 30_000 }), { take: true, check: false }, 'not twice a minute');
  // Another tab while the leader holds the lease: nothing, hidden or not.
  assert.deepEqual(tickPlan({ hasAlerts, lease: { tab: 't1', at: now - 60_000 }, tab: 't2', now, lastChecked: 0 }), { take: false, check: false });
  // The leader closed or froze: after LEASE_MS another tab takes over.
  assert.deepEqual(tickPlan({ hasAlerts, lease: { tab: 't1', at: now - LEASE_MS - 1 }, tab: 't2', now, lastChecked: now - CHECK_MS }), { take: true, check: true });
  assert.deepEqual(tickPlan({ hasAlerts: false, lease: null, tab: 't1', now, lastChecked: 0 }), { take: false, check: false });
  assert.ok(LEASE_MS > CHECK_MS, 'a hidden leader, throttled to a tick a minute, keeps its lease');
  // The browser code: hidden tabs do not drop the lease; coming back runs the same tick.
  const src = readFileSync('public/alerts.js', 'utf8');
  const watcher = src.slice(src.indexOf('export function startAlerts'));
  assert.doesNotMatch(watcher, /if \(document\.hidden\) \{ dropLease/);
  assert.match(watcher, /visibilitychange', \(\) => \{ if \(!document\.hidden\) tick\(\); \}/);
  // A hidden tab never marks alerts seen.
  assert.match(readFileSync('public/screens/alerts.js', 'utf8'), /if \(!document\.hidden\) seen\(\);/);
});

test('gauge values round like their headlines, at a negative half too', () => {
  assert.equal(headlineNumber(-2.25, 1), -2.3);
  assert.equal(headlineNumber(-0.5, 0), -1);
  assert.equal(headlineNumber(-0.04, 1), 0);
  assert.equal(headlineNumber(2.25, 1), 2.3);
  assert.equal(headlineNumber(NaN, 1), null);
  for (let i = -3000; i <= 3000; i += 1) {
    const v = i / 1000 + 0.0005 * Math.sign(i);
    for (const d of [0, 1]) {
      const shown = Number(signedPct(v, d).replace('%', '').replace('−', '-'));
      assert.ok(headlineNumber(v, d) === shown, `${v} (${d}): ${headlineNumber(v, d)} vs ${signedPct(v, d)}`);
    }
  }
  // Through a real gauge: lipstick at exactly -2.25% a year.
  const rows = Array.from({ length: 13 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, '0')}`.replace('2025-13', '2026-01'), value: 100 }));
  rows[12] = { month: '2026-01', value: 97.75 };
  const g = lipstick.build(rows);
  assert.equal(g.headline, `${signedPct(g.yoy, 1)} YOY`);
  assert.ok(g.value === Number(signedPct(g.yoy, 1).replace('%', '').replace('−', '-')), `${g.value} vs ${g.headline}`);
});

test('tab lease: one tab checks; a stale lease is free', () => {
  assert.equal(leaseFree(null, 't1', 100), true);
  assert.equal(leaseFree({ tab: 't1', at: 100 }, 't1', 101), true);
  assert.equal(leaseFree({ tab: 't2', at: 100 }, 't1', 101), false);
  assert.equal(leaseFree({ tab: 't2', at: 100 }, 't1', 100 + LEASE_MS), false);
  assert.equal(leaseFree({ tab: 't2', at: 100 }, 't1', 100 + LEASE_MS + 1), true);
});

test('gauges: a numeric value and unit where the headline is one clear number', () => {
  const rec = odds.pickRecession(fxj('polymarket-recession.json'), NOW);
  const dl = rides.parsePark(fxj('queue-times-16.json'));
  const mk = rides.parsePark(fxj('queue-times-6.json'));
  const pk = panic.parse(fxj('wiki-recession.json'));
  const built = {
    canal: canal.build(canal.parseDaily(fxj('canal-daily.json')), canal.parseAverages(fxj('canal-avg.json')), canal.latestDate(fxj('canal-top.json'))),
    waffle: waffle.build([], '2026-09-26T04:00:00Z'),
    panic: panic.build({ Recession: pk, Stock_market_crash: pk, Stagflation: pk, Bank_run: pk }),
    hiring: hiring.build(hiring.parse(fxj('hn-whoishiring.json')), NOW),
    hotdog: hotdog.build(parseFredCsv(fx('fred-cpiaucsl.csv'))),
    undies: undies.build(undies.parse(fxj('bls-undies.json'))),
    odds: odds.build({ recession: rec, fed: null }, NOW),
    boxrate: boxrate.build(boxrate.parse(fx('drewry-head.html'))),
    eggs: eggs.build(fred('fred-eggs.csv')),
    rides: rides.build([{ park: rides.PARKS[0], rides: mk }, { park: rides.PARKS[4], rides: dl }]),
    trucks: trucks.build({ cass: fred('fred-cass.csv'), truck: fred('fred-truck.csv'), rail: fred('fred-rail.csv') }),
    boxes: boxes.build({ output: fred('fred-box-output.csv'), price: fred('fred-box-price.csv') }),
    lipstick: lipstick.build(fred('fred-cosmetics.csv')),
    sick: sick.build(sick.parse(fxj('cdc-wval.json'))),
  };
  const byId = Object.fromEntries(Object.values(ALERT_GAUGES).map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(built).sort(), Object.keys(byId).sort(), 'every alert gauge is built here');
  for (const [id, g] of Object.entries(built)) {
    assert.ok(Number.isFinite(g.value), `${id} value`);
    assert.equal(g.unit, byId[id].unit, `${id} unit`);
    // The number is the headline's own number (same rounding).
    const shown = String(g.headline).replace(/−/g, '-').replace(/,/g, '');
    const num = Number((/-?\d+(\.\d+)?/.exec(shown) || [])[0]);
    assert.ok(g.value === num, `${id}: ${g.headline} -> ${g.value}`); // -0 and 0 are the same number here
    // The summary the watcher reads carries it.
    const s = summarize({ id, ok: true, stale: false, updated: 'x', ...g });
    assert.deepEqual([s.value, s.unit], [g.value, g.unit], `${id} summary`);
  }
  assert.equal(built.canal.value, 3);
  assert.equal(built.hotdog.value, 4.66);
  assert.equal(built.odds.value, 10);
  assert.equal(built.boxrate.value, 4468);
  // Where there is no clear number: no value, and the summary has none either.
  const fedOnly = odds.build({ recession: null, fed: odds.pickFed(fxj('polymarket-fed.json'), NOW) }, NOW);
  assert.equal(fedOnly.value, undefined);
  const shut = rides.build([{ park: rides.PARKS[0], rides: mk }]);
  assert.equal(shut.value, null);
  assert.equal(summarize({ id: 'rides', ok: true, ...shut }).value, undefined);
  const mac = macau.build([macau.parse(fx('dicj-2026.xml')), macau.parse(fx('dicj-2025.xml'))]);
  assert.equal(mac.unit, undefined, 'MACAU value is revenue, not the headline: not an alert gauge');
  assert.equal(summarize({ id: 'macau', ok: true, ...mac }).value, undefined);
  assert.equal(degen.build(degen.parse(fxj('degen.json'))).value, undefined);
});

test('gauges: the alert list matches the WEIRD commands and the server modules', () => {
  const cmdOf = Object.fromEntries(WEIRD_GAUGES.map((g) => [g.id, g.command]));
  const ids = new Set(GAUGES.map((g) => g.id));
  for (const [cmd, spec] of Object.entries(ALERT_GAUGES)) {
    assert.equal(cmdOf[spec.id], cmd, cmd);
    assert.ok(ids.has(spec.id), spec.id);
    assert.equal(findCommand(cmd).category, 'Weird data');
  }
});

test('router: ALERTS parses, a link only ever opens the list, bad words show the usage line', () => {
  const c = parseCommand('ALERTS AAPL > 350');
  assert.equal(c.name, 'ALERTS');
  assert.equal(c.args.alert.sym, 'AAPL');
  assert.equal(parseCommand('alert aapl < 300').name, 'ALERTS');
  assert.equal(parseCommand('ALERTS').args.action, 'show');
  assert.equal(urlFor('ALERTS AAPL > 350').url, 'ALERTS', 'a shared link never adds an alert');
  assert.equal(urlFor('ALERTS CLEAR').url, 'ALERTS', 'nor clears them');
  assert.equal(urlFor('ALERTS').url, 'ALERTS');
  assert.ok(COMMANDS.some((x) => x.name === 'ALERTS' && x.group === 'Your stuff'));
  assert.ok(!SOON.some((x) => x.name === 'ALERTS'));
  assert.equal(suggest('ALERTS AAPL ')[0].usage, true);
  assert.equal(suggest('ALERTS AAPL > 350').length, 0);
  // AAPL ALERTS is not a ticker function.
  assert.notEqual(parseCommand('AAPL ALERTS').name, 'ALERTS');
});

test('ALERTS names are not tickers; the pro terminal code is not used (SEC lists checked Sep 26 2026)', () => {
  // Checked against SEC company_tickers.json, company_tickers_mf.json and
  // company_tickers_exchange.json: ALERT and ALERTS are not tickers. ALRT is never used.
  const CHECKED = ['ALERTS', 'ALERT'];
  const entry = REGISTRY.find((x) => x.name === 'ALERTS');
  const names = [entry.name, ...(entry.aliases || [])];
  assert.deepEqual(names.sort(), CHECKED.sort());
  const all = REGISTRY.flatMap((x) => [x.name, ...(x.aliases || [])]);
  assert.ok(!all.includes('ALRT'));
  assert.equal(parseCommand('ALRT').name, 'QUOTE', 'ALRT is only ever a ticker-shaped word');
});

test('screen: the table escapes, shows the state, and the honest line', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = alertsTable([
    base({ name: evil, last: 341.07 }),
    base({ id: 'b', state: 'triggered', firedAt: Date.parse('2026-09-26T14:32:00'), firedValue: 350.42, last: 350.42 }),
  ], Date.parse('2026-09-26T15:00:00'));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /WAITING/);
  assert.match(html, /TRIGGERED 14:32/);
  assert.match(html, /data-act="rearm"/);
  assert.equal((html.match(/data-act="remove"/g) || []).length, 2);
  assert.match(html, />\+2\.62%</);
  assert.equal(firedAt(Date.parse('2026-09-25T09:05:00'), Date.parse('2026-09-26T10:00:00')), 'SEP 25 09:05');
  assert.equal(HONEST_LINE, 'Alerts check while Bloombroke is open in a tab.');
  const src = readFileSync('public/screens/alerts.js', 'utf8') + readFileSync('public/alerts.js', 'utf8');
  assert.doesNotMatch(src, new RegExp(['bloom', 'berg'].join(''), 'i'), 'no other terminal names');
  assert.doesNotMatch(src, /ALRT/);
  assert.ok(!src.includes(String.fromCharCode(0x2014)), 'no em dashes');
});
