// Currency conversion and 30-day history from the Frankfurter API (ECB reference rates, no key).

import { createCache } from './cache.js';

const BASE = 'https://api.frankfurter.dev/v1';
const SERIES_TTL = 60 * 60_000;
const CURRENCIES_TTL = 24 * 60 * 60_000;
export const FX_EXAMPLES = ['FX 500 USD THB', 'FX 100 EUR USD', 'FX 20000 JPY GBP', 'FX USD CAD'];

export class FxError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

export function normalizeCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

export function isCodeShape(code) {
  return /^[A-Z]{3}$/.test(code);
}

export function parseAmount(raw) {
  if (raw === undefined || raw === null || raw === '') return 1;
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1e15) return NaN;
  return n;
}

export function convert(amount, rate) {
  return amount * rate;
}

// Frankfurter series { "YYYY-MM-DD": { THB: 33.4 } } -> [{ d, v }] sorted by date.
export function shapeSeries(rates, to) {
  return Object.entries(rates || {})
    .map(([d, r]) => ({ d, v: r?.[to] }))
    .filter((p) => Number.isFinite(p.v))
    .sort((a, b) => (a.d < b.d ? -1 : 1));
}

export function isoDaysAgo(days, from = new Date()) {
  const d = new Date(from.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`fx source HTTP ${res.status}`);
  return res.json();
}

export function makeFx({ fetchImpl = globalThis.fetch, cache = createCache(), now = () => new Date() } = {}) {
  async function currencies() {
    const { value } = await cache.cached('currencies', CURRENCIES_TTL, () => getJson(fetchImpl, `${BASE}/currencies`));
    return value;
  }

  async function series(from, to) {
    return cache.cached(`series:${from}:${to}`, SERIES_TTL, async () => {
      const start = isoDaysAgo(31, now());
      const body = await getJson(fetchImpl, `${BASE}/${start}..?from=${from}&to=${to}`);
      const points = shapeSeries(body.rates, to);
      if (!points.length) throw new Error('fx source: empty series');
      return points;
    });
  }

  async function getFx({ amount: rawAmount, from: rawFrom, to: rawTo }) {
    const from = normalizeCode(rawFrom);
    const to = normalizeCode(rawTo);
    const amount = parseAmount(rawAmount);
    if (!Number.isFinite(amount)) {
      throw new FxError('bad_amount', 'That amount does not look like a number.', { examples: FX_EXAMPLES });
    }

    let list;
    try {
      list = await currencies();
    } catch {
      throw new FxError('unavailable', 'Currency data is taking a break. Try again in a minute.');
    }
    const unknown = [from, to].filter((c) => !isCodeShape(c) || !(c in list));
    if (unknown.length) {
      throw new FxError('unknown_currency', `Unknown currency: ${unknown.join(', ')}.`, {
        unknown, examples: FX_EXAMPLES, supported: Object.keys(list).sort(),
      });
    }

    let points, stale = false, fetchedAt = Date.now();
    if (from === to) {
      const today = now().toISOString().slice(0, 10);
      points = [{ d: isoDaysAgo(30, now()), v: 1 }, { d: today, v: 1 }];
    } else {
      try {
        ({ value: points, stale, fetchedAt } = await series(from, to));
      } catch {
        throw new FxError('unavailable', 'Currency data is taking a break. Try again in a minute.');
      }
    }

    const last = points[points.length - 1];
    return {
      amount, from, to,
      fromName: list[from], toName: list[to],
      rate: last.v,
      result: convert(amount, last.v),
      date: last.d,
      series: points,
      stale,
      updated: new Date(fetchedAt).toISOString(),
    };
  }

  return { getFx, currencies };
}

export const { getFx } = makeFx();
