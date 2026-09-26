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
// (gitignored). When a source fails or is empty and memory has nothing (after a restart,
// say), that file is served with stale: true and its own as-of date. NO DATA only when
// there has never been a good value.

import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCache } from '../cache.js';
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

// How long the summary waits for one gauge before it says "pending".
export const SUMMARY_WAIT = 9000;

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
  const saved = new Map();
  const caches = new Map(gauges.map((g) => [g.id, createCache({ retryMs: g.retryMs || 5 * 60_000, now })]));

  const shape = (g, value, stale, fetchedAt) => ({ id: g.id, ok: true, ...value, stale, updated: new Date(fetchedAt).toISOString() });

  // Never throws: a failed or empty source gives the last good value (stale), or the
  // NO DATA shape when there is none.
  async function getGauge(name) {
    const g = gauges.find((x) => x.id === String(name ?? '').toLowerCase());
    if (!g) return null;
    try {
      const { value, stale, fetchedAt } = await caches.get(g.id).cached(g.id, g.ttl, () => g.load(get, { now }));
      if (!value || !value.headline) throw Object.assign(new Error('empty'), { code: 'no_data' });
      if (!stale && saved.get(g.id) !== fetchedAt) {
        saved.set(g.id, fetchedAt);
        store.write(g.id, value, fetchedAt);
      }
      return shape(g, value, stale, fetchedAt);
    } catch (err) {
      if (err?.code !== 'no_data') console.error(`[weird:${g.id}]`, err?.message || err);
      const last = store.read(g.id);
      return last ? shape(g, last.value, true, last.fetchedAt) : noData(g);
    }
  }

  // Every gauge at once. One that takes longer than `wait` comes back pending (its
  // fetch goes on, and the screen asks for it on its own).
  async function getWeird({ wait = SUMMARY_WAIT } = {}) {
    const rows = await Promise.all(gauges.map((g) => {
      let timer;
      const late = new Promise((resolve) => { timer = setTimeout(resolve, wait, noData(g, { headline: 'LOADING', pending: true })); timer.unref?.(); });
      return Promise.race([getGauge(g.id), late]).finally(() => clearTimeout(timer));
    }));
    // Stale when every gauge that has a value is showing a last good one.
    const good = rows.filter((r) => r.ok);
    // ttl: DESK cards fetch this summary again when their gauge is due.
    return { gauges: rows.map((r, i) => ({ ...summarize(r), ttl: gauges[i].ttl })), updated: new Date(now()).toISOString(), stale: good.length > 0 && good.every((r) => r.stale) };
  }

  return { getGauge, getWeird };
}

export const { getGauge, getWeird } = makeWeird();
