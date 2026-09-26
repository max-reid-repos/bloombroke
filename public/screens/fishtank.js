// FISHTANK: the S&P 100 as fish in a tank, drawn on one canvas. One fish per stock:
// size from market cap, colour and depth from today's % change (winners swim near the
// surface, losers near the floor). Hover a fish for its name, click it to open it.
// Data: the same S&P 100 batch as HEATMAP, every member (/api/fishtank), every 60s.

import { esc, q, fmtPct, nyTime, panel, LOADING } from './markets.js';
import { sizeGuard } from './size-guard.js';

// ---- Pure mapping (tested in test/fishtank.test.js) ------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The % change that reaches the surface or the floor: the biggest move today, never
// under 1% so a quiet day does not fling the fish to the walls.
export function depthRange(stocks) {
  let m = 0;
  for (const s of stocks) if (Number.isFinite(s.changePct)) m = Math.max(m, Math.abs(s.changePct));
  return Math.max(1, m);
}

// % change -> depth, 0 = surface, 1 = floor, 0.5 = flat. A square-root curve keeps the
// order but spreads the crowd of small moves over the tank instead of one line.
export function pctToDepth(pct, range = 3) {
  if (!Number.isFinite(pct) || !(range > 0)) return 0.5;
  const t = Math.sqrt(Math.min(1, Math.abs(pct) / range));
  return 0.5 - 0.5 * Math.sign(pct) * t;
}

// Market cap -> fish length in px. Length grows with sqrt(cap), so a fish's area follows
// its cap; the biggest company is `max` long, and no fish is shorter than `min`. With no
// cap (or no largest cap) every fish gets the same `fallback` length.
export function capToSize(cap, maxCap, { max = 80, min = 12, fallback = 26 } = {}) {
  if (!(cap > 0) || !(maxCap > 0)) return fallback;
  return clamp(max * Math.sqrt(cap / maxCap), min, max);
}

// % change -> fish colour: green up, red down, steel when flat. Brighter and more
// saturated as the move grows, full strength at 3%.
export function fishColor(pct) {
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.005) return { h: 208, s: 18, l: 46 };
  const t = Math.min(1, Math.abs(pct) / 3);
  return pct > 0
    ? { h: 147, s: Math.round(34 + 40 * t), l: Math.round(34 + 28 * t) }
    : { h: 0, s: Math.round(44 + 52 * t), l: Math.round(40 + 28 * t) };
}

export const hsl = ({ h, s, l }, a = 1) => (a >= 1 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${a})`);

// The biggest winner (up only) and biggest loser (down only); null when there is none.
// Ties go to the first ticker in A-Z order, so the pick is stable between refreshes.
export function pickExtremes(stocks) {
  let winner = null;
  let loser = null;
  for (const s of stocks) {
    const p = s.changePct;
    if (!Number.isFinite(p)) continue;
    if (p > 0 && (!winner || p > winner.changePct || (p === winner.changePct && s.ticker < winner.ticker))) winner = s;
    if (p < 0 && (!loser || p < loser.changePct || (p === loser.changePct && s.ticker < loser.ticker))) loser = s;
  }
  return { winner, loser };
}

// "S&P 100 · 63 up · 37 down · updated 14:32" (New York time).
export function tankHeader(stocks, updated) {
  const up = stocks.filter((s) => s.changePct > 0).length;
  const down = stocks.filter((s) => s.changePct < 0).length;
  return { up, down, text: `S&P 100 · ${up} up · ${down} down · updated ${nyTime(updated)}` };
}

// A stable number in [0, 1) for a ticker and a salt: the same fish swims the same way on
// every load.
export function seeded(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ---- The tank ----------------------------------------------------------------------

const SURFACE = 16; // px from the top to the waterline
const FLOOR = 22; // px of sand at the bottom
const FRAME_MS = 1000 / 60 - 1.5; // about 60fps at most, whatever the display rate
const ICE = 'hsla(201, 100%, 78%,';

// Fish length limits for a tank w x h.
export function sizeLimits(w, h) {
  const max = clamp(Math.sqrt(w * h) * 0.085, 30, 88);
  return { max, min: Math.max(9, max * 0.16), fallback: max * 0.4 };
}

// The animation loop. It draws at most about 60 times a second, and only while nothing
// holds it: 'data' (no batch yet), 'hidden' (the tab), 'offscreen' (a DESK panel scrolled
// away), 'reduced' (prefers-reduced-motion). destroy() holds it for good.
export function makeRunner(frame, {
  raf = (cb) => requestAnimationFrame(cb), caf = (id) => cancelAnimationFrame(id), frameMs = FRAME_MS, onStart,
} = {}) {
  const holds = new Set();
  let id = 0; let on = false; let lastDraw = -Infinity;
  function loop(now) {
    id = raf(loop);
    if (now - lastDraw < frameMs) return;
    lastDraw = now;
    frame(now);
  }
  function sync() {
    const go = holds.size === 0;
    if (go && !on) { on = true; lastDraw = -Infinity; onStart?.(); id = raf(loop); } else if (!go && on) { on = false; caf(id); id = 0; }
  }
  return {
    hold(reason, yes = true) {
      if (holds.has('left')) return;
      if (yes) holds.add(reason); else holds.delete(reason);
      sync();
    },
    get running() { return on; },
    destroy() { holds.add('left'); sync(); },
  };
}

function makeTank(host, canvas, tip, { onOpen, reduced }) {
  const g = canvas.getContext('2d');
  const font = (getComputedStyle(host).fontFamily || 'monospace');
  let W = 0; let H = 0; let dpr = 1;
  let bg = null; // the still background, drawn once per size
  let fish = []; // one per stock
  const byTicker = new Map();
  let bubbles = [];
  let weeds = [];
  let labels = { winner: null, loser: null };
  let range = 0; // the % change at the surface (and, negative, at the floor)
  let last = 0; let clock = 0;
  let pointer = null; // { x, y } over the canvas
  let hover = null;
  const runner = makeRunner((now) => frame(now), { onStart: () => { last = 0; } });
  runner.hold('data'); // nothing to draw until the first batch

  const floorY = () => H - FLOOR;
  const band = () => ({ top: SURFACE + 14, bot: floorY() - 12 });

  function paintBackground() {
    bg = document.createElement('canvas');
    bg.width = Math.round(W * dpr); bg.height = Math.round(H * dpr);
    const b = bg.getContext('2d');
    b.scale(dpr, dpr);
    const water = b.createLinearGradient(0, 0, 0, H);
    water.addColorStop(0, 'hsl(206, 52%, 10%)');
    water.addColorStop(0.55, 'hsl(211, 44%, 6%)');
    water.addColorStop(1, 'hsl(213, 43%, 4%)');
    b.fillStyle = water;
    b.fillRect(0, 0, W, H);
    // Light from above: a few faint slanted beams.
    for (let i = 0; i < 5; i += 1) {
      const x = W * (0.12 + i * 0.2 + (seeded('beam', i) - 0.5) * 0.08);
      const wTop = 18 + seeded('bw', i) * 40;
      const beam = b.createLinearGradient(0, SURFACE, 0, floorY());
      beam.addColorStop(0, `${ICE} 0.045)`);
      beam.addColorStop(1, `${ICE} 0)`);
      b.fillStyle = beam;
      b.beginPath();
      b.moveTo(x, SURFACE); b.lineTo(x + wTop, SURFACE);
      b.lineTo(x + wTop + H * 0.28, floorY()); b.lineTo(x + H * 0.18, floorY());
      b.closePath(); b.fill();
    }
    // The waterline: a dashed rule with a tint above it.
    b.fillStyle = `${ICE} 0.035)`;
    b.fillRect(0, 0, W, SURFACE);
    b.strokeStyle = `${ICE} 0.32)`;
    b.lineWidth = 1;
    b.setLineDash([6, 4]);
    b.beginPath(); b.moveTo(0, SURFACE + 0.5); b.lineTo(W, SURFACE + 0.5); b.stroke();
    b.setLineDash([]);
    // Depth marks on the left wall: the move that reaches the surface, flat, the floor.
    const { top, bot } = band();
    const mid = Math.round((top + bot) / 2) + 0.5;
    b.strokeStyle = 'hsla(210, 24%, 40%, 0.22)';
    b.setLineDash([2, 6]);
    b.beginPath(); b.moveTo(0, mid); b.lineTo(W, mid); b.stroke();
    b.setLineDash([]);
    b.font = `10px ${font}`;
    b.fillStyle = 'hsla(208, 24%, 58%, 0.6)';
    b.textBaseline = 'middle';
    b.textAlign = 'left';
    b.fillText('0%', 6, mid - 8);
    if (range) {
      b.fillText(fmtPct(range), 6, top);
      b.fillText(fmtPct(-range), 6, bot);
    }
    // The sand: a low dune with a lit edge and a scatter of pixel grains.
    const fy = floorY();
    const dune = (x) => fy + 2 + Math.sin(x / 90 + 1.3) * 1.6 + Math.sin(x / 37) * 0.8;
    const sand = b.createLinearGradient(0, fy, 0, H);
    sand.addColorStop(0, 'hsl(208, 30%, 13%)');
    sand.addColorStop(1, 'hsl(212, 34%, 7%)');
    b.beginPath();
    b.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) b.lineTo(x, dune(x));
    b.lineTo(W, H);
    b.closePath();
    b.fillStyle = sand;
    b.fill();
    b.beginPath();
    for (let x = 0; x <= W; x += 6) (x ? b.lineTo(x, dune(x)) : b.moveTo(x, dune(x)));
    b.strokeStyle = 'hsla(206, 60%, 80%, 0.45)';
    b.lineWidth = 1;
    b.stroke();
    for (let x = 3; x < W; x += 7) {
      const k = seeded(`s${x}`);
      const y = dune(x) + 4 + k * (H - dune(x) - 7);
      b.fillStyle = `hsla(206, 40%, ${48 + k * 32}%, ${0.25 + k * 0.35})`;
      b.fillRect(x + Math.round(seeded(`t${x}`) * 5), Math.round(y), k > 0.8 ? 2 : 1, 1);
    }
  }

  function makeWeeds() {
    const n = clamp(Math.round(W / 190), 3, 9);
    weeds = Array.from({ length: n }, (_, i) => ({
      x: Math.round(W * ((i + 0.5) / n + (seeded('weed', i) - 0.5) * 0.6 / n)),
      n: Math.round(clamp(H * (0.12 + seeded('wh', i) * 0.16), 60, 220) / 13),
      ph: seeded('wp', i) * 6.28,
    }));
  }

  function makeBubbles() {
    const n = clamp(Math.round((W * H) / 26000), 8, 42);
    bubbles = Array.from({ length: n }, (_, i) => newBubble(i, true));
  }

  function newBubble(i, anywhere = false) {
    const fromWeed = weeds.length && Math.random() < 0.5 ? weeds[i % weeds.length].x + 4 : Math.random() * W;
    return {
      x: fromWeed, y: anywhere ? SURFACE + Math.random() * (floorY() - SURFACE) : floorY() - 2,
      r: 0.8 + Math.random() * 2.2, v: 14 + Math.random() * 22, ph: Math.random() * 6.28,
    };
  }

  // New data: keep each fish where it is, move it towards its new depth and colour.
  function setStocks(stocks) {
    const was = range;
    range = depthRange(stocks);
    if (range !== was && W) paintBackground();
    const maxCap = stocks.reduce((m, s) => Math.max(m, s.marketCap > 0 ? s.marketCap : 0), 0);
    const lim = sizeLimits(W || 800, H || 500);
    const seen = new Set();
    fish = stocks.map((s) => {
      seen.add(s.ticker);
      let f = byTicker.get(s.ticker);
      if (!f) {
        const r = seeded(s.ticker);
        const dir = seeded(s.ticker, 7) < 0.5 ? -1 : 1;
        f = {
          x01: 0.04 + r * 0.92, dir, face: dir, y: null,
          speed: 10 + seeded(s.ticker, 3) * 18, ph: seeded(s.ticker, 5) * 6.28,
          jit: (seeded(s.ticker, 11) - 0.5) * 2,
        };
        byTicker.set(s.ticker, f);
      }
      f.s = s;
      f.depth = pctToDepth(s.changePct, range);
      f.col = fishColor(s.changePct);
      f.cap = s.marketCap;
      return f;
    });
    for (const t of [...byTicker.keys()]) if (!seen.has(t)) byTicker.delete(t);
    fish.sort((a, b) => (b.cap || 0) - (a.cap || 0)); // big fish at the back
    const ex = pickExtremes(stocks);
    labels = { winner: ex.winner?.ticker || null, loser: ex.loser?.ticker || null };
    applySize(lim, maxCap);
    if (hover && byTicker.get(hover.s.ticker) !== hover) setHover(null);
    runner.hold('data', false);
    if (!runner.running) frame(performance.now(), true);
  }

  function applySize(lim = sizeLimits(W, H), maxCap = fish.reduce((m, f) => Math.max(m, f.cap > 0 ? f.cap : 0), 0)) {
    for (const f of fish) {
      f.len = capToSize(f.cap, maxCap, lim);
      f.x = f.x01 * W;
      if (f.y == null || reduced()) f.y = targetY(f);
    }
  }

  function targetY(f) {
    const { top, bot } = band();
    const pad = f.len * 0.22;
    return clamp(top + f.depth * (bot - top) + f.jit * 5, top + pad, bot - pad);
  }

  // The box changed size (through the size guard): resize the canvas and the scene.
  function resize(w, h) {
    W = w; H = h;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    paintBackground();
    makeWeeds();
    makeBubbles();
    applySize();
    for (const f of fish) f.y = targetY(f);
    frame(performance.now(), true);
  }

  // ---- drawing ----

  function drawFish(f, t, lit) {
    const y = f.bobY;
    const L = f.len; const Hh = L * 0.42;
    const wob = reduced() ? 0 : Math.sin(t * (5 + f.speed * 0.12) + f.ph) * Hh * 0.2;
    g.save();
    g.translate(f.x, y);
    g.scale(Math.abs(f.face) < 0.08 ? 0.08 * Math.sign(f.face || 1) : f.face, 1);
    // Tail first, then the body over it.
    g.beginPath();
    g.moveTo(-L * 0.26, 0);
    g.lineTo(-L * 0.5, -Hh * 0.46 + wob);
    g.lineTo(-L * 0.43, wob * 0.6);
    g.lineTo(-L * 0.5, Hh * 0.46 + wob);
    g.closePath();
    g.fillStyle = hsl({ ...f.col, l: f.col.l - 8 }, 0.8);
    g.fill();
    g.beginPath();
    g.moveTo(L * 0.5, 0);
    g.quadraticCurveTo(L * 0.1, -Hh, -L * 0.3, wob * 0.25);
    g.quadraticCurveTo(L * 0.1, Hh, L * 0.5, 0);
    g.fillStyle = hsl(f.col, 0.9);
    g.fill();
    g.lineWidth = lit ? 1.5 : 1;
    g.strokeStyle = lit ? 'hsl(206, 100%, 94%)' : hsl({ ...f.col, l: Math.min(88, f.col.l + 22) }, 0.9);
    g.stroke();
    if (L >= 16) {
      // Gill line and eye.
      g.beginPath();
      g.moveTo(L * 0.2, -Hh * 0.28);
      g.quadraticCurveTo(L * 0.14, 0, L * 0.2, Hh * 0.28);
      g.strokeStyle = hsl({ ...f.col, l: f.col.l - 14 }, 0.8);
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = 'hsl(213, 43%, 5%)';
      g.fillRect(L * 0.3, -Hh * 0.16, Math.max(1.5, L * 0.045), Math.max(1.5, L * 0.045));
    }
    g.restore();
  }

  // A tiny ticker tag beside the fish, on whichever side has room.
  function drawLabel(f, kind) {
    const text = f.s.ticker;
    g.font = `600 10px ${font}`;
    const tw = g.measureText(text).width;
    const gap = f.len * 0.5 + 7;
    const right = f.x + gap + tw + 4 <= W;
    const x = right ? f.x + gap : f.x - gap - tw;
    const y = f.bobY;
    g.fillStyle = 'hsla(213, 43%, 4%, 0.72)';
    g.fillRect(x - 3, y - 7, tw + 6, 13);
    g.fillStyle = kind === 'winner' ? 'hsl(147, 70%, 62%)' : 'hsl(0, 100%, 74%)';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(text, x, y);
  }

  function drawWeeds(t) {
    g.font = `600 13px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    for (const w of weeds) {
      for (let i = 0; i < w.n; i += 1) {
        const k = i / w.n;
        const sway = reduced() ? Math.sin(w.ph + i * 0.5) * 2 : Math.sin(t * 0.9 + w.ph + i * 0.45) * (1.5 + k * 7);
        g.fillStyle = `hsla(186, 50%, ${36 + k * 16}%, ${0.95 - k * 0.35})`;
        g.fillText(i % 2 ? ')' : '(', w.x + sway, floorY() - 2 - i * 13);
      }
    }
  }

  function drawBubbles(t, dt) {
    g.strokeStyle = `${ICE} 0.4)`;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < bubbles.length; i += 1) {
      const b = bubbles[i];
      if (dt) {
        b.y -= b.v * dt;
        if (b.y < SURFACE + 2) { bubbles[i] = newBubble(i); continue; }
      }
      const x = b.x + Math.sin(t * 1.6 + b.ph) * 2.5;
      g.moveTo(x + b.r, b.y);
      g.arc(x, b.y, b.r, 0, 6.2832);
    }
    g.stroke();
  }

  function step(f, dt) {
    if (f === hover) { f.face += (f.dir - f.face) * Math.min(1, dt * 4); return; } // a hovered fish holds still
    const margin = f.len * 0.5 + 4;
    if (f.x > W - margin) f.dir = -1;
    else if (f.x < margin) f.dir = 1;
    f.face += (f.dir - f.face) * Math.min(1, dt * 2.5);
    f.x += f.face * f.speed * dt;
    f.x01 = f.x / W;
    f.y += (targetY(f) - f.y) * Math.min(1, dt * 0.8);
  }

  // The fish under a point, front ones first. The fish already hovered gets a slightly
  // bigger target, so its gentle bob never flickers the readout on and off.
  const inside = (f, px, py, k = 1) => {
    const dx = (px - f.x) / (Math.max(7, f.len * 0.5) * k);
    const dy = (py - f.bobY) / (Math.max(6, f.len * 0.24) * k);
    return dx * dx + dy * dy <= 1;
  };
  function hitTest(px, py) {
    if (hover && fish.includes(hover) && inside(hover, px, py, 1.4)) return hover;
    for (let i = fish.length - 1; i >= 0; i -= 1) if (inside(fish[i], px, py)) return fish[i];
    return null;
  }

  // The readout: filled and measured here, on a pointer event, never in frame().
  let tipW = 0; let tipH = 0;
  function setHover(f) {
    if (f === hover) return;
    hover = f;
    if (!f) { tip.hidden = true; canvas.style.cursor = ''; return; }
    const s = f.s;
    const dir = s.changePct > 0 ? 'up' : s.changePct < 0 ? 'down' : 'flat';
    tip.innerHTML = `<b>${esc(s.ticker)}</b> ${esc(s.name)} <span class="${dir}">${esc(fmtPct(s.changePct))}</span>`;
    tip.hidden = false;
    tipW = tip.offsetWidth; tipH = tip.offsetHeight;
    canvas.style.cursor = 'pointer';
  }
  // Keep the readout by its fish: writes only.
  function placeTip() {
    if (!hover) return;
    const x = clamp(hover.x - tipW / 2, 4, Math.max(4, W - tipW - 4));
    const upper = hover.bobY - hover.len * 0.3 - tipH - 8;
    const y = upper > 2 ? upper : hover.bobY + hover.len * 0.3 + 8;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function frame(now, still = false) {
    if (!W || !H) return;
    const dt = still || !last ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    const t = reduced() ? 0 : clock;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(bg, 0, 0, W, H);
    drawWeeds(t);
    for (const f of fish) {
      if (dt) step(f, dt);
      f.bobY = f.y + (reduced() ? 0 : Math.sin(t * 0.7 + f.ph) * 2.5);
    }
    for (const f of fish) drawFish(f, t, f === hover);
    drawBubbles(t, dt);
    for (const kind of ['winner', 'loser']) {
      const f = labels[kind] && byTicker.get(labels[kind]);
      if (f) drawLabel(f, kind);
    }
    placeTip();
  }

  // A new screen resolution (the window moved to another display, or a zoom): redraw
  // the canvas sharp at the new pixel ratio. The query is re-armed for the next change.
  let dprQuery = null;
  function watchDpr() {
    dprQuery?.removeEventListener?.('change', onDpr);
    dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) || null;
    dprQuery?.addEventListener?.('change', onDpr);
  }
  function onDpr() {
    watchDpr();
    if (W && H) resize(W, H);
  }
  watchDpr();

  canvas.addEventListener('pointermove', (e) => {
    pointer = { x: e.offsetX, y: e.offsetY };
    setHover(hitTest(pointer.x, pointer.y));
    if (!runner.running) frame(performance.now(), true);
  });
  canvas.addEventListener('pointerleave', () => {
    pointer = null;
    setHover(null);
    if (!runner.running) frame(performance.now(), true);
  });
  canvas.addEventListener('click', (e) => {
    const f = hitTest(e.offsetX, e.offsetY);
    if (f) onOpen(f.s.ticker);
  });

  return {
    setStocks,
    resize,
    hold: (reason, on) => runner.hold(reason, on),
    get running() { return runner.running; },
    redraw: () => frame(performance.now(), true),
    get size() { return { W, H }; },
    destroy() {
      runner.destroy();
      dprQuery?.removeEventListener?.('change', onDpr);
    },
  };
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Fishtank', `<div class="ft-host" id="ft-host">${LOADING}</div>`, { cls: 'panel-solo', metaId: 'ft-meta', bodyCls: 'flush' });
  const host = el.querySelector('#ft-host');
  const meta = el.querySelector('#ft-meta');
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => Boolean(motion?.matches);
  let tank = null;
  let stocks = null;
  let left = false;
  // What holds the animation, besides data: kept here so a tank made later starts right.
  const holds = { hidden: document.hidden, offscreen: typeof IntersectionObserver === 'function', reduced: reduced() };
  const applyHolds = () => { if (tank) for (const [k, v] of Object.entries(holds)) tank.hold(k, v); };

  function mount() {
    host.innerHTML = '<canvas class="ft-canvas" role="img" aria-label="The S&amp;P 100 as fish"></canvas><div class="ft-tip" hidden></div><ul class="ft-sr" aria-label="Every fish"></ul>';
    tank = makeTank(host, host.querySelector('canvas'), host.querySelector('.ft-tip'), { onOpen: (t) => ctx.run(t), reduced });
    applyHolds();
  }

  // Size: the canvas sits absolutely inside the box, so it never changes the box; the
  // box size goes through the shared size guard, so a scrollbar that comes and goes
  // cannot start a redraw loop.
  const guard = sizeGuard();
  const now = () => performance.now();
  function fit() {
    if (!tank) return;
    const s = guard.next(host.clientWidth, host.clientHeight, now());
    if (s) tank.resize(s.w, s.h);
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
  ro?.observe(host);
  // Off screen (a DESK panel scrolled away): no frames.
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => { holds.offscreen = !entries[entries.length - 1].isIntersecting; applyHolds(); })
    : null;
  io?.observe(host);

  const onVis = () => { holds.hidden = document.hidden; applyHolds(); };
  document.addEventListener('visibilitychange', onVis);
  const onMotion = () => { holds.reduced = reduced(); applyHolds(); if (holds.reduced) tank?.redraw(); };
  motion?.addEventListener?.('change', onMotion);
  ctx.onCleanup(() => {
    left = true;
    ro?.disconnect();
    io?.disconnect();
    tank?.destroy();
    document.removeEventListener('visibilitychange', onVis);
    motion?.removeEventListener?.('change', onMotion);
  });

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/fishtank', { signal: ctx.signal });
      if (left) return;
      stocks = d.stocks;
      if (!tank) mount();
      const head = tankHeader(stocks, d.updated);
      meta.innerHTML = `<span class="ft-idx">S&amp;P 100 · </span><span class="up">${head.up} up</span> · <span class="down">${head.down} down</span>`
        + `<span class="ft-upd"> · updated ${esc(nyTime(d.updated))}</span><span class="ft-key"><span class="ft-sep"> · </span><span class="ft-long">size = company size</span><span class="ft-short">size = cap</span> · depth = today's %</span>`;
      host.querySelector('canvas').setAttribute('aria-label', `The S&P 100 as fish: ${head.up} up, ${head.down} down`);
      // The same fish as links, for keyboards and screen readers (shown on focus).
      host.querySelector('.ft-sr').innerHTML = [...stocks].sort((a, b) => b.changePct - a.changePct)
        .map((s) => `<li><a href="${esc(q(s.ticker))}" data-cmd="${esc(s.ticker)}">${esc(`${s.ticker} ${s.name} ${fmtPct(s.changePct)}`)}</a></li>`).join('');
      if (!tank.size.W) fit();
      tank.setStocks(stocks);
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError' || left) return;
      if (!stocks) host.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH FISHTANK', 'warn');
    }
  }

  load();
  ctx.live(load, 60_000);
}
