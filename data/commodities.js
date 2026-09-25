// COMMODITIES: front-month futures from the CNBC quote service (no key). Delayed.
// `unit` is how each contract is quoted on its exchange.

import { makeCnbcList } from './lists.js';

export const COMMODITIES = [
  { id: 'WTI', src: '@CL.1', name: 'Oil (WTI)', group: 'Energy', unit: 'USD per barrel', decimals: 2 },
  { id: 'BRENT', src: '@LCO.1', name: 'Oil (Brent)', group: 'Energy', unit: 'USD per barrel', decimals: 2 },
  { id: 'NATGAS', src: '@NG.1', name: 'Natural gas', group: 'Energy', unit: 'USD per MMBtu', decimals: 3 },
  { id: 'GOLD', src: '@GC.1', name: 'Gold', group: 'Metals', unit: 'USD per troy ounce', decimals: 2 },
  { id: 'SILVER', src: '@SI.1', name: 'Silver', group: 'Metals', unit: 'USD per troy ounce', decimals: 3 },
  { id: 'COPPER', src: '@HG.1', name: 'Copper', group: 'Metals', unit: 'USD per pound', decimals: 4 },
  { id: 'PLATINUM', src: '@PL.1', name: 'Platinum', group: 'Metals', unit: 'USD per troy ounce', decimals: 2 },
  { id: 'WHEAT', src: '@W.1', name: 'Wheat', group: 'Agriculture', unit: 'US cents per bushel', decimals: 2 },
  { id: 'CORN', src: '@C.1', name: 'Corn', group: 'Agriculture', unit: 'US cents per bushel', decimals: 2 },
  { id: 'SOYBEANS', src: '@S.1', name: 'Soybeans', group: 'Agriculture', unit: 'US cents per bushel', decimals: 2 },
  { id: 'COFFEE', src: '@KC.1', name: 'Coffee', group: 'Agriculture', unit: 'US cents per pound', decimals: 2 },
  { id: 'SUGAR', src: '@SB.1', name: 'Sugar', group: 'Agriculture', unit: 'US cents per pound', decimals: 2 },
  { id: 'COCOA', src: '@CC.1', name: 'Cocoa', group: 'Agriculture', unit: 'USD per tonne', decimals: 0 },
];

// "WTI Crude (Nov'26)" -> "NOV'26"
export function contractMonth(name) {
  const m = /\(([A-Za-z]{3})'(\d{2})\)/.exec(String(name ?? ''));
  return m ? `${m[1].toUpperCase()}'${m[2]}` : null;
}

export function makeCommodities(opts = {}) {
  const list = makeCnbcList({ key: 'commodities', items: COMMODITIES, extra: (r) => ({ contract: contractMonth(r?.name) }), ...opts });
  return {
    async getCommodities() {
      const { rows, stale, updated } = await list();
      return { commodities: rows, stale, updated };
    },
  };
}

export const { getCommodities } = makeCommodities();
