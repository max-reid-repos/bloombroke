// WELCOME: the chips on the first-visit card (consent.js owns the card, the legal line,
// the input and the record of acceptance). A chip accepts AND runs its command in one go;
// SURPRISE ME runs one fun command picked from a fixed list. Loaded on first visit only,
// with welcome.css beside it (the chips, and the command bar's one-time glow).
// Pure parts are exported for tests.

// { cmd, cap, chip }: the command, a 2-4 word caption, and the goal's short fixed label.
export const WELCOME_CHIPS = [
  { cmd: 'GUESS', cap: "Today's mystery chart", chip: 'guess' },
  { cmd: 'WHATIF IPHONE6', cap: 'Apple stock instead?', chip: 'whatif' },
  { cmd: 'GRAVEYARD', cap: 'Tickers that died', chip: 'graveyard' },
  { cmd: 'AAPL 1Y', cap: 'Apple, one year', chip: 'chart' },
];

// SURPRISE ME: only these, ever. { cmd, kind }: kind is the goal's short fixed label.
export const SURPRISE_PICKS = [
  // id: the gauge's /api/weird id, so a gauge with nothing to show can be skipped.
  ...[['PIZZA', 'pizza'], ['WAFFLE', 'waffle'], ['HOTDOG', 'hotdog'], ['UNDIES', 'undies'], ['BIGMAC', 'bigmac'], ['LIPSTICK', 'lipstick'], ['EGGPRICE', 'eggs'], ['CANAL', 'canal']]
    .map(([g, id]) => ({ cmd: g, kind: 'weird', id })),
  ...['LEH', 'ENE', 'IPET', 'BBI', 'NSCP', 'RSH', 'TOY', 'WE'].map((t) => ({ cmd: `GRAVEYARD ${t}`, kind: 'graveyard' })),
  ...['PS4', 'MODEL3', 'RTX3080', 'BLACKBERRY', 'SWITCH', 'GTX1080'].map((w) => ({ cmd: `WHATIF ${w}`, kind: 'whatif' })),
  { cmd: 'SECTORS MAP', kind: 'sectors' },
];

// WEIRD gauges with nothing to show (NO DATA and no last good reading, as emptyGauge in
// weird-gauges.js): SURPRISE ME skips them until they report again. Filled from
// /api/weird once, when this module loads in the browser; until then nothing is skipped.
const emptyWeird = new Set();
export function noteWeird(rows) {
  emptyWeird.clear();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && typeof r.id === 'string' && r.ok === false && !r.pending) emptyWeird.add(r.id);
  }
  return emptyWeird;
}
if (typeof document !== 'undefined' && typeof fetch === 'function') {
  fetch('/api/weird', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((d) => { if (d) noteWeird(d.gauges); })
    .catch(() => {});
}

// One pick: a kind first (so the one SECTORS MAP comes up as often as a gauge), then one
// of its commands. rand: () => [0, 1). skip: gauge ids to leave out (a kind left with
// none is left out too). Always an item of SURPRISE_PICKS.
export function pickSurprise(rand = Math.random, skip = emptyWeird) {
  const r = () => { const x = Number(rand()); return Number.isFinite(x) && x >= 0 && x < 1 ? x : 0; };
  const picks = SURPRISE_PICKS.filter((p) => !p.id || !skip.has(p.id));
  const kinds = [...new Set(picks.map((p) => p.kind))];
  const kind = kinds[Math.floor(r() * kinds.length)];
  const list = picks.filter((p) => p.kind === kind);
  return list[Math.floor(r() * list.length)];
}

// The chips' HTML: a label, the four chips and SURPRISE ME. data-chip / data-surprise
// tell consent.js what a press means.
export function chipsHtml() {
  const chips = WELCOME_CHIPS.map((c, i) => `<button type="button" class="wc-chip" data-chip="${i}"><span class="wc-cmd">${c.cmd}</span><span class="wc-cap">${c.cap}</span></button>`).join('');
  return `<div class="wc-chips" role="group" aria-labelledby="consent-try">${chips}</div>
      <button type="button" class="wc-surprise" data-surprise="1">SURPRISE ME</button>`;
}

// What a pressed chip means: { cmd, chip } or { cmd, surprise } (surprise: the kind), or null.
export function chipChoice(el, rand = Math.random) {
  if (!el || !el.dataset) return null;
  if (el.dataset.surprise) {
    const p = pickSurprise(rand);
    return { cmd: p.cmd, surprise: p.kind };
  }
  const c = WELCOME_CHIPS[Number(el.dataset.chip)];
  return c ? { cmd: c.cmd, chip: c.chip } : null;
}

// Arrow keys between the chips (and SURPRISE ME, the last). i: the focused one (-1: the
// input). -> the index to focus, -1 for the input, or null (the key is not ours).
export function chipNav(i, key, count) {
  if (count <= 0) return null;
  if (i < 0) return key === 'ArrowDown' ? 0 : null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(i + 1, count - 1);
  if (key === 'ArrowLeft' || key === 'ArrowUp') return i - 1; // -1: back to the input
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
