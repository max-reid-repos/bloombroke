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

export const GAUGES = [canal, pizza, degen, waffle, panic, hiring, hotdog, omens, undies, bigmac];

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

export function summarize(detail) {
  if (!detail.ok) return detail;
  const out = { id: detail.id, ok: true, stale: detail.stale, updated: detail.updated };
  for (const k of SUMMARY_KEYS) if (detail[k] !== undefined) out[k] = detail[k];
  return out;
}

export function makeWeird({ fetchImpl = globalThis.fetch, now = Date.now, gauges = GAUGES } = {}) {
  const get = sourceClient(fetchImpl);
  const caches = new Map(gauges.map((g) => [g.id, createCache({ retryMs: g.retryMs || 5 * 60_000, now })]));

  // Never throws: a failed or empty source gives the NO DATA shape.
  async function getGauge(name) {
    const g = gauges.find((x) => x.id === String(name ?? '').toLowerCase());
    if (!g) return null;
    try {
      const { value, stale, fetchedAt } = await caches.get(g.id).cached(g.id, g.ttl, () => g.load(get, { now }));
      if (!value || !value.headline) return noData(g);
      return { id: g.id, ok: true, ...value, stale, updated: new Date(fetchedAt).toISOString() };
    } catch (err) {
      if (err?.code !== 'no_data') console.error(`[weird:${g.id}]`, err?.message || err);
      return noData(g);
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
    return { gauges: rows.map(summarize), updated: new Date(now()).toISOString() };
  }

  return { getGauge, getWeird };
}

export const { getGauge, getWeird } = makeWeird();
