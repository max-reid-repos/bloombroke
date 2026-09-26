// WEIRD: odd live gauges, one module per gauge in this folder.
//
// A gauge module exports:
//   id        the API name (/api/weird/<id>), lower case
//   source    the source name shown on NO DATA
//   ttl       how long a result is kept, ms (retryMs: optional wait after a failure)
//   load(get, { now })  fetches and returns { headline, line, spark, asOf, source,
//             credit?, ...detail }. get = sourceClient(): get.json(url), get.text(url).
//   Parsers are exported on their own so tests can run them on fixtures.
//
// To add a gauge: write the module, add it to GAUGES below, add its command to
// public/registry.js and its screen entry to public/screens/weird-gauges.js.
//
// Last good value: each successful result is also written to data/.cache/weird/<id>.json
// (gitignored), and every file there is read into memory at boot. A request never waits
// on a source when there is a value: a value younger than the gauge's ttl is served as
// is, an older one is served at once with stale: true (its own as-of date) while one
// background refresh per gauge fetches a new one. Only a gauge with no value anywhere
// waits (briefly) and then says pending. NO DATA only when there has never been a good
// value and the source failed.

import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceClient } from './source.js';
import * as canal from './canal.js';
import * as pizza from './pizza.js';
import * as degen from './degen.js';
import * as waffle from './waffle.js';
import * as panic from './panic.js';
import * as hiring from './hiring.js';
import * as hotdog from './hotdog.js';
import * as omens from './omens.js';
import * as undies from './undies.js';
import * as bigmac from './bigmac.js';
import * as billions from './billions.js';
import * as wsb from './wsb.js';
import * as odds from './odds.js';
import * as boxrate from './boxrate.js';
import * as eggs from './eggs.js';
import * as rides from './rides.js';
import * as buzz from './buzz.js';
import * as beige from './beige.js';
import * as trucks from './trucks.js';
import * as boxes from './boxes.js';
import * as lipstick from './lipstick.js';
import * as sick from './sick.js';
import * as macau from './macau.js';

// Tile order: the first ten (phase 3a), then the rest, most fun first.
export const GAUGES = [
  canal, pizza, degen, waffle, panic, hiring, hotdog, omens, undies, bigmac,
  billions, wsb, odds, boxrate, eggs, rides, buzz, beige, trucks, boxes, lipstick, sick, macau,
];

// How long /api/weird and /api/weird/<id> wait for a gauge that has no value at all
// before it says "pending". A gauge with any value never waits.
export const FAST_WAIT = 250;
export const SUMMARY_WAIT = FAST_WAIT;
// Boot pre-warm: one gauge started every PREWARM_GAP_MS, so the sources (SEC EDGAR
// above all) are not hit at once after a restart.
export const PREWARM_GAP_MS = 1500;

const SUMMARY_KEYS = ['headline', 'line', 'spark', 'asOf', 'source', 'credit'];

export function gaugeById(name) {
  const k = String(name ?? '').trim().toLowerCase();
  return GAUGES.find((g) => g.id === k) || null;
}

// What a tile shows when its source failed or had nothing.
export function noData(g, extra = {}) {
  return { id: g.id, ok: false, headline: 'NO DATA', source: g.source, ...extra };
}

export const LAST_GOOD_DIR = fileURLToPath(new URL('../.cache/weird/', import.meta.url));

// dir -> { read(id), write(id, value, fetchedAt) }. No dir: a store that keeps nothing.
// A file is read from disk once; after that the copy in memory is used (and kept in
// step with every write), so a remembered failure does not re-read the file per request.
export function lastGoodStore(dir) {
  if (!dir) return { read: () => null, write: () => {} };
  const file = (id) => path.join(dir, `${id}.json`);
  const mem = new Map();
  return {
    read(id) {
      if (mem.has(id)) return mem.get(id);
      let got = null;
      try {
        const j = JSON.parse(readFileSync(file(id), 'utf8'));
        got = j?.value?.headline && Number.isFinite(j.fetchedAt) ? j : null;
      } catch {
        got = null;
      }
      mem.set(id, got);
      return got;
    },
    write(id, value, fetchedAt) {
      mem.set(id, { fetchedAt, value });
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${file(id)}.tmp`, JSON.stringify({ fetchedAt, value }));
        renameSync(`${file(id)}.tmp`, file(id));
      } catch (err) {
        console.error(`[weird:${id}] last good not saved:`, err.message);
      }
    },
  };
}

export function summarize(detail) {
  if (!detail.ok) return detail;
  const out = { id: detail.id, ok: true, stale: detail.stale, updated: detail.updated };
  for (const k of SUMMARY_KEYS) if (detail[k] !== undefined) out[k] = detail[k];
  // ALERTS: a gauge's headline number, only where the gauge gives it a unit.
  if (Number.isFinite(detail.value) && detail.unit) { out.value = detail.value; out.unit = detail.unit; }
  return out;
}

export function makeWeird({ fetchImpl = globalThis.fetch, now = Date.now, gauges = GAUGES, lastGoodDir = LAST_GOOD_DIR } = {}) {
  const get = sourceClient(fetchImpl);
  const store = lastGoodStore(lastGoodDir);
  // id -> { value, fetchedAt }: the newest good value, from disk at boot, then each refresh.
  const latest = new Map();
  for (const g of gauges) { const l = store.read(g.id); if (l) latest.set(g.id, l); }
  const inflight = new Map(); // id -> the one refresh running for that gauge
  const holdUntil = new Map(); // id -> no new refresh before this time (after a failure)
  const queued = new Set(); // ids the boot pre-warm will refresh soon: a request leaves them to it

  const shape = (g, value, stale, fetchedAt) => ({ id: g.id, ok: true, ...value, stale, updated: new Date(fetchedAt).toISOString() });
  const find = (name) => gauges.find((x) => x.id === String(name ?? '').toLowerCase()) || null;
  const isFresh = (g, last) => now() - last.fetchedAt < g.ttl;

  // Fetch a gauge now and keep the value (memory and disk). One in flight per gauge: a
  // second call gets the same promise. After a failure no new fetch starts for retryMs
  // (an empty answer: for the ttl). Never rejects: it resolves { value, fetchedAt } when a
  // new value came, else null.
  function refresh(g) {
    if (inflight.has(g.id)) return inflight.get(g.id);
    if (now() < (holdUntil.get(g.id) || 0)) return Promise.resolve(null);
    const p = (async () => {
      try {
        const value = await g.load(get, { now });
        if (!value || !value.headline) throw Object.assign(new Error('empty'), { code: 'no_data' });
        const got = { value, fetchedAt: now() };
        latest.set(g.id, got);
        store.write(g.id, value, got.fetchedAt);
        holdUntil.delete(g.id);
        return got;
      } catch (err) {
        if (err?.code !== 'no_data') console.error(`[weird:${g.id}]`, err?.message || err);
        holdUntil.set(g.id, now() + (err?.code === 'no_data' ? g.ttl : g.retryMs || 5 * 60_000));
        return null;
      } finally {
        inflight.delete(g.id);
      }
    })();
    inflight.set(g.id, p);
    return p;
  }

  // The gauge as the API shows it: the latest value, stale when older than its ttl.
  function current(g) {
    const last = latest.get(g.id);
    return last ? shape(g, last.value, !isFresh(g, last), last.fetchedAt) : null;
  }

  // Never throws. With a value: answers at once (a value past its ttl starts a background
  // refresh and is served stale meanwhile). With none: waits for the source up to `wait`
  // ms, then says pending (the fetch goes on); a failed source gives NO DATA.
  async function getGauge(name, { wait = Infinity } = {}) {
    const g = find(name);
    if (!g) return null;
    const last = latest.get(g.id);
    if (last) {
      if (!isFresh(g, last) && !queued.has(g.id)) refresh(g);
      return current(g);
    }
    // A value that just came is fresh, however short the ttl.
    const done = refresh(g).then((got) => (got ? shape(g, got.value, false, got.fetchedAt) : current(g) || noData(g)));
    if (!Number.isFinite(wait)) return done;
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(resolve, wait, noData(g, { headline: 'LOADING', pending: true })); timer.unref?.(); });
    return Promise.race([done, late]).finally(() => clearTimeout(timer));
  }

  // Every gauge at once, each within `wait` ms (see getGauge).
  async function getWeird({ wait = SUMMARY_WAIT } = {}) {
    const rows = await Promise.all(gauges.map((g) => getGauge(g.id, { wait })));
    // Stale when every gauge that has a value is showing a last good one.
    const good = rows.filter((r) => r.ok);
    // ttl: DESK cards fetch this summary again when their gauge is due.
    return { gauges: rows.map((r, i) => ({ ...summarize(r), ttl: gauges[i].ttl })), updated: new Date(now()).toISOString(), stale: good.length > 0 && good.every((r) => r.stale) };
  }

  // Boot pre-warm: refresh every gauge that has no value or an expired one, gauges with
  // no value first, one started every gapMs. Until its turn, a request serves a queued
  // gauge's last good value without starting a fetch of its own, so a burst of visitors
  // right after a deploy does not hit every source at once. Returns a stop function.
  function startPrewarm({ gapMs = PREWARM_GAP_MS } = {}) {
    const due = gauges.filter((g) => { const l = latest.get(g.id); return !l || !isFresh(g, l); });
    due.sort((a, b) => Number(latest.has(a.id)) - Number(latest.has(b.id)));
    for (const g of due) queued.add(g.id);
    const timers = due.map((g, i) => {
      const t = setTimeout(() => { queued.delete(g.id); refresh(g); }, i * gapMs);
      t.unref?.();
      return t;
    });
    return () => { timers.forEach(clearTimeout); due.forEach((g) => queued.delete(g.id)); };
  }

  return { getGauge, getWeird, startPrewarm, refreshing: (id) => inflight.has(id) };
}

const weird = makeWeird();
export const { getGauge, getWeird } = weird;
export const startWeirdPrewarm = (opts) => weird.startPrewarm(opts);
