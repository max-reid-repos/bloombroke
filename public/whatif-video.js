// SAVE VIDEO: the REPLAY race as a square 1080x1080 MP4, about 10 s at 30 fps, no audio,
// drawn like the certificate: cream paper, coloured-pencil lines, the product doodle, the
// number rolling and the seal stamping at the end. Bottom strip: the command and
// bloombroke.com. Made in the browser only:
//   1. WebCodecs VideoEncoder (H.264) + mp4-muxer (MIT, vendored in public/vendor)
//   2. else MediaRecorder recording the canvas as MP4 (real time)
//   3. else one plain line: VIDEO_NEEDS
// Every number drawn comes from the replay points and the certificate model the server
// sent (the same ones on screen); nothing is computed here but the in-between frames.

import { frameAt, scaleOf, timeOf, fmtCounter, isBehind } from './whatif-replay.js';

export const SIZE = 1080;
export const FPS = 30;
export const RACE_FRAMES = 255; // 8.5 s of race
export const HOLD_FRAMES = 45; // 1.5 s: the seal stamps, the result holds
export const VIDEO_NEEDS = 'Saving a video needs Chrome, Edge or Safari.';
export const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'];
const RECORDER_TYPES = ['video/mp4;codecs=avc1', 'video/mp4'];
const HINDSIGHT = 'Hindsight only. Past returns do not predict future returns. Not a recommendation.';

// ---- Feature detection and names (tested) -------------------------------------------

// 'webcodecs' | 'recorder' | null, from what this browser has. g: the global object.
export function videoSupport(g = globalThis) {
  if (typeof g.VideoEncoder === 'function' && typeof g.VideoFrame === 'function') return 'webcodecs';
  if (recorderType(g)) return 'recorder';
  return null;
}

export function recorderType(g = globalThis) {
  const MR = g.MediaRecorder;
  const canCapture = typeof g.HTMLCanvasElement === 'function' && typeof g.HTMLCanvasElement.prototype?.captureStream === 'function';
  if (typeof MR !== 'function' || typeof MR.isTypeSupported !== 'function' || !canCapture) return null;
  return RECORDER_TYPES.find((t) => MR.isTypeSupported(t)) || null;
}

// The first H.264 profile the encoder takes at 1080x1080, or null.
export async function encoderConfig(g = globalThis) {
  for (const codec of CODECS) {
    const config = { codec, width: SIZE, height: SIZE, bitrate: 8_000_000, framerate: FPS, avc: { format: 'avc' } };
    try {
      const r = await g.VideoEncoder.isConfigSupported(config);
      if (r?.supported) return config;
    } catch { /* try the next one */ }
  }
  return null;
}

// "WHATIF BIGMAC:10Y" -> "bloombroke-whatif-bigmac-10y.mp4"
export function videoFilename(command) {
  const words = String(command || '').toLowerCase().replace(/^\s*whatif\b/, '').trim();
  const slug = words.replace(/[:\s]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `bloombroke-whatif${slug ? `-${slug}` : ''}.mp4`;
}

// Frame i -> { race: 0..1, stamp: 0..1 (the seal, after the race) }.
export function timeline(i) {
  const race = Math.min(1, i / RACE_FRAMES);
  const stamp = i <= RACE_FRAMES ? 0 : Math.min(1, (i - RACE_FRAMES) / 9);
  return { race, stamp };
}

// Whole dollars from $1,000 (like the certificate), cents below.
export function fmtMoney(n) {
  const a = Math.abs(n);
  const d = a >= 1000 ? 0 : 2;
  return `${n < 0 ? '−' : ''}$${a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

// ---- Drawing -------------------------------------------------------------------------

const INK = '#2A1A10';
const INK_SOFT = '#5A4330';
const RED = '#C23B2A';
const PENCIL = { stock: '#3E6B47', jar: '#A97B22', spent: '#B5412E' };
const BG = '#05080C';
const ACCENT = '#6CCBFF';
const TEXT = '#CFEAFF';
const DIM = '#7C93A8';
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const HAND = "'Caveat', cursive";

// The art is 1536x1024. The square certificate keeps its top and bottom and repeats a
// plain band of paper in between (mirrored, so the grain has no seams).
const ART_W = 1536;
const ART_H = 1024;
const BAND = [0.42, 0.56]; // of the art height: below the clipped receipt, above the seal
const CERT = { x: 24, y: 24, w: SIZE - 48, h: SIZE - 24 - 104 };

function certGeometry() {
  const s = CERT.w / ART_W;
  const topH = BAND[0] * ART_H * s;
  const botH = (1 - BAND[1]) * ART_H * s;
  const midH = CERT.h - topH - botH;
  // Art % -> canvas px. Above the band the art keeps its place; below it, it moves down.
  const x = (pct) => CERT.x + (pct / 100) * CERT.w;
  const y = (pct) => {
    const ay = (pct / 100) * ART_H;
    if (ay <= BAND[0] * ART_H) return CERT.y + ay * s;
    if (ay >= BAND[1] * ART_H) return CERT.y + topH + midH + (ay - BAND[1] * ART_H) * s;
    return CERT.y + topH + ((ay - BAND[0] * ART_H) / ((BAND[1] - BAND[0]) * ART_H)) * midH;
  };
  return { s, topH, botH, midH, x, y };
}

function drawPaper(ctx, paper, g) {
  const { s, topH, botH, midH } = g;
  const b0 = BAND[0] * ART_H;
  const b1 = BAND[1] * ART_H;
  ctx.drawImage(paper, 0, 0, ART_W, b0, CERT.x, CERT.y, CERT.w, topH);
  const bandH = (b1 - b0) * s;
  const y0 = CERT.y + topH;
  for (let k = 0, y = y0; y < y0 + midH; k += 1, y += bandH) {
    const h = Math.min(bandH, y0 + midH - y);
    const srcH = h / s;
    ctx.save();
    if (k % 2) {
      ctx.translate(0, 2 * y + h);
      ctx.scale(1, -1);
      ctx.drawImage(paper, 0, b1 - srcH, ART_W, srcH, CERT.x, y, CERT.w, h);
    } else {
      ctx.drawImage(paper, 0, b0, ART_W, srcH, CERT.x, y, CERT.w, h);
    }
    ctx.restore();
  }
  ctx.drawImage(paper, 0, b1, ART_W, ART_H - b1, CERT.x, y0 + midH, CERT.w, botH);
}

// A deterministic wobble: the same point wobbles the same way on every frame.
const wobble = (i, pass, axis) => {
  const v = Math.sin(i * 12.9898 + pass * 78.233 + axis * 37.719) * 43758.5453;
  return (v - Math.floor(v)) - 0.5;
};

const patterns = new Map();
function pencilPattern(ctx, color) {
  if (patterns.has(color)) return patterns.get(color);
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const p = c.getContext('2d');
  p.fillStyle = color;
  for (let i = 0; i < 64 * 64; i += 1) {
    const a = 0.3 + 0.7 * (wobble(i, 3, 1) + 0.5);
    p.globalAlpha = a;
    p.fillRect(i % 64, Math.floor(i / 64), 1, 1);
  }
  const pat = ctx.createPattern(c, 'repeat');
  patterns.set(color, pat);
  return pat;
}

// A coloured-pencil line: two or three loose passes with grain.
function pencil(ctx, pts, color, width) {
  if (pts.length < 2) return;
  const pat = pencilPattern(ctx, color);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let pass = 0; pass < 3; pass += 1) {
    ctx.globalAlpha = pass === 0 ? 0.9 : 0.4;
    ctx.lineWidth = pass === 0 ? width : width * 0.6;
    ctx.strokeStyle = pat;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const j = pass === 0 ? 0.6 : 1.8;
      const px = x + wobble(i, pass, 0) * j;
      const py = y + wobble(i, pass, 1) * j;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.stroke();
  }
  ctx.restore();
}

function text(ctx, s, x, y, { font, color = INK, align = 'center', base = 'middle', maxW } = {}) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  if (maxW) {
    // Shrink to fit.
    let size = Number(/(\d+(?:\.\d+)?)px/.exec(font)[1]);
    while (size > 10 && ctx.measureText(s).width > maxW) {
      size -= 2;
      ctx.font = font.replace(/\d+(?:\.\d+)?px/, `${size}px`);
    }
  }
  ctx.fillText(s, x, y);
}

// One frame. m: the certificate model; replay: { points }; command: the text at the
// bottom; assets: { paper, doodle } (loaded images); i: the frame number.
export function drawFrame(ctx, { m, replay, command, assets }, i) {
  const { race, stamp } = timeline(i);
  const pts = replay.points;
  const f = frameAt(pts, race);
  const g = certGeometry();

  ctx.save();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SIZE, SIZE);
  drawPaper(ctx, assets.paper, g);

  // Receipt on the clip, as on the certificate.
  ctx.save();
  ctx.translate(g.x(7.33), g.y(13.3));
  ctx.rotate((-15 * Math.PI) / 180);
  (m.receipt || []).forEach((line, k) => text(ctx, line, 0, k * 22 + 10, { font: `800 11px ${MONO}`, color: INK_SOFT, align: 'left' }));
  ctx.restore();

  // Ribbon.
  text(ctx, m.ribbon, g.x(49.6), g.y(20.2), { font: `700 44px ${HAND}`, maxW: 0.33 * CERT.w });

  // The big number, rolling; red while the stock is behind what was paid.
  const behind = f.done ? m.loss : isBehind(f);
  text(ctx, fmtMoney(f.stock), SIZE / 2, g.y(33.5) + 58, { font: `800 104px ${MONO}`, color: behind ? RED : INK, maxW: 0.62 * CERT.w });
  text(ctx, f.done ? 'worth today' : `in the stock, ${fmtCounter(f.t)}`, SIZE / 2, g.y(33.5) + 128, { font: `700 36px ${HAND}`, color: INK_SOFT });

  // The race: pencil lines, spent below zero.
  const box = { x0: 120, x1: 730, y0: g.y(33.5) + 170, y1: g.y(57) };
  const t0 = timeOf(pts[0]);
  const t1 = timeOf(pts[pts.length - 1]);
  const { top, bottom } = scaleOf(pts);
  const X = (t) => box.x0 + ((t - t0) / Math.max(1, t1 - t0)) * (box.x1 - box.x0);
  const Y = (v) => box.y0 + ((top - v) / (top + bottom)) * (box.y1 - box.y0);
  pencil(ctx, [[box.x0 - 10, Y(0)], [box.x1 + 20, Y(0)]], INK_SOFT, 2);
  const upto = pts.slice(0, f.i + 1).map((p) => ({ t: timeOf(p), ...p }));
  if (!f.done) upto.push({ t: f.t, stock: f.stock, jar: f.jar, spent: f.spent });
  const series = (key, sign) => upto.map((p) => [X(p.t), Y(sign * p[key])]);
  const heads = [];
  for (const [key, sign, label] of [['spent', -1, 'spent'], ['jar', 1, 'cash in a jar'], ['stock', 1, 'stock']]) {
    const line = series(key, sign);
    pencil(ctx, line, PENCIL[key], key === 'stock' ? 6 : 4.5);
    const [hx, hy] = line[line.length - 1];
    heads.push({ key, label, x: hx, y: hy });
  }
  // Labels by each line's head, pushed apart so they never sit on each other.
  // They stay above the seal.
  heads.sort((a, b) => a.y - b.y);
  for (let k = 1; k < heads.length; k += 1) if (heads[k].y - heads[k - 1].y < 34) heads[k].y = heads[k - 1].y + 34;
  const limit = g.y(68.4) - 0.1 * CERT.w - 24;
  for (let k = heads.length - 1; k >= 0; k -= 1) heads[k].y = Math.min(heads[k].y, limit - (heads.length - 1 - k) * 34);
  for (const h of heads) text(ctx, h.label, h.x + 16, h.y, { font: `700 32px ${HAND}`, color: PENCIL[h.key], align: 'left' });
  // The two ruled lines.
  text(ctx, `You spent ${fmtMoney(f.spent)}`, g.x(49.9), g.y(71.3) - 14, { font: `800 30px ${MONO}`, maxW: 0.36 * CERT.w });
  text(ctx, m.holding, g.x(49.9), g.y(76.9) - 14, { font: `600 26px ${MONO}`, color: INK_SOFT, maxW: 0.36 * CERT.w });

  // The seal stamps in at the end, with the multiple.
  if (stamp > 0) {
    const k = 1 + 0.35 * (1 - stamp);
    ctx.save();
    ctx.globalAlpha = Math.min(1, stamp * 1.4);
    ctx.translate(g.x(82.5), g.y(68.4));
    ctx.rotate((-4 * Math.PI) / 180);
    ctx.scale(k, k);
    // The seal itself, cut from the art (a square round its centre), pressed down.
    const rArt = 150;
    const r = rArt * g.s;
    ctx.drawImage(assets.paper, 0.825 * ART_W - rArt, 0.684 * ART_H - rArt, 2 * rArt, 2 * rArt, -r, -r, 2 * r, 2 * r);
    text(ctx, m.multiple, 0, m.loss ? -18 : 0, { font: `800 38px ${MONO}`, color: m.loss ? INK_SOFT : INK, maxW: 0.16 * CERT.w });
    if (m.loss) {
      ctx.fillStyle = RED;
      ctx.save();
      ctx.translate(0, -18);
      ctx.rotate((-14 * Math.PI) / 180);
      ctx.fillRect(-48, -3, 96, 6);
      ctx.restore();
      text(ctx, 'dodged', 0, 36, { font: `700 32px ${HAND}`, color: RED });
    }
    ctx.restore();
  }

  // The doodle, stuck on the bottom-left corner.
  if (assets.doodle) {
    ctx.save();
    ctx.translate(CERT.x + 90, CERT.y + CERT.h - 92);
    ctx.rotate((-8 * Math.PI) / 180);
    ctx.drawImage(assets.doodle, -95, -95, 190, 190);
    ctx.restore();
  }

  // The bottom strip.
  text(ctx, `> ${command}`, 36, SIZE - 64, { font: `600 28px ${MONO}`, color: ACCENT, align: 'left', maxW: 700 });
  text(ctx, 'bloombroke.com', SIZE - 36, SIZE - 64, { font: `800 28px ${MONO}`, color: TEXT, align: 'right' });
  text(ctx, HINDSIGHT, SIZE / 2, SIZE - 26, { font: `500 17px ${MONO}`, color: DIM, maxW: SIZE - 72 });
  ctx.restore();
}

// ---- Making the file -------------------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${src}`));
    img.src = src;
  });
}

export async function loadAssets(m) {
  const art = (f) => new URL(`./img/whatif/${f}`, import.meta.url).href;
  await Promise.all([
    document.fonts?.load(`800 104px ${MONO}`), document.fonts?.load(`600 28px ${MONO}`),
    document.fonts?.load(`500 17px ${MONO}`), document.fonts?.load(`700 44px ${HAND}`),
  ].map((p) => Promise.resolve(p).catch(() => null)));
  const [paper, doodle] = await Promise.all([loadImage(art('certificate.webp')), loadImage(art(`doodle-${m.doodle}.webp`)).catch(() => null)]);
  return { paper, doodle };
}

async function withEncoder(data, config, onProgress) {
  const { Muxer, ArrayBufferTarget } = await import('./vendor/mp4-muxer.js');
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: SIZE, height: SIZE, frameRate: FPS }, fastStart: 'in-memory' });
  let failed = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
  encoder.configure(config);
  const total = RACE_FRAMES + HOLD_FRAMES;
  for (let i = 0; i <= total; i += 1) {
    if (failed) throw failed;
    drawFrame(ctx, data, i);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    onProgress?.(i / total);
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
    if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  await encoder.flush();
  encoder.close();
  if (failed) throw failed;
  muxer.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}

async function withRecorder(data, mimeType, onProgress) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  drawFrame(ctx, data, 0);
  const stream = canvas.captureStream(FPS);
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const parts = [];
  rec.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
  const stopped = new Promise((resolve) => { rec.onstop = resolve; });
  rec.start(250);
  const total = RACE_FRAMES + HOLD_FRAMES;
  const start = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const i = Math.min(total, Math.floor(((performance.now() - start) / 1000) * FPS));
      drawFrame(ctx, data, i);
      onProgress?.(i / total);
      if (i >= total) resolve(); else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  return new Blob(parts, { type: 'video/mp4' });
}

// Makes the MP4 and returns { blob, filename, how } (how: 'webcodecs' or 'recorder').
// Throws Error(VIDEO_NEEDS) when this browser can do neither.
export async function makeVideo({ m, replay, command }, { onProgress, g = globalThis } = {}) {
  const how = videoSupport(g);
  if (!how) throw new Error(VIDEO_NEEDS);
  const assets = await loadAssets(m);
  const data = { m, replay, command, assets };
  const config = how === 'webcodecs' ? await encoderConfig(g) : null;
  const filename = videoFilename(command);
  if (config) return { blob: await withEncoder(data, config, onProgress), filename, how: 'webcodecs' };
  const type = recorderType(g);
  if (!type) throw new Error(VIDEO_NEEDS);
  return { blob: await withRecorder(data, type, onProgress), filename, how: 'recorder' };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
