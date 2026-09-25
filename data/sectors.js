// SECTORS: the 11 SPDR sector ETFs. Today's move from the CNBC quote service,
// 1M and YTD from CNBC daily closes (both no key).

import { makeCnbcList, nyDay } from './lists.js';
import { getChart as defaultGetChart } from './charts.js';

export const SECTOR_ETFS = [
  { id: 'XLK', src: 'XLK', name: 'Technology' },
  { id: 'XLC', src: 'XLC', name: 'Communication Services' },
  { id: 'XLY', src: 'XLY', name: 'Consumer Discretionary' },
  { id: 'XLP', src: 'XLP', name: 'Consumer Staples' },
  { id: 'XLV', src: 'XLV', name: 'Health Care' },
  { id: 'XLF', src: 'XLF', name: 'Financials' },
  { id: 'XLI', src: 'XLI', name: 'Industrials' },
  { id: 'XLE', src: 'XLE', name: 'Energy' },
  { id: 'XLU', src: 'XLU', name: 'Utilities' },
  { id: 'XLRE', src: 'XLRE', name: 'Real Estate' },
  { id: 'XLB', src: 'XLB', name: 'Materials' },
];

// "2026-09-25" -> "2026-08-25" (clamped to the month's last day: 03-31 -> 02-28).
export function monthBefore(day) {
  const [y, m, d] = day.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const pct = (now, base) => (Number.isFinite(now) && base > 0 ? ((now - base) / base) * 100 : null);

// Daily closes [{ t, v }] (oldest first) and today's price -> % change over 1 month and year to date.
// 1M compares with the last close on or before the same day last month; YTD with the last close
// of the previous year.
export function periodChanges(points, last, today) {
  let base1m = null;
  let baseYtd = null;
  const monthAgo = monthBefore(today);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  for (const p of points) {
    const d = nyDay(p.t);
    if (d <= monthAgo) base1m = p.v;
    if (d < yearStart) baseYtd = p.v;
  }
  return { m1: pct(last, base1m), ytd: pct(last, baseYtd) };
}

export function makeSectors({ getChart = defaultGetChart, now = () => Date.now(), ...opts } = {}) {
  const list = makeCnbcList({ key: 'sectors', items: SECTOR_ETFS, minRows: 8, ...opts });

  async function getSectors() {
    const { rows, stale, updated } = await list();
    const today = nyDay(now());
    const charts = await Promise.allSettled(rows.map((r) => getChart(r.id, '1Y')));
    const sectors = rows.map((r, i) => {
      const c = charts[i];
      const ch = c.status === 'fulfilled' ? periodChanges(c.value.points, r.last, today) : { m1: null, ytd: null };
      return { ...r, ...ch };
    });
    return { sectors, stale: stale || charts.some((c) => c.status === 'fulfilled' && c.value.stale), updated };
  }

  return { getSectors };
}

export const { getSectors } = makeSectors();
