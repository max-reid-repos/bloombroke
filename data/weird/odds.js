// ODDS: what prediction-market prices imply for a US recession this year and for the
// next Fed rate decision. Source: the Polymarket Gamma API public search (no key). A
// "Yes" price of 0.10 is read as a 10% chance. Question text is shown as the market
// words it. No links to the market are sent or shown.

import { NoData } from './source.js';

export const id = 'odds';
export const source = 'Polymarket';
export const ttl = 15 * 60_000;

// No past at the source: one reading per UTC day is recorded (data/weird/history.js).
export const defaultPeriod = 'MAX';
export const snapshotSeries = [{ key: 'recession', label: 'US recession chance, %' }, { key: 'fed', label: 'Top Fed outcome, %', hidden: true }];
export const snapshot = (v) => ({ recession: v.recession?.pct ?? null, fed: v.fed?.outcomes?.[0]?.pct ?? null });

const search = (q) => `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&events_status=active&limit_per_type=20`;

// A market's "Yes" price as a % (0 to 100), or null.
export function yesPct(m) {
  try {
    const outcomes = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes;
    const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
    const i = (outcomes || []).findIndex((o) => /^yes$/i.test(String(o)));
    const p = Number(prices?.[i]);
    return i >= 0 && p >= 0 && p <= 1 ? p * 100 : null;
  } catch {
    return null;
  }
}

const open = (x, now) => x && x.active !== false && !x.closed && !x.archived
  && (!x.endDate || !Number.isFinite(Date.parse(x.endDate)) || Date.parse(x.endDate) > now);

// Search body -> the US recession market for this year (or the soonest one), or null.
export function pickRecession(body, now) {
  const year = new Date(now).getUTCFullYear();
  const found = [];
  for (const e of body?.events || []) {
    if (!open(e, now) || !/^U\.?S\.? recession\b/i.test(String(e.title || ''))) continue;
    for (const m of e.markets || []) {
      const pct = yesPct(m);
      if (!open(m, now) || pct === null || !/^U\.?S\.? recession\b/i.test(String(m.question || ''))) continue;
      const y = Number(/\b(20\d\d)\b/.exec(m.question)?.[1]);
      found.push({ question: String(m.question), pct, year: y || null, endDate: m.endDate || e.endDate || null, volume: Number(m.volumeNum ?? m.volume) || 0 });
    }
  }
  if (!found.length) return null;
  const thisYear = found.filter((f) => f.year === year).sort((a, b) => b.volume - a.volume);
  if (thisYear.length) return thisYear[0];
  return found.sort((a, b) => Date.parse(a.endDate || '9999') - Date.parse(b.endDate || '9999'))[0];
}

// Search body -> the next Fed decision: { title, endDate, outcomes: [{ question, pct }] }, or null.
export function pickFed(body, now) {
  const events = (body?.events || [])
    .filter((e) => open(e, now) && /^Fed decision in\b/i.test(String(e.title || '')) && Number.isFinite(Date.parse(e.endDate)))
    .sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate));
  for (const e of events) {
    const outcomes = (e.markets || [])
      .filter((m) => open(m, now))
      .map((m) => ({ question: String(m.question || ''), pct: yesPct(m) }))
      .filter((m) => m.question && m.pct !== null)
      .sort((a, b) => b.pct - a.pct);
    if (outcomes.length) return { title: String(e.title), endDate: e.endDate, outcomes };
  }
  return null;
}

// 9.5 -> '10%', 0.3 -> '<1%'.
export function pctLabel(p) {
  if (!Number.isFinite(p)) return '--';
  if (p > 0 && p < 1) return '<1%';
  if (p < 100 && p > 99) return '>99%';
  return `${Math.round(p)}%`;
}

export function build({ recession, fed }, now = Date.now()) {
  if (!recession && !fed) throw new NoData('Polymarket: no matching active market');
  const top = fed?.outcomes[0];
  return {
    headline: recession ? `RECESSION ${pctLabel(recession.pct)}` : `FED ${pctLabel(top.pct)}`,
    // ALERTS: the recession odds only; a FED headline is a different question, so no value.
    ...(recession && Number.isFinite(recession.pct) ? { value: Math.round(recession.pct), unit: '%' } : {}),
    line: recession ? recession.question : top.question,
    spark: null,
    asOf: new Date(now).toISOString(),
    source,
    recession,
    fed,
  };
}

export async function load(get, { now = Date.now } = {}) {
  const t = now();
  const [rec, fed] = await Promise.all([
    get.json(search('US recession'), { timeout: 15_000 }),
    get.json(search('Fed decision'), { timeout: 15_000 }),
  ]);
  return build({ recession: pickRecession(rec, t), fed: pickFed(fed, t) }, t);
}
