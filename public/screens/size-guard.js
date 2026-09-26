// Which box sizes a chart redraws for. A chart that redraws on every resize can feed a
// loop: a scrollbar appears, the box shrinks, the chart redraws smaller, the scrollbar
// goes, the box grows, and round again. The guard rounds sizes, skips a size already
// drawn, and when the box flips between two sizes (A, B, A) within windowMs it settles
// on the larger one and ignores the pair until a third size comes along.

const area = (s) => s.w * s.h;

export function sizeGuard({ windowMs = 1000 } = {}) {
  let hist = []; // sizes drawn, newest last: { w, h, t }
  let pair = null; // [A, B] while settled
  const same = (a, b) => a && b && a.w === b.w && a.h === b.h;

  function drawn(w, h, t) {
    const s = { w: Math.round(w), h: Math.round(h), t };
    if (same(s, hist[hist.length - 1])) hist[hist.length - 1].t = t;
    else hist = [...hist.slice(-2), s];
  }

  // The size to draw for a new box size, or null to keep the chart as it is.
  function next(w, h, t) {
    const s = { w: Math.round(w), h: Math.round(h), t };
    if (!s.w || !s.h) return null;
    const last = hist[hist.length - 1];
    if (same(s, last)) return null;
    if (pair) {
      if (pair.some((p) => same(p, s))) return null;
      pair = null; // a real resize: follow it again
    }
    const prev = hist[hist.length - 2];
    if (same(s, prev) && t - prev.t <= windowMs) {
      // A, B, A: a loop. Settle on the larger of the two.
      pair = [prev, last];
      const big = area(prev) >= area(last) ? prev : last;
      if (same(big, last)) return null;
      drawn(big.w, big.h, t);
      return { w: big.w, h: big.h };
    }
    drawn(s.w, s.h, t);
    return { w: s.w, h: s.h };
  }

  return { next, drawn };
}
