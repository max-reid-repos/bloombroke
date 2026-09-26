import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pctToDepth, depthRange, capToSize, fishColor, pickExtremes, tankHeader, sizeLimits, seeded,
} from '../public/screens/fishtank.js';
import { parseCommand, FKEYS } from '../public/app.js';
import { findCommand, byCategory } from '../public/registry.js';
import { WEIRD_SCREENS } from '../public/commands-weird.js';

test('fishtank: % change to depth, winners up top, losers at the floor', () => {
  assert.equal(pctToDepth(0, 3), 0.5, 'flat swims mid-tank');
  assert.equal(pctToDepth(3, 3), 0, 'the biggest move up reaches the surface');
  assert.equal(pctToDepth(-3, 3), 1, 'the biggest move down reaches the floor');
  assert.equal(pctToDepth(9, 3), 0, 'past the range: clamped');
  assert.equal(pctToDepth(-9, 3), 1);
  assert.ok(pctToDepth(1, 3) < pctToDepth(0.5, 3), 'a bigger gain swims higher');
  assert.ok(pctToDepth(-1, 3) > pctToDepth(-0.5, 3), 'a bigger loss swims lower');
  assert.ok(Math.abs(pctToDepth(0.75, 3) - (0.5 - 0.5 * Math.sqrt(0.25))) < 1e-12, 'square-root spread');
  assert.equal(pctToDepth(NaN, 3), 0.5);
  assert.equal(pctToDepth(1, 0), 0.5);
});

test('fishtank: depth range is the biggest move, never under 1%', () => {
  assert.equal(depthRange([{ changePct: 0.2 }, { changePct: -0.4 }]), 1);
  assert.equal(depthRange([{ changePct: 2.5 }, { changePct: -4.1 }, { changePct: NaN }]), 4.1);
  assert.equal(depthRange([]), 1);
});

test('fishtank: market cap to size, length grows with sqrt(cap)', () => {
  const lim = { max: 80, min: 10, fallback: 30 };
  assert.equal(capToSize(4e12, 4e12, lim), 80, 'the biggest company is the longest fish');
  assert.equal(capToSize(1e12, 4e12, lim), 40, 'a quarter of the cap: half the length');
  assert.equal(capToSize(4e10, 4e12, lim), 10, 'never shorter than min');
  assert.equal(capToSize(null, 4e12, lim), 30, 'no cap: the one fallback size');
  assert.equal(capToSize(0, 4e12, lim), 30);
  assert.equal(capToSize(1e12, 0, lim), 30, 'no caps at all: every fish the same');
  const a = capToSize(1e12, 4e12, lim); const b = capToSize(2e12, 4e12, lim);
  assert.ok(Math.abs((b / a) ** 2 - 2) < 1e-9, 'area follows cap');
});

test('fishtank: size limits scale with the tank and stay in bounds', () => {
  const big = sizeLimits(1400, 720);
  const phone = sizeLimits(372, 608);
  assert.ok(big.max > phone.max);
  for (const l of [big, phone, sizeLimits(10, 10), sizeLimits(5000, 3000)]) {
    assert.ok(l.max >= 30 && l.max <= 88, `max ${l.max}`);
    assert.ok(l.min >= 9 && l.min < l.max);
    assert.ok(l.fallback > l.min && l.fallback < l.max);
  }
});

test('fishtank: colour scale, green up, red down, brighter with the move', () => {
  assert.equal(fishColor(1).h, 147);
  assert.equal(fishColor(-1).h, 0);
  assert.equal(fishColor(0).h, 208, 'flat is steel');
  assert.equal(fishColor(NaN).h, 208);
  assert.ok(fishColor(2).l > fishColor(0.5).l, 'bigger gain, brighter');
  assert.ok(fishColor(-2).l > fishColor(-0.5).l, 'bigger loss, brighter');
  assert.ok(fishColor(2).s > fishColor(0.5).s);
  assert.deepEqual(fishColor(3), fishColor(8), 'full strength at 3%');
  assert.deepEqual(fishColor(-3), fishColor(-8));
});

test('fishtank: biggest winner and loser, stable on ties', () => {
  const s = [
    { ticker: 'AAA', changePct: 1.2 }, { ticker: 'NVDA', changePct: 3.1 }, { ticker: 'AMD', changePct: 3.1 },
    { ticker: 'PFE', changePct: -2.4 }, { ticker: 'XOM', changePct: 0 }, { ticker: 'BAD', changePct: NaN },
  ];
  const { winner, loser } = pickExtremes(s);
  assert.equal(winner.ticker, 'AMD', 'a tie goes to the first ticker A-Z');
  assert.equal(loser.ticker, 'PFE');
  assert.deepEqual(pickExtremes([{ ticker: 'A', changePct: 1 }]), { winner: { ticker: 'A', changePct: 1 }, loser: null }, 'no loser on an all-up day');
  assert.deepEqual(pickExtremes([{ ticker: 'A', changePct: 0 }]), { winner: null, loser: null });
  assert.deepEqual(pickExtremes([]), { winner: null, loser: null });
});

test('fishtank: header line counts up and down', () => {
  const h = tankHeader([{ changePct: 1 }, { changePct: 2 }, { changePct: -1 }, { changePct: 0 }], '2026-09-25T18:32:00Z');
  assert.equal(h.up, 2);
  assert.equal(h.down, 1);
  assert.equal(h.text, 'S&P 100 · 2 up · 1 down · updated 14:32');
});

test('fishtank: seeded numbers are stable and in [0, 1)', () => {
  assert.equal(seeded('AAPL', 3), seeded('AAPL', 3));
  assert.notEqual(seeded('AAPL', 3), seeded('AAPL', 4));
  for (const t of ['A', 'MSFT', 'BRK.B', '']) for (let i = 0; i < 20; i += 1) {
    const v = seeded(t, i);
    assert.ok(v >= 0 && v < 1, `${t} ${i}: ${v}`);
  }
});

test('fishtank: routed, listed under Weird data, off the F-key bar', () => {
  assert.equal(parseCommand('FISHTANK').name, 'FISHTANK');
  assert.ok(WEIRD_SCREENS.FISHTANK?.render, 'has its own screen');
  const c = findCommand('FISHTANK');
  assert.equal(c.category, 'Weird data');
  assert.ok(byCategory('Weird data').includes(c));
  const words = c.summary.split(/\s+/).length;
  assert.ok(words >= 3 && words <= 5, c.summary);
  assert.equal(findCommand('FISH'), null, 'FISH is not a command');
  assert.ok(!FKEYS.some((k) => k.cmd === 'FISHTANK'));
});

test('fishtank: copy rules, no banned brand word, no em dashes', () => {
  for (const f of ['public/screens/fishtank.js']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /\u2014/, `${f}: em dash`);
  }
});
