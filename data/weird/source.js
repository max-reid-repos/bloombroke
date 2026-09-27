// Shared fetch helpers for the WEIRD gauges. Every request names us in the
// User-Agent (some sources refuse anonymous ones) and gives up after a timeout.

import { cappedFetch } from '../http.js';

export const UA = 'Bloombroke/1.0 (hello@bloombroke.com)';
export const TIMEOUT = 8000;

// A source answered, but with nothing to show: the tile says NO DATA.
export class NoData extends Error {
  constructor(message = 'no data') {
    super(message);
    this.code = 'no_data';
  }
}

// Largest body we read from any source. Past it the request is aborted.
export const MAX_BYTES = 5 * 1024 * 1024;

// A response body as text, read in chunks and cut off past `cap` bytes. A declared
// content-length over the cap is refused before reading.
export async function readCapped(res, cap = MAX_BYTES, abort = null) {
  const host = (() => { try { return new URL(res.url).host; } catch { return 'source'; } })();
  const declared = Number(res.headers?.get?.('content-length'));
  const tooBig = () => {
    abort?.abort();
    return new Error(`${host}: response over ${Math.round(cap / 1024 / 1024)} MB`);
  };
  if (Number.isFinite(declared) && declared > cap) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    throw tooBig();
  }
  if (!res.body?.getReader) {
    const t = await res.text();
    if (Buffer.byteLength(t) > cap) throw tooBig();
    return t;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw tooBig();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString('utf8');
}

// fetchImpl -> { text(url, opts), json(url, opts) }. opts: { timeout, headers, accept,
// maxBytes, method, body } (method and body: for the few sources that take a POST, BLS).
export function sourceClient(fetchImpl = cappedFetch) {
  async function get(url, { timeout = TIMEOUT, headers = {}, accept = '*/*', maxBytes = MAX_BYTES, method, body } = {}) {
    const abort = new AbortController();
    const res = await fetchImpl(url, {
      ...(method ? { method } : {}),
      ...(body !== undefined ? { body } : {}),
      headers: { 'User-Agent': UA, Accept: accept, ...headers },
      signal: AbortSignal.any([AbortSignal.timeout(timeout), abort.signal]),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
    return readCapped(res, maxBytes, abort);
  }
  return {
    text: (url, opts) => get(url, opts),
    json: async (url, opts) => JSON.parse(await get(url, { accept: 'application/json', ...opts })),
  };
}

// Small shared helpers.
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// +12% / −12% (a true minus sign, as elsewhere on the site). 0 has no sign.
// ALERTS: the number a headline shows, as a number: the same rounding as signedPct and
// toFixed (half away from zero on the digits shown), so -2.25 is -2.3 like its headline.
export function headlineNumber(v, decimals = 1) {
  if (!Number.isFinite(v)) return null;
  const n = Number(Math.abs(v).toFixed(decimals));
  return n === 0 ? 0 : Math.sign(v) * n;
}

export function signedPct(v, decimals = 1) {
  if (!Number.isFinite(v)) return '--';
  const s = Math.abs(v).toFixed(decimals);
  if (Number(s) === 0) return `${s}%`;
  return `${v > 0 ? '+' : '−'}${s}%`;
}

// Run fn(item) for every item, at most `limit` at a time, with at least `gapMs` between
// starts (for sources with a request-rate rule, like SEC EDGAR). Results in item order;
// the first failure rejects.
export async function pool(items, limit, fn, gapMs = 0) {
  const out = new Array(items.length);
  let next = 0;
  let slot = 0;
  const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      const at = Math.max(Date.now(), slot);
      slot = at + gapMs;
      if (at > Date.now()) await wait(at - Date.now());
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        next = items.length; // stop the other workers too
        throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// '&amp;' and friends in a plain-text field -> the characters. The screen escapes again.
export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|ndash|mdash);/g, (_, k) => ({
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-',
    }[k]));
}
