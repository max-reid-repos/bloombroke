// REPLAY: the WHATIF race, from the first buy to today, in three thin lines.
//
//   STOCK          the value of the shares bought so far
//   CASH IN A JAR  the same dollars kept in a jar, deflated by CPI-U
//   SPENT          the running total paid, drawn below zero (money out)
//
// The points come from the server (data/whatif.js replaySeries): one per month, one per
// purchase day and today. The last point equals the result table exactly. Pure maths at
// the top (node:test imports it), then the terminal-style canvas and the player.

export const LINE_KEYS = ['stock', 'jar', 'spent'];
export const LINE_LABELS = { stock: 'STOCK', jar: 'CASH IN A JAR', spent: 'SPENT' };

// 8 to 12 seconds: longer histories get a little longer.
export function durationMs(points) {
  const n = Array.isArray(points) ? points.length : 0;
  return Math.round(Math.min(12000, Math.max(8000, 8000 + n * 18)));
}

export const timeOf = (pt) => Date.parse(`${pt.d}T12:00:00Z`);

// The race at progress p (0 to 1, linear in time): the date and the three values.
export function frameAt(points, p) {
  const n = points.length;
  const last = points[n - 1];
  const t0 = timeOf(points[0]);
  const t1 = timeOf(last);
  if (!(p < 1) || n === 1 || t1 <= t0) return { t: t1, i: n - 1, stock: last.stock, jar: last.jar, spent: last.spent, done: true };
  const t = t0 + (t1 - t0) * Math.max(0, p);
  let i = 0;
  while (i < n - 2 && timeOf(points[i + 1]) <= t) i += 1;
  const a = points[i];
  const b = points[i + 1];
  const ta = timeOf(a);
  const tb = timeOf(b);
  const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 1;
  const mix = (k) => a[k] + (b[k] - a[k]) * f;
  return { t, i, stock: mix('stock'), jar: mix('jar'), spent: mix('spent'), done: false };
}

// The value box behind the lines: stock and jar above zero, spent below it.
export function scaleOf(points) {
  let top = 0;
  let bottom = 0;
  for (const p of points) {
    top = Math.max(top, p.stock, p.jar);
    bottom = Math.max(bottom, p.spent);
  }
  return { top: top || 1, bottom: bottom || 1 };
}

// Is the stock behind what was paid so far? (The big number is red then.)
export const isBehind = (f) => f.spent > 0 && f.stock < f.spent;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function fmtCounter(t) {
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---- Terminal canvas -------------------------------------------------------------

function cssVar(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

// Where the three names go at the lines' ends: in the lines' order top to bottom, at
// least `gap` px apart and inside [top, bottom]. ys: the ends' y, in LINE_KEYS order.
export function labelYs(ys, { gap = 12, top = 0, bottom = Infinity } = {}) {
  const order = ys.map((y, i) => [y, i]).sort((a, b) => a[0] - b[0]);
  const out = order.map(([y]) => y);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.max(out[i], i ? out[i - 1] + gap : top);
  for (let i = out.length - 1; i >= 0; i -= 1) out[i] = Math.min(out[i], i < out.length - 1 ? out[i + 1] - gap : bottom);
  const res = [];
  order.forEach(([, i], k) => { res[i] = out[k]; });
  return res;
}

// The lines up to frame f, thin, in terminal colours, with small monospace year marks,
// each line named at its end (STOCK, CASH IN A JAR, SPENT), so no key is needed.
export function drawTerminal(canvas, points, f) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const col = {
    stock: cssVar(canvas, '--accent', '#6CCBFF'),
    jar: cssVar(canvas, '--cmp-3', '#8f99a3'),
    spent: cssVar(canvas, '--down', '#FF5C5C'),
    rule: cssVar(canvas, '--rule-strong', '#2a3642'),
    dim: cssVar(canvas, '--dim', '#7C93A8'),
  };
  const font = cssVar(canvas, '--font', 'monospace');
  ctx.font = `11px ${font}`;
  const padL = 4;
  // Room at the right for the names, after the last point.
  const padR = 8 + Math.ceil(Math.max(...LINE_KEYS.map((k) => ctx.measureText(LINE_LABELS[k]).width)));
  const padT = 6;
  const padB = 16;
  const t0 = timeOf(points[0]);
  const t1 = timeOf(points[points.length - 1]);
  const { top, bottom } = scaleOf(points);
  const X = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (w - padL - padR);
  const span = top + bottom;
  const Y = (v) => padT + ((top - v) / span) * (h - padT - padB);

  // Zero line and year marks.
  ctx.font = `10px ${font}`;
  ctx.fillStyle = col.dim;
  ctx.strokeStyle = col.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, Math.round(Y(0)) + 0.5);
  ctx.lineTo(w - padR, Math.round(Y(0)) + 0.5);
  ctx.stroke();
  const y0 = new Date(t0).getUTCFullYear();
  const y1 = new Date(t1).getUTCFullYear();
  const every = Math.max(1, Math.ceil((y1 - y0 + 1) / Math.max(2, Math.floor(w / 70))));
  ctx.textBaseline = 'bottom';
  for (let y = y0 + 1; y <= y1; y += 1) {
    if ((y - y0) % every) continue;
    const x = X(Date.UTC(y, 0, 1, 12));
    if (x < padL + 12 || x > w - padR - 16) continue;
    ctx.fillText(String(y), x - 12, h);
    ctx.fillRect(Math.round(x), Math.round(Y(0)) - 2, 1, 5);
  }

  // The lines, up to the current frame.
  const upto = points.slice(0, f.i + 1).map((p) => ({ t: timeOf(p), stock: p.stock, jar: p.jar, spent: p.spent }));
  if (!f.done) upto.push({ t: f.t, stock: f.stock, jar: f.jar, spent: f.spent });
  const line = (key, color, sign = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    upto.forEach((p, i) => { const x = X(p.t); const y = Y(sign * p[key]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    const endP = upto[upto.length - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X(endP.t), Y(sign * endP[key]), 2.5, 0, Math.PI * 2);
    ctx.fill();
  };
  line('spent', col.spent, -1);
  line('jar', col.jar);
  line('stock', col.stock);

  // The names, just right of the ends.
  const endP = upto[upto.length - 1];
  const sign = { stock: 1, jar: 1, spent: -1 };
  const ys = labelYs(LINE_KEYS.map((k) => Y(sign[k] * endP[k])), { gap: 12, top: padT + 4, bottom: h - padB - 4 });
  ctx.font = `11px ${font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  LINE_KEYS.forEach((k, i) => {
    ctx.fillStyle = col[k];
    ctx.fillText(LINE_LABELS[k], X(endP.t) + 6, ys[i]);
  });
}

// ---- Player ------------------------------------------------------------------------

// Plays the race in canvas, calling onFrame(f) each frame and onDone() at the end.
// reduced motion (or reduced: true): the final frame at once.
export function createReplay(canvas, points, { onFrame = () => {}, onDone = () => {}, reduced } = {}) {
  let raf = 0;
  let current = frameAt(points, 1);
  const still = reduced ?? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const draw = (f) => { current = f; drawTerminal(canvas, points, f); onFrame(f); };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => drawTerminal(canvas, points, current)) : null;
  ro?.observe(canvas);

  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function finish() { stop(); draw(frameAt(points, 1)); onDone(); }
  function play() {
    stop();
    if (still) { finish(); return; }
    const total = durationMs(points);
    let start = 0;
    const step = (now) => {
      if (!start) start = now;
      const p = (now - start) / total;
      if (p >= 1) { finish(); return; }
      draw(frameAt(points, p));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  return {
    play,
    finish,
    playing: () => Boolean(raf),
    destroy() { stop(); ro?.disconnect(); },
  };
}
