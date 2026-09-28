// PRO v3: the seat, big. GET /api/pro/seat (the next seat number: read only, one number,
// cached), the hero (the next seat for a visitor, your own seat for Pro), yearly first,
// the test-mode line, the live line from real numbers only, and every old PRO command.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { openDb } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import { revealKeyFrom } from '../pro/licence.js';
import { mountPro, SEAT_CACHE_MS } from '../pro/routes.js';
import { parseCommand, urlFor } from '../public/app.js';
import {
  mainHtml, pageHtml, detailsHtml, heroSeat, seatParts, proofLine, visitLen, planButton,
  TEST_LINE, UP_NEXT, PERKS, GIFT_ACTION, DETAILS_OPEN, BUY_TERMS, DEMO_BANNER,
  render, loginCommand, logoutCommand, giftCommand, redeemCommand,
} from '../public/screens/pro.js';

const T0 = Date.UTC(2026, 8, 28, 12);
const quiet = { log() {}, error() {} };
const KEY = 'BB-7KQ2-M9XD-HT4P-WZ3C';
const BBRK = { audience: { visitors: { d7: 70 }, pageviews: { d7: 245 }, avgVisitSec: 417 } };
const all = () => true;

async function setup({ store: override } = {}) {
  let t = T0;
  const now = () => t;
  const db = openDb(':memory:');
  const store = override ? override(createStore(db, { aesKey: revealKeyFrom('x'.repeat(40)), now })) : createStore(db, { aesKey: revealKeyFrom('x'.repeat(40)), now });
  const app = express();
  mountPro(app, { store, now, log: quiet, config: {} });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (url, opts = {}) => {
    const res = await fetch(base + url, opts);
    let body = null;
    try { body = await res.json(); } catch { /* none */ }
    return { status: res.status, body, headers: res.headers };
  };
  const close = () => new Promise((r) => server.close(r));
  return { db, store, get, close, advance(ms) { t += ms; } };
}

// Words a person reads: tags out, entities in, split on spaces.
function words(html) {
  const text = html
    .replace(/<[^>]+\bhidden\b[^>]*>[^<]*<\/[a-z0-9]+>/gi, ' ') // hidden notes (the yearly one)
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9$+-]/.test(w) && w !== '·' && w !== '-');
}

// ---- GET /api/pro/seat -------------------------------------------------------------------

test('next seat: one number, no key needed, cached a minute, public cache header', async () => {
  const s = await setup();
  try {
    const r = await s.get('/api/pro/seat');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { next: 1 }, 'an empty database: seat 1 is next');
    assert.deepEqual(Object.keys(r.body), ['next'], 'nothing but the number');
    assert.equal(r.headers.get('cache-control'), `public, max-age=${SEAT_CACHE_MS / 1000}`);
    s.store.ensureLicence({ sessionId: 'cs_test_seat00000001', subscriptionId: 'sub_1', status: 'active' });
    s.store.ensureLicence({ sessionId: 'cs_test_seat00000002', subscriptionId: 'sub_2', status: 'active' });
    assert.deepEqual((await s.get('/api/pro/seat')).body, { next: 1 }, 'within a minute: the cached number');
    s.advance(SEAT_CACHE_MS);
    assert.deepEqual((await s.get('/api/pro/seat')).body, { next: 3 });
  } finally { await s.close(); }
});

test('next seat: read only, never goes down, never reused after a licence row is gone', async () => {
  const s = await setup();
  try {
    for (let i = 1; i <= 42; i++) s.store.ensureLicence({ sessionId: `cs_test_seat${String(i).padStart(8, '0')}`, subscriptionId: `sub_${i}`, status: 'active' });
    const before = s.db.prepare('SELECT COUNT(*) AS n FROM licences').get().n;
    assert.equal((await s.get('/api/pro/seat')).body.next, 43);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM licences').get().n, before, 'asking writes nothing');
    s.db.prepare('DELETE FROM licences WHERE seat = 42').run();
    s.advance(SEAT_CACHE_MS);
    assert.equal((await s.get('/api/pro/seat')).body.next, 43, 'seat_high keeps 42 taken');
    assert.equal(s.store.nextSeat(), 43);
    // Only GET: nothing else is routed there.
    assert.equal((await s.get('/api/pro/seat', { method: 'POST' })).status, 404);
  } finally { await s.close(); }
});

test('next seat: a database error is a 503, not a made-up number', async () => {
  const s = await setup({ store: (st) => ({ ...st, nextSeat() { throw new Error('locked'); } }) });
  try {
    const r = await s.get('/api/pro/seat');
    assert.equal(r.status, 503);
    assert.equal(r.body.next, undefined);
  } finally { await s.close(); }
});

// ---- the hero -----------------------------------------------------------------------------

test('hero: a visitor sees the next seat, UP NEXT, the zeros in front dim', () => {
  assert.deepEqual(seatParts(43), { lead: '000', digits: '43', label: 'SEAT 00043' });
  assert.deepEqual(seatParts(12345), { lead: '', digits: '12345', label: 'SEAT 12345' });
  assert.equal(seatParts(0), null);
  assert.equal(seatParts(null), null);
  assert.deepEqual(heroSeat({ next: 43 }), { mine: false, seat: 43 });
  const html = mainHtml({ next: 43, bbrk: BBRK, has: all });
  assert.match(html, new RegExp(`>${UP_NEXT}<`));
  assert.match(html, /aria-label="SEAT 00043"/);
  assert.match(html, /<span class="pro3-word">SEAT <\/span><span class="pro3-zero">000<\/span>43<\/h2>/);
  assert.doesNotMatch(html, /YOUR/);
  // Before the number arrives: dashes, never a guess.
  assert.match(mainHtml({ has: all }), /<span class="pro3-zero">-----<\/span><\/h2>/);
});

test('hero: a Pro viewer sees their own seat, not the next one', () => {
  const st = { status: 'active', seat: 12, canGift: true, interval: 'year', currentPeriodEnd: new Date(Date.UTC(2027, 8, 27, 12)).toISOString() };
  assert.deepEqual(heroSeat({ key: KEY, st, next: 43 }), { mine: true, seat: 12 });
  const html = mainHtml({ key: KEY, st, next: 43, bbrk: BBRK, has: all });
  assert.match(html, /aria-label="Your SEAT 00012"/);
  assert.match(html, /<span class="pro3-who">YOUR <\/span><span class="pro3-word">SEAT <\/span><span class="pro3-zero">000<\/span>12<\/h2>/);
  assert.doesNotMatch(html, /00043|>43</);
  assert.doesNotMatch(html, new RegExp(UP_NEXT));
  assert.match(html, /Renews Sep 27, 2027, yearly/);
  // Paid Pro: GIFT is the one big action, MANAGE a small link, no SUBSCRIBE, no live line.
  assert.match(html, new RegExp(`class="pro3-buy" href="\\?c=GIFT" data-cmd="GIFT">${GIFT_ACTION}<`));
  assert.match(html, /id="pro-manage">MANAGE</);
  assert.match(html, /id="pro-show">SHOW KEY</);
  assert.match(html, /data-cmd="LOGOUT"/);
  assert.doesNotMatch(html, /SUBSCRIBE|pro-proof|pro3-price/);
  // Pro that cannot gift (a trial or no subscription id): MANAGE is the big one, once.
  const noGift = mainHtml({ key: KEY, st: { ...st, canGift: false }, has: all });
  assert.equal((noGift.match(/id="pro-manage"/g) || []).length, 1);
  assert.match(noGift, /class="pro3-buy" id="pro-manage">MANAGE</);
});

test('hero: a lapsed key keeps its seat and gets REACTIVATE; a gift month gets no button', () => {
  const lapsed = mainHtml({ key: KEY, st: { status: 'canceled', seat: 7 }, has: all });
  assert.match(lapsed, /aria-label="Your SEAT 00007"/);
  assert.match(lapsed, /id="pro-sub" data-plan="year" data-label="REACTIVATE">REACTIVATE YEARLY</);
  assert.match(lapsed, /REACTIVATE keeps this key, its seat and your synced lists\./);
  assert.match(lapsed, /id="pro-manage">MANAGE</);
  const gift = mainHtml({ key: KEY, st: { status: 'gift', seat: 9, giftUntil: new Date(Date.now() + 5 * 864e5).toISOString() }, has: all });
  assert.match(gift, /aria-label="Your SEAT 00009"/);
  assert.doesNotMatch(gift, /pro3-buy|pro-manage/);
  assert.match(gift, /When the gift month ends, you can subscribe on this key and keep its seat\./);
  const ended = mainHtml({ key: KEY, st: { status: 'gift_ended', seat: 9 }, has: all });
  assert.match(ended, /data-label="SUBSCRIBE">SUBSCRIBE YEARLY</);
});

// ---- the price, the button, the plan -------------------------------------------------------

test('yearly first: PRO and PRO YEARLY lead with yearly, PRO MONTHLY with monthly', () => {
  const html = mainHtml({ next: 43, has: all });
  assert.match(html, /id="pro-plan-year" data-plan="year" aria-pressed="true">\$420 a year\.</);
  assert.match(html, /id="pro-plan-month" data-plan="month" aria-pressed="false">Or \$42 a month\.</);
  assert.match(html, /id="pro-sub" data-plan="year" data-label="SUBSCRIBE">SUBSCRIBE YEARLY</);
  assert.equal((html.match(/class="pro3-buy"/g) || []).length, 1, 'one button');
  const month = mainHtml({ next: 43, plan: 'month', has: all });
  assert.match(month, /id="pro-sub" data-plan="month" data-label="SUBSCRIBE">SUBSCRIBE MONTHLY</);
  assert.match(month, /id="pro-plan-month" data-plan="month" aria-pressed="true"/);
  assert.equal(planButton('year'), 'YEARLY');
  assert.equal(planButton('month'), 'MONTHLY');
  assert.deepEqual(parseCommand('PRO').args, {});
  assert.deepEqual(parseCommand('PRO YEARLY').args, { plan: 'year' });
  assert.deepEqual(parseCommand('PRO MONTHLY').args, { plan: 'month' });
  // The screen maps no plan to yearly (render: plan === 'month' ? 'month' : 'year').
  assert.match(readFileSync('public/screens/pro.js', 'utf8'), /const plan = cmd\.args\?\.plan === 'month' \? 'month' : 'year';/);
});

// ---- the test-mode line, DETAILS --------------------------------------------------------------

test('test mode: the dim line is on the page; DETAILS keeps the full terms and the test card', () => {
  assert.equal(TEST_LINE, 'Test mode: no card is charged yet.');
  const page = pageHtml();
  assert.match(page, /<p class="pro3-fine" id="pro-test" hidden>Test mode: no card is charged yet\.<\/p>/);
  assert.match(page, /id="pro-details" hidden/);
  const d = detailsHtml();
  for (const t of BUY_TERMS) assert.ok(d.includes(t.replace(/'/g, '&#39;')) || d.includes(t), t);
  assert.ok(d.includes(DEMO_BANNER));
  assert.match(d, /you agree to the <a href="\/terms">Terms<\/a>/);
  assert.match(d, />FREE</);
  assert.match(d, /COMING WHEN PRO LAUNCHES/);
  assert.match(mainHtml({ has: all }), new RegExp(`id="pro-more" aria-expanded="false" aria-controls="pro-details">\\${DETAILS_OPEN}<`));
  // The page shows it only when the server says test mode.
  assert.match(readFileSync('public/screens/pro.js', 'utf8'), /if \(c\.mode !== 'test' \|\| !el\.isConnected\) return;/);
});

// ---- the live line ---------------------------------------------------------------------------

test('live line: our own numbers only, the parts that are known, never a seat count', () => {
  assert.equal(proofLine(BBRK), '70 visitors this week · 7 min average visit');
  assert.equal(proofLine({ audience: { visitors: { d7: 1 } } }), '1 visitor this week');
  assert.equal(proofLine({ audience: { avgVisitSec: 40 } }), '40 s average visit');
  assert.equal(proofLine(null), '');
  assert.equal(proofLine({ audience: { visitors: { d7: null }, avgVisitSec: null } }), '');
  assert.equal(proofLine({ seats: { all: 12 }, audience: {} }), '', 'seats in test mode are demo checkouts');
  assert.equal(visitLen(417), '7 min');
  assert.match(mainHtml({ next: 43, bbrk: BBRK, has: all }), /id="pro-proof"><span class="pro3-part">70 visitors this week<\/span><span class="pro3-dot" aria-hidden="true"> · <\/span><span class="pro3-part">7 min average visit<\/span><\/p>/);
});

// ---- few words -------------------------------------------------------------------------------

test('few words: the visitor page is about 50 words, perks as three lines', () => {
  const html = mainHtml({ next: 43, bbrk: BBRK, has: all }) + '<p class="pro3-fine">' + TEST_LINE + '</p>';
  const w = words(html);
  assert.ok(w.length <= 55, `${w.length} words: ${w.join(' ')}`);
  assert.deepEqual(PERKS, ['Your seat number, forever.', 'Your setup on every device.', 'No ads. No trackers.']);
  for (const p of PERKS) assert.ok(html.includes(`<li>${p}</li>`), p);
  assert.match(html, /Coming: <a class="pro3-link" href="\?c=CHAT" data-cmd="CHAT">CHAT<\/a> between seats, closed-tab alerts\./);
  // One row of small links for a visitor.
  assert.match(html, /data-cmd="LOGIN">LOGIN<.*data-cmd="REDEEM">REDEEM<.*data-cmd="GIFT">GIFT<.*id="pro-more"/s);
});

// ---- every old PRO command -------------------------------------------------------------------

test('old commands still route: PRO YEARLY, LOGIN, LOGOUT, REDEEM, GIFT; MANAGE is on PRO', () => {
  assert.equal(parseCommand('PRO YEARLY').name, 'PRO');
  assert.equal(urlFor('PRO YEARLY').url, 'PRO YEARLY');
  assert.deepEqual(parseCommand('LOGIN').args, { show: true });
  assert.deepEqual(parseCommand(`LOGIN ${KEY}`).args, { key: KEY });
  assert.equal(parseCommand('LOGOUT').name, 'LOGOUT');
  assert.equal(parseCommand('REDEEM').name, 'REDEEM');
  assert.equal(parseCommand('REDEEM GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345').args.code, 'GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345');
  assert.equal(parseCommand('GIFT').name, 'GIFT');
  for (const c of [render, loginCommand.render, logoutCommand.render, giftCommand.render, redeemCommand.render]) assert.equal(typeof c, 'function');
  // MANAGE is a button on PRO for a key holder with billing, as before.
  assert.match(mainHtml({ key: KEY, st: { status: 'active', seat: 3, canGift: true }, has: all }), /id="pro-manage"/);
});

// ---- house rules -----------------------------------------------------------------------------

test('house rules on the new PRO copy: no brand word, no em dash, no emoji, no advice line up front', () => {
  const src = readFileSync('public/screens/pro.js', 'utf8') + readFileSync('public/screens/pro.css', 'utf8');
  assert.doesNotMatch(src, new RegExp(['bloom', 'berg'].join(''), 'i'));
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(src, /32,000/);
  const front = mainHtml({ next: 43, bbrk: BBRK, has: all });
  assert.doesNotMatch(front, /advice|advise|should buy|recommend/i);
  // No amber or orange in the new styles.
  assert.doesNotMatch(readFileSync('public/screens/pro.css', 'utf8'), /amber|orange|hsl\((2\d|3\d|4\d),/i);
});
