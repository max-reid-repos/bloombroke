// A WEIRD gauge whose feed has nothing (NO DATA, no last good reading) is left out of the
// WEIRD grid and SURPRISE ME, and comes back by itself once it reports. Its own screen, a
// DESK card, a GRID tile and /api/weird keep the row as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeWeird } from '../data/weird/index.js';
import * as pizzaGauge from '../data/weird/pizza.js';
import { emptyGauge, WEIRD_GAUGES, gaugeByCommand } from '../public/screens/weird-gauges.js';
import { render, showTile, tileBody, noDataCount } from '../public/screens/weird.js';
import { cardBody } from '../public/screens/desk-cards.js';
import { SURPRISE_PICKS, SURPRISE_WAIT_MS, pickSurprise, emptyWeirdIds, fetchEmptyWeird, chipChoice } from '../public/screens/welcome.js';

const fx = (f) => readFileSync(new URL(`./fixtures/weird/${f}`, import.meta.url), 'utf8');
const FULL = JSON.stringify({
  success: true, overall_index: 42, defcon_level: 4, active_spikes: 1, timestamp: '2026-09-26T02:17:42.784Z',
  data: [{ name: 'Dominos Pizza', current_popularity: 80, percentage_of_usual: 160, is_spike: true }],
});

test('emptyGauge: NO DATA is empty; a value, a stale value and LOADING are not', () => {
  assert.equal(emptyGauge({ id: 'pizza', ok: false, headline: 'NO DATA', source: 'pizzint.watch' }), true);
  assert.equal(emptyGauge({ id: 'pizza', ok: false, headline: 'LOADING', pending: true }), false);
  assert.equal(emptyGauge({ id: 'pizza', ok: true, headline: 'DEFCON 4' }), false);
  assert.equal(emptyGauge({ id: 'pizza', ok: true, stale: true, headline: 'DEFCON 4' }), false);
  assert.equal(emptyGauge(null), false);
  assert.equal(emptyGauge(undefined), false);
});

test('server: an empty feed is an empty row in /api/weird; the row stays; a full feed brings it back', async () => {
  let body = fx('pizza-empty.json');
  let t = Date.parse('2026-09-28T06:00:00Z');
  const w = makeWeird({ gauges: [pizzaGauge], lastGoodDir: null, now: () => t, fetchImpl: async () => new Response(body, { status: 200 }) });
  const first = await w.getWeird({ wait: 1000 });
  const row = first.gauges.find((g) => g.id === 'pizza');
  assert.ok(row, 'the row is still in the summary for other consumers');
  assert.equal(row.headline, 'NO DATA');
  assert.equal(emptyGauge(row), true);
  // Its own route keeps its NO DATA answer.
  assert.equal((await w.getGauge('pizza')).headline, 'NO DATA');
  // Places report again (after the hold): the row is a value, not empty.
  body = FULL;
  t += pizzaGauge.ttl + 1;
  const again = await w.getWeird({ wait: 1000 });
  const back = again.gauges.find((g) => g.id === 'pizza');
  assert.equal(back.ok, true);
  assert.equal(back.headline, 'DEFCON 4');
  assert.equal(emptyGauge(back), false);
  // The feed empties again: the last good value is served stale, so it stays shown.
  body = fx('pizza-empty.json');
  t += pizzaGauge.ttl + 1;
  await w.getWeird({ wait: 1000 });
  const kept = (await w.getWeird({ wait: 1000 })).gauges.find((g) => g.id === 'pizza');
  assert.equal(kept.ok, true);
  assert.equal(kept.stale, true);
  assert.equal(emptyGauge(kept), false);
});

function fakeNode() {
  return { hidden: false, style: { display: '' } };
}

test('showTile: leaves a tile out and puts it back (the tile CSS sets display)', () => {
  const n = fakeNode();
  showTile(n, false);
  assert.equal(n.hidden, true);
  assert.equal(n.style.display, 'none');
  showTile(n, true);
  assert.equal(n.hidden, false);
  assert.equal(n.style.display, '');
});

// The WEIRD grid on a tiny fake page: each tile node, its body, and the ctx it uses.
function fakeGrid(answers) {
  const tiles = new Map(WEIRD_GAUGES.map((g) => [g.id, { ...fakeNode(), body: { innerHTML: '' } }]));
  for (const t of tiles.values()) t.querySelector = (sel) => (sel === '.panel-body' ? t.body : null);
  const el = {
    innerHTML: '',
    querySelector(sel) {
      if (sel === '.wd-grid') return { addEventListener() {} };
      if (sel === '.wd-bar') return { innerHTML: '' };
      const m = /^#wd-t-(.+)$/.exec(sel);
      return m ? tiles.get(m[1]) || null : null;
    },
  };
  const calls = { status: [] };
  const ctx = {
    signal: { aborted: false },
    fetchJSON: async () => answers.shift(),
    setCommandHook() {},
    onCleanup() {},
    updated() {},
    status: (s) => calls.status.push(s),
    live: (fn) => { calls.load = fn; },
  };
  return { el, ctx, tiles, calls };
}
const settle = () => new Promise((r) => { setTimeout(r, 0); });
const row = (id, extra) => ({ id, ...extra });

test('WEIRD grid: an empty gauge is left out, the others show, and it comes back when it reports', async () => {
  const ok = (id) => row(id, { ok: true, headline: 'X', line: 'y', updated: '2026-09-28T06:00:00Z' });
  const rows = (pizza) => WEIRD_GAUGES.map((g) => (g.id === 'pizza' ? pizza : ok(g.id)));
  const { el, ctx, tiles, calls } = fakeGrid([
    { updated: '2026-09-28T06:00:00Z', gauges: rows(row('pizza', { ok: false, headline: 'NO DATA', source: 'pizzint.watch' })) },
    { updated: '2026-09-28T06:10:00Z', gauges: rows(row('pizza', { ok: true, headline: 'DEFCON 4', line: 'Pizza', updated: '2026-09-28T06:10:00Z' })) },
  ]);
  render(el, { name: 'WEIRD', args: {} }, ctx);
  await settle();
  assert.equal(tiles.get('pizza').style.display, 'none');
  assert.equal(tiles.get('pizza').hidden, true);
  assert.equal(calls.status.at(-1), '', 'a left-out gauge is not in the NO DATA count');
  for (const [id, t] of tiles) if (id !== 'pizza') assert.equal(t.style.display, '', id);
  calls.load();
  await settle();
  assert.equal(tiles.get('pizza').style.display, '');
  assert.equal(tiles.get('pizza').hidden, false);
  assert.match(tiles.get('pizza').body.innerHTML, /DEFCON 4/);
});

test('WEIRD grid: a gauge still LOADING is not left out', async () => {
  const { el, ctx, tiles } = fakeGrid([
    { updated: '2026-09-28T06:00:00Z', gauges: [row('pizza', { ok: false, headline: 'LOADING', pending: true })] },
  ]);
  render(el, { name: 'WEIRD', args: {} }, ctx);
  await settle();
  assert.equal(tiles.get('pizza').style.display, '');
});

test('the NO DATA tile itself is unchanged (hiding is done around it, not in it)', () => {
  const g = gaugeByCommand('PIZZA');
  const html = tileBody(g, { id: 'pizza', ok: false, headline: 'NO DATA', source: 'pizzint.watch' });
  assert.match(html, /wd-big is-none">NO DATA</);
});

test('DESK cards keep the calm NO DATA look (not left out)', () => {
  const g = gaugeByCommand('PIZZA');
  assert.match(cardBody(g, { id: 'pizza', ok: false, headline: 'NO DATA', source: 'pizzint.watch' }), /wd-big is-none">NO DATA</);
});

test('SURPRISE ME: skips a gauge with nothing to show, and picks it again once it reports', () => {
  const weird = SURPRISE_PICKS.filter((p) => p.kind === 'weird');
  for (const p of weird) assert.equal(gaugeByCommand(p.cmd)?.id, p.id, `${p.cmd} names its gauge id`);
  const rands = Array.from({ length: 400 }, (_, i) => (i * 0.61803) % 1);
  const seen = (skip) => {
    const out = new Set();
    for (const r of rands) out.add(pickSurprise(() => r, skip).cmd);
    return out;
  };
  const skip = emptyWeirdIds([row('pizza', { ok: false, headline: 'NO DATA' }), row('waffle', { ok: false, headline: 'LOADING', pending: true }), row('canal', { ok: true })]);
  assert.deepEqual([...skip], ['pizza']);
  const without = seen(skip);
  assert.ok(!without.has('PIZZA'), 'an empty gauge is never picked');
  assert.ok(without.has('WAFFLE'), 'a loading gauge still is');
  assert.ok(seen(emptyWeirdIds([row('pizza', { ok: true, headline: 'DEFCON 4' })])).has('PIZZA'), 'back once it reports');
  // Every weird gauge empty: the kind is left out, the other kinds still come up.
  const all = seen(new Set(weird.map((p) => p.id)));
  assert.ok(![...all].some((c) => weird.some((p) => p.cmd === c)));
  assert.ok(all.size > 0);
  assert.ok(seen(undefined).has('PIZZA'), 'no skip list: every pick as before');
});

test('WEIRD status count: only tiles that show NO DATA; left-out and loading ones are not counted', () => {
  assert.equal(noDataCount([row('pizza', { ok: false, headline: 'NO DATA' }), row('canal', { ok: true })]), 0);
  assert.equal(noDataCount([row('pizza', { ok: false, headline: 'LOADING', pending: true })]), 0);
  assert.equal(noDataCount([]), 0);
  assert.equal(noDataCount(undefined), 0);
});

// A fetch that answers after `ms` with /api/weird's rows, and counts its calls.
function slowFetch(ms, gauges) {
  const f = async (url, opts) => {
    f.calls.push(url);
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      opts?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
    });
    return new Response(JSON.stringify({ gauges }), { status: 200 });
  };
  f.calls = [];
  return f;
}
const pizzaEmpty = [row('pizza', { ok: false, headline: 'NO DATA' })];
const surprise = { dataset: { surprise: '1' } };
const weirdFirst = () => 0; // kind 0 is weird, pick 0 is PIZZA

test('SURPRISE ME: /api/weird is asked only on the press, and an empty gauge is skipped', async () => {
  assert.equal(SURPRISE_PICKS[0].cmd, 'PIZZA');
  assert.equal(SURPRISE_WAIT_MS, 600);
  const f = slowFetch(5, pizzaEmpty);
  assert.equal(f.calls.length, 0);
  const c = await chipChoice(surprise, weirdFirst, { fetchImpl: f });
  assert.deepEqual(f.calls, ['/api/weird']);
  assert.equal(c.surprise, 'weird');
  assert.notEqual(c.cmd, 'PIZZA');
  // A normal chip asks nothing and answers at once.
  assert.equal(typeof chipChoice({ dataset: { chip: '0' } }).then, 'undefined');
});

test('SURPRISE ME: past the wait it picks from everything, as before', async () => {
  const f = slowFetch(5000, pizzaEmpty);
  const t0 = Date.now();
  const c = await chipChoice(surprise, weirdFirst, { fetchImpl: f, waitMs: 30 });
  assert.ok(Date.now() - t0 < 1000, 'did not wait for the slow answer');
  assert.equal(c.cmd, 'PIZZA');
  assert.equal(await fetchEmptyWeird({ fetchImpl: f, waitMs: 20 }), null);
  assert.equal(await fetchEmptyWeird({ fetchImpl: async () => new Response('nope', { status: 503 }) }), null);
  assert.equal(await fetchEmptyWeird({ fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await fetchEmptyWeird({ fetchImpl: null }), null);
});

test('SURPRISE ME: a second press while it waits shares the one request', async () => {
  const f = slowFetch(10, pizzaEmpty);
  const a = chipChoice(surprise, weirdFirst, { fetchImpl: f });
  const b = chipChoice(surprise, weirdFirst, { fetchImpl: f });
  assert.equal(a, b);
  await a;
  assert.equal(f.calls.length, 1);
});
