#!/usr/bin/env node
// Layout audit of the card pages (kit.js cardPage) in a real browser. Not part of
// npm test: run it against a local dev server.
//
//   PORT=3021 node server.js &
//   node scripts/layout-audit.cjs [--base=http://127.0.0.1:3021] [--shots=DIR] [--live-data=https://bloombroke.com]
//                                 [--only=bbrk,pro] [--open]
//
// For each card page at 1536x730, 1920x1080 and 390x844 (real scrollbars), it fails on:
//   overflow  the page or the screen scrolls sideways
//   crop      a chart or globe cut off (outside its scroll area, or clipped), or not square
//   font      a font size that is not on the type scale (style.css)
//   measure   a block of text wider than about 70 characters of its own font
//   primary   more than one primary (solid) button
//   fold      on a desktop size, BBRK's and SPONSOR's globe not wholly in the first view
//             (its bottom below the scroll box's visible bottom, scrolled to the top)
// and prints a table. --shots saves a PNG per page and size (after-<page>-<width>.png).
// The numbers the pages show come from small fixtures below, or with --live-data from the
// public GET routes of that site (/api/bbrk, /api/sponsors, /api/pro/seat, /api/pro/config).
// The key view uses a made-up test licence (the key never leaves this browser).
//
// Needs puppeteer-core and a Chrome: PUPPETEER_CORE (a path to the module, default the
// one in ~/tools/shot) and CHROME (default the puppeteer cache build).

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const arg = (name, fallback) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
};
const BASE = arg('base', 'http://127.0.0.1:3021');
const SHOTS = arg('shots', '');
const LIVE = arg('live-data', '');
const ONLY = arg('only', '');
const OPEN = process.argv.includes('--open'); // + Details open, for a look (shots end -details)
const PUPPETEER = process.env.PUPPETEER_CORE || path.join(os.homedir(), 'tools/shot/node_modules/puppeteer-core');
const CHROME = process.env.CHROME || path.join(os.homedir(), '.cache/puppeteer/chrome/linux-151.0.7922.77/chrome-linux64/chrome');

// The type scale (style.css's header); 13 is the body size.
const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
const TYPE = (/Type scale: ([\d ]+)/.exec(css)?.[1] || '').trim().split(/\s+/).map(Number);
// The legal version the first-visit notice asks for (public/legal-version.js), accepted up front.
const LEGAL = /TERMS_VERSION = '([\d.]+)'/.exec(fs.readFileSync(path.join(__dirname, '../public/legal-version.js'), 'utf8'))?.[1] || '1.5';

const SIZES = [[1536, 730], [1920, 1080], [390, 844]];
const KEY = 'BB-TEST-TEST-TEST-TEST'.replace(/T/g, 'Q'); // looks like a key, is not one
const YEAR = new Date(Date.now() + 360 * 864e5).toISOString();

const FIX = {
  '/api/bbrk': {
    updated: new Date().toISOString(), mode: 'test', mrr: 'MRR $0 (test mode)',
    audience: {
      visitors: { today: 15, yesterdaySoFar: 12, d7: 83, d30: 83 }, pageviews: { today: 23, d7: 270, d30: 270 },
      spark30: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 18, 37, 19, 15],
      globe: { window: '7d', countries: [{ cc: 'US', visitors: 59, live: true }, { cc: 'JP', visitors: 9 }], cities: [{ name: 'Tokyo', cc: 'JP', at: [140, 36], visitors: 9 }], other: 9 },
      live: 3, avgVisitSec: 390, returningPct: 3.6, desktopPct: 51.5,
      countries: [{ name: 'United States', pct: 71 }, { name: 'Japan', pct: 11 }], referrers: [{ name: 'Direct/None', pct: 100 }],
    },
    inventory: { stripShown: { today: 491, d7: 750 }, stripClicks: { today: 7, d7: 9 }, embedLoads: { today: 0, d7: 1 }, mcpCalls: { today: 0, d7: 0 } },
  },
  '/api/sponsors': { lines: [], house: [{ text: 'YOUR COMPANY HERE. On every screen, all day.', cmd: 'SPONSOR' }, { text: 'This line is for rent. No tracking, no pop-ups.', cmd: 'SPONSOR' }], gauges: {}, line: null },
  '/api/pro/seat': { next: 4 },
  '/api/pro/config': { mode: 'test', open: true, price: 4200, currency: 'usd', yearly: true, yearPrice: 42000 },
  '/api/pro/status': { active: true, status: 'active', last4: 'QESQ', seat: 3, interval: 'year', currentPeriodEnd: YEAR, cancelAtPeriodEnd: false, canGift: true },
  // ME: a made-up profile (the longest username there can be).
  '/api/me': { seat: 3, username: 'Abcdefghijklmno', color: 2, avatar: null, status: { active: true, status: 'active', seat: 3, interval: 'year', currentPeriodEnd: YEAR, cancelAtPeriodEnd: false, canGift: true } },
  '/api/live': { here: 3 },
};

// [name, command, { key, type }]: type: typed into the command bar (a link never runs LOGIN).
const PAGES = [
  ['bbrk', 'BBRK'], ['sponsor', 'SPONSOR'], ['pro', 'PRO'], ['pro-key', 'PRO', { key: true }],
  ['login', 'LOGIN', { type: true }], ['redeem', 'REDEEM'], ['gift', 'GIFT'], ['feedback', 'FEEDBACK'], ['chat', 'CHAT'],
  ['me', 'ME'], ['me-pro', 'ME', { key: true }],
].filter(([n]) => !ONLY || ONLY.split(',').includes(n));

async function liveData() {
  if (!LIVE) return;
  for (const p of ['/api/bbrk', '/api/sponsors', '/api/pro/seat', '/api/pro/config']) {
    try {
      const r = await fetch(LIVE + p, { headers: { Accept: 'application/json' } });
      if (r.ok) FIX[p] = await r.json();
    } catch { /* keep the fixture */ }
  }
}

// Runs in the page: every check, for the card on screen.
function inPage(scale, firstView) {
  const out = { overflow: [], crop: [], font: [], measure: [], primary: [], fold: [] };
  const de = document.documentElement;
  const screen = document.getElementById('screen');
  if (de.scrollWidth > de.clientWidth + 1) out.overflow.push(`page ${de.scrollWidth}>${de.clientWidth}`);
  if (screen && screen.scrollWidth > screen.clientWidth + 1) out.overflow.push(`screen ${screen.scrollWidth}>${screen.clientWidth}`);
  const card = document.querySelector('#screen .card');
  if (!card) { out.crop.push('no .card on screen'); return out; }
  const shut = (el) => { const d = el.closest('details:not([open])'); return Boolean(d) && !el.closest('summary'); };
  const shown = (el) => { const r = el.getBoundingClientRect(); return !shut(el) && r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  // Media: inside every clipping or scrolling box above it, and square when it is a globe.
  for (const m of card.querySelectorAll('.card-media canvas, .card-chart svg, .card-media figure')) {
    if (!shown(m)) continue;
    const r = m.getBoundingClientRect();
    if (m.tagName === 'CANVAS' && Math.abs(r.width - r.height) > 1) out.crop.push(`globe not square ${Math.round(r.width)}x${Math.round(r.height)}`);
    for (let a = m.parentElement; a && a !== de; a = a.parentElement) {
      const s = getComputedStyle(a);
      const clipX = s.overflowX !== 'visible';
      const clipY = s.overflowY !== 'visible';
      if (!clipX && !clipY) continue;
      const b = a.getBoundingClientRect();
      const scrolls = /auto|scroll/;
      // Inside the scroll area: the part of the box it can scroll to.
      const left = b.left - a.scrollLeft;
      const top = b.top - a.scrollTop;
      const right = scrolls.test(s.overflowX) ? left + a.scrollWidth : b.right;
      const bottom = scrolls.test(s.overflowY) ? top + a.scrollHeight : b.bottom;
      if ((clipX && (r.left < left - 1 || r.right > right + 1)) || (clipY && (r.top < top - 1 || r.bottom > bottom + 1))) {
        out.crop.push(`${m.tagName.toLowerCase()} clipped by ${a.id ? `#${a.id}` : a.className || a.tagName}`);
        break;
      }
      // Inside a box that scrolls: scrolling brings it into view, so the boxes above
      // that one do not cut it.
      if (scrolls.test(s.overflowX) || scrolls.test(s.overflowY)) break;
    }
  }
  // Text: the size is on the scale, and no line of words is wider than about 70ch.
  const ctx = document.createElement('canvas').getContext('2d');
  for (const el of card.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || !shown(el)) continue;
    const s = getComputedStyle(el);
    const px = parseFloat(s.fontSize);
    if (!scale.includes(px)) out.font.push(`${el.tagName.toLowerCase()}.${el.className || ''} ${px}px`);
    ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const ch = ctx.measureText('0').width || px * 0.6;
    const w = el.getBoundingClientRect().width;
    const lines = Math.round(el.getBoundingClientRect().height / (parseFloat(s.lineHeight) || px * 1.45));
    if (w / ch > 72 && lines > 1) out.measure.push(`${el.tagName.toLowerCase()}.${el.className || ''} ${Math.round(w / ch)}ch`);
  }
  // The first view: scrolled to the top, the globe ends above the dock and the scroll
  // box's visible bottom.
  if (firstView) {
    const box = document.getElementById('screen');
    const own = box && /auto|scroll/.test(getComputedStyle(box).overflowY);
    if (own) box.scrollTop = 0; else window.scrollTo(0, 0);
    const dock = document.querySelector('.dock');
    const bottom = Math.min(own ? box.getBoundingClientRect().bottom : innerHeight, dock ? dock.getBoundingClientRect().top : innerHeight);
    const media = card.querySelector('.card-media');
    if (!media) out.fold.push('no media');
    else {
      const r = media.getBoundingClientRect();
      if (r.bottom > bottom + 0.5) out.fold.push(`globe bottom ${Math.round(r.bottom)} > visible ${Math.round(bottom)}`);
      const c = media.querySelector('canvas');
      if (c) out.fold.push(...(c.getBoundingClientRect().width < 219 ? [`globe ${Math.round(c.getBoundingClientRect().width)} px, under 220`] : []));
    }
  }
  const primaries = [...card.querySelectorAll('.btn-solid')].filter(shown);
  if (primaries.length > 1) out.primary.push(`${primaries.length} solid buttons`);
  return out;
}

async function main() {
  await liveData();
  const puppeteer = require(PUPPETEER);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const rows = [];
  let failed = 0;
  try {
    for (const [name, cmd, opts = {}] of PAGES) {
      for (const [w, h] of SIZES) {
        const context = await browser.createBrowserContext(); // its own storage: no key left over
        const page = await context.newPage();
        await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
        await page.evaluateOnNewDocument((key, status, legal, me) => {
          try {
            localStorage.setItem('bb.consent', JSON.stringify({ version: legal, acceptedAt: new Date().toISOString() }));
            if (key) {
              localStorage.setItem('bb.pro.key', JSON.stringify(key));
              localStorage.setItem('bb.pro.status', JSON.stringify({ ...status, checked: Date.now() }));
              localStorage.setItem('bb.me', JSON.stringify({ seat: me.seat, username: me.username, color: me.color, avatar: me.avatar }));
            }
          } catch { /* none */ }
        }, opts.key ? KEY : null, FIX['/api/pro/status'], LEGAL, FIX['/api/me']);
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const u = new URL(req.url());
          const fix = u.origin === new URL(BASE).origin && req.method() === 'GET' ? FIX[u.pathname] : null;
          if (fix && !((u.pathname === '/api/pro/status' || u.pathname === '/api/me') && !opts.key)) req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(fix) });
          else if (/datafa\.st|cloudflareinsights/.test(u.host)) req.abort();
          else req.continue();
        });
        await page.goto(`${BASE}/?c=${encodeURIComponent(opts.type ? 'PRO' : cmd)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForSelector('#screen .card', { timeout: 15000 }).catch(() => {});
        if (opts.type) {
          await page.click('#cmd');
          await page.keyboard.type(cmd);
          await page.keyboard.press('Enter');
          await page.waitForSelector('#screen .card-form', { timeout: 15000 }).catch(() => {});
        }
        await new Promise((r) => { setTimeout(r, 2000); });
        if (OPEN) {
          await page.evaluate(() => { const d = document.querySelector('#screen .card-more'); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } });
          await new Promise((r) => { setTimeout(r, 300); });
        }
        const firstView = !OPEN && w >= 1100 && ['bbrk', 'sponsor'].includes(name);
        const res = await page.evaluate(inPage, TYPE, firstView);
        const bad = Object.entries(res).filter(([, v]) => v.length);
        if (bad.length) failed++;
        rows.push({ page: name, size: `${w}x${h}`, result: bad.length ? 'FAIL' : 'ok', notes: bad.map(([k, v]) => `${k}: ${[...new Set(v)].slice(0, 3).join('; ')}`).join(' | ') });
        if (SHOTS) {
          fs.mkdirSync(SHOTS, { recursive: true });
          await page.screenshot({ path: path.join(SHOTS, `after-${name}-${w}${OPEN ? '-details' : ''}.png`) });
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('PAGE', 10)}${pad('SIZE', 11)}${pad('RESULT', 8)}NOTES`);
  for (const r of rows) console.log(`${pad(r.page, 10)}${pad(r.size, 11)}${pad(r.result, 8)}${r.notes}`);
  console.log(`\n${rows.length - failed} of ${rows.length} pass. Type scale: ${TYPE.join(' ')}.`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => { console.error(err); process.exit(2); });
