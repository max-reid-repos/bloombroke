// WORLDMAP helpers, pure (no DOM): the map projection, which index colours which
// country, the colour scale, and the chokepoint and storm markers. The build script
// (scripts/build-worldmap.js) projects the country shapes with the same projection, so
// a dot placed here lands on the right coast of the shipped map.

// ---- Projection: Robinson, cropped to 84N .. 57S (no Antarctica) ------------------

// Snyder's table, every 5 degrees of latitude from 0 to 90: [length of the parallel, distance from the equator].
const ROBINSON = [
  [1.0000, 0.0000], [0.9986, 0.0620], [0.9954, 0.1240], [0.9900, 0.1860], [0.9822, 0.2480],
  [0.9730, 0.3100], [0.9600, 0.3720], [0.9427, 0.4340], [0.9216, 0.4958], [0.8962, 0.5571],
  [0.8679, 0.6176], [0.8350, 0.6769], [0.7986, 0.7346], [0.7597, 0.7903], [0.7186, 0.8435],
  [0.6732, 0.8936], [0.6213, 0.9394], [0.5722, 0.9761], [0.5322, 1.0000],
];

// Unit Robinson (R = 1): lon, lat in degrees -> [x, y], y up. Linear between table rows.
export function robinson(lon, lat) {
  const a = Math.min(90, Math.abs(lat)) / 5;
  const i = Math.min(17, Math.floor(a));
  const t = a - i;
  const plen = ROBINSON[i][0] + (ROBINSON[i + 1][0] - ROBINSON[i][0]) * t;
  const pdfe = ROBINSON[i][1] + (ROBINSON[i + 1][1] - ROBINSON[i][1]) * t;
  return [0.8487 * plen * (lon * Math.PI) / 180, 1.3523 * pdfe * Math.sign(lat)];
}

export const MAP_W = 1000;
export const LAT_TOP = 84;
export const LAT_BOTTOM = -57;
const SCALE = MAP_W / (2 * 0.8487 * Math.PI); // 180 degrees east of the centre = the right edge
const Y_TOP = robinson(0, LAT_TOP)[1];
export const MAP_H = Math.round((Y_TOP - robinson(0, LAT_BOTTOM)[1]) * SCALE);

// lon, lat in degrees -> [x, y] in map units: 0,0 top left, MAP_W x MAP_H.
export function project(lon, lat) {
  const [x, y] = robinson(lon, lat);
  return [MAP_W / 2 + x * SCALE, (Y_TOP - y) * SCALE];
}

// ---- Layer 1: countries and their main index -----------------------------------

// ISO country code -> the terminal's instrument id (its CNBC symbol in instruments.js)
// and the exchange whose hours say open or closed (screens/clock.js). Symbols checked
// live against CNBC on 2026-09-26; Saudi Arabia (Tadawul) has no working CNBC symbol,
// so it is left off.
export const COUNTRY_INDEX = {
  US: { id: 'SPX', src: '.SPX', ex: 'NYSE' },
  CA: { id: 'TSX', src: '.GSPTSE', ex: 'TSX' },
  MX: { id: 'MEXBOL', src: '.MXX', ex: 'BMV' },
  BR: { id: 'BOVESPA', src: '.BVSP', ex: 'B3' },
  AR: { id: 'MERVAL', src: '.MERV', ex: 'BYMA' },
  GB: { id: 'FTSE', src: '.FTSE', ex: 'LSE' },
  DE: { id: 'DAX', src: '.GDAXI', ex: 'XETRA' },
  FR: { id: 'CAC40', src: '.FCHI', ex: 'EURONEXT' },
  ES: { id: 'IBEX35', src: '.IBEX', ex: 'BME' },
  IT: { id: 'FTSEMIB', src: '.FTMIB', ex: 'BIT' },
  NL: { id: 'AEX', src: '.AEX', ex: 'AMS' },
  CH: { id: 'SMI', src: '.SSMI', ex: 'SIX' },
  TR: { id: 'BIST100', src: '.XU100', ex: 'BIST' },
  JP: { id: 'N225', src: '.N225', ex: 'TSE' },
  CN: { id: 'SHANGHAI', src: '.SSEC', ex: 'SSE' },
  HK: { id: 'HSI', src: '.HSI', ex: 'HKEX' },
  KR: { id: 'KOSPI', src: '.KS11', ex: 'KRX' },
  TW: { id: 'TAIEX', src: '.TWII', ex: 'TWSE' },
  IN: { id: 'NIFTY50', src: '.NSEI', ex: 'NSE' },
  AU: { id: 'ASX200', src: '.AXJO', ex: 'ASX' },
  TH: { id: 'SET', src: '.SETI', ex: 'SET' },
  VN: { id: 'VNINDEX', src: '.VNI', ex: 'HOSE' },
};

// Places too small for a 110m country shape: drawn as a dot, [lon, lat].
export const CITY_DOTS = { HK: { name: 'Hong Kong', at: [114.17, 22.3] } };

export function indexFor(cc) {
  return COUNTRY_INDEX[cc] || null;
}

// Every index id, for the one /api/quotes call (it takes up to 60).
export function indexIds() {
  return [...new Set(Object.values(COUNTRY_INDEX).map((c) => c.id))];
}

// ---- Colour scale: diverging, capped at +-3% ------------------------------------

export const CAP_PCT = 3;
export const NO_INDEX_FILL = 'hsl(212, 16%, 13%)';
export const FLAT_FILL = 'hsl(210, 12%, 30%)';

// Moves smaller than this are flat (steel grey).
export const FLAT_PCT = 0.1;

// % change -> fill. Steel grey within +-0.1%, deeper green or red up to +-3% (and past it).
export function moveFill(pct) {
  if (!Number.isFinite(pct)) return NO_INDEX_FILL;
  if (Math.abs(pct) < FLAT_PCT) return FLAT_FILL;
  const t = Math.min(1, Math.abs(pct) / CAP_PCT);
  return pct > 0
    ? `hsl(147, ${Math.round(30 + 40 * t)}%, ${Math.round(28 + 16 * t)}%)`
    : `hsl(0, ${Math.round(38 + 50 * t)}%, ${Math.round(32 + 18 * t)}%)`;
}

export const LEGEND_STEPS = [-3, -2, -1, 0, 1, 2, 3];

// ---- Layer 2: chokepoints (the CANAL gauge's rows) --------------------------------

// portid (IMF PortWatch) -> [lon, lat] of the narrows, and where its label sits.
export const CHOKE_AT = {
  chokepoint6: { at: [56.3, 26.5], label: 'right' },   // Strait of Hormuz
  chokepoint1: { at: [32.35, 30.6], label: 'left' },   // Suez Canal
  chokepoint2: { at: [-79.7, 9.1], label: 'left' },    // Panama Canal
  chokepoint5: { at: [100.9, 2.9], label: 'left' },    // Malacca Strait
  chokepoint4: { at: [43.4, 12.6], label: 'right' },   // Bab el-Mandeb
  chokepoint3: { at: [29.05, 41.1], label: 'left' },   // Bosporus
};

export const DOT_MIN = 2.5;
export const DOT_MAX = 13;

// Circle area follows the ship count: radius = DOT_MAX * sqrt(n / top), never below
// DOT_MIN for a live count. top is the busiest value on the map (today or average).
export function dotRadius(n, top) {
  if (!Number.isFinite(n) || n < 0 || !(top > 0)) return 0;
  return Math.max(DOT_MIN, DOT_MAX * Math.sqrt(Math.min(n, top) / top));
}

// "Far below average": the latest day under half the 1-year daily average.
export const LOW_RATIO = 0.5;
export function chokeLow(total, avg) {
  return Number.isFinite(total) && Number.isFinite(avg) && avg > 0 && total < avg * LOW_RATIO;
}

// CANAL rows -> markers { portid, name, full, x, y, r, ring, low, label, row }.
export function chokeMarkers(rows) {
  const list = (rows || []).filter((r) => CHOKE_AT[r.portid]);
  const top = Math.max(0, ...list.flatMap((r) => [r.total, r.avgTotal].filter(Number.isFinite)));
  return list.map((r) => {
    const [x, y] = project(...CHOKE_AT[r.portid].at);
    return {
      portid: r.portid, name: r.name, full: r.full || r.name, x, y,
      r: dotRadius(r.total, top), ring: dotRadius(r.avgTotal, top),
      low: chokeLow(r.total, r.avgTotal), label: CHOKE_AT[r.portid].label, row: r,
    };
  });
}

// ---- Layer 3: storms (the WAFFLE gauge's NHC list) --------------------------------

// Wind in knots (and NHC's classification) -> the short category: C1..C5 on the
// Saffir-Simpson scale for hurricanes, else TS, TD or the NHC code.
export function stormCategory(windKt, kind = '') {
  const k = String(kind || '').toUpperCase();
  if (Number.isFinite(windKt) && windKt >= 64 && (k === 'HU' || k === '' || k === 'TY')) {
    if (windKt >= 137) return 'C5';
    if (windKt >= 113) return 'C4';
    if (windKt >= 96) return 'C3';
    if (windKt >= 83) return 'C2';
    return 'C1';
  }
  if (k) return k.slice(0, 4);
  if (!Number.isFinite(windKt)) return '';
  return windKt >= 34 ? 'TS' : 'TD';
}

const KIND_WORDS = {
  HU: 'Hurricane', TS: 'Tropical storm', TD: 'Tropical depression', STS: 'Subtropical storm',
  SD: 'Subtropical depression', PTC: 'Potential tropical cyclone', PC: 'Post-tropical cyclone', TY: 'Typhoon',
};
export function stormKindWord(kind) {
  return KIND_WORDS[String(kind || '').toUpperCase()] || 'Storm';
}

// Storm rows -> markers { id, name, x, y, cat, row }; bad positions are left out.
export function stormMarkers(storms) {
  return (storms || [])
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lat <= LAT_TOP && s.lat >= LAT_BOTTOM && Math.abs(s.lon) <= 180)
    .map((s) => {
      const [x, y] = project(s.lon, s.lat);
      return { id: s.id, name: s.name, x, y, cat: stormCategory(s.windKt, s.kind), row: s };
    });
}

// ---- Size: the map scaled into its box --------------------------------------------

// Box w x h (h = the height it may take) -> the map's drawn size, keeping its shape.
export function fitMap(w, h) {
  if (!(w > 0)) return { w: 0, h: 0 };
  const byW = { w, h: (w * MAP_H) / MAP_W };
  if (!(h > 0) || byW.h <= h) return { w: Math.floor(byW.w), h: Math.floor(byW.h) };
  return { w: Math.floor((h * MAP_W) / MAP_H), h: Math.floor(h) };
}

// ---- Labels: each one beside its marker, never on top of another ------------------

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function labelBox(it, side) {
  const { x, y, w, h, gap } = it;
  if (side === 'left') return { x0: x - gap - w, x1: x - gap, y0: y - h / 2, y1: y + h / 2, tx: x - gap, ty: y + h * 0.35, anchor: 'end', side };
  if (side === 'below') return { x0: x - w / 2, x1: x + w / 2, y0: y + gap, y1: y + gap + h, tx: x, ty: y + gap + h * 0.8, anchor: 'middle', side };
  if (side === 'above') return { x0: x - w / 2, x1: x + w / 2, y0: y - gap - h, y1: y - gap, tx: x, ty: y - gap - h * 0.2, anchor: 'middle', side };
  return { x0: x + gap, x1: x + gap + w, y0: y - h / 2, y1: y + h / 2, tx: x + gap, ty: y + h * 0.35, anchor: 'start', side: 'right' };
}

// items: [{ x, y, r, w, h, gap, prefer }] (map units; r = the marker's radius, w, h =
// the label's size, gap = the marker's radius plus a margin). Markers are obstacles too. Returns one
// { tx, ty, anchor, side } per item: the first side that fits inside the map and clears
// everything placed so far, else the preferred side.
export function placeLabels(items, bounds = { w: MAP_W, h: MAP_H }) {
  const taken = items.map((it) => ({ x0: it.x - it.r, x1: it.x + it.r, y0: it.y - it.r, y1: it.y + it.r }));
  return items.map((it, i) => {
    const sides = [...new Set([it.prefer || 'right', 'right', 'left', 'below', 'above'])];
    let pick = null;
    for (const side of sides) {
      const b = labelBox(it, side);
      const inside = b.x0 >= 0 && b.x1 <= bounds.w && b.y0 >= 0 && b.y1 <= bounds.h;
      if (inside && !taken.some((o, j) => j !== i && overlaps(o, b))) { pick = b; break; }
    }
    pick ||= labelBox(it, it.prefer || 'right');
    taken.push(pick);
    return { tx: pick.tx, ty: pick.ty, anchor: pick.anchor, side: pick.side };
  });
}
