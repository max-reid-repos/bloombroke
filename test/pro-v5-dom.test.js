// PRO v5 in a small DOM (test/fixtures/tiny-dom.js): the real render() and its real
// handlers on the visitor's page. The price line and M / Y (yearly not set up: monthly,
// the year off), SUBSCRIBE buying the picked plan, the test-mode line in test mode, the
// status bar without the price, and the stage: the real screens/pro-demo.js loaded by
// name, keys 1 to 4 and clicks on the key row, the command bar keeping its typing, and
// everything off once the screen is left. Live mode is test/pro-v5-dom-live.test.js
// (getConfig keeps its first good answer for the page's life, so one mode per file).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../public/screens/pro.js';
import { STAGE_MS } from '../public/screens/pro-demo.js';
import { mount, fakeDocument, flush } from './fixtures/tiny-dom.js';

const QUOTES = [{ ticker: 'NVDA', kind: 'stock', last: 191.2, prevClose: 185.6, change: 5.6, changePct: 3.02, asOf: '2026-09-29' },
  { ticker: 'AAPL', kind: 'stock', last: 338.4, change: -2.67, changePct: -0.78 }];
const doc = fakeDocument();
globalThis.document = doc; // the keys' listener and the stage's hidden-tab listener
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => { setTimeout(r, 5); });
  }
};

function page(config) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
    if (config === null) throw new Error('offline');
    if (String(url).includes('/api/pro/checkout')) return { ok: true, json: async () => ({ url: 'https://example.com/not-checkout' }) };
    return { ok: true, json: async () => config };
  };
  const el = mount();
  const status = [];
  const ac = new AbortController();
  const fetched = [];
  const ctx = {
    signal: ac.signal,
    status: (t, kind) => status.push([t, kind || '']),
    fetchJSON: async (url) => { fetched.push(url); return url.startsWith('/api/pro/seat') ? { next: 5 } : { quotes: QUOTES }; },
    store: { get: (k, fb) => (k === 'bb.watch' ? ['AAPL', 'NVDA'] : fb), set() {} },
  };
  render(el, { name: 'PRO', args: {} }, ctx);
  const body = mount('<main id="body"></main>', 'body').querySelector('#body');
  const bar = mount('<input id="cmd">').querySelector('#cmd');
  const bits = () => ({
    month: el.querySelector('#pro-plan-month').getAttribute('aria-pressed'),
    year: el.querySelector('#pro-plan-year').getAttribute('aria-pressed'),
    plan: el.querySelector('#pro-sub').dataset.plan,
    button: el.querySelector('#pro-sub').textContent,
  });
  const on = () => el.querySelectorAll('[data-stage]').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => Number(t.dataset.stage));
  return { el, ctx, ac, calls, status, fetched, bits, body, bar, on };
}

// Yearly first in this file: getConfig() keeps a good answer for the page's life (a
// failed one is asked again), so the failing config goes first.
test('yearly not set up: monthly is picked, the yearly price dim and off; Y and a click do nothing', async () => {
  const p = page(null);
  await flush();
  assert.ok(p.calls.some((c) => c.url === '/api/pro/config'));
  assert.deepEqual(p.bits(), { month: 'true', year: 'false', plan: 'month', button: 'SUBSCRIBE' });
  const y = p.el.querySelector('#pro-plan-year');
  assert.equal(y.disabled, true);
  assert.equal(y.title, 'Yearly is not available yet. Monthly is.');
  assert.equal(p.el.querySelector('#pro-year-note').hidden, false);
  y.click();
  assert.equal(p.bits().plan, 'month', 'a disabled price does nothing');
  const ev = doc.key('y', p.body);
  assert.equal(p.bits().plan, 'month', 'nor does Y');
  assert.equal(ev.prevented, true, 'the key is still PRO\'s, not typing');
  // No config (so not test mode): no test-mode line.
  assert.equal(p.el.querySelector('#pro-test').hidden, true);
  p.ac.abort();
});

test('test mode: the price line, M and Y, SUBSCRIBE buys the picked plan; the test line shows; no price in the status bar', async () => {
  const p = page({ mode: 'test', open: true, yearly: true });
  await until(() => !p.el.querySelector('#pro-test').hidden);
  assert.equal(p.el.querySelector('#pro-test').textContent, 'Test mode: no card is charged yet.');
  assert.equal(p.el.querySelector('#pro-demo').hidden, false, 'the test card, in + Details');
  // Yearly first.
  assert.deepEqual(p.bits(), { month: 'false', year: 'true', plan: 'year', button: 'SUBSCRIBE' });
  assert.equal(p.el.querySelector('#pro-plan-year').disabled, false);
  // A click on the other price picks it.
  p.el.querySelector('#pro-plan-month').click();
  assert.deepEqual(p.bits(), { month: 'true', year: 'false', plan: 'month', button: 'SUBSCRIBE' });
  // Y and M (either case), with the focus on the page.
  let ev = doc.key('Y', p.body);
  assert.equal(ev.prevented && ev.stopped, true);
  assert.equal(p.bits().plan, 'year');
  doc.key('m', p.body);
  assert.equal(p.bits().plan, 'month');
  // In the command bar they are typing, never a plan.
  ev = doc.key('y', p.bar);
  assert.equal(ev.prevented, false);
  assert.equal(p.bits().plan, 'month');
  // SUBSCRIBE: the real checkout call with the picked plan.
  p.el.querySelector('#pro-sub').click();
  await flush();
  const buy = p.calls.filter((c) => c.url === '/api/pro/checkout');
  assert.equal(buy.length, 1);
  assert.deepEqual(buy[0].body, { plan: 'month' });
  doc.key('y', p.body);
  p.el.querySelector('#pro-sub').disabled = false; // the button comes back after a failed open
  p.el.querySelector('#pro-sub').click();
  await flush();
  assert.deepEqual(p.calls.filter((c) => c.url === '/api/pro/checkout')[1].body, { plan: 'year' });
  // The status bar: never "PRO: $42 A MONTH OR $420 A YEAR".
  assert.equal(p.status[0][0], '');
  assert.ok(p.status.every(([t]) => !/\$|A MONTH|A YEAR/.test(t)), JSON.stringify(p.status));
  p.ac.abort();
});

test('the stage on the page: PINGS first; keys 1 to 4 and the key row switch it; the command bar keeps its digits; off on leave', async () => {
  const p = page({ mode: 'test', open: true, yearly: true });
  const view = () => p.el.querySelector('#pd-stage');
  await until(() => view().children.length > 0);
  assert.ok(p.fetched.some((u) => u === '/api/quotes?s=AAPL,NVDA'));
  assert.deepEqual(p.on(), [1]);
  assert.match(view().textContent, /New message from @joe\$NVDA 191\.20 \+3\.0% since/);
  assert.match(view().textContent, /NVDA above 185/);
  // Key 3, with the focus on the page: EVERY DEVICE, the visitor's own list.
  let ev = doc.key('3', p.body);
  assert.equal(ev.prevented, true);
  assert.deepEqual(p.on(), [3]);
  assert.equal(p.el.querySelector('#pd-stage-label').textContent, 'EVERY DEVICE');
  assert.match(p.el.querySelector('#pd-stage-meta').textContent, /your watchlist/);
  assert.match(view().textContent, /AAPL[^]*338\.40/);
  // A digit typed in the command bar is typing (3988.HK), never a stage.
  ev = doc.key('1', p.bar);
  assert.equal(ev.prevented, false);
  assert.deepEqual(p.on(), [3]);
  // Not ours: 5, Ctrl+2.
  assert.equal(doc.key('5', p.body).prevented, false);
  assert.equal(doc.key('2', p.body, { ctrlKey: true }).prevented, false);
  assert.deepEqual(p.on(), [3]);
  // A click on the key row.
  p.el.querySelector('[data-stage="2"]').click();
  assert.deepEqual(p.on(), [2]);
  await until(() => view().querySelectorAll('.cm').length === 3, 6000);
  assert.deepEqual(view().querySelectorAll('.cm-who').map((w) => w.textContent.trim()), ['ana', 'ana', 'joe'], 'no seat numbers on ana and joe');
  assert.equal(view().querySelectorAll('.cm-seat').length, 0);
  p.el.querySelector('[data-stage="4"]').click();
  assert.match(view().textContent, /SEAT 00005/, 'the real next seat from /api/pro/seat');
  // Left: the keys are off and nothing moves.
  const before = doc.count('keydown');
  assert.ok(before >= 1);
  p.ac.abort();
  doc.key('1', p.body);
  assert.deepEqual(p.on(), [4]);
  assert.equal(doc.count('keydown'), 0, 'every PRO key listener gone');
  assert.equal(doc.count('visibilitychange'), 0, 'the stage stopped');
});

test('a hover on the stage keeps it where it is (about 6 s of real time)', async () => {
  const p = page({ mode: 'test', open: true, yearly: true });
  await until(() => p.el.querySelector('#pd-stage').children.length > 0);
  p.el.querySelector('#pd-stagebox').dispatch('pointerenter');
  // The move would come at STAGE_MS: wait past it (real time), and it has not moved.
  await new Promise((r) => { setTimeout(r, STAGE_MS + 300); });
  assert.deepEqual(p.on(), [1]);
  p.ac.abort();
  assert.equal(doc.count('keydown'), 0);
});
