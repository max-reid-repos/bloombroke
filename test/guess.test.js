import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  POOL, GUESS_EPOCH, puzzleNumber, puzzleDate, cycleOrder, pickAnswer, loadSecret,
  closesBefore, yearBefore, normalise, oneYearMove, hintCells, findMember, fmtMove, fmtCap, mountGuess,
} from '../data/guess.js';
import {
  shareText, shareOnX, guessStats, readState, recordResult, msToNextPuzzle, fmtCountdown,
  matchPool, exactPick, chartSvg, rowsHtml, SQUARES, LEGEND, legendHtml, dirText, dirArrow, endLine, statsHtml,
} from '../public/screens/guess.js';
import { parseCommand } from '../public/app.js';
import { findCommand } from '../public/registry.js';
import { commandMeta, sitemapUrls } from '../lib/seo.js';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

test('GUESS pick: the pool is the S&P 100 with one Alphabet line', () => {
  assert.equal(POOL.length, 100);
  assert.ok(POOL.some((m) => m.ticker === 'GOOGL'));
  assert.ok(!POOL.some((m) => m.ticker === 'GOOG'), 'GOOG and GOOGL share a chart');
  assert.equal(new Set(POOL.map((m) => m.ticker)).size, POOL.length);
});

test('GUESS pick: puzzle numbers follow the New York date, #1 on the first day', () => {
  assert.equal(GUESS_EPOCH, '2026-09-27');
  assert.equal(puzzleNumber('2026-09-27'), 1);
  assert.equal(puzzleNumber('2026-09-28'), 2);
  assert.equal(puzzleNumber('2026-11-02'), 37, 'across the clock change');
  assert.equal(puzzleNumber('2027-09-27'), 366);
  assert.equal(puzzleNumber('2026-09-01'), 1, 'before the first puzzle');
  assert.equal(puzzleNumber('nope'), 1);
  assert.equal(puzzleDate(1), '2026-09-27');
  assert.equal(puzzleDate(37), '2026-11-02');
});

test('GUESS pick: stable per date and secret, no repeats inside a cycle', () => {
  assert.equal(pickAnswer(5, SECRET).ticker, pickAnswer(5, SECRET).ticker, 'the same answer every time');
  const cycle = Array.from({ length: POOL.length }, (_, i) => pickAnswer(i + 1, SECRET).ticker);
  assert.equal(new Set(cycle).size, POOL.length, 'every stock once in the first cycle');
  const second = Array.from({ length: POOL.length }, (_, i) => pickAnswer(POOL.length + i + 1, SECRET).ticker);
  assert.equal(new Set(second).size, POOL.length, 'and once in the second');
  assert.notDeepEqual(second, cycle, 'each cycle has its own order');
  assert.notEqual(second[0], cycle[cycle.length - 1], 'no stock two days running across the join');
  const other = Array.from({ length: 10 }, (_, i) => pickAnswer(i + 1, 'another-secret-abcdefabcdefabcdefabcdef').ticker);
  assert.notDeepEqual(other, cycle.slice(0, 10), 'the secret sets the order');
  assert.notDeepEqual(cycle.slice(0, 10), POOL.slice(0, 10).map((m) => m.ticker), 'not the list order');
  // The join rule holds for many cycles.
  for (let c = 1; c < 30; c += 1) {
    const prev = cycleOrder(SECRET, c - 1);
    assert.notEqual(cycleOrder(SECRET, c)[0].ticker, prev[prev.length - 1].ticker);
  }
});

test('GUESS pick: the pool is frozen, so the answers never reshuffle', () => {
  assert.deepEqual(Array.from({ length: 10 }, (_, i) => pickAnswer(i + 1, SECRET).ticker),
    ['GEV', 'COST', 'ACN', 'ORCL', 'XOM', 'SBUX', 'ABT', 'LRCX', 'CVS', 'PANW']);
  const src = readFileSync('data/guess.js', 'utf8');
  assert.doesNotMatch(src, /\bSP100\b/, 'a copy of the list, not a filter over the live one');
});

test('GUESS secret: env first, else a file made once and kept', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-guess-'));
  const file = path.join(dir, 'sub', 'guess-secret');
  assert.equal(loadSecret({ env: { GUESS_SECRET: ' from-env ' }, file }), 'from-env');
  const quiet = { error() {} };
  const a = loadSecret({ env: {}, file, log: quiet });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(file, 'utf8').trim(), a, 'written to the file');
  assert.equal(statSync(file).mode & 0o777, 0o600, 'only the owner reads it');
  assert.equal(loadSecret({ env: {}, file, log: quiet }), a, 'the same secret after a restart');
  assert.equal(loadSecret({ env: { GUESS_SECRET: '' }, file, log: quiet }), a, 'an empty env var falls back to the file');
  writeFileSync(file, 'short\n');
  const b = loadSecret({ env: {}, file, log: quiet });
  assert.match(b, /^[0-9a-f]{64}$/, 'a broken file is replaced');
  assert.equal(readFileSync(file, 'utf8').trim(), b);
});

test('GUESS chart: closes before today only, as % from the first close', () => {
  const day = (d) => Date.parse(`${d}T04:00:00Z`);
  const pts = [
    { t: day('2026-09-24'), v: 110 }, { t: day('2026-09-23'), v: 100 }, { t: day('2026-09-25'), v: 90 },
    { t: day('2026-09-27'), v: 500 }, { t: day('2026-09-22'), v: null },
  ];
  const c = closesBefore(pts, '2026-09-27');
  assert.deepEqual(c.map((p) => p.v), [100, 110, 90], 'sorted, today and bad values out');
  assert.deepEqual(normalise(c).map((p) => p[1]), [0, 10, -10]);
  assert.equal(Math.round(oneYearMove(c) * 100) / 100, -10);
  assert.equal(oneYearMove(c.slice(0, 1)), null);
  assert.deepEqual(normalise([]), []);
});

test('GUESS chart: the window starts one year before the puzzle date, whatever the source sent', () => {
  const day = (d) => Date.parse(`${d}T04:00:00Z`);
  assert.equal(yearBefore('2026-09-28'), '2025-09-28');
  // Two fetches that day whose 1Y windows start on different days (a UTC date vs a New
  // York date) give the same closes.
  const all = ['2025-09-26', '2025-09-27', '2025-09-28', '2025-09-29', '2026-09-25', '2026-09-28'].map((d, i) => ({ t: day(d), v: 100 + i }));
  const a = closesBefore(all, '2026-09-28');
  const b = closesBefore(all.slice(2), '2026-09-28');
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((p) => p.v), [102, 103, 104], 'from 2025-09-28 up to the day before');
});

test('GUESS hints: sector, 1Y move, size and first letter, each saying where the answer is', () => {
  const answer = { ticker: 'NVDA', sector: 'TECH', move: 40, cap: 5e12 };
  const cells = hintCells(answer, { ticker: 'AAPL', sector: 'TECH', move: 10, cap: 4e12 });
  assert.deepEqual(cells.map((c) => c.key), ['SECTOR', '1Y MOVE', 'SIZE', 'LETTER']);
  assert.deepEqual(cells[0], { key: 'SECTOR', value: 'TECH', dir: 'SAME', grade: 'hit' });
  assert.deepEqual(cells[1], { key: '1Y MOVE', value: '+10.0%', dir: 'ANSWER HIGHER', grade: 'miss' });
  assert.deepEqual(cells[2], { key: 'SIZE', value: '$4.00T', dir: 'CLOSE', grade: 'hit' }, '5T vs 4T is within 25%');
  assert.deepEqual(cells[3], { key: 'LETTER', value: 'A', dir: 'ANSWER AFTER', grade: 'miss' });

  const near = hintCells(answer, { ticker: 'MSFT', sector: 'COMM', move: 52, cap: 8e12 });
  assert.equal(near[0].grade, 'miss');
  assert.equal(near[0].dir, 'DIFFERENT');
  assert.deepEqual([near[1].dir, near[1].grade], ['ANSWER LOWER', 'near'], '12 points off');
  assert.deepEqual([near[2].dir, near[2].grade], ['ANSWER SMALLER', 'near'], 'within 2x');
  assert.deepEqual([near[3].dir, near[3].grade], ['ANSWER AFTER', 'near'], 'M to N is one letter');

  const unknown = hintCells(answer, { ticker: 'XOM', sector: 'ENERGY', move: null, cap: null });
  assert.deepEqual(unknown[1], { key: '1Y MOVE', value: '--', dir: '--', grade: 'none' }, 'no fake 0.0%');
  assert.deepEqual(unknown[2], { key: 'SIZE', value: '--', dir: '--', grade: 'none' });
  assert.equal(unknown[3].dir, 'ANSWER BEFORE');
  assert.equal(hintCells(answer, { ticker: 'NFLX', sector: 'COMM', move: 40, cap: 5e12 })[3].dir, 'SAME');
  for (const c of [...cells, ...near, ...unknown]) assert.ok(['SAME', 'DIFFERENT', 'CLOSE', '--'].includes(c.dir) || /^ANSWER (HIGHER|LOWER|BIGGER|SMALLER|BEFORE|AFTER)$/.test(c.dir), `${c.key}: ${c.dir} says it about the answer`);

  const solved = hintCells(answer, { ...answer });
  assert.ok(solved.every((c) => c.grade === 'hit'), 'the answer itself is all hits');
  assert.equal(fmtMove(-3.04), '−3.0%');
  assert.equal(fmtMove(0.01), '0.0%');
  assert.equal(fmtCap(467.1e9), '$467B');
  assert.equal(fmtCap(91.6e9), '$91.6B');
  assert.equal(fmtCap(0), '--');
});

test('GUESS input: a ticker or a company name, from the pool only', () => {
  assert.equal(findMember('aapl').ticker, 'AAPL');
  assert.equal(findMember(' apple ').ticker, 'AAPL');
  assert.equal(findMember('brk-b').ticker, 'BRK.B');
  assert.equal(findMember('GOOG'), null);
  assert.equal(findMember('ZZZZ'), null);
  assert.equal(findMember(''), null);
  const pool = POOL.map((m) => [m.ticker, m.name]);
  assert.deepEqual(matchPool(pool, 'nv').map((m) => m[0]), ['NVDA']);
  assert.equal(matchPool(pool, 'a')[0][0], 'AAPL', 'tickers that start with it first');
  assert.equal(matchPool(pool, 'apple')[0][0], 'AAPL', 'a company name');
  assert.ok(matchPool(pool, 'bank').some((m) => m[0] === 'BAC'), 'a word inside the name');
  assert.ok(!matchPool(pool, 'nv', { exclude: ['NVDA'] }).length, 'guessed ones drop out');
  assert.equal(matchPool(pool, 'a').length, 6, 'a short list');
  assert.deepEqual(matchPool(pool, '  '), []);
  assert.equal(exactPick(pool, 'nvidia')[0], 'NVDA');
  assert.equal(exactPick(pool, 'nvi'), null);
});

test('GUESS share: header, one row of squares per guess, the link', () => {
  const row = (...g) => ({ cells: g.map((grade) => ({ grade })) });
  const rows = [row('miss', 'near', 'miss', 'hit'), row('hit', 'hit', 'hit', 'hit')];
  const text = shareText(7, rows, true);
  const [G, Y, B] = [SQUARES.hit, SQUARES.near, SQUARES.miss];
  assert.deepEqual([G, Y, B], ['\u{1F7E9}', '\u{1F7E6}', '\u2B1B'], 'green match, blue near, black miss; never yellow');
  assert.equal(text, `BLOOMBROKE GUESS #7 2/6\n${B}${Y}${B}${G}\n${G}${G}${G}${G}\nbloombroke.com/?c=GUESS`);
  const lost = shareText(8, Array.from({ length: 6 }, () => row('miss', 'none', 'miss', 'miss')), false);
  assert.match(lost, /^BLOOMBROKE GUESS #8 X\/6\n/);
  assert.equal(lost.split('\n').length, 8);
  assert.doesNotMatch(lost, /undefined/);
  const x = new URL(shareOnX(text));
  assert.equal(x.origin + x.pathname, 'https://x.com/intent/post');
  assert.equal(x.searchParams.get('text'), text);
});

test('GUESS stats: played, win %, streaks; a missed day or a loss breaks the streak', () => {
  assert.deepEqual(guessStats({}, 5), { played: 0, wins: 0, winPct: null, current: 0, max: 0 });
  const r = { 1: { t: 3, w: 1 }, 2: { t: 4, w: 1 }, 3: { t: 6, w: 0 }, 4: { t: 2, w: 1 }, 5: { t: 5, w: 1 } };
  assert.deepEqual(guessStats(r, 5), { played: 5, wins: 4, winPct: 80, current: 2, max: 2 });
  assert.equal(guessStats(r, 6).current, 2, 'today still open: the streak runs to yesterday');
  assert.equal(guessStats(r, 7).current, 0, 'a missed day breaks it');
  const gap = { 1: { t: 1, w: 1 }, 2: { t: 1, w: 1 }, 3: { t: 1, w: 1 }, 5: { t: 1, w: 1 } };
  assert.deepEqual([guessStats(gap, 5).current, guessStats(gap, 5).max], [1, 3], 'a skipped puzzle splits runs');
  assert.equal(guessStats({ ...r, 6: { t: 6, w: 0 } }, 6).current, 0, 'a loss today');
  assert.equal(guessStats(null, 1).played, 0);
});

test('GUESS state: saved games read back safely, results kept once', () => {
  assert.deepEqual(readState(null), { results: {}, game: null });
  assert.deepEqual(readState({ results: [1], game: { n: 'x' } }), { results: {}, game: null });
  const s = readState({ results: { 1: { t: 2, w: 1 } }, game: { n: 2, rows: [{ ticker: 'AAPL', name: 'Apple', cells: [] }, { bad: true }] } });
  assert.equal(s.game.rows.length, 1, 'a broken row is dropped');
  const once = recordResult(recordResult(s, 2, 3, true), 2, 6, false);
  assert.deepEqual(once.results[2], { t: 3, w: 1 }, 'the first result stands');
  let big = { results: {}, game: null };
  for (let n = 1; n <= 410; n += 1) big = recordResult(big, n, 1, true);
  assert.equal(Object.keys(big.results).length, 400);
  assert.ok(!big.results[1] && big.results[410]);
});

test('GUESS countdown: to the next New York midnight, clock changes included', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(msToNextPuzzle(at('2026-09-27T03:59:00Z')), 60_000, 'EDT: midnight is 04:00Z');
  assert.equal(msToNextPuzzle(at('2026-09-27T04:00:00Z')), 86_400_000);
  assert.equal(msToNextPuzzle(at('2026-12-01T04:59:59.500Z')), 500, 'EST: midnight is 05:00Z');
  // 1 Nov 2026: clocks go back, the day is 25 hours.
  assert.equal(msToNextPuzzle(at('2026-11-01T04:00:00Z')), 25 * 3_600_000);
  // 8 Mar 2026: clocks go forward, the day is 23 hours.
  assert.equal(msToNextPuzzle(at('2026-03-08T05:00:00Z')), 23 * 3_600_000);
  assert.equal(fmtCountdown(3_723_000), '01:02:03');
  assert.equal(fmtCountdown(-5), '00:00:00');
});

test('GUESS screen parts: the chart has % and months only, rows show every try', () => {
  const day = 86_400_000;
  const t0 = Date.parse('2025-09-26T04:00:00Z');
  const series = Array.from({ length: 250 }, (_, i) => [t0 + i * day * 1.45, Math.sin(i / 20) * 30]);
  const svg = chartSvg(series, 800, 400);
  assert.match(svg, /^<svg class="gs-svg" width="800" height="400"/);
  assert.match(svg, />OCT</);
  assert.match(svg, /%</);
  assert.doesNotMatch(svg, /\$/, 'no price levels');
  assert.doesNotMatch(svg, /style=/);
  assert.equal(chartSvg([], 800, 400), '');
  assert.equal(chartSvg(series, 0, 0), '');
  const html = rowsHtml([{ ticker: 'AAPL', name: 'Apple', cells: hintCells({ ticker: 'NVDA', sector: 'TECH', move: 1, cap: 1 }, { ticker: 'AAPL', sector: 'TECH', move: 2, cap: 2 }), solved: false }]);
  assert.equal((html.match(/class="gs-row/g) || []).length, 6);
  assert.match(html, /g-hit/);
  assert.match(html, /<th scope="col">SECTOR<\/th><th scope="col">1Y MOVE<\/th><th scope="col">SIZE<\/th><th scope="col">FIRST LETTER<\/th>/);
  // A cell: the guess's value and one arrow to the answer. The words are only a tooltip.
  const cells = hintCells({ ticker: 'MSFT', sector: 'TECH', move: 30, cap: 100 }, { ticker: 'AAPL', sector: 'HEALTH', move: 10, cap: 400 });
  const row = rowsHtml([{ ticker: 'AAPL', name: 'Apple', cells, solved: false }]);
  assert.doesNotMatch(row.replace(/title="[^"]*"|<span class="offscreen">[^<]*<\/span>/g, ''), /ANSWER|Answer|DIFFERENT|SAME|CLOSE/, 'no words in the cells');
  assert.match(row, /<span class="gs-v">\+10\.0%<\/span><span class="gs-d" aria-hidden="true">\u2191<\/span>/, 'answer higher: up');
  assert.match(row, /<span class="gs-v">A<\/span><span class="gs-d" aria-hidden="true">\u2191<\/span>/, 'answer later in A to Z: up');
  assert.match(row, /title="Answer smaller"><span class="gs-v">[^<]*<\/span><span class="gs-d" aria-hidden="true">\u2193</, 'answer smaller: down');
  assert.match(row, /title="Different"><span class="gs-v">HEALTH<\/span><span class="offscreen">/, 'a sector has no arrow');
  // Every direction the server sends, and the words of rows saved before.
  const arrows = { 'ANSWER HIGHER': '\u2191', 'ANSWER BIGGER': '\u2191', 'ANSWER AFTER': '\u2191', 'ANSWER LOWER': '\u2193', 'ANSWER SMALLER': '\u2193', 'ANSWER BEFORE': '\u2193',
    LATER: '\u2191', HIGHER: '\u2191', BIGGER: '\u2191', EARLIER: '\u2193', LOWER: '\u2193', SMALLER: '\u2193', SAME: '', CLOSE: '', DIFFERENT: '', OTHER: '', '--': '' };
  for (const [d, a] of Object.entries(arrows)) assert.equal(dirArrow(d), a, d);
  const old = rowsHtml([{ ticker: 'AAPL', name: 'Apple', cells: [{ grade: 'miss', value: 'A', dir: 'LATER' }, { grade: 'miss', value: 'X', dir: 'SMALLER' }] }]);
  assert.match(old, /title="Answer after"><span class="gs-v">A<\/span><span class="gs-d" aria-hidden="true">\u2191</);
  assert.match(old, /title="Answer smaller"><span class="gs-v">X<\/span><span class="gs-d" aria-hidden="true">\u2193</);
  assert.equal(dirText('SAME'), 'SAME');
  // The legend: one plain line, outside the table.
  assert.equal(LEGEND, 'Arrows point to the answer. Green: same or close. Blue: near.');
  assert.doesNotMatch(LEGEND, /\u2014|\p{Extended_Pictographic}/u);
  assert.equal(legendHtml(), `<p class="gs-legend">${LEGEND}</p>`);
  assert.doesNotMatch(rowsHtml([]), /gs-legend/);
  // The end: one line, one stats line.
  assert.equal(endLine(3, null), 'Got it in 3.');
  assert.equal(endLine(0, { ticker: 'UPS', name: 'United Parcel Service' }), 'It was UPS (United Parcel Service).');
  const stats = statsHtml({ played: 4, wins: 3, winPct: 75, current: 2, max: 3 });
  assert.match(stats, /PLAYED<\/span> <b>4<[\s\S]*WIN %<\/span> <b>75<[\s\S]*STREAK<\/span> <b>2</);
  assert.doesNotMatch(stats, /MAX STREAK/);
});

test('GUESS copy: no emoji in the screen, no banned words, no em dashes', () => {
  const src = readFileSync('public/screens/guess.js', 'utf8');
  const server = readFileSync('data/guess.js', 'utf8');
  for (const s of [src, server]) {
    assert.doesNotMatch(s, /\u2014/);
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'));
    assert.doesNotMatch(s, /\b(buy|sell) (signal|rating)|price target/i);
  }
  // The squares live only in SQUARES (escaped in the source), used by shareText.
  assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, 'no emoji characters in the source');
});

test('GUESS wiring: a command in HELP and MENU, with its own search title', () => {
  const p = parseCommand('guess');
  assert.equal(p.name, 'GUESS');
  assert.equal(p.input, 'GUESS');
  const entry = findCommand('GUESS');
  assert.equal(entry.category, 'Charts');
  const meta = commandMeta('GUESS', parseCommand);
  assert.match(meta.title, /^GUESS: the daily stock chart puzzle/);
  assert.match(meta.description, /S&P 100/);
  assert.equal(meta.url, 'https://bloombroke.com/?c=GUESS');
  assert.ok(sitemapUrls().includes('https://bloombroke.com/?c=GUESS'));
});

// --- the endpoints ---------------------------------------------------------------------
async function serve({ now, getChart, getCaps, limiter } = {}) {
  const app = express();
  const game = mountGuess(app, { getChart, getCaps, secret: SECRET, now, limiter });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json(), headers: r.headers }; };
  return { game, get, close: () => new Promise((r) => server.close(r)) };
}

// A year of daily closes: each ticker its own straight line (NVDA +50%, others by letter).
function fakeChart(calls) {
  return async (ticker) => {
    calls?.push(ticker);
    if (ticker === 'FAIL') throw new Error('down');
    const start = Date.parse('2025-09-26T04:00:00Z');
    const end = ticker.charCodeAt(0) + 50;
    const points = [];
    for (let i = 0; i <= 367; i += 1) points.push({ t: start + i * 86_400_000, v: 100 + (end - 100) * (i / 367) });
    return { points };
  };
}

test('GUESS endpoints: today, check, reveal', async () => {
  const calls = [];
  const now = () => new Date('2026-09-28T15:00:00Z'); // puzzle #2
  const { get, close } = await serve({ now, getChart: fakeChart(calls), getCaps: async () => ({ stocks: POOL.map((m, i) => ({ ticker: m.ticker, marketCap: (i + 1) * 1e10 })) }) });
  try {
    const answer = pickAnswer(2, SECRET);
    const today = await get('/api/guess/today');
    assert.equal(today.status, 200);
    assert.equal(today.body.n, 2);
    assert.equal(today.body.date, '2026-09-28');
    assert.equal(today.body.tries, 6);
    assert.equal(today.body.pool.length, 100);
    assert.equal(today.body.series[0][1], 0, 'starts at 0%');
    assert.ok(today.body.series.every(([t]) => t < Date.parse('2026-09-28T04:00:00Z')), 'no bar from today');
    assert.ok(!('answer' in today.body) && !('ticker' in today.body));
    assert.match(today.headers.get('cache-control'), /max-age=60/);

    const wrong = POOL.find((m) => m.ticker !== answer.ticker);
    const miss = await get(`/api/guess/check?n=2&g=${encodeURIComponent(wrong.ticker)}`);
    assert.equal(miss.status, 200);
    assert.equal(miss.body.solved, false);
    assert.equal(miss.body.guess.ticker, wrong.ticker);
    assert.equal(miss.body.cells.length, 4);
    assert.ok(miss.body.cells.every((c) => typeof c.value === 'string' && typeof c.dir === 'string'));

    const hit = await get(`/api/guess/check?n=2&g=${encodeURIComponent(answer.name.toLowerCase())}`);
    assert.equal(hit.body.solved, true);
    assert.ok(hit.body.cells.every((c) => c.grade === 'hit'));

    assert.equal((await get('/api/guess/check?n=1&g=AAPL')).body.error, 'old_puzzle');
    assert.equal((await get('/api/guess/check?n=1&g=AAPL')).status, 409);
    assert.equal((await get('/api/guess/check?n=2&g=ZZZZ')).status, 400);
    assert.equal((await get('/api/guess/check?g=AAPL')).status, 400);
    const ahead = await get('/api/guess/check?n=3&g=AAPL');
    assert.deepEqual([ahead.status, ahead.body.error], [400, 'usage'], 'a future puzzle is a usage error, not a new puzzle');

    const rev = await get('/api/guess/reveal?n=2');
    assert.deepEqual([rev.body.ticker, rev.body.name], [answer.ticker, answer.name]);
    assert.ok(rev.body.sectorName);
    assert.equal((await get('/api/guess/reveal?n=1')).body.ticker, pickAnswer(1, SECRET).ticker, 'past puzzles too');
    assert.equal((await get('/api/guess/reveal?n=3')).status, 400, 'never a future answer');
    assert.equal((await get('/api/guess/reveal?n=abc')).status, 400);

    // One chart fetch per ticker per day.
    const n = calls.filter((t) => t === answer.ticker).length;
    await get('/api/guess/today');
    assert.equal(calls.filter((t) => t === answer.ticker).length, n);
  } finally {
    await close();
  }
});

test('GUESS endpoints: a missing cap or chart is "--", a dead source is 503, and a limit', async () => {
  const flaky = fakeChart();
  let fail = false;
  const { get, close } = await serve({
    now: () => new Date('2026-09-28T15:00:00Z'),
    getChart: async (t, r) => { if (fail) throw new Error('down'); return flaky(t, r); },
    getCaps: async () => { throw new Error('caps down'); },
  });
  try {
    const answer = pickAnswer(2, SECRET);
    await get('/api/guess/today');
    fail = true;
    const wrong = POOL.find((m) => m.ticker !== answer.ticker);
    const r = await get(`/api/guess/check?n=2&g=${wrong.ticker}`);
    assert.equal(r.status, 200, 'the answer chart is already in');
    const [, move, size] = r.body.cells;
    assert.deepEqual([move.value, move.grade], ['--', 'none']);
    assert.deepEqual([size.value, size.grade], ['--', 'none']);
  } finally {
    await close();
  }

  const dead = await serve({ now: () => new Date('2026-09-28T15:00:00Z'), getChart: async () => { throw new Error('down'); }, getCaps: async () => ({ stocks: [] }) });
  try {
    const r = await dead.get('/api/guess/today');
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'unavailable');
  } finally {
    await dead.close();
  }

  let hits = 0;
  const limiter = { hit: () => { hits += 1; return hits > 2 ? { ok: false, retryAfter: 30 } : { ok: true, retryAfter: 60 }; } };
  const lim = await serve({ now: () => new Date('2026-09-28T15:00:00Z'), getChart: fakeChart(), getCaps: async () => ({ stocks: [] }), limiter });
  try {
    await lim.get('/api/guess/reveal?n=1');
    await lim.get('/api/guess/reveal?n=1');
    const r = await lim.get('/api/guess/reveal?n=1');
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('retry-after'), '30');
  } finally {
    await lim.close();
  }
});
