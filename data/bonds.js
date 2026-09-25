// BONDS: 10-year government bond yields by country, from the CNBC quote service (no key).
// `change` is in percentage points; the screen shows it in basis points.

import { makeCnbcList, withCmd } from './lists.js';

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

export function makeBonds(opts = {}) {
  const list = makeCnbcList({ key: 'bonds', items: BONDS, ...opts });
  return {
    async getBonds() {
      const { rows, stale, updated } = await list();
      return { bonds: rows, stale, updated };
    },
  };
}

export const { getBonds } = makeBonds();
