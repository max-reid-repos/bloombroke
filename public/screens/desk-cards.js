// DESK cards: a WEIRD gauge as a DESK panel, drawn as its WEIRD tile (the tile body is
// weird.js tileBody, not a copy). Every card on a desk shares one /api/weird fetch,
// fetched again when the first card's gauge is due (its updated time plus its ttl).
// screens/desk.js puts the cards in the grid; this file is the pure part.

import { esc } from './markets.js';
import { tileBody } from './weird.js';
import { WEIRD_GAUGES, gaugeByCommand, emptyGauge } from './weird-gauges.js';
import { findCommand } from '../registry.js';

export const CARD_MIN_MS = 60_000; // /api/weird is cached for 60 seconds anyway
export const CARD_RETRY_MS = 5 * 60_000; // a failed or stale gauge, or a failed fetch
export const CARD_TTL_MS = 10 * 60_000; // a row without a ttl: the WEIRD screen's own pace
const GRACE_MS = 5_000;

// The gauge a stored panel command names (CANAL), or null.
export function cardGauge(cmd) {
  return gaugeByCommand(String(cmd ?? '').trim().toUpperCase());
}

// The + PANEL picker's "Weird data" group: every gauge, filtered by what is typed. A
// gauge whose name or alias starts with it comes first, then one whose description has
// every typed word as a whole word ("hormuz" finds CANAL; "ca" is not in "carloads").
const words = (text) => String(text).toUpperCase().split(/[^A-Z0-9$]+/).filter(Boolean);
export function weirdPickItems(text = '') {
  const t = String(text).trim().toUpperCase().replace(/^\+\s*/, '').replace(/\s+/g, ' ');
  const all = WEIRD_GAUGES.map((g) => {
    const c = findCommand(g.command);
    return { name: g.command, value: g.command, hint: c?.summary || g.title, names: [g.command, ...(c?.aliases || [])] };
  });
  const out = (list) => list.map(({ name, value, hint }) => ({ name, value, hint }));
  if (!t) return out(all);
  const byName = all.filter((s) => s.names.some((n) => n.startsWith(t.replace(/ /g, ''))));
  const typed = words(t);
  const byWords = all.filter((s) => !byName.includes(s) && typed.every((w) => words(s.hint).includes(w)));
  return out([...byName, ...byWords]);
}

// A key while a preset waits to replace the desk -> 'replace', 'keep' or null (the key
// does what it always does). where: 'page' (nothing focused), 'command' (the empty
// command bar), 'confirm' (the confirm line), 'typing' (a command being typed) or
// 'control' (a button, link, tab, card or input). Enter on a control keeps its action.
export function confirmKey(key, where) {
  if (key === 'Escape') return where === 'typing' ? null : 'keep';
  if (key === 'Enter') return ['page', 'command', 'confirm'].includes(where) ? 'replace' : null;
  return null;
}

// A card: the WEIRD tile's panel, without its numbered head (the DESK panel head names
// the gauge). d is the gauge's /api/weird row, or null while loading.
export const cardBody = (g, d) => tileBody(g, d);
export function cardHtml(g, d) {
  return `<div class="wd-tile dp-card" data-card="${esc(g.command)}" tabindex="0" title="Open ${esc(g.command)}"><section class="panel"><div class="panel-body">${cardBody(g, d)}</div></section></div>`;
}

// A card whose gauge has nothing to show (NO DATA, no last good reading) is left out of
// the desk until the gauge reports again. rows: mergeCardRows' map. A failed fetch puts
// no row there, so it hides nothing.
export const cardHidden = (rows, id) => emptyGauge(rows.get(id));

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

// When to fetch /api/weird again, in this browser's time: when the first card's gauge is
// due, at least CARD_MIN_MS after the last fetch. ids: the gauges with a card on the
// desk. lastFetch: when the last fetch ran here; serverNow: the summary's own updated
// time (ms). Due times are worked out in server time (a gauge's updated + ttl, minus the
// server's now), so a browser clock that runs fast or slow does not change them.
export function nextCardFetch(rows, ids, lastFetch, serverNow = lastFetch) {
  if (!ids.length) return null;
  const now = Number.isFinite(serverNow) ? serverNow : lastFetch;
  let wait = Infinity;
  for (const id of ids) {
    const r = rows.get(id);
    const at = Date.parse(r?.updated || '');
    let w;
    if (!r || r.pending) w = CARD_MIN_MS;
    else if (r.ok === false || r.stale || !Number.isFinite(at)) w = CARD_RETRY_MS;
    else w = at + (Number(r.ttl) > 0 ? Number(r.ttl) : CARD_TTL_MS) + GRACE_MS - now;
    wait = Math.min(wait, w);
  }
  return lastFetch + Math.max(CARD_MIN_MS, wait);
}
