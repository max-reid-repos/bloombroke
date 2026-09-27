// The per-ticker news log: every headline about a company that NEWS <ticker> fetched,
// kept on disk so WHY can show what came out on a day long after the feed dropped it.
//
// One JSON file per ticker under data/.cache/newslog/ (gitignored, so a deploy's git
// pull never touches it). Each row is { time, source, title, url }, newest first, one
// copy per story, at most LOG_CAP per ticker. Writes go to a temp file and are renamed
// into place, one at a time per ticker; a write that fails is logged and skipped (the
// log is extra, the screens never wait on it).

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { titleKey } from './news.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOG_DIR = path.join(root, 'data', '.cache', 'newslog');
export const LOG_CAP = 400;

const SAFE = /^[A-Z0-9][A-Z0-9.^=-]{0,15}$/;
const httpUrl = (u) => {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
  } catch {
    return null;
  }
};

// A feed item -> a log row, or null when it lacks a time, a title or a web link.
export function logRow(n) {
  const t = Date.parse(n?.time || '');
  const url = httpUrl(n?.url || n?.link);
  const title = String(n?.title || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!Number.isFinite(t) || !url || !title) return null;
  return { time: new Date(t).toISOString(), source: String(n.source || '').slice(0, 60), title, url };
}

const rowKey = (r) => `t:${titleKey(r.title)}`;

// Old rows plus new ones: one copy per story (the first seen keeps its time), newest
// first, capped. Returns { rows, added } (added: how many were not there before).
export function mergeLog(old, incoming, cap = LOG_CAP) {
  const byKey = new Map();
  for (const r of old || []) {
    const row = logRow(r);
    if (row && !byKey.has(rowKey(row))) byKey.set(rowKey(row), row);
  }
  let added = 0;
  for (const n of incoming || []) {
    const row = logRow(n);
    if (!row || byKey.has(rowKey(row))) continue;
    byKey.set(rowKey(row), row);
    added += 1;
  }
  const rows = [...byKey.values()].sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0)).slice(0, cap);
  return { rows, added };
}

export function makeNewsLog({ dir = LOG_DIR, cap = LOG_CAP, maxOpen = 300 } = {}) {
  const open = new Map(); // ticker -> Promise<rows>, least recently used first
  const chains = new Map(); // ticker -> the write queue
  const file = (t) => path.join(dir, `${t}.json`);

  function load(ticker) {
    if (open.has(ticker)) {
      const p = open.get(ticker);
      open.delete(ticker);
      open.set(ticker, p);
      return p;
    }
    const p = readFile(file(ticker), 'utf8').then((s) => {
      const body = JSON.parse(s);
      return Array.isArray(body?.rows) ? mergeLog(body.rows, [], cap).rows : [];
    }).catch(() => []);
    open.set(ticker, p);
    while (open.size > maxOpen) open.delete(open.keys().next().value);
    return p;
  }

  // The ticker's rows, newest first ([] when there are none yet).
  async function read(rawTicker) {
    const ticker = String(rawTicker || '').toUpperCase();
    if (!SAFE.test(ticker)) return [];
    return load(ticker);
  }

  // Add headlines to a ticker's log. Resolves to how many were new; never throws.
  function record(rawTicker, items) {
    const ticker = String(rawTicker || '').toUpperCase();
    if (!SAFE.test(ticker) || !items?.length) return Promise.resolve(0);
    const prev = chains.get(ticker) || Promise.resolve();
    const run = prev.then(async () => {
      const old = await load(ticker);
      const { rows, added } = mergeLog(old, items, cap);
      if (!added) return 0;
      open.set(ticker, Promise.resolve(rows));
      await mkdir(dir, { recursive: true });
      const tmp = `${file(ticker)}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, JSON.stringify({ ticker, rows }));
      await rename(tmp, file(ticker));
      return added;
    }).catch((err) => {
      console.error('[newslog]', ticker, err.message);
      return 0;
    });
    chains.set(ticker, run);
    run.finally(() => { if (chains.get(ticker) === run) chains.delete(ticker); });
    return run;
  }

  return { read, record };
}

export const newsLog = makeNewsLog();
