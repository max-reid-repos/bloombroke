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
//
// History (data/weird/history.js): a gauge's past readings, for the period row, the big
// chart, the grid sparks and the record line. Optional parts of a gauge module:
//   value.hist        built by load() from what it fetched anyway (recent or full)
//   history(get, { now, prev })  the deep past, fetched rarely: historyTtl (default 7
//             days; historyRetryMs after a failure or while `complete: false`), kept in
//             data/.cache/weird/<id>.history.json with its own hold file
//   snapshot(value) -> { key: number }  for a source that keeps no past: one reading per
//             UTC day is recorded (snapshotSeries names the keys, the first is the lead)
//   recordPoints(hist) -> [{ d, v }]  what the record line reads (default: the lead)
//   record = false    no record line (the headline is not a number that has one)
//   defaultPeriod     the period a gauge screen opens on (default 1Y)

import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceClient, isoDay } from './source.js';
import {
  historyStore, snapshotStore, snapshotHist, mergeHist, periodInfo, pickPeriod, sliceHist, sparkFor,
  recordLine, leadPoints, hasHist, RECORDING_UNTIL,
} from './history.js';
import { WEIRD_PERIODS, periodWord } from '../../public/screens/weird-gauges.js';
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
// Upkeep after boot: every TICK_MS one step of history and daily-reading work (at most one
// history fetch and one snapshot-gauge fetch at a time), so no source is hit in a burst.
export const TICK_MS = 60_000;
export const HISTORY_TTL = 7 * 24 * 60 * 60_000;
export const HISTORY_RETRY = 6 * 60 * 60_000;

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

// dir -> { read(id), write(id, value, fetchedAt), readHold(id), writeHold(id, until) }.
// No dir: a store that keeps nothing. A file is read from disk once; after that the copy
// in memory is used (and kept in step with every write), so a remembered failure does not
// re-read the file per request. A hold (<id>.hold.json: no fetch before `until`, after a
// failure) survives a restart, so repeated deploys do not spend a source's daily quota
// (BLS allows 25 a day); writeHold(id, 0) removes it.
export function lastGoodStore(dir) {
  if (!dir) return { read: () => null, write: () => {}, readHold: () => 0, writeHold: () => {} };
  const holdFile = (id) => path.join(dir, `${id}.hold.json`);
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
    readHold(id) {
      try {
        const until = JSON.parse(readFileSync(holdFile(id), 'utf8'))?.until;
        return Number.isFinite(until) ? until : 0;
      } catch {
        return 0;
      }
    },
    writeHold(id, until) {
      try {
        if (!(until > 0)) { rmSync(holdFile(id), { force: true }); return; }
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${holdFile(id)}.tmp`, JSON.stringify({ until }));
        renameSync(`${holdFile(id)}.tmp`, holdFile(id));
      } catch (err) {
        console.error(`[weird:${id}] hold not saved:`, err.message);
      }
    },
  };
}

export function summarize(detail) {
  if (!detail.ok) return detail;
  const out = { id: detail.id, ok: true, stale: detail.stale, updated: detail.updated };
  for (const k of SUMMARY_KEYS) if (detail[k] !== undefined) out[k] = detail[k];
  if (detail.record) out.record = detail.record;
  // ALERTS: a gauge's headline number, only where the gauge gives it a unit.
  if (Number.isFinite(detail.value) && detail.unit) { out.value = detail.value; out.unit = detail.unit; }
  return out;
}

export function makeWeird({ fetchImpl = globalThis.fetch, now = Date.now, gauges = GAUGES, lastGoodDir = LAST_GOOD_DIR } = {}) {
  const get = sourceClient(fetchImpl);
  const store = lastGoodStore(lastGoodDir);
  const hstore = historyStore(lastGoodDir);
  const days = snapshotStore(lastGoodDir ? path.join(lastGoodDir, 'days') : null);
  // id -> { value, fetchedAt }: the newest good value, from disk at boot, then each refresh.
  const latest = new Map();
  for (const g of gauges) { const l = store.read(g.id); if (l) latest.set(g.id, l); }
  const inflight = new Map(); // id -> the one refresh running for that gauge
  // id -> no new refresh before this time (after a failure); from disk at boot too.
  const holdUntil = new Map();
  for (const g of gauges) { const h = store.readHold(g.id); if (h > now()) holdUntil.set(g.id, h); }
  const held = (g) => now() < (holdUntil.get(g.id) || 0);
  const queued = new Set(); // ids the boot pre-warm will refresh soon: a request leaves them to it

  // ---- History and daily readings (see data/weird/history.js) ----
  // id -> { hist, fetchedAt }: the deep past from g.history(), from disk at boot.
  const deep = new Map();
  for (const g of gauges) { if (!g.history) continue; const h = hstore.read(g.id); if (h) deep.set(g.id, h); }
  const histKey = (g) => `${g.id}.history`;
  const histHold = new Map();
  for (const g of gauges) { if (!g.history) continue; const h = store.readHold(histKey(g)); if (h > now()) histHold.set(g.id, h); }
  const histInflight = new Map();
  let daysVersion = 0;

  // Keep the first reading of the value's own UTC day (a snapshot gauge only).
  function snap(g, got) {
    if (!g.snapshot || !got?.value) return;
    let reading = null;
    try { reading = g.snapshot(got.value); } catch { reading = null; }
    if (days.record(g.id, isoDay(got.fetchedAt), reading)) daysVersion += 1;
  }
  for (const g of gauges) { const l = latest.get(g.id); if (l) snap(g, l); }

  const historyDue = (g) => {
    const h = deep.get(g.id);
    if (!h) return true;
    const ttl = h.hist.complete === false ? (g.historyRetryMs || HISTORY_RETRY) : (g.historyTtl || HISTORY_TTL);
    return now() - h.fetchedAt >= ttl;
  };
  const historyHeld = (g) => now() < (histHold.get(g.id) || 0);

  // Fetch a gauge's deep past, one at a time per gauge. A failure holds it for
  // historyRetryMs (on disk too, so repeated deploys do not spend a quota). Never rejects.
  function refreshHistory(g) {
    if (!g.history) return Promise.resolve(null);
    if (histInflight.has(g.id)) return histInflight.get(g.id);
    if (historyHeld(g)) return Promise.resolve(null);
    const p = (async () => {
      try {
        const hist = await g.history(get, { now, prev: deep.get(g.id)?.hist || null });
        if (!hasHist(hist)) throw Object.assign(new Error('empty history'), { code: 'no_data' });
        const got = { hist, fetchedAt: now() };
        deep.set(g.id, got);
        hstore.write(g.id, hist, got.fetchedAt);
        if (histHold.delete(g.id)) store.writeHold(histKey(g), 0);
        return got;
      } catch (err) {
        console.error(`[weird:${g.id}] history:`, err?.message || err);
        const until = now() + (g.historyRetryMs || HISTORY_RETRY);
        histHold.set(g.id, until);
        store.writeHold(histKey(g), until);
        return null;
      } finally {
        histInflight.delete(g.id);
      }
    })();
    histInflight.set(g.id, p);
    return p;
  }

  // The whole history of a gauge (deep past under the latest value's own, or the daily
  // readings), worked out once per change and kept.
  const memo = new Map();
  function fullHist(g) {
    const l = latest.get(g.id);
    const dp = deep.get(g.id);
    const key = `${l?.fetchedAt}|${dp?.fetchedAt}|${g.snapshot ? daysVersion : ''}`;
    const hit = memo.get(g.id);
    if (hit && hit.key === key) return hit;
    let hist = null;
    if (g.snapshot) hist = snapshotHist(days.read(g.id), g.snapshotSeries);
    else hist = mergeHist(dp?.hist, l?.value?.hist);
    const first = g.snapshot ? days.read(g.id)[0]?.[0] || null : null;
    const periods = periodInfo(hist, { recordingSince: first });
    let record = null;
    if (g.record !== false && hist) {
      try { record = recordLine(g.recordPoints ? g.recordPoints(hist) : leadPoints(hist)); } catch { record = null; }
    }
    const out = {
      key, hist, periods, record,
      recording: first && !periods[RECORDING_UNTIL].ok ? { since: first } : null,
    };
    memo.set(g.id, out);
    return out;
  }

  // A gauge answer plus its history view: the readings for one period (hist), which
  // periods are on (periods), the one shown (period), the record line and, for a
  // snapshot gauge still filling up, when recording started.
  function withHistory(g, detail, asked) {
    if (!detail?.ok) return detail;
    const f = fullHist(g);
    const period = pickPeriod(f.periods, asked, g.defaultPeriod || '1Y');
    const { hist: _full, ...rest } = detail;
    return {
      ...rest,
      hist: sliceHist(f.hist, period),
      period,
      periods: f.periods,
      record: f.record,
      ...(f.recording ? { recording: f.recording } : {}),
    };
  }

  // One step of upkeep: record today's reading where one is in memory, fetch one snapshot
  // gauge that has none for today, and start one deep-history fetch that is due.
  function tick() {
    const today = isoDay(now());
    for (const g of gauges) { const l = latest.get(g.id); if (l) snap(g, l); }
    const need = gauges.find((g) => g.snapshot && !days.has(g.id, today) && !queued.has(g.id) && !held(g) && !inflight.has(g.id));
    if (need) refresh(need);
    if (!histInflight.size) {
      const due = gauges.find((g) => g.history && !historyHeld(g) && historyDue(g));
      if (due) refreshHistory(due);
    }
  }

  const shape = (g, value, stale, fetchedAt) => ({ id: g.id, ok: true, ...value, stale, updated: new Date(fetchedAt).toISOString() });
  const find = (name) => gauges.find((x) => x.id === String(name ?? '').toLowerCase()) || null;
  const isFresh = (g, last) => now() - last.fetchedAt < g.ttl;

  // Fetch a gauge now and keep the value (memory and disk). One in flight per gauge: a
  // second call gets the same promise. After a failure no new fetch starts for retryMs
  // (an empty answer: for the ttl). Never rejects: it resolves { value, fetchedAt } when a
  // new value came, else null.
  function refresh(g) {
    if (inflight.has(g.id)) return inflight.get(g.id);
    if (held(g)) return Promise.resolve(null);
    const p = (async () => {
      try {
        const value = await g.load(get, { now });
        if (!value || !value.headline) throw Object.assign(new Error('empty'), { code: 'no_data' });
        const got = { value, fetchedAt: now() };
        latest.set(g.id, got);
        store.write(g.id, value, got.fetchedAt);
        snap(g, got);
        if (holdUntil.delete(g.id)) store.writeHold(g.id, 0);
        return got;
      } catch (err) {
        if (err?.code !== 'no_data') console.error(`[weird:${g.id}]`, err?.message || err);
        const until = now() + (err?.code === 'no_data' ? g.ttl : g.retryMs || 5 * 60_000);
        holdUntil.set(g.id, until);
        store.writeHold(g.id, until);
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
  // period: '3M' .. 'MAX' for the history view (an unknown or missing one gives the
  // gauge's default); the answer never carries the whole history.
  async function getGauge(name, { wait = Infinity, period = null } = {}) {
    const g = find(name);
    if (!g) return null;
    return withHistory(g, await rawGauge(g, wait), periodWord(period));
  }

  async function rawGauge(g, wait) {
    const last = latest.get(g.id);
    if (last) {
      if (!isFresh(g, last) && !queued.has(g.id)) refresh(g);
      return current(g);
    }
    // Its pre-warm turn has not come: no fetch of its own, so a cold start never hits
    // every source at once.
    if (queued.has(g.id)) return noData(g, { headline: 'LOADING', pending: true });
    // A value that just came is fresh, however short the ttl.
    const done = refresh(g).then((got) => (got ? shape(g, got.value, false, got.fetchedAt) : current(g) || noData(g)));
    if (!Number.isFinite(wait)) return done;
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(resolve, wait, noData(g, { headline: 'LOADING', pending: true })); timer.unref?.(); });
    return Promise.race([done, late]).finally(() => clearTimeout(timer));
  }

  // Every gauge at once, each within `wait` ms (see getGauge). period: '3M' .. 'MAX' puts
  // each tile's spark on that period (from its history; [] when it has none there);
  // none (AUTO) keeps each gauge's own spark. periods: which periods any gauge covers.
  async function getWeird({ wait = SUMMARY_WAIT, period = null } = {}) {
    const p = periodWord(period);
    const rows = await Promise.all(gauges.map((g) => rawGauge(g, wait)));
    // Stale when every gauge that has a value is showing a last good one.
    const good = rows.filter((r) => r.ok);
    const periods = Object.fromEntries(WEIRD_PERIODS.map((x) => [x, { ok: false, title: 'No gauge covers this yet' }]));
    const out = rows.map((r, i) => {
      const g = gauges[i];
      const row = { ...summarize(r), ttl: g.ttl };
      if (!r.ok) return row;
      const f = fullHist(g);
      for (const x of WEIRD_PERIODS) if (f.periods[x].ok) periods[x] = { ok: true, title: '' };
      if (f.record) row.record = f.record;
      // A period longer than the gauge's past draws all of it (as its own screen does);
      // one with too few readings in it (twice-a-year data at 3M) draws nothing.
      if (p) {
        const info = f.periods[p];
        const shown = info.ok ? p : /^Too few readings in/.test(info.title) ? null : 'MAX';
        row.spark = shown ? sparkFor(f.hist, shown) : [];
        if (row.spark.length < 3) row.spark = [];
        if (shown && shown !== p && f.hist?.d?.length) row.sparkFrom = f.hist.d[0];
      }
      return row;
    });
    // ttl: DESK cards fetch this summary again when their gauge is due.
    return { gauges: out, period: p || 'AUTO', periods, updated: new Date(now()).toISOString(), stale: good.length > 0 && good.every((r) => r.stale) };
  }

  // Boot pre-warm: refresh every gauge that has no value or an expired one, gauges with
  // no value first, one started every gapMs. Until its turn, a request serves a queued
  // gauge's last good value (or pending) without starting a fetch of its own, so a burst
  // of visitors right after a deploy does not hit every source at once. A gauge still on
  // hold after a failure is left out. Returns a stop function.
  function startPrewarm({ gapMs = PREWARM_GAP_MS, tickMs = TICK_MS } = {}) {
    // A value saved before its gauge built a history (value.hist) is fetched again too,
    // so the period row and the record line do not wait a whole ttl after a deploy.
    // (Every gauge whose load() builds one names a defaultPeriod.)
    const noHist = (g, l) => Boolean(g.defaultPeriod && !g.snapshot && !l.value.hist);
    const due = gauges.filter((g) => { const l = latest.get(g.id); return !held(g) && (!l || !isFresh(g, l) || noHist(g, l)); });
    due.sort((a, b) => Number(latest.has(a.id)) - Number(latest.has(b.id)));
    for (const g of due) queued.add(g.id);
    const timers = due.map((g, i) => {
      const t = setTimeout(() => { queued.delete(g.id); refresh(g); }, i * gapMs);
      t.unref?.();
      return t;
    });
    // Upkeep starts once the pre-warm is through, then runs every tickMs.
    let upkeep = null;
    const start = setTimeout(() => { tick(); upkeep = setInterval(tick, tickMs); upkeep.unref?.(); }, due.length * gapMs + tickMs);
    start.unref?.();
    return () => { timers.forEach(clearTimeout); clearTimeout(start); clearInterval(upkeep); due.forEach((g) => queued.delete(g.id)); };
  }

  return {
    getGauge, getWeird, startPrewarm, tick, refreshHistory,
    refreshing: (id) => inflight.has(id),
    historyOf: (id) => { const g = find(id); return g ? fullHist(g) : null; },
  };
}

const weird = makeWeird();
export const { getGauge, getWeird } = weird;
export const startWeirdPrewarm = (opts) => weird.startPrewarm(opts);
