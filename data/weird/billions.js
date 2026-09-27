// BILLIONS: how much the richest people made or lost today. Source: the Forbes
// real-time billionaires list (an unofficial JSON feed behind forbes.com). Net worth is
// in millions of dollars; today's change is the live estimate minus the previous
// close estimate (estWorthPrev). Only the fields we use are asked for: the full record
// is too big and the feed refuses it at times.

import { NoData } from './source.js';

export const id = 'billions';
export const source = 'Forbes';
export const ttl = 15 * 60_000;

// No past at the source: one reading per UTC day is recorded (data/weird/history.js).
// The biggest mover is a different person most days: no record line.
export const record = false;
export const defaultPeriod = 'MAX';
export const snapshotSeries = [{ key: 'move', label: 'Biggest one-day change, $B' }];
export const snapshot = (v) => ({ move: v.moves?.[0]?.change ?? null });

const FIELDS = 'rank,uri,personName,lastName,finalWorth,estWorthPrev,timestamp';
const URL_RTB = `https://www.forbes.com/forbesapi/person/rtb/0/position/true.json?fields=${FIELDS}`;

// Forbes body -> { people: [{ name, last, rank, worth, prev }], asOf, size }. Millions.
export function parse(body) {
  const list = body?.personList?.personsLists;
  if (!Array.isArray(list) || !list.length) throw new Error('Forbes: unexpected shape');
  let ts = 0;
  const people = [];
  for (const p of list) {
    const worth = Number(p.finalWorth);
    const prev = Number(p.estWorthPrev);
    const name = String(p.personName ?? '').trim();
    if (!name || !(worth > 0) || !(prev > 0)) continue;
    if (Number.isFinite(Number(p.timestamp))) ts = Math.max(ts, Number(p.timestamp));
    people.push({ name, last: String(p.lastName ?? '').trim(), rank: Number(p.rank) || null, worth, prev });
  }
  return { people, asOf: ts ? new Date(ts).toISOString() : null, size: list.length };
}

// Millions -> '+$4.1B' / '−$8.8B' (a true minus sign).
export function signedB(m) {
  const s = (Math.abs(m) / 1000).toFixed(1);
  if (Number(s) === 0) return '$0.0B';
  return `${m > 0 ? '+' : '−'}$${s}B`;
}

const row = (p) => ({
  rank: p.rank,
  name: p.name,
  worth: p.worth / 1000,
  change: (p.worth - p.prev) / 1000,
  pct: (p.worth / p.prev - 1) * 100,
});

export function build(p, n = 10) {
  if (!p.people.length) throw new NoData('Forbes: no net worth values');
  const moves = p.people
    .map((x) => ({ ...x, change: x.worth - x.prev }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const top = moves[0];
  const flat = Math.abs(top.change) < 50;
  const who = (top.last || top.name).toUpperCase();
  const richest = p.people.filter((x) => x.rank).sort((a, b) => a.rank - b.rank).slice(0, 5);
  return {
    headline: flat ? 'NO BIG MOVES TODAY' : `${who} ${signedB(top.change)}`,
    line: 'Biggest one-day change in net worth',
    spark: null,
    asOf: p.asOf,
    source,
    count: p.size,
    moves: moves.slice(0, n).map(row),
    richest: richest.map(row),
  };
}

export async function load(get) {
  return build(parse(await get.json(URL_RTB, { timeout: 30_000 })));
}
