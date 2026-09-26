// DESK cards: a WEIRD gauge as a DESK panel, drawn as its WEIRD tile (the tile body is
// weird.js tileBody, not a copy). Every card on a desk shares one /api/weird fetch,
// fetched again when the first card's gauge is due (its updated time plus its ttl).
// screens/desk.js puts the cards in the grid; this file is the pure part.

import { esc } from './markets.js';
import { tileBody } from './weird.js';
import { WEIRD_GAUGES, gaugeByCommand } from './weird-gauges.js';
import { findCommand } from '../registry.js';

export const CARD_MIN_MS = 60_000; // /api/weird is cached for 60 seconds anyway
export const CARD_RETRY_MS = 5 * 60_000; // a failed or stale gauge, or a failed fetch
export const CARD_TTL_MS = 10 * 60_000; // a row without a ttl: the WEIRD screen's own pace
const GRACE_MS = 5_000;

// The gauge a stored panel command names (CANAL), or null.
export function cardGauge(cmd) {
  return gaugeByCommand(String(cmd ?? '').trim().toUpperCase());
}

// The + PANEL picker's "Weird data" group: every gauge, filtered by what is typed.
export function weirdPickItems(text = '') {
  const t = String(text).trim().toUpperCase().replace(/^\+\s*/, '');
  return WEIRD_GAUGES
    .map((g) => ({ name: g.command, value: g.command, hint: findCommand(g.command)?.summary || g.title }))
    .filter((s) => !t || s.name.startsWith(t) || s.hint.toUpperCase().includes(t));
}

// A card: the WEIRD tile's panel, without its numbered head (the DESK panel head names
// the gauge). d is the gauge's /api/weird row, or null while loading.
export const cardBody = (g, d) => tileBody(g, d);
export function cardHtml(g, d) {
  return `<div class="wd-tile dp-card" data-card="${esc(g.command)}" tabindex="0" title="Open ${esc(g.command)}"><section class="panel"><div class="panel-body">${cardBody(g, d)}</div></section></div>`;
}

// A new summary over the last one: a gauge that came back pending keeps the value it had.
export function mergeCardRows(prev, rows) {
  const next = new Map(prev);
  for (const r of rows || []) {
    if (!r || typeof r.id !== 'string') continue;
    if (r.pending && prev.get(r.id)?.ok) continue;
    next.set(r.id, r);
  }
  return next;
}

// When to fetch /api/weird again (ms since epoch): when the first card's gauge is due,
// at least CARD_MIN_MS after the last fetch. ids: the gauges with a card on the desk.
export function nextCardFetch(rows, ids, lastFetch) {
  if (!ids.length) return null;
  let due = Infinity;
  for (const id of ids) {
    const r = rows.get(id);
    const at = Date.parse(r?.updated || '');
    let t;
    if (!r || r.pending) t = lastFetch + CARD_MIN_MS;
    else if (r.ok === false || r.stale || !Number.isFinite(at)) t = lastFetch + CARD_RETRY_MS;
    else t = at + (Number(r.ttl) > 0 ? Number(r.ttl) : CARD_TTL_MS) + GRACE_MS;
    due = Math.min(due, t);
  }
  return Math.max(lastFetch + CARD_MIN_MS, due);
}
