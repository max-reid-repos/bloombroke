// Shared fetch helpers for the WEIRD gauges. Every request names us in the
// User-Agent (some sources refuse anonymous ones) and gives up after a timeout.

export const UA = 'Bloombroke/1.0 (hello@bloombroke.com)';
export const TIMEOUT = 8000;

// A source answered, but with nothing to show: the tile says NO DATA.
export class NoData extends Error {
  constructor(message = 'no data') {
    super(message);
    this.code = 'no_data';
  }
}

// fetchImpl -> { text(url, opts), json(url, opts) }. opts: { timeout, headers }.
export function sourceClient(fetchImpl = globalThis.fetch) {
  async function get(url, { timeout = TIMEOUT, headers = {}, accept = '*/*' } = {}) {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Accept: accept, ...headers },
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
    return res;
  }
  return {
    text: async (url, opts) => (await get(url, opts)).text(),
    json: async (url, opts) => (await get(url, { accept: 'application/json', ...opts })).json(),
  };
}

// Small shared helpers.
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// +12% / −12% (a true minus sign, as elsewhere on the site). 0 has no sign.
export function signedPct(v, decimals = 1) {
  if (!Number.isFinite(v)) return '--';
  const s = Math.abs(v).toFixed(decimals);
  if (Number(s) === 0) return `${s}%`;
  return `${v > 0 ? '+' : '−'}${s}%`;
}
