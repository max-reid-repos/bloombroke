import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseCommand, suggest, COMMANDS } from '../public/app.js';
import { EXTRA, matchExtra } from '../public/commands.js';
import { findCommand } from '../public/registry.js';
import { squarify, heatFill, labelSize, weightedPct, heatmapSvg } from '../public/screens/heatmap.js';
import { monthlyPayment, amortize, parse as parseLoan, parseMoney } from '../public/screens/loan.js';
import { growth, parse as parseCompound } from '../public/screens/compound.js';
import { cellChange, matrixTable } from '../public/screens/fxmatrix.js';
import { crossRates } from '../data/fxmatrix.js';
import { EXCHANGES, sessionState, holidayFromQuote, fmtDuration, statusOf } from '../public/screens/clock.js';
import { parse as parseCompare } from '../public/screens/compare.js';
import { parse as parseHistory, toCsv } from '../public/screens/history.js';
import { parse as parseEarnings, resolveDay } from '../public/screens/earnings.js';
import { parse as parseCalendar, filterEvents } from '../public/screens/calendar.js';
import { parse as parseNewsTicker } from '../public/screens/tickernews.js';
import { spreadLabels, nearestIndex, linesSvg } from '../public/screens/lines.js';
import { fmtCompact } from '../public/screens/movers.js';
import { fmtPrice } from '../public/screens/crypto.js';
import { curveSeries } from '../public/screens/curve.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// ---- router ------------------------------------------------------------------

test('router: every extra command parses, keeps its own URL, and beats a same-named ticker', () => {
  assert.equal(parseCommand('world').name, 'WORLD');
  assert.equal(parseCommand('CLOCK').name, 'CLOCK', 'CLOCK is ticker shaped but is a command');
  assert.equal(parseCommand('loan 400000 30y').input, 'LOAN 400000 30Y');
  assert.equal(parseCommand('NEWS').name, 'NEWS', 'plain NEWS is still the market screen');
  assert.deepEqual(parseCommand('news aapl').args, { ticker: 'AAPL' });
  assert.equal(parseCommand('news aapl').name, 'TICKERNEWS');
  assert.equal(parseCommand('news aapl msft').error, 'usage');
  assert.equal(parseCommand('compare aapl').error, 'usage');
  assert.equal(parseCommand('AAPL').name, 'QUOTE');
  assert.equal(matchExtra('NOPE', []), null);
  for (const c of EXTRA) {
    const h = findCommand(c.name);
    assert.ok(h && COMMANDS.some((x) => x.name === c.name && x.hint === h.summary), `${c.name} is in HELP`);
    const ex = h.examples[0];
    const parsed = parseCommand(ex);
    assert.equal(parsed.error, undefined, `${ex} parses`);
    if (c.name !== 'NEWS') assert.equal(parsed.name, c.id || c.name);
    for (const e of h.examples) assert.equal(parseCommand(e).error, undefined, `${e} parses`);
  }
  assert.equal(suggest('COMPARE AAPL ')[0].usage, true);
  assert.equal(suggest('LOAN')[0].value, 'LOAN ');
});

test('copy rules: no banned brand word, no em dashes, no amber in the new files', () => {
  const files = [
    ...readdirSync('public/screens').map((f) => `public/screens/${f}`),
    'public/commands.js', 'public/commands.css', 'command-routes.js',
    ...readdirSync('data').filter((f) => f.endsWith('.js')).map((f) => `data/${f}`),
  ];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
  }
  for (const f of ['public/commands.css', 'public/commands.js', 'public/screens/heatmap.js', 'public/screens/lines.js']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s, /amber|#ffb|hsl\((3\d|4\d|5\d),/i, `${f}: amber`);
  }
});

// ---- heatmap -----------------------------------------------------------------

test('heatmap: squarified layout fills the box exactly, no overlaps', () => {
  const values = [500, 433, 300, 120, 60, 60, 40, 20, 10, 5, 0, -3];
  const rect = { x: 10, y: 20, w: 600, h: 400 };
  const out = squarify(values, rect);
  assert.equal(out[10], null);
  assert.equal(out[11], null);
  const boxes = out.filter(Boolean);
  const total = values.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  close(boxes.reduce((a, b) => a + b.w * b.h, 0), rect.w * rect.h, 1e-6);
  out.forEach((b, i) => {
    if (!b) return;
    close(b.w * b.h, (values[i] / total) * rect.w * rect.h, 1e-6);
    assert.ok(b.x >= rect.x - 1e-9 && b.y >= rect.y - 1e-9, 'inside');
    assert.ok(b.x + b.w <= rect.x + rect.w + 1e-6 && b.y + b.h <= rect.y + rect.h + 1e-6, 'inside');
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]; const b = boxes[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(ox <= 1e-6 || oy <= 1e-6, `boxes ${i} and ${j} overlap`);
    }
  }
  // Squarified: the biggest box is not a sliver.
  const big = out[0];
  assert.ok(Math.max(big.w / big.h, big.h / big.w) < 3);
  assert.deepEqual(squarify([], rect), []);
  assert.deepEqual(squarify([1, 2], { x: 0, y: 0, w: 0, h: 10 }), [null, null]);
  const one = squarify([7], { x: 0, y: 0, w: 100, h: 50 });
  assert.deepEqual(one, [{ x: 0, y: 0, w: 100, h: 50 }]);
});

test('heatmap: colours, labels, sector weights, links', () => {
  assert.equal(heatFill(0), heatFill(0.001));
  assert.equal(heatFill(3), heatFill(9), 'clamped at 3%');
  assert.match(heatFill(1), /^hsl\(147,/);
  assert.match(heatFill(-1), /^hsl\(0,/);
  assert.equal(labelSize(20, 10, 4), 0, 'too small: no label');
  assert.ok(labelSize(200, 100, 4) <= 24);
  assert.ok(labelSize(60, 40, 4) >= 9);
  close(weightedPct([{ changePct: 2, marketCap: 3 }, { changePct: -2, marketCap: 1 }]), 1);
  const svg = heatmapSvg([
    { ticker: 'AAPL', name: 'Apple', sector: 'TECH', changePct: 1.2, marketCap: 4e12, last: 1 },
    { ticker: 'JPM', name: 'JPMorgan <x>', sector: 'FIN', changePct: -0.5, marketCap: 8e11, last: 1 },
  ], 800, 500);
  assert.match(svg, /href="\?c=AAPL" data-cmd="AAPL"/);
  assert.match(svg, /JPMorgan &lt;x&gt;/);
  assert.doesNotMatch(svg, /style=/, 'no inline styles: the CSP blocks them');
});

// ---- money tools -------------------------------------------------------------

test('LOAN: payment formula, amortisation and parsing', () => {
  close(monthlyPayment(400000, 7, 30), 2661.21, 0.01);
  close(monthlyPayment(100000, 6, 15), 843.86, 0.01);
  close(monthlyPayment(12000, 0, 1), 1000);
  const a = amortize(400000, 7, 30);
  assert.equal(a.rows.length, 30);
  close(a.rows[29].balance, 0, 1e-6);
  close(a.rows.reduce((t, r) => t + r.principal, 0), 400000, 1e-6);
  close(a.totalInterest, a.payment * 360 - 400000, 1e-4);
  close(a.totalPaid, a.payment * 360, 1e-4);
  assert.ok(a.rows[0].interest > a.rows[0].principal, 'early years are mostly interest');
  assert.deepEqual(parseLoan(['400000', '30Y']), { amount: 400000, years: 30, rate: null });
  assert.deepEqual(parseLoan(['$400,000']), { amount: 400000, years: 30, rate: null });
  assert.deepEqual(parseLoan(['400K', '15', 'YEARS', 'AT', '6.25%']), { amount: 400000, years: 15, rate: 6.25 });
  assert.deepEqual(parseLoan(['25000', '5Y', '7.9']), { amount: 25000, years: 5, rate: 7.9 });
  assert.equal(parseLoan([]).error, 'usage');
  assert.equal(parseLoan(['ABC']).error, 'amount');
  assert.equal(parseLoan(['1000', '60Y']).error, 'years');
  assert.equal(parseLoan(['1000', '30Y', '45%']).error, 'rate');
  assert.equal(parseLoan(['1000', '30Y', '5%', 'X']).error, 'usage');
  assert.equal(parseMoney('1.2M'), 1200000);
  assert.ok(Number.isNaN(parseMoney('12X')));
});

test('COMPOUND: growth matches the closed form; parsing', () => {
  const r = 0.08 / 12;
  const n = 360;
  const g = growth({ monthly: 500, rate: 8, years: 30 });
  close(g.final, 500 * (((1 + r) ** n - 1) / r), 1e-6);
  assert.equal(g.paid, 180000);
  assert.equal(g.rows.length, 31);
  const lump = growth({ start: 10000, rate: 7, years: 20 });
  close(lump.final, 10000 * (1 + 0.07 / 12) ** 240, 1e-6);
  const zero = growth({ start: 100, monthly: 10, rate: 0, years: 2 });
  assert.equal(zero.final, 340);
  const yearly = growth({ yearly: 1000, rate: 0, years: 3 });
  assert.equal(yearly.final, 3000);
  assert.deepEqual(parseCompound(['500/MO', '8%', '30Y']), { start: 0, monthly: 500, yearly: 0, rate: 8, years: 30 });
  assert.deepEqual(parseCompound(['10000', '500', 'PER', 'MONTH', '7%', '20', 'YEARS']), { start: 10000, monthly: 500, yearly: 0, rate: 7, years: 20 });
  assert.deepEqual(parseCompound(['6000/YR', '5%', '10Y']), { start: 0, monthly: 0, yearly: 6000, rate: 5, years: 10 });
  assert.equal(parseCompound(['500/MO', '30Y']).error, 'usage', 'the rate is required, never assumed');
  assert.equal(parseCompound(['500/MO', '8%', '0Y']).error, 'years');
  assert.equal(parseCompound(['500/MO', '80%', '10Y']).error, 'rate');
  assert.equal(parseCompound(['1', '2', '8%', '10Y']).error, 'usage');
});

// ---- FX matrix -----------------------------------------------------------------

test('FX matrix: day change per cell and a linked table', () => {
  const now = crossRates({ EUR: 0.8, JPY: 160 }, ['USD', 'EUR', 'JPY']);
  const prev = crossRates({ EUR: 0.8, JPY: 150 }, ['USD', 'EUR', 'JPY']);
  close(cellChange(now, prev, 'USD', 'JPY'), (160 / 150 - 1) * 100);
  assert.equal(cellChange(now, prev, 'USD', 'EUR'), 0);
  assert.equal(cellChange(now, null, 'USD', 'EUR'), null);
  assert.equal(cellChange(now, prev, 'EUR', 'EUR'), null);
  const html = matrixTable({ codes: ['USD', 'EUR', 'JPY'], matrix: now, prev });
  assert.match(html, /data-cmd="FX 1 USD JPY"/);
  assert.match(html, /fxm-arr up/);
});

// ---- clocks --------------------------------------------------------------------

test('CLOCK: open, lunch and closed, with time to the next bell', () => {
  // Friday 25 Sep 2026 14:30 UTC = 10:30 New York, 15:30 London, 23:30 Tokyo
  const t = new Date('2026-09-25T14:30:00Z');
  const ny = sessionState(EXCHANGES.NYSE, t);
  assert.equal(ny.state, 'OPEN');
  close(ny.minsTo, 330);
  assert.equal(ny.local, '10:30:00');
  const tokyo = sessionState(EXCHANGES.TSE, t);
  assert.equal(tokyo.state, 'CLOSED');
  close(tokyo.minsTo, 3 * 1440 + 9 * 60 - (23 * 60 + 30), 1e-9); // Monday 09:00, 57.5 hours away
  // Tokyo lunch: 03:00 UTC = 12:00 JST
  const lunch = sessionState(EXCHANGES.TSE, new Date('2026-09-25T03:00:00Z'));
  assert.equal(lunch.state, 'LUNCH');
  close(lunch.minsTo, 30);
  // NYSE holiday: Thanksgiving 26 Nov 2026, 11:00 ET
  assert.equal(sessionState(EXCHANGES.NYSE, new Date('2026-11-26T16:00:00Z')).state, 'CLOSED');
  // Early close on 27 Nov 2026: 12:30 ET closes in 30 minutes
  close(sessionState(EXCHANGES.NYSE, new Date('2026-11-27T17:30:00Z')).minsTo, 30);
  assert.equal(fmtDuration(45), '45M');
  assert.equal(fmtDuration(125), '2H 05M');
  assert.equal(fmtDuration(3000), '2D 02H');
});

test('CLOCK: a holiday shows when the index has not traded today', () => {
  // Shanghai, Friday 25 Sep 2026 10:30 CST (02:30 UTC): schedule says open
  const t = new Date('2026-09-25T02:30:00Z');
  const st = sessionState(EXCHANGES.SSE, t);
  assert.equal(st.state, 'OPEN');
  assert.equal(holidayFromQuote(EXCHANGES.SSE, st, '2026-09-24'), true);
  assert.equal(holidayFromQuote(EXCHANGES.SSE, st, '2026-09-25T10:29:00.000+0800'), false);
  assert.equal(statusOf(EXCHANGES.SSE, st, '2026-09-24').text, 'HOLIDAY');
  // Right after the open, a missing print is not a holiday yet.
  const early = sessionState(EXCHANGES.SSE, new Date('2026-09-25T01:35:00Z'));
  assert.equal(holidayFromQuote(EXCHANGES.SSE, early, '2026-09-24'), false);
});

// ---- argument parsers ------------------------------------------------------------

test('COMPARE, HISTORY, EARNINGS, CALENDAR and NEWS arguments', () => {
  assert.deepEqual(parseCompare(['AAPL', 'MSFT', 'NVDA']), { tickers: ['AAPL', 'MSFT', 'NVDA'], range: '1Y' });
  assert.deepEqual(parseCompare(['KO', 'VS', 'PEP', '5Y']), { tickers: ['KO', 'PEP'], range: '5Y' });
  assert.deepEqual(parseCompare(['AAPL,MSFT']), { tickers: ['AAPL', 'MSFT'], range: '1Y' });
  assert.equal(parseCompare(['AAPL', 'AAPL']).error, 'usage');
  assert.equal(parseCompare(['A', 'B', 'C', 'D', 'E', 'F']).error, 'usage');
  assert.equal(parseCompare(['AAPL', 'MSFT', '7Y']).error, 'usage');

  assert.deepEqual(parseHistory(['AAPL']), { ticker: 'AAPL' });
  assert.deepEqual(parseHistory(['AAPL', '2024']), { ticker: 'AAPL', from: '2024-01-01', to: '2024-12-31' });
  assert.deepEqual(parseHistory(['AAPL', 'FROM', '2025-01-02', 'TO', '2025-06-30']), { ticker: 'AAPL', from: '2025-01-02', to: '2025-06-30' });
  assert.deepEqual(parseHistory(['US10Y', '2025']).ticker, 'US10Y');
  assert.equal(parseHistory(['AAPL', '2025-02-30']).error, 'usage');
  assert.equal(parseHistory(['AAPL', '2025-06-30', '2025-01-01']).error, 'usage');
  assert.equal(parseHistory([]).error, 'usage');

  assert.deepEqual(parseEarnings([]), { day: 'TODAY', week: false });
  assert.deepEqual(parseEarnings(['WEEK']), { day: 'TODAY', week: true });
  assert.deepEqual(parseEarnings(['NEXT', 'WEEK']), { day: '+7', week: true });
  assert.deepEqual(parseEarnings(['2026-10-14']), { day: '2026-10-14', week: false });
  assert.equal(parseEarnings(['SOON']).error, 'usage');
  const fri = new Date('2026-09-25T15:00:00Z');
  assert.equal(resolveDay('TODAY', fri), '2026-09-25');
  assert.equal(resolveDay('TOMORROW', fri), '2026-09-26');
  assert.equal(resolveDay('+7', fri), '2026-10-02');
  assert.equal(resolveDay('TODAY', new Date('2026-09-26T02:00:00Z')), '2026-09-25', 'New York date, not UTC');

  assert.deepEqual(parseCalendar([]), { scope: 'MAJOR' });
  assert.deepEqual(parseCalendar(['USD']), { scope: 'US' });
  assert.equal(parseCalendar(['EUR']).error, 'usage');
  const ev = [
    { country: 'USD', impact: 'Low' }, { country: 'EUR', impact: 'High' },
    { country: 'EUR', impact: 'Low' }, { country: 'JPY', impact: 'Holiday' },
  ];
  assert.equal(filterEvents(ev, 'MAJOR').length, 3);
  assert.equal(filterEvents(ev, 'US').length, 1);
  assert.equal(filterEvents(ev, 'ALL').length, 4);

  assert.equal(parseNewsTicker([]), null);
  assert.deepEqual(parseNewsTicker(['TSLA']), { ticker: 'TSLA' });
});

test('HISTORY: CSV is oldest first with a header', () => {
  const csv = toCsv('AAPL', [
    { d: '2026-09-24', o: 1, h: 2, l: 0.5, c: 1.5, v: 100, chg: 50 },
    { d: '2026-09-23', o: 1, h: 1, l: 1, c: 1, v: null, chg: null },
  ]);
  assert.equal(csv, 'Date,Open,High,Low,Close,Volume,Change %\n2026-09-23,1,1,1,1,,\n2026-09-24,1,2,0.5,1.5,100,50.0000\n');
});

// ---- charts and formats ------------------------------------------------------------

test('lines chart: labels spread apart, nearest point, no inline styles', () => {
  const ys = spreadLabels([100, 102, 104, 300], 16, 0, 400);
  assert.ok(ys[1] - ys[0] >= 16 && ys[2] - ys[1] >= 16);
  assert.equal(ys[3], 300);
  const top = spreadLabels([395, 398], 16, 0, 400);
  assert.ok(top[1] <= 400 && top[1] - top[0] >= 16);
  const pts = [{ x: 0 }, { x: 10 }, { x: 20 }];
  assert.equal(nearestIndex(pts, 4), 0);
  assert.equal(nearestIndex(pts, 6), 1);
  assert.equal(nearestIndex(pts, 99), 2);
  const svg = linesSvg([
    { id: 'a', cls: 'ln-0', points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
    { id: 'b', cls: 'ln-1', points: [{ x: 0, y: 3 }, { x: 1, y: -1 }] },
  ], { width: 400, height: 200, zero: true });
  assert.match(svg, /class="ln ln-0"/);
  assert.match(svg, /class="ln-zero"/);
  assert.doesNotMatch(svg, /style=/);
  assert.equal(linesSvg([{ id: 'a', cls: 'ln-0', points: [{ x: 0, y: 1 }] }]), '');
  const cs = curveSeries([{ id: '1M', now: 4, m1: null, y1: 3 }, { id: '3M', now: 4.1, m1: 3.9, y1: 3.1 }]);
  assert.deepEqual(cs.map((s) => s.points.length), [2, 1, 2], 'missing values are skipped, never filled in');
});

test('formats: compact numbers and coin prices', () => {
  assert.equal(fmtCompact(22_400_000), '22.4M');
  assert.equal(fmtCompact(1_676_137_068_038), '1.7T');
  assert.equal(fmtCompact(815_166_720), '815M');
  assert.equal(fmtCompact(NaN), '--');
  assert.equal(fmtPrice(83435), '83,435.00');
  assert.equal(fmtPrice(0.1234567), '0.1235');
  assert.equal(fmtPrice(0.00001234), '0.00001234');
});

test('CLOCK: the table is drawn once; each second writes only the text that changed', async () => {
  const { render, CLOCK_LIST } = await import('../public/screens/clock.js');
  let writes = 0;
  const text = (v = '') => ({ nodeValue: v });
  const cell = () => ({ firstChild: text(), className: '', textContent: '', querySelector: () => ({ firstChild: text() }), getAttribute() { return this.x; }, setAttribute(k, v) { this.x = v; writes += 1; } });
  const row = () => { const c = { last: cell(), st: cell(), next: cell(), now: cell() }; return { querySelector: (s) => ({ '.last': c.last, '.st': c.st, '.next': c.next, '.db-now': c.now })[s] }; };
  const rows = CLOCK_LIST.map(row);
  let bodySets = 0;
  const body = { set innerHTML(v) { bodySets += 1; }, querySelectorAll: () => rows };
  const side = { innerHTML: '' };
  const el = { set innerHTML(v) {}, querySelectorAll: () => [body, side] };
  let tick = null;
  render(el, {}, { every: (fn) => { tick = fn; }, status() {}, fetchJSON: () => new Promise(() => {}), signal: null });
  for (let i = 0; i < 6; i += 1) tick();
  assert.equal(bodySets, 1, 'never redrawn after the first paint');
  assert.ok(writes <= CLOCK_LIST.length, 'the now mark moves once, then only when the minute does');
});
