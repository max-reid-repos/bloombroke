// Share-card hardening (security test, 30 Sep 2026): per-address limits on new renders
// and on the WHATIF numbers /api/whatif keeps, a cap on the render queue, shorter disk
// keep for files read 10 minutes (test/cert.test.js keepFor). The page head and temp
// names: test/og-head.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  rememberCert, getCert, whatifCard, quoteCard, affordCard, defaultPng, makeRateLimit, limited, renderBusy,   OG_RENDER_RATE, CERT_WRITE_RATE, RENDER_WAIT_MAX, MINE_RATE,
} from '../lib/og.js';
import { certModel } from '../data/whatif-cert.js';
import { catalog } from '../data/whatif-service.js';
import { parseCommand } from '../public/app.js';

const tmp = (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-oglim-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const row = { id: 'iphone6', kind: 'once', name: 'iPhone 6', company: 'Apple', ticker: 'AAPL', bought: '2014-09-19', close: 25, buys: 1, paid: 649, shares: 25.96, price: 250, value: 6490, multiple: 10 };
const result = (price = 250) => ({ rows: [{ ...row, price, value: price * 25.96 }], total: { paid: 649, value: price * 25.96, gain: price * 25.96 - 649, multiple: price / 25, pct: 900 }, stale: false });
const quoteDeps = (dir) => ({
  getQuote: async (t) => ({ ticker: t, name: `${t} Inc`, last: 100 + t.length, change: 1, changePct: 1, decimals: 2, asOf: '2026-09-30T16:00:00-04:00' }),
  getChart: async () => ({ points: Array.from({ length: 22 }, (_, i) => ({ close: 90 + i })) }),
  parse: parseCommand,
  cacheDir: dir,
});

test('numbers: generous for crawlers, tight for disk writes, a short queue', () => {
  assert.deepEqual(OG_RENDER_RATE, { renders: 120, windowMs: 10 * 60_000, addresses: 5000 });
  assert.deepEqual(CERT_WRITE_RATE, { renders: 30, windowMs: 10 * 60_000, addresses: 5000 });
  assert.equal(RENDER_WAIT_MAX, 16);
  assert.equal(MINE_RATE.renders, 20, 'MY cards keep their own limit');
});

test('S1 rememberCert: at most N new files per address; MY results never count; over it nothing is written', async (t) => {
  const dir = tmp(t);
  const allow = makeRateLimit({ renders: 2, windowMs: 60_000, addresses: 10 });
  const cert = (cmd) => certModel(result(), catalog, cmd);
  await rememberCert(cert('WHATIF IPHONE6'), { cacheDir: dir, ip: '1.2.3.4', allow });
  await rememberCert(cert('WHATIF IPHONE6:1Y'), { cacheDir: dir, ip: '1.2.3.4', allow });
  await rememberCert(cert('WHATIF IPHONE6:3Y'), { cacheDir: dir, ip: '1.2.3.4', allow });
  assert.equal(readdirSync(dir).filter((f) => f.endsWith('.json')).length, 2, 'the third is skipped silently');
  await rememberCert(cert('WHATIF IPHONE6:5Y'), { cacheDir: dir, ip: '5.6.7.8', allow });
  assert.equal(readdirSync(dir).filter((f) => f.endsWith('.json')).length, 3, 'another address has its own allowance');
  const server = readFileSync('server.js', 'utf8');
  assert.match(server, /rememberCert\(data\.cert, \{ stale: data\.stale, ip: clientIp\(req\) \}\)/);
  assert.match(server, /import \{ clientIp \} from '\.\/pro\/ratelimit\.js';/);
});

test('S2 ticker and AFFORD cards: new renders count per address, cache hits never; over it the site card, busy', async (t) => {
  const dir = tmp(t);
  const deps = quoteDeps(dir);
  const site = await defaultPng();
  const allowNew = makeRateLimit({ renders: 1, windowMs: 60_000, addresses: 10 });
  const a = await quoteCard('AAPL', deps, { ip: '1.1.1.1', allowNew });
  assert.ok(!a.busy);
  assert.notDeepEqual(a.png, site);
  const again = await quoteCard('AAPL', deps, { ip: '1.1.1.1', allowNew });
  assert.ok(!again.busy, 'from disk: free');
  assert.deepEqual(again.png, a.png);
  const b = await quoteCard('MSFT', deps, { ip: '1.1.1.1', allowNew });
  assert.equal(b.busy, true, 'a second new render in the window');
  assert.deepEqual(b.png, site);
  assert.ok(!(await quoteCard('MSFT', deps, { ip: '2.2.2.2', allowNew })).busy, 'another address');
  const notTicker = await quoteCard('HELP', deps, { ip: '1.1.1.1', allowNew });
  assert.ok(!notTicker.busy, 'not a ticker: the site card, not a limit');

  const allowAfford = makeRateLimit({ renders: 1, windowMs: 60_000, addresses: 10 });
  const x = await affordCard('AFFORD 500 BIKE 2 PER WEEK', { cacheDir: dir, ip: '3.3.3.3', allowNew: allowAfford });
  assert.ok(!x.busy);
  assert.ok(!(await affordCard('AFFORD 500 BIKE 2 PER WEEK', { cacheDir: dir, ip: '3.3.3.3', allowNew: allowAfford })).busy, 'cached');
  const y = await affordCard('AFFORD 600 BIKE 2 PER WEEK', { cacheDir: dir, ip: '3.3.3.3', allowNew: allowAfford });
  assert.equal(y.busy, true);
});

test('S2 WHATIF card: a new render counts per address; the cached card is free', async (t) => {
  const dir = tmp(t);
  const deps = { catalog, getWhatif: async () => result(), cacheDir: dir };
  const allowNew = makeRateLimit({ renders: 1, windowMs: 60_000, addresses: 10 });
  const one = await whatifCard('WHATIF IPHONE6', deps, { ip: '9.9.9.9', allowNew });
  assert.equal(one.real, true);
  assert.equal((await whatifCard('WHATIF IPHONE6', deps, { ip: '9.9.9.9', allowNew })).real, true, 'from disk');
  const two = await whatifCard('WHATIF IPHONE6:1Y', { ...deps, getWhatif: async () => result(260) }, { ip: '9.9.9.9', allowNew });
  assert.equal(two.busy, true);
  assert.equal(two.real, false);
  const server = readFileSync('server.js', 'utf8');
  assert.match(server, /whatifCard\(str\(req\.query\.c\) \|\| '', ogDeps, \{ ip: clientIp\(req\) \}\)/);
  assert.match(server, /quoteCard\(str\(req\.query\.c\) \|\| '', quoteDeps, \{ ip: clientIp\(req\) \}\);\n\s+sendPng\(res, card\.png, card\.busy \? 60 : 600\)/);
  assert.match(server, /affordCard\(str\(req\.query\.c\) \|\| '', \{ ip: clientIp\(req\) \}\);\n\s+sendPng\(res, card\.png, card\.busy \? 60 : 86400\)/);
});

test('S2 the queue: with 16 renders waiting, a new card is the site card, busy', async (t) => {
  const dir = tmp(t);
  const deps = quoteDeps(dir);
  await defaultPng(); // drawn before the queue fills
  const gates = [];
  const jobs = [];
  for (let i = 0; i < 2 + RENDER_WAIT_MAX; i++) jobs.push(limited(() => new Promise((r) => gates.push(r))));
  await new Promise((r) => setImmediate(r));
  assert.equal(renderBusy(), true);
  const card = await quoteCard('NVDA', deps, { ip: '4.4.4.4', allowNew: () => true });
  assert.equal(card.busy, true);
  // Let them all go (each finishing lets the next one start).
  while (gates.length || jobs.length > 0) {
    const g = gates.shift();
    if (g) g();
    await new Promise((r) => setImmediate(r));
    if (!gates.length) { await Promise.all(jobs); break; }
  }
  assert.equal(renderBusy(), false);
  assert.ok(!(await quoteCard('NVDA', deps, { ip: '4.4.4.4', allowNew: () => true })).busy, 'room again');
});

test('R1 makeRateLimit forgets an address within a minute after its window (the Privacy Policy)', () => {
  let t = 1_000_000;
  const allow = makeRateLimit({ renders: 5, windowMs: 10 * 60_000, addresses: 100 }, () => t);
  allow('1.1.1.1');
  allow('2.2.2.2');
  assert.equal(allow.size(), 2);
  t += 5 * 60_000;
  allow('2.2.2.2'); // 2.2.2.2 renders again: its window starts over
  t += 5 * 60_000 + 60_000; // 1.1.1.1's window ended a minute ago
  allow('3.3.3.3'); // a call after a minute sweeps
  assert.equal(allow.size(), 2, '1.1.1.1 is gone');
  t += 10 * 60_000;
  allow.sweep(t); // the timer's sweep
  assert.equal(allow.size(), 0, 'every window over: nothing held');
  const src = readFileSync('lib/og.js', 'utf8');
  assert.match(src, /setInterval\(\(\) => sweep\(\), sweepEvery\)\.unref\?\.\(\)/, 'a timer sweeps even with no calls');
});

test('R3 getCert (page meta, embed, /og/whatif.png): a new numbers file counts per address; over it the model still comes back', async (t) => {
  const dir = tmp(t);
  const deps = { catalog, getWhatif: async () => result(), cacheDir: dir };
  const allowWrite = makeRateLimit({ renders: 1, windowMs: 60_000, addresses: 10 });
  const a = await getCert('WHATIF IPHONE6', deps, { ip: '7.7.7.7', allowWrite });
  const b = await getCert('WHATIF IPHONE6:1Y', deps, { ip: '7.7.7.7', allowWrite });
  assert.ok(a && b, 'both answered');
  assert.equal(readdirSync(dir).filter((f) => f.endsWith('.json')).length, 1, 'only the first is kept');
  await getCert('WHATIF IPHONE6:3Y', deps, { ip: '8.8.8.8', allowWrite });
  assert.equal(readdirSync(dir).filter((f) => f.endsWith('.json')).length, 2, 'another address');
  const server = readFileSync('server.js', 'utf8');
  assert.match(server, /withScreenHints\(await shareIndex\(c, clientIp\(req\)\), c\)/);
  assert.match(server, /getCert\(c, ogDeps, \{ ip \}\)/);
  assert.match(server, /getCert: \(c, req\) => getCert\(c, ogDeps, \{ ip: req \? clientIp\(req\) : null \}\)/);
  assert.match(readFileSync('lib/embed-pages.js', 'utf8'), /getCert\(c, req\)/);
  assert.match(readFileSync('lib/og.js', 'utf8'), /const model = await getCert\(c, deps, \{ ip \}\);/, 'whatifCard passes its address on');
});
