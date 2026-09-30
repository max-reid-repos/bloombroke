// The IPO IT share card (/og/ipo.png) is the NOT A TICKER page's certificate: the same
// serial, the issue day, the stamp clear of the ticker, a versioned og:image URL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sharp from 'sharp';
import { certSerial as pageSerial } from '../public/screens/nosuch.js';
import { certSerial } from '../lib/cert-serial.js';
import {
  IPO_CERT, IPO_CARD_VERSION, IPO_MAX_AGE, IPO_DATED_MAX_AGE, REFUSED_MAX_AGE, ipoLayout, ipoTree, makeNoSuchCards, mountNoSuch, nosuchMeta, parseBlocklist, loadGraveyard,
} from '../lib/og-nosuch.js';
import { W, H, SITE, withMeta } from '../lib/og.js';

const BANNED = new RegExp(['bloom', 'berg'].join(''), 'i');
const BLOCK = parseBlocklist('# test\nZZTOP\n*QQQX\n');
const GRAVE = loadGraveyard();
const TODAY = '2026-09-30';
const today = () => TODAY;

test('the server serial is the page serial', () => {
  const words = ['XQZT', 'LEHM', 'Q', 'A', 'Z', 'MAXX', 'maxx', 'WWWWW', 'ABCDE', 'QXZV', 'BRKX', 'NOPE', 'ZZ', ''];
  for (let i = 0; i < 200; i += 1) {
    const n = 1 + (i % 5);
    words.push(Array.from({ length: n }, (_, k) => String.fromCharCode(65 + ((i * 7 + k * 13) % 26))).join(''));
  }
  for (const w of words) {
    assert.equal(certSerial(w), pageSerial(w), w);
    assert.match(certSerial(w), /^\d{6}$/, w);
  }
});

// Two boxes { cx, cy, w, h, rot } overlap (separating axes), each grown by pad px.
function overlap(a, b, pad = 0) {
  const corners = (r) => {
    const t = (r.rot * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const hw = r.w / 2 + pad;
    const hh = r.h / 2 + pad;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [r.cx + x * c - y * s, r.cy + x * s + y * c]);
  };
  const A = corners(a);
  const B = corners(b);
  for (const poly of [A, B]) {
    for (let i = 0; i < 4; i += 1) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % 4];
      const ax = -(y2 - y1);
      const ay = x2 - x1;
      const pa = A.map(([x, y]) => x * ax + y * ay);
      const pb = B.map(([x, y]) => x * ax + y * ay);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

test('the stamp never covers the ticker, the date or the serial, and stays on the paper', () => {
  for (const word of ['Q', 'QX', 'QXZ', 'QXZV', 'WWWWW', 'MMMMM']) {
    for (const day of ['2026-09-30', '2026-09-01', '2026-12-31']) {
      const L = ipoLayout(word, day);
      const stamp = L.stamp;
      assert.equal(overlap(stamp, L.big, 0.06 * L.big.size), false, `${word}: stamp on the ticker`);
      assert.equal(overlap(stamp, L.issued, 4), false, `${word} ${day}: stamp on the date`);
      assert.equal(overlap(stamp, L.serial, 4), false, `${word}: stamp on the serial`);
      assert.equal(overlap(stamp, { ...L.seal, w: 5 * 0.6 * L.seal.size, h: L.seal.size }, 4), false, 'stamp on the seal');
      assert.ok(L.big.w < IPO_CERT.paper.w * 0.6, `${word}: the ticker fits the paper`);
    }
  }
  const L = ipoLayout('XQZT', TODAY);
  assert.ok(L.stamp.cx - L.stamp.w / 2 > 0 && L.stamp.cx + L.stamp.w / 2 < IPO_CERT.paper.w);
  assert.ok(L.big.size >= 100, 'the ticker is large enough to read when X shows the card small');
});

test('the card: ONE SHARE, $TICKER, the issue day, the serial, $0.00, the stamp, the wordmark', async () => {
  const s = JSON.stringify(await ipoTree('XQZT', { day: TODAY }));
  for (const want of ['ONE SHARE', '$XQZT', 'Issued 30 Sep 2026', `No. ${pageSerial('XQZT')}`, '$0.00', 'NOT A REAL SECURITY', 'bloombroke.com', 'IPO IT XQZT']) {
    assert.ok(s.includes(want), want);
  }
  assert.doesNotMatch(s, BANNED);
  assert.doesNotMatch(s, /—/);
});

test('/og/ipo.png draws a 1200x630 PNG for XQZT; the day comes only from today or yesterday', async () => {
  const days = [];
  const cards = makeNoSuchCards({ graveyard: GRAVE, block: BLOCK, today });
  const out = await cards.ipo('XQZT', null, TODAY);
  const info = await sharp(out.png).metadata();
  assert.equal(info.format, 'png');
  assert.equal(info.width, W);
  assert.equal(info.height, H);
  assert.equal(out.maxAge, IPO_DATED_MAX_AGE);

  let renders = 0;
  const fake = Buffer.from('card');
  const siteCard = Buffer.from('site');
  const app = express();
  const render = async (tree) => { renders += 1; days.push(JSON.stringify(tree).match(/Issued ([^"]+)/)[1]); return fake; };
  mountNoSuch(app, { graveyard: GRAVE, block: BLOCK, today, render, fallback: async () => siteCard });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const get = async (p) => { const r = await fetch(base + p); return { r, body: Buffer.from(await r.arrayBuffer()) }; };
    let { r, body } = await get(`/og/ipo.png?t=XQZT&d=${TODAY}&v=${IPO_CARD_VERSION}`);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('cache-control'), `public, max-age=${IPO_DATED_MAX_AGE}`);
    assert.deepEqual(body, fake);
    await get(`/og/ipo.png?t=xqzt&d=${TODAY}&v=9`);
    assert.equal(renders, 1, 'the same word and day: drawn once, whatever v says');
    ({ r } = await get('/og/ipo.png?t=XQZT&d=2026-09-29'));
    assert.equal(r.headers.get('cache-control'), `public, max-age=${IPO_DATED_MAX_AGE}`, 'yesterday: a share from last night');
    assert.equal(renders, 2);
    ({ r } = await get('/og/ipo.png?t=XQZT'));
    assert.equal(r.headers.get('cache-control'), `public, max-age=${IPO_MAX_AGE}`, 'no day: today, kept an hour');
    ({ r } = await get('/og/ipo.png?t=XQZT&d=2019-01-01'));
    assert.equal(r.headers.get('cache-control'), `public, max-age=${IPO_MAX_AGE}`, 'another day: today');
    ({ r } = await get('/og/ipo.png?t=XQZT&d=%3Cb%3E'));
    assert.equal(renders, 2, 'any day but today or yesterday is today: nothing new drawn');
    assert.deepEqual(days, ['30 Sep 2026', '29 Sep 2026']);
    // Refused words: the site card, never a certificate.
    for (const t of ['ZZTOP', 'AQQQX', 'SE' + 'X', 'TOOLONG', 'M4X', 'AAPL', '%3Cb%3E', '']) {
      ({ r, body } = await get(`/og/ipo.png?t=${t}&d=${TODAY}&v=${IPO_CARD_VERSION}`));
      assert.equal(r.status, 200, t);
      assert.deepEqual(body, siteCard, t);
      assert.equal(r.headers.get('cache-control'), `public, max-age=${REFUSED_MAX_AGE}`, t);
    }
    assert.equal(renders, 2);
  } finally {
    server.close();
  }
});

test('the og:image of ?c=IPO IT XQZT carries the issue day and the card version', () => {
  const m = nosuchMeta('IPO IT XQZT', { graveyard: GRAVE, block: BLOCK, today });
  assert.equal(m.image, `${SITE}/og/ipo.png?t=XQZT&d=${TODAY}&v=${IPO_CARD_VERSION}`);
  assert.equal(IPO_CARD_VERSION, '2');
  const html = withMeta('<html><head><title>x</title><meta name="description" content="x"></head><body></body></html>', m);
  assert.match(html, new RegExp(`<meta property="og:image" content="${SITE}/og/ipo\\.png\\?t=XQZT&amp;d=${TODAY}&amp;v=2">`));
  assert.match(html, /<meta name="twitter:image" content="[^"]*&amp;v=2">/);
  assert.equal(nosuchMeta('IPO IT ZZTOP', { graveyard: GRAVE, block: BLOCK, today }), null, 'a refused word: no card of its own');
});
