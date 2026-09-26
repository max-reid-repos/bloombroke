import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  robinson, project, MAP_W, MAP_H, LAT_TOP, LAT_BOTTOM,
  COUNTRY_INDEX, CITY_DOTS, indexFor, indexIds,
  moveFill, NO_INDEX_FILL, FLAT_FILL, CAP_PCT,
  dotRadius, DOT_MIN, DOT_MAX, chokeLow, chokeMarkers, CHOKE_AT,
  stormCategory, stormMarkers, fitMap, placeLabels,
} from '../public/screens/worldmap-geo.js';
import { simplify, ringsToPath, buildMap } from '../scripts/build-worldmap.js';
import { layerState, LAYERS } from '../public/screens/worldmap.js';
import { INSTRUMENTS, instrumentById, instrumentBySrc, resolveInstrument } from '../public/instruments.js';
import { EXCHANGES } from '../public/screens/clock.js';
import { WORLD } from '../data/world.js';
import { MAX_LIST } from '../data/quotes.js';
import { parseCommand } from '../public/app.js';
import { findCommand } from '../public/registry.js';
import { CHOKEPOINTS } from '../data/weird/canal.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// ---- projection ------------------------------------------------------------------

test('worldmap projection: Robinson, centred, cropped to 84N..57S', () => {
  const [x0, y0] = robinson(0, 0);
  close(x0, 0);
  close(y0, 0);
  close(robinson(180, 0)[0], 0.8487 * Math.PI);
  close(robinson(0, 90)[1], 1.3523);
  close(robinson(0, -45)[1], -robinson(0, 45)[1]);
  close(robinson(0, 45)[1], 1.3523 * 0.5571); // a table row, exact
  close(robinson(90, 45)[0], 0.8487 * 0.8962 * (Math.PI / 2));
  // Between rows: linear, so 47.5 is halfway between 45 and 50.
  close(robinson(0, 47.5)[1], 1.3523 * (0.5571 + 0.6176) / 2);
  // Map units: the edges and the crop.
  close(project(-180, 0)[0], 0);
  close(project(180, 0)[0], MAP_W);
  close(project(0, 0)[0], MAP_W / 2);
  close(project(0, LAT_TOP)[1], 0);
  assert.ok(Math.abs(project(0, LAT_BOTTOM)[1] - MAP_H) < 1, 'the bottom crop is the map height');
  assert.equal(MAP_H, 423);
  // North is up, east is right, and parallels shrink toward the poles.
  assert.ok(project(0, 50)[1] < project(0, 10)[1]);
  assert.ok(project(30, 0)[0] > project(10, 0)[0]);
  assert.ok(project(100, 60)[0] - MAP_W / 2 < project(100, 0)[0] - MAP_W / 2);
});

test('worldmap projection: known places land where the shipped map has them', () => {
  const geo = JSON.parse(readFileSync('public/geo/world-110m.json', 'utf8'));
  const pathOf = (cc) => geo.countries.find((c) => c.cc === cc).d;
  // The bounding box of a country's outline, from its relative path data.
  function bbox(d) {
    let x = 0; let y = 0; let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const part of d.split('z').filter(Boolean)) {
      const [head, rest = ''] = part.split('l');
      [x, y] = head.slice(1).trim().split(/\s+/).map(Number);
      const nums = (rest.match(/-?\d*\.?\d+/g) || []).map(Number);
      const pts = [[x, y]];
      for (let i = 0; i + 1 < nums.length; i += 2) { x += nums[i]; y += nums[i + 1]; pts.push([x, y]); }
      for (const [px, py] of pts) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
    }
    return { x0, x1, y0, y1 };
  }
  const inside = (pt, b, pad = 0) => pt[0] >= b.x0 - pad && pt[0] <= b.x1 + pad && pt[1] >= b.y0 - pad && pt[1] <= b.y1 + pad;
  assert.ok(inside(project(2.35, 48.86), bbox(pathOf('FR'))), 'Paris is in France');
  assert.ok(inside(project(139.7, 35.7), bbox(pathOf('JP'))), 'Tokyo is in Japan');
  assert.ok(inside(project(-58.4, -34.6), bbox(pathOf('AR')), 2), 'Buenos Aires is by Argentina');
  // Chokepoints sit on the coasts they belong to.
  assert.ok(inside(project(...CHOKE_AT.chokepoint1.at), bbox(pathOf('EG'))), 'Suez is in Egypt');
  assert.ok(inside(project(...CHOKE_AT.chokepoint2.at), bbox(pathOf('PA'))), 'the Panama Canal is in Panama');
  assert.ok(inside(project(...CHOKE_AT.chokepoint3.at), bbox(pathOf('TR'))), 'the Bosporus is in Turkey');
  const my = bbox(pathOf('MY'));
  assert.ok(inside(project(...CHOKE_AT.chokepoint5.at), my, 3), 'Malacca is by Malaysia');
  const ye = bbox(pathOf('YE'));
  assert.ok(inside(project(...CHOKE_AT.chokepoint4.at), ye, 2), 'Bab el-Mandeb is by Yemen');
  const om = bbox(pathOf('OM'));
  assert.ok(inside(project(...CHOKE_AT.chokepoint6.at), om, 2), 'Hormuz is by Oman');
});

test('worldmap asset: small, every country once, plain path data', () => {
  assert.ok(statSync('public/geo/world-110m.json').size < 250 * 1024, 'under 250 KB');
  const geo = JSON.parse(readFileSync('public/geo/world-110m.json', 'utf8'));
  assert.equal(geo.w, MAP_W);
  assert.equal(geo.h, MAP_H);
  assert.match(geo.source, /Natural Earth/);
  assert.ok(geo.countries.length > 150);
  assert.equal(new Set(geo.countries.map((c) => c.cc)).size, geo.countries.length);
  for (const c of geo.countries) {
    assert.match(c.d, /^(M[-\d. ]+l[-\d. ]*z)+$/, `${c.cc} path`);
    assert.equal(typeof c.name, 'string');
  }
  assert.ok(!geo.countries.some((c) => c.cc === 'AQ' || c.cc === 'ATA'), 'no Antarctica');
  // Every mapped country but the city dots has a shape.
  for (const cc of Object.keys(COUNTRY_INDEX)) {
    assert.ok(geo.countries.some((c) => c.cc === cc) || CITY_DOTS[cc], `${cc} is on the map`);
  }
});

test('worldmap build: simplify keeps the ends, path data is relative tenths', () => {
  const line = [[0, 0], [1, 0.01], [2, 0], [3, 5], [4, 0]];
  const s = simplify(line, 0.2);
  assert.deepEqual(s[0], [0, 0]);
  assert.deepEqual(s[s.length - 1], [4, 0]);
  assert.ok(!s.some((p) => p[0] === 1), 'the near-straight point goes');
  assert.ok(s.some((p) => p[0] === 3), 'the spike stays');
  assert.equal(ringsToPath([[[10, 10], [20, 10], [20, 20.05], [10, 10]]]), 'M10 10l10 0 0 10.1z');
  const fc = {
    features: [
      { properties: { ISO_A2_EH: 'FR', NAME: 'France', ADM0_A3: 'FRA' }, geometry: { type: 'Polygon', coordinates: [[[0, 45], [5, 45], [5, 50], [0, 50], [0, 45]]] } },
      { properties: { ISO_A2_EH: '-99', NAME: 'Somaliland', ADM0_A3: 'SOL' }, geometry: { type: 'Polygon', coordinates: [[[44, 9], [48, 9], [48, 11], [44, 11], [44, 9]]] } },
      { properties: { ISO_A2_EH: 'AQ', NAME: 'Antarctica', ADM0_A3: 'ATA' }, geometry: { type: 'Polygon', coordinates: [[[0, -80], [5, -80], [5, -70], [0, -80]]] } },
    ],
  };
  const m = buildMap(fc);
  assert.deepEqual(m.countries.map((c) => c.cc), ['FR', 'SOL']);
});

// ---- country -> index -------------------------------------------------------------

test('worldmap mapping: each country has a known index, its CNBC symbol and exchange', () => {
  const ids = indexIds();
  assert.ok(ids.length <= MAX_LIST, 'one /api/quotes call');
  assert.equal(ids.length, Object.keys(COUNTRY_INDEX).length, 'no index twice');
  for (const [cc, c] of Object.entries(COUNTRY_INDEX)) {
    const inst = instrumentById(c.id);
    assert.ok(inst, `${cc}: ${c.id} is a known instrument`);
    assert.equal(inst.src, c.src, `${cc}: CNBC symbol`);
    assert.equal(inst.kind, 'index');
    assert.ok(EXCHANGES[c.ex], `${cc}: exchange ${c.ex}`);
    // The same symbol WORLD lists for that country, so both screens agree.
    const w = WORLD.find((x) => x.src === c.src);
    assert.ok(w, `${cc}: on WORLD`);
    assert.equal(w.ex, c.ex, `${cc}: same exchange as WORLD`);
    assert.equal(parseCommand(c.id).name, 'QUOTE', `${c.id} opens its screen`);
  }
  assert.equal(indexFor('US').id, 'SPX');
  assert.equal(indexFor('GB').src, '.FTSE');
  assert.equal(indexFor('SA'), null, 'Saudi Arabia: no working CNBC symbol');
  assert.equal(indexFor('KE'), null);
  // New ids never shadow a stock: IBEX (a Nasdaq stock) stays a stock.
  assert.equal(resolveInstrument('IBEX'), null);
  assert.equal(resolveInstrument('ibex35').id, 'IBEX35');
  assert.equal(resolveInstrument('nifty').id, 'NIFTY50');
});

test('instruments: each CNBC symbol, id and alias exists once', () => {
  const seen = new Map();
  for (const i of INSTRUMENTS) {
    assert.ok(!seen.has(i.src), `${i.src}: ${seen.get(i.src)} and ${i.id}`);
    seen.set(i.src, i.id);
  }
  const keys = new Map();
  for (const i of INSTRUMENTS) {
    for (const k of [i.id, ...i.aliases].map((x) => x.toUpperCase())) {
      assert.ok(!keys.has(k) || keys.get(k) === i.id, `${k}: ${keys.get(k)} and ${i.id}`);
      keys.set(k, i.id);
    }
  }
  // WORLDMAP reuses whatever id already carries its symbol.
  for (const c of Object.values(COUNTRY_INDEX)) assert.equal(instrumentBySrc(c.src).id, c.id, c.src);
});

// ---- colour scale -----------------------------------------------------------------

test('worldmap colour: diverging green and red, capped at 3%', () => {
  assert.equal(moveFill(NaN), NO_INDEX_FILL);
  assert.equal(moveFill(undefined), NO_INDEX_FILL);
  assert.equal(moveFill(0), FLAT_FILL);
  assert.equal(moveFill(0.004), FLAT_FILL);
  assert.match(moveFill(1), /^hsl\(147,/);
  assert.match(moveFill(-1), /^hsl\(0,/);
  assert.equal(moveFill(CAP_PCT), moveFill(7.5), 'capped at +3%');
  assert.equal(moveFill(-CAP_PCT), moveFill(-12), 'capped at -3%');
  const light = (s) => Number(/(\d+)%\)$/.exec(s)[1]);
  assert.ok(light(moveFill(2)) > light(moveFill(0.5)), 'bigger moves are brighter');
  assert.ok(light(moveFill(-2)) > light(moveFill(-0.5)));
  assert.notEqual(NO_INDEX_FILL, FLAT_FILL, 'no index is not the same as flat');
});

// ---- chokepoints ------------------------------------------------------------------

test('worldmap ships: dot area follows the count, ring is the 1-year average', () => {
  assert.equal(dotRadius(250, 250), DOT_MAX);
  close(dotRadius(62.5, 250), DOT_MAX / 2); // a quarter of the ships, half the radius
  assert.equal(dotRadius(1, 250), DOT_MIN, 'a tiny count still shows');
  assert.equal(dotRadius(0, 250), DOT_MIN);
  assert.equal(dotRadius(null, 250), 0);
  assert.equal(dotRadius(10, 0), 0);
  assert.equal(dotRadius(400, 250), DOT_MAX);
  assert.equal(chokeLow(1, 35), true, 'Hormuz at 1 ship vs 35 a day');
  assert.equal(chokeLow(20, 35), false);
  assert.equal(chokeLow(17, 35), true);
  assert.equal(chokeLow(null, 35), false);
  assert.equal(chokeLow(5, null), false);
  const rows = [
    { portid: 'chokepoint6', name: 'Hormuz', full: 'Strait of Hormuz', total: 1, avgTotal: 35 },
    { portid: 'chokepoint5', name: 'Malacca', full: 'Malacca Strait', total: 230, avgTotal: 228.7 },
    { portid: 'nope', name: 'Nope', total: 5, avgTotal: 5 },
  ];
  const m = chokeMarkers(rows);
  assert.equal(m.length, 2, 'unknown chokepoints are left out');
  assert.equal(m[1].r, DOT_MAX, 'the busiest is the biggest');
  assert.ok(m[0].low);
  assert.ok(!m[1].low);
  assert.ok(m[0].ring > m[0].r, 'Hormuz: the ring is far outside the dot');
  // Every CANAL chokepoint has a place on the map.
  for (const c of CHOKEPOINTS) assert.ok(CHOKE_AT[c.portid], c.name);
});

test('worldmap storms: Saffir-Simpson category from the wind, bad positions dropped', () => {
  assert.equal(stormCategory(150, 'HU'), 'C5');
  assert.equal(stormCategory(137, 'HU'), 'C5');
  assert.equal(stormCategory(136, 'HU'), 'C4');
  assert.equal(stormCategory(105, 'HU'), 'C3');
  assert.equal(stormCategory(90, 'HU'), 'C2');
  assert.equal(stormCategory(64, 'HU'), 'C1');
  assert.equal(stormCategory(40, 'TS'), 'TS');
  assert.equal(stormCategory(30, 'TD'), 'TD');
  assert.equal(stormCategory(45, ''), 'TS');
  const m = stormMarkers([
    { id: 'a', name: 'Polo', kind: 'HU', windKt: 150, lat: 17.5, lon: -110.5 },
    { id: 'b', name: 'Bad', kind: 'TS', windKt: 40, lat: NaN, lon: 0 },
  ]);
  assert.equal(m.length, 1);
  assert.equal(m[0].cat, 'C5');
  assert.ok(m[0].x < MAP_W / 2 && m[0].y > 0 && m[0].y < MAP_H);
});

// ---- size and labels --------------------------------------------------------------

test('worldmap size: fits the box and keeps its shape', () => {
  assert.deepEqual(fitMap(1000, 1000), { w: 1000, h: 423 });
  assert.deepEqual(fitMap(1000, 300), { w: 709, h: 300 });
  assert.deepEqual(fitMap(390, 0), { w: 390, h: 164 }, 'no height limit: fit the width');
  assert.deepEqual(fitMap(0, 300), { w: 0, h: 0 });
});

test('worldmap labels: the next free side, never on top of another', () => {
  const items = [
    { x: 100, y: 100, r: 5, gap: 8, w: 60, h: 12, prefer: 'right' },
    { x: 100, y: 110, r: 5, gap: 8, w: 60, h: 12, prefer: 'right' },
  ];
  const [a, b] = placeLabels(items);
  assert.equal(a.side, 'right');
  assert.notEqual(b.side, 'right', 'the second label moves');
  const edge = placeLabels([{ x: 990, y: 50, r: 3, gap: 6, w: 60, h: 12, prefer: 'right' }])[0];
  assert.equal(edge.side, 'left', 'kept inside the map');
  assert.equal(edge.anchor, 'end');
});

test('worldmap screen: layers default on, command in HELP', () => {
  assert.deepEqual(layerState(null), { INDEXES: true, SHIPS: true, STORMS: true });
  assert.deepEqual(layerState({ SHIPS: false }), { INDEXES: true, SHIPS: false, STORMS: true });
  assert.deepEqual(layerState('junk'), { INDEXES: true, SHIPS: true, STORMS: true });
  assert.deepEqual(LAYERS, ['INDEXES', 'SHIPS', 'STORMS']);
  assert.equal(parseCommand('worldmap').name, 'WORLDMAP');
  const h = findCommand('WORLDMAP');
  assert.equal(h.category, 'Markets');
  const words = h.summary.split(/\s+/).length;
  assert.ok(words >= 3 && words <= 5, h.summary);
});

test('worldmap copy: no em dashes, no amber, no banned brand word', () => {
  for (const f of ['public/screens/worldmap.js', 'public/screens/worldmap-geo.js', 'scripts/build-worldmap.js']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
    assert.doesNotMatch(s, /amber|hsl\((3[0-9]|4[0-5]),/i, `${f}: amber`);
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
  }
});
