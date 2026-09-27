// BONDS: government bond yields by country and maturity, from the CNBC quote service
// (no key). `change` is in percentage points; the screen shows it in basis points.
// - bonds: the 10-year list (one row per country), as before.
// - grid: every country in BOND_GRID with its 2Y, 5Y, 10Y and 30Y (null where the source
//   has no quote). One upstream call feeds both.

import { cappedFetch } from './http.js';
import { createCache } from './cache.js';
import { fetchCnbcRows, parseListRows } from './quotes.js';
import { withCmd, iso } from './lists.js';
import { BOND_GRID, BOND_TERMS } from '../public/instruments.js';

const TTL = 60_000;

export const BONDS = [
  { id: 'US', src: 'US10Y', name: 'United States', cmd: 'US10Y' },
  { id: 'DE', src: 'DE10Y', name: 'Germany' },
  { id: 'GB', src: 'GB10Y', name: 'United Kingdom' },
  { id: 'FR', src: 'FR10Y', name: 'France' },
  { id: 'IT', src: 'IT10Y', name: 'Italy' },
  { id: 'JP', src: 'JP10Y', name: 'Japan' },
  { id: 'CN', src: 'CN10Y', name: 'China' },
  { id: 'AU', src: 'AU10Y', name: 'Australia' },
  { id: 'CA', src: 'CA10Y', name: 'Canada' },
  { id: 'IN', src: 'IN10Y', name: 'India' },
].map(withCmd);

// Every grid cell as a list item: { id: 'DE2Y', src: 'DE2Y', cc, term }.
export const GRID_CELLS = BOND_GRID.flatMap((b) => b.terms.map((t) => withCmd({ id: `${b.cc}${t}`, src: `${b.cc}${t}`, cc: b.cc, term: t })));

// Parsed cells -> one row per country, in BOND_GRID order.
export function buildGrid(cells) {
  const byId = new Map(cells.map((c) => [c.id, c]));
  return BOND_GRID.map((b) => ({
    cc: b.cc,
    name: b.name,
    region: b.region,
    cells: Object.fromEntries(BOND_TERMS.map((t) => {
      const c = byId.get(`${b.cc}${t}`);
      return [t, c ? { id: c.id, cmd: c.cmd, last: c.last, change: c.change, asOf: c.asOf, realTime: c.realTime } : null];
    })),
  }));
}

export function makeBonds({ fetchImpl = cappedFetch, cache = createCache() } = {}) {
  async function getBonds() {
    const { value, stale, fetchedAt } = await cache.cached('bonds:grid', TTL, async () => {
      const srcs = [...new Set([...GRID_CELLS, ...BONDS].map((i) => i.src))];
      const rows = await fetchCnbcRows(fetchImpl, srcs);
      const bonds = parseListRows(BONDS, rows);
      const cells = parseListRows(GRID_CELLS, rows);
      if (cells.length < GRID_CELLS.length / 2) throw new Error('quotes source: too few rows for bonds');
      return { bonds, grid: buildGrid(cells) };
    });
    return { ...value, terms: BOND_TERMS, stale, updated: iso(fetchedAt) };
  }
  return { getBonds };
}

export const { getBonds } = makeBonds();
