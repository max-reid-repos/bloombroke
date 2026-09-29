// GUESS design review: one column with a 2:1 chart, the clue looks (hit a fill, near blue
// text, miss dim text) in the table and the how-to key alike, the answer named in the
// chart's strip when the game ends (won or lost), COPY RESULT the one primary button, and
// NEXT IN in hours and minutes. The screen runs on the tiny DOM (test/fixtures/tiny-dom.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mount, flush } from './fixtures/tiny-dom.js';
import {
  render, fmtCountdown, nextInner, revealHtml, seriesMove, HOWTO, HOWTO_EXAMPLE, howtoExampleHtml, cellHtml, STORE_KEY, TRIES,
} from '../public/screens/guess.js';
import { howtoHtml } from '../public/howto.js';
import { hintCells } from '../data/guess.js';

const css = readFileSync('public/screens/guess.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => {
  const i = css.indexOf(`${sel} {`);
  assert.ok(i >= 0, `a rule for ${sel}`);
  return css.slice(i, css.indexOf('}', i) + 1);
};

// ---- layout ---------------------------------------------------------------------------

test('GUESS layout: one column at every size, the chart on top and never taller than 2:1', () => {
  // No two-column grid anywhere, at any width.
  for (const m of css.matchAll(/grid-template-columns:\s*([^;}]+)/g)) assert.equal(m[1].trim(), 'minmax(0, 1fr)', `one column: ${m[0]}`);
  // The chart panel comes first in the markup, the guesses under it.
  const src = readFileSync('public/screens/guess.js', 'utf8');
  assert.ok(src.indexOf("panel('1', 'Guess'") < src.indexOf("panel('2', 'Your guesses'"));
  // Phones and the page layout: 2:1 by its width.
  assert.match(rule('.gs-chart'), /aspect-ratio: 2 \/ 1/);
  assert.match(rule('.gs-chart'), /width: 100%/);
  // The desktop layout: a column. The chart wants half its panel's width (50cqw of the
  // chart panel's body) and only gives way (to 160 px); the guesses sit right under it
  // at their own height and take any room left, so no empty band opens under the chart.
  const desk = css.slice(css.indexOf('@media (min-width: 1100px)'));
  assert.match(desk, /\.view > \.grid-guess \{ display: flex; flex-direction: column; \}/);
  assert.match(desk, /\.grid-guess > \.gs-chart-panel \{ flex: 0 1 auto; min-height: 160px; \}/, 'the chart panel: its content size, shrinks only');
  assert.match(desk, /\.grid-guess > \.gs-play \{ flex: 1 0 auto; \}/, 'the guesses: never squeezed, take the rest');
  assert.match(desk, /\.gs-chart-panel > \.panel-body \{[^}]*flex: 0 1 auto;[^}]*container-type: inline-size/);
  assert.match(desk, /\.grid-guess \.gs-chart \{[^}]*flex: 0 1 auto;[^}]*height: 50cqw;[^}]*max-height: none/, '2:1 at most, and no bigger box than the chart');
  assert.doesNotMatch(desk, /\.gs-chart \{[^}]*flex: 1/, 'the chart never grows past 2:1 (that was the empty band)');
  // Never a fixed height that could be taller than 2:1.
  assert.doesNotMatch(rule('.gs-chart'), /(^|[\s;{])height: \d/);
});

// ---- the clue looks -------------------------------------------------------------------

test('GUESS clues: right is a green fill, close is blue text with its arrow (no box), wrong is dim text', () => {
  assert.match(rule('.gs-cell.g-hit'), /background: var\(--up\)/);
  const near = rule('.gs-cell.g-near');
  assert.match(near, /color: var\(--accent\)/);
  assert.doesNotMatch(near, /box-shadow|border|background|outline/, 'no box or outline');
  const miss = rule('.gs-cell.g-miss');
  assert.match(miss, /color: var\(--dim\)/);
  assert.doesNotMatch(miss, /box-shadow|border|background|outline/);
  // Nowhere else draws a box round a near or miss cell (the pop-up had its own edge).
  assert.doesNotMatch(css, /g-(near|miss)[^{]*\{[^}]*(box-shadow|outline)/);
  // The cells carry the grade class; the near arrow is in the cell, coloured with it.
  const [, move, size] = HOWTO_EXAMPLE.cells;
  assert.match(cellHtml(move), /^<td class="gs-cell g-near" title="Answer higher"><span class="gs-v">\+6\.2%<\/span><span class="gs-d" aria-hidden="true">↑<\/span>/);
  assert.match(cellHtml(size), /^<td class="gs-cell g-miss"/);
  assert.doesNotMatch(css, /\.gs-cell\.g-near \.gs-d|\.gs-cell\.g-miss \.gs-d/, 'the arrow takes the cell colour');
});

test('GUESS how to play: the example row and the key use the same looks, and still match the grading', () => {
  const answer = { ticker: 'MDLZ', sector: 'STAPLES', move: 16.2, cap: 85e9 };
  const guess = { ticker: 'KO', sector: 'STAPLES', move: 6.2, cap: 300e9 };
  assert.deepEqual(hintCells(answer, guess), HOWTO_EXAMPLE.cells, 'graded as data/guess.js grades it');
  const ex = howtoExampleHtml();
  for (const c of HOWTO_EXAMPLE.cells) assert.ok(ex.includes(cellHtml(c)), c.key);
  // The key: a tiny cell of each look, a letter in it; near and miss with their arrows.
  assert.deepEqual(HOWTO.legend.map((k) => [k.cls, k.label, k.sample]), [
    ['gs-cell g-hit', 'hit', 'A'], ['gs-cell g-near', 'near', 'A↑'], ['gs-cell g-miss', 'miss', 'A↓'],
  ]);
  const html = howtoHtml(HOWTO);
  assert.match(html, /<span class="howto-sw gs-cell g-hit" aria-hidden="true">A<\/span><span class="offscreen">Green: <\/span>hit/);
  assert.match(html, /<span class="howto-sw gs-cell g-near" aria-hidden="true">A↑<\/span><span class="offscreen">Blue: <\/span>near/);
  assert.match(html, /<span class="howto-sw gs-cell g-miss" aria-hidden="true">A↓<\/span><span class="offscreen">Dim: <\/span>miss/);
  // The key cell is sized as a cell, not a filled square for every look.
  assert.match(rule('.howto-sw.gs-cell'), /min-width: 24px; height: 20px/);
  // A screen without samples keeps plain squares.
  assert.match(howtoHtml({ legend: [{ cls: 'x', label: 'y' }] }), /<span class="howto-sw x" aria-hidden="true"><\/span>y/);
});

// ---- the reveal, the end card, the countdown -------------------------------------------

test('GUESS reveal: ticker, name and the 1Y move, in plain words', () => {
  assert.equal(revealHtml({ ticker: 'SO', name: 'Southern Company' }, -12.34),
    '<span class="meta-note gs-reveal"><b class="gs-rtk">SO</b> · Southern Company · <span class="down">−12.3%</span> in a year</span>');
  assert.match(revealHtml({ ticker: 'NVDA', name: 'Nvidia' }, 40), /<span class="up">\+40\.0%<\/span> in a year/);
  assert.equal(revealHtml({ ticker: 'X', name: 'X & Co' }, NaN), '<span class="meta-note gs-reveal"><b class="gs-rtk">X</b> · X &amp; Co</span>');
  assert.equal(revealHtml(null, 3), '');
  assert.equal(seriesMove([[1, 0], [2, -12.3]]), -12.3);
  assert.ok(Number.isNaN(seriesMove([])));
});

test('GUESS countdown: hours and minutes, no seconds', () => {
  assert.equal(fmtCountdown(13 * 3_600_000 + 20 * 60_000), '13 h 20 m');
  assert.equal(fmtCountdown(3_723_000), '1 h 3 m', 'a part minute counts as a whole one');
  assert.equal(fmtCountdown(59_000), '0 h 1 m');
  assert.equal(fmtCountdown(0), '0 h 0 m');
  assert.equal(fmtCountdown(-5), '0 h 0 m');
  assert.equal(fmtCountdown(24 * 3_600_000), '24 h 0 m');
});

test('GUESS next puzzle: NEXT IN while waiting; once the time has come, the new puzzle line, never 0 h 0 m', () => {
  assert.equal(nextInner(0, 13 * 3_600_000 + 20 * 60_000), 'NEXT IN <span class="gs-cd">13 h 20 m</span>');
  assert.equal(nextInner(1000, 1000), 'A NEW PUZZLE IS OUT. <a class="code" href="?c=GUESS" data-cmd="GUESS">GUESS</a>');
  assert.equal(nextInner(5000, 1000), nextInner(1000, 1000));
  assert.doesNotMatch(nextInner(999, 1000), /0 h 0 m/, 'the last second: a part minute is a whole one');
});

test('GUESS links: SHARE ON X and EMBED hover as the kit\'s card links (brighter), the underline unchanged', () => {
  const hover = rule('.gs-share .gs-link:hover, .gs-share .gs-link:focus-visible');
  assert.match(hover, /color: var\(--text\)/);
  assert.match(hover, /text-decoration: underline/);
  assert.match(rule('.gs-share .gs-link'), /text-decoration: underline/);
});

// The screen, on the tiny DOM. api: path -> the JSON the server sends.
const MOVE = -12.3;
const SERIES = Array.from({ length: 30 }, (_, i) => [Date.UTC(2025, 9, 1) + i * 86_400_000, i === 29 ? MOVE : i * 0.1]);
const POOL = [['SO', 'Southern Company'], ['KO', 'Coca-Cola'], ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'Nvidia'], ['AMZN', 'Amazon'], ['META', 'Meta Platforms'], ['PEP', 'PepsiCo']];
const cells = (grade) => [{ key: 'SECTOR', value: 'TECH', dir: 'DIFFERENT', grade }, { key: '1Y MOVE', value: '+1.0%', dir: 'ANSWER LOWER', grade }, { key: 'SIZE', value: '$1T', dir: 'ANSWER SMALLER', grade }, { key: 'LETTER', value: 'A', dir: 'ANSWER AFTER', grade }];
const row = (t, solved = false) => ({ ticker: t, name: POOL.find((p) => p[0] === t)[1], cells: cells(solved ? 'hit' : 'miss'), solved });

function screen(saved, check = () => { throw new Error('no check'); }) {
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  const data = new Map([[STORE_KEY, saved]]);
  const every = [];
  const status = [];
  const ctx = {
    embed: true, // no pop-up, no chat lookup
    signal: { aborted: false },
    store: { get: (k, fb) => (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : fb), set: (k, v) => data.set(k, v) },
    fetchJSON: async (url) => {
      if (url === '/api/guess/today') return { n: 9, date: '2026-10-05', tries: TRIES, series: SERIES, pool: POOL };
      if (url.startsWith('/api/guess/check?')) return check(new URLSearchParams(url.split('?')[1]));
      throw new Error(`no ${url}`);
    },
    status: (t) => status.push(t), updated() {}, every: (fn, ms) => every.push([fn, ms]), onCleanup() {}, copy: async () => true,
  };
  const el = mount();
  render(el, { name: 'GUESS', args: {} }, ctx);
  return { el, ctx, every, data, meta: () => el.querySelector('#gs-meta').textContent };
}

test('GUESS reveal: a won game names the stock in the chart strip, from the guess that got it', async () => {
  const s = screen({ results: {}, game: { n: 9, rows: [row('AAPL'), row('MSFT')] } }, (p) => {
    assert.equal(p.get('g'), 'SO');
    return { n: 9, guess: { ticker: 'SO', name: 'Southern Company' }, cells: cells('hit'), solved: true };
  });
  await flush(8);
  assert.equal(s.meta(), 'MYSTERY STOCK · 1 YEAR · % CHANGE', 'a mystery while playing');
  const input = s.el.querySelector('.gs-in');
  input.value = 'SO';
  s.el.querySelector('.gs-form').parent.dispatch('submit', { target: input });
  await flush(12);
  assert.equal(s.meta(), 'SO · Southern Company · −12.3% in a year');
  assert.equal(s.el.querySelector('.gs-result').textContent, 'Got it in 3.', 'the result line stays');
  assert.equal(s.el.querySelectorAll('.gs-row').length, 3, 'no blank rows for tries never used');
  assert.ok(s.el.querySelector('.gs-stats'), 'the stats stay');
  assert.equal(s.data.get(STORE_KEY).results[9].w, 1);
});

test('GUESS reveal: a lost game names the stock too (the answer that came with the sixth guess)', async () => {
  const five = ['KO', 'AAPL', 'MSFT', 'NVDA', 'AMZN'].map((t) => row(t));
  const s = screen({ results: {}, game: { n: 9, rows: five } }, (p) => {
    assert.equal(p.get('p'), 'KO,AAPL,MSFT,NVDA,AMZN');
    return { n: 9, guess: { ticker: 'META', name: 'Meta Platforms' }, cells: cells('miss'), solved: false, answer: { ticker: 'SO', name: 'Southern Company' } };
  });
  await flush(8);
  assert.match(s.meta(), /^MYSTERY STOCK/);
  const input = s.el.querySelector('.gs-in');
  input.value = 'META';
  s.el.querySelector('.gs-form').parent.dispatch('submit', { target: input });
  await flush(12);
  assert.equal(s.meta(), 'SO · Southern Company · −12.3% in a year');
  assert.equal(s.el.querySelector('.gs-result').textContent, 'It was SO (Southern Company).');
  assert.equal(s.data.get(STORE_KEY).results[9].w, 0);
  // Opened again later: still named.
  const again = screen(s.data.get(STORE_KEY));
  await flush(12);
  assert.equal(again.meta(), 'SO · Southern Company · −12.3% in a year');
});

test('GUESS end card: COPY RESULT is the one primary button; SHARE ON X and EMBED are text links; NEXT IN in h and m, once a minute', async () => {
  const s = screen({ results: {}, game: { n: 9, rows: [row('SO', true)] } });
  await flush(12);
  const share = s.el.querySelector('.gs-share');
  const solid = share.querySelectorAll('.btn-solid');
  assert.equal(solid.length, 1);
  assert.ok(solid[0].classList.contains('gs-copy'));
  assert.equal(solid[0].textContent, 'COPY RESULT');
  for (const sel of ['.gs-x', '.gs-embed']) {
    const l = share.querySelector(sel);
    assert.ok(l.classList.contains('card-link'), `${sel} is a text link`);
    assert.ok(!l.classList.contains('chip') && !l.classList.contains('btn-solid'), `${sel} has no box`);
  }
  assert.equal(share.querySelector('.gs-x').tag, 'a');
  assert.match(share.querySelector('.gs-cd').textContent, /^\d{1,2} h \d{1,2} m$/);
  assert.deepEqual(s.every.map(([, ms]) => ms), [60_000], 'updated once a minute');
  s.every[0][0]();
  assert.match(share.querySelector('.gs-cd').textContent, /^\d{1,2} h \d{1,2} m$/);
});

test('GUESS end card after the rollover: the new puzzle line, on the next tick and when it is drawn late', async () => {
  const realNow = Date.now;
  try {
    // Open, then the New York midnight passes: the minute tick swaps NEXT IN for the line.
    const s = screen({ results: {}, game: { n: 9, rows: [row('SO', true)] } });
    await flush(12);
    assert.match(s.el.querySelector('.gs-next').textContent, /^NEXT IN \d/);
    Date.now = () => realNow() + 25 * 3_600_000;
    s.every[0][0]();
    assert.equal(s.el.querySelector('.gs-next').textContent, 'A NEW PUZZLE IS OUT. GUESS');
    assert.equal(s.el.querySelector('.gs-next').querySelector('[data-cmd]').getAttribute('data-cmd'), 'GUESS', 'the way to start it');
    assert.equal(s.el.querySelector('.gs-cd'), null);
    s.every[0][0]();
    assert.equal(s.el.querySelector('.gs-next').textContent, 'A NEW PUZZLE IS OUT. GUESS', 'stays');
    // Opened just before midnight, drawn after it (a slow answer): never "0 h 0 m".
    Date.now = realNow;
    const late = screen({ results: {}, game: { n: 9, rows: [row('SO', true)] } });
    Date.now = () => realNow() + 25 * 3_600_000;
    await flush(12);
    assert.equal(late.el.querySelector('.gs-next').textContent, 'A NEW PUZZLE IS OUT. GUESS');
    assert.doesNotMatch(late.el.querySelector('.gs-end').textContent, /0 h 0 m/);
  } finally {
    Date.now = realNow;
  }
});
