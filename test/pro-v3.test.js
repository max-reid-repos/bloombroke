// PRO v3: the seat, big, as a card page (kit.js cardPage). GET /api/pro/seat (the next
// seat number: read only, one number, cached), the hero (the next seat for a visitor),
// the key view for Pro (YOUR KEY, COPY, DOWNLOAD, MANAGE PLAN and CANCEL), yearly first,
// the test-mode note, the word budget, and every old PRO command.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { openDb } from '../pro/db.js';
import { createStore } from '../pro/store.js';
import { revealKeyFrom } from '../pro/licence.js';
import { mountPro, SEAT_CACHE_MS } from '../pro/routes.js';
import { parseCommand, urlFor } from '../public/app.js';
import { cardWords } from '../public/kit.js';
import {
  mainHtml, pageHtml, detailsHtml, heroSeat, seatParts, keyFacts, planButton,
  YOUR_KEY, STAGES, GIFT_ACTION, GIFT_AFTER, MANAGE, CANCEL, KEY_NOTE, RENEW_NOTE, TEST_NOTE, TERMS_ROWS, BUY_TERMS, DEMO_BANNER,
  render, loginCommand, logoutCommand, giftCommand, redeemCommand,
} from '../public/screens/pro.js';

const T0 = Date.UTC(2026, 8, 28, 12);
const quiet = { log() {}, error() {} };
const KEY = 'BB-7KQ2-M9XD-HT4P-WZ3C';
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

test('seat: the zeros in front dim; a visitor sees the next seat on the SEAT stage (PRO v5, test/pro-v5.test.js)', () => {
  assert.deepEqual(seatParts(43), { lead: '000', digits: '43', label: 'SEAT 00043' });
  assert.deepEqual(seatParts(12345), { lead: '', digits: '12345', label: 'SEAT 12345' });
  assert.equal(seatParts(0), null);
  assert.equal(seatParts(null), null);
  assert.deepEqual(heroSeat({ next: 43 }), { mine: false, seat: 43 });
  const html = mainHtml({ next: 43, has: all });
  assert.doesNotMatch(html, /YOUR/);
  // The seat number is drawn by the stage (in the browser), never in the page's own words.
  assert.doesNotMatch(html, /00043/);
});

test('key view: Pro sees YOUR KEY, COPY and DOWNLOAD, its own seat and renewal, and the small links', () => {
  const st = { status: 'active', seat: 12, canGift: true, interval: 'year', currentPeriodEnd: new Date(Date.UTC(2027, 8, 27, 12)).toISOString() };
  assert.deepEqual(heroSeat({ key: KEY, st, next: 43 }), { mine: true, seat: 12 });
  const html = mainHtml({ key: KEY, st, next: 43, has: all });
  assert.match(html, new RegExp(`<p class="tag card-kicker">${YOUR_KEY}</p>`));
  assert.match(html, /<span class="pro-key" id="pro-key">BB-XXXX-XXXX-XXXX-WZ3C<\/span>/, 'masked until SHOW KEY');
  assert.doesNotMatch(html, new RegExp(KEY), 'the full key is not in the page until asked');
  assert.match(mainHtml({ key: KEY, st, reveal: KEY, has: all }), new RegExp(`id="pro-key">${KEY}<`), 'in full after checkout, REDEEM or SHOW KEY');
  assert.match(html, /class="btn card-btn btn-solid" id="pro-copy">COPY</);
  assert.match(html, /class="btn card-btn" id="pro-dl">DOWNLOAD</);
  assert.equal((html.match(/btn-solid/g) || []).length, 1, 'one primary button');
  assert.ok(html.includes(KEY_NOTE));
  assert.doesNotMatch(html, /00043|>43</, 'its own seat, not the next one');
  assert.match(html, /<dd class="num"><span class="pro3-zero">000<\/span>12<\/dd>/);
  assert.match(html, /<dt class="tag">RENEWS YEARLY<\/dt><dd class="num">Sep 27, 2027<\/dd>/);
  // The links: GIFT, MANAGE PLAN, CANCEL (both open the billing portal), SHOW KEY, LOGOUT.
  assert.match(html, new RegExp(`<a class="card-link" href="\\?c=GIFT" data-cmd="GIFT">${GIFT_ACTION}</a>`));
  assert.match(html, new RegExp(`id="pro-manage">${MANAGE}<`));
  assert.match(html, new RegExp(`id="pro-cancel">${CANCEL}<`));
  assert.match(html, /id="pro-show">SHOW KEY</);
  assert.match(html, /data-cmd="LOGOUT"/);
  assert.doesNotMatch(html, /SUBSCRIBE|pro-sub|pro3-plan/);
  // No stage and no key row for someone who has Pro.
  assert.ok(STAGES.every((x) => !html.includes(`<span class="pd-key-l">${x.label}</span>`)));
  assert.doesNotMatch(html, /pd-|pro-v5|data-stage/);
  // Pro that cannot gift: no GIFT link; a subscription that is ending: no CANCEL.
  assert.doesNotMatch(mainHtml({ key: KEY, st: { ...st, canGift: false }, has: all }), /data-cmd="GIFT"/);
  const ending = mainHtml({ key: KEY, st: { ...st, cancelAtPeriodEnd: true }, has: all });
  assert.doesNotMatch(ending, /pro-cancel/);
  assert.match(ending, /ENDS, NO RENEWAL/);
  assert.equal((ending.match(/id="pro-manage"/g) || []).length, 1);
  // Both links call the same portal; no new billing code.
  const src = readFileSync('public/screens/pro.js', 'utf8');
  assert.match(src, /wire\(host, ctx, '#pro-manage', 'OPENING BILLING\.\.\.', \(\) => pro\.openPortal\(\)\);/);
  assert.match(src, /wire\(host, ctx, '#pro-cancel', '[^']*', \(\) => pro\.openPortal\(\)\);/);
});

test('just bought, SHOW KEY on a key with Pro off, a gift month, billing only with a saved key', () => {
  const st = { status: 'active', seat: 12, canGift: true, interval: 'year', currentPeriodEnd: new Date(Date.UTC(2027, 8, 27, 12)).toISOString() };
  const bought = mainHtml({ key: KEY, st, reveal: KEY, has: all });
  assert.match(bought, /<p class="card-note">Save this key\. It is your login on any device\.<\/p>/, 'the last chance to save it');
  assert.doesNotMatch(bought, /pro-manage|pro-cancel/, 'no key saved in this browser (node has none): nothing for billing to send');
  assert.match(mainHtml({ key: KEY, st, has: all }), /<p class="card-note">Your login on any device\.<\/p>/);
  // A key with Pro off: SHOW KEY puts the key into the same view; the price and REACTIVATE stay.
  const off = mainHtml({ key: KEY, st: { status: 'canceled', seat: 7 }, reveal: KEY, has: all });
  assert.match(off, /id="pro-sub"[^>]*>REACTIVATE YEARLY</);
  assert.match(off, /<dl class="card-facts n1"><div class="card-fact"><dt class="tag">YOUR KEY<\/dt><dd class="num"><span class="pro-key" id="pro-key">BB-7KQ2-M9XD-HT4P-WZ3C<\/span><\/dd><\/div><\/dl>/);
  assert.doesNotMatch(off, /pro-show/);
  assert.match(off, /Renews until cancelled · REACTIVATE keeps this key/);
  assert.match(mainHtml({ key: KEY, st: { status: 'gift_ended', seat: 9 }, has: all }), /Renews until cancelled · SUBSCRIBE keeps this key/);
  // A gift month: what happens after it, in Details.
  const gift = mainHtml({ key: KEY, st: { status: 'gift', seat: 9, giftUntil: new Date(Date.now() + 5 * 864e5).toISOString() }, has: all });
  assert.ok(gift.split('<details')[1].includes(GIFT_AFTER));
  assert.ok(!detailsHtml().includes(GIFT_AFTER));
  // A pasted gift code with spaces fits the LOGIN box.
  assert.match(readFileSync('public/screens/pro.js', 'utf8'), /button: 'LOGIN', maxlength: 80 \}/);
});

test('key facts: the seat, and renews, ends or the gift month', () => {
  const end = new Date(Date.UTC(2026, 10, 3, 12)).toISOString();
  const label = (st) => keyFacts(st, Date.UTC(2026, 9, 1)).map((f) => f.label);
  assert.deepEqual(label({ status: 'active', seat: 3, interval: 'month', currentPeriodEnd: end }), ['SEAT', 'RENEWS MONTHLY']);
  assert.deepEqual(label({ status: 'active', seat: 3, cancelAt: end }), ['SEAT', 'ENDS, NO RENEWAL']);
  assert.deepEqual(label({ status: 'gift', seat: 9, giftUntil: end }), ['SEAT', 'GIFT MONTH UNTIL']);
  assert.deepEqual(label(null), ['SEAT']);
});

test('hero: a lapsed key keeps its seat and gets REACTIVATE; a gift month shows the key', () => {
  const lapsed = mainHtml({ key: KEY, st: { status: 'canceled', seat: 7 }, has: all });
  assert.match(lapsed, /aria-label="Your SEAT 00007"/);
  assert.match(lapsed, /<p class="tag card-kicker">CANCELED<\/p>/);
  assert.match(lapsed, /id="pro-sub" data-plan="year" data-label="REACTIVATE">REACTIVATE YEARLY</);
  assert.match(lapsed, /REACTIVATE keeps this key, its seat and your synced lists\./);
  assert.match(lapsed, /id="pro-manage">MANAGE PLAN</);
  assert.doesNotMatch(lapsed, /pro-cancel/, 'nothing to cancel');
  const gift = mainHtml({ key: KEY, st: { status: 'gift', seat: 9, giftUntil: new Date(Date.now() + 5 * 864e5).toISOString() }, has: all });
  assert.match(gift, /YOUR KEY/);
  assert.doesNotMatch(gift, /pro-sub|pro-manage|pro-cancel/, 'a gift month has no billing');
  assert.match(gift, /GIFT MONTH UNTIL/);
  assert.ok(detailsHtml().length > 0);
  const ended = mainHtml({ key: KEY, st: { status: 'gift_ended', seat: 9 }, has: all });
  assert.match(ended, /data-label="SUBSCRIBE">SUBSCRIBE YEARLY</);
});

// ---- the price, the button, the plan -------------------------------------------------------

test('yearly first: PRO and PRO YEARLY lead with yearly, PRO MONTHLY with monthly', () => {
  // A visitor (PRO v5): both prices, each once, the picked one pressed; one SUBSCRIBE
  // with no plan word (it buys the picked plan).
  const html = mainHtml({ next: 43, has: all });
  assert.match(html, /<p class="card-sub"><span class="pro5-price" role="group" aria-label="Plan"><button type="button" class="pro3-plan pro5-plan" id="pro-plan-month" data-plan="month" aria-pressed="false">\$42 a month<\/button><button type="button" class="pro3-plan pro5-plan" id="pro-plan-year" data-plan="year" aria-pressed="true">\$420 a year<\/button><\/span><\/p>/);
  assert.match(html, /class="btn card-btn btn-solid" id="pro-sub" data-plan="year">SUBSCRIBE</);
  assert.equal((html.match(/btn-solid/g) || []).length, 1, 'one button');
  assert.equal((html.split('<details')[0].replace(/<[^>]+>/g, ' ').match(/\$420/g) || []).length, 1, '$420 once above Details');
  assert.equal((html.split('<details')[0].replace(/<[^>]+>/g, ' ').match(/\$42\b/g) || []).length, 1, '$42 once above Details');
  const month = mainHtml({ next: 43, plan: 'month', has: all });
  assert.match(month, /id="pro-sub" data-plan="month">SUBSCRIBE</);
  assert.match(month, /id="pro-plan-month" data-plan="month" aria-pressed="true">\$42 a month</);
  // A key with Pro off keeps the v3 switch: both prices, the picked one pressed.
  const off = mainHtml({ key: ['BB', '7KQ2', 'M9XD', 'HT4P', 'WZ3C'].join('-'), st: { status: 'canceled', seat: 7 }, has: all });
  assert.match(off, /id="pro-plan-year" data-plan="year" aria-pressed="true">\$420 a year\.</);
  assert.match(off, /id="pro-plan-month" data-plan="month" aria-pressed="false">Or \$42 a month\.</);
  // The switch: the same click handler (it reads the plan when clicked) for both views;
  // yearly not ready turns the year off (test/pro-v5-dom.test.js runs it).
  const src = readFileSync('public/screens/pro.js', 'utf8');
  assert.match(src, /for \(const p of host\.querySelectorAll\('\.pro3-plan'\)\) \{\s*p\.addEventListener\('click', \(\) => \{ v\.plan = p\.dataset\.plan; setPlan\(host, v\.plan\); \}\);/);
  assert.match(src, /y\.disabled = true;\s*y\.title = YEARLY_NOT_YET;/);
  assert.equal(planButton('year'), 'YEARLY');
  assert.equal(planButton('month'), 'MONTHLY');
  assert.deepEqual(parseCommand('PRO').args, {});
  assert.deepEqual(parseCommand('PRO YEARLY').args, { plan: 'year' });
  assert.deepEqual(parseCommand('PRO MONTHLY').args, { plan: 'month' });
  // The screen maps no plan to yearly (render: plan === 'month' ? 'month' : 'year').
  assert.match(readFileSync('public/screens/pro.js', 'utf8'), /const plan = cmd\.args\?\.plan === 'month' \? 'month' : 'year';/);
});

// ---- the note, the test mode, DETAILS -------------------------------------------------------

test('note and test mode: one dim line on the page; Details keeps every term as a short row, and the test card', () => {
  const html = mainHtml({ next: 43, has: all });
  // The visitor (PRO v5): "Cancel any time.", then the test-mode line, hidden until test mode.
  assert.match(html, /<p class="card-note">Cancel any time\.<span id="pro-year-note" hidden> [^<]+<\/span><span id="pro-test" hidden>Test mode: no card is charged yet\.<\/span><\/p>/);
  // A key with Pro off keeps its note (the member views are unchanged).
  const off = mainHtml({ key: KEY, st: { status: 'canceled', seat: 7 }, has: all });
  assert.match(off, new RegExp(`<p class="card-note">${RENEW_NOTE} · REACTIVATE keeps[^<]*<span id="pro-test" hidden> · ${TEST_NOTE}</span>`));
  assert.equal(pageHtml(), '<div class="pro-page"><div id="pro-claim"></div><div id="pro-account"></div></div>');
  // + Details: WHATIF's toggle, closed.
  assert.match(html, /<details class="how card-more"><summary>Details<\/summary>/);
  const d = detailsHtml();
  assert.ok(d.includes(DEMO_BANNER));
  assert.match(d, /id="pro-demo" role="note" hidden/);
  assert.match(d, /you agree to the <a href="\/terms">Terms<\/a>/);
  assert.match(d, />FREE</);
  assert.match(d, />PRO</);
  assert.doesNotMatch(d, /COMING WHEN PRO LAUNCHES/, 'closed-tab alerts are live now');
  // Every fact of the buying terms is still there, short: price, renewal, cancel, the
  // paid period, the experiment, the shutdown refund, gifts, login, not advice, operator.
  const text = d.replace(/<[^>]+>/g, ' ');
  for (const x of ['$42 a month or $420 a year', 'Stripe', 'until you cancel', 'type PRO and press MANAGE PLAN or CANCEL', 'end of the month or year you paid for',
    'experiment', 'short notice', 'refund the unused days', 'up to 3 codes', '30 days', 'no card', 'their own seat', 'Work once', '90 days',
    'Cannot make gift codes', 'no email or password', 'not investment advice', 'Run by Bloombroke.', 'hello@bloombroke.com']) assert.ok(text.includes(x), x);
  for (const [, t] of TERMS_ROWS) assert.ok(t.split(/\s+/).length <= 14, `${t}: 14 words or fewer`);
  // The full wording stays exported (and in the Terms).
  assert.match(BUY_TERMS.join(' '), /Cancel any time: type PRO and press MANAGE PLAN or CANCEL\./);
  // The page shows the test bits only when the server says test mode, and never when
  // checkout is closed (PRO_CHECKOUT=closed shows "Pro opens soon." instead).
  const src = readFileSync('public/screens/pro.js', 'utf8');
  assert.match(src, /if \(c\.closed\) \{ showSoon\(el\); return; \}\n\s+if \(c\.mode !== 'test'\) return;/);
});

// ---- few words -------------------------------------------------------------------------------

test('few words: the visitor view within its budget (test/layout-rules.test.js), 25 with a key; no visitors line', () => {
  const visitor = mainHtml({ next: 43, has: all }).replace('<span id="pro-test" hidden>', '<span id="pro-test">');
  const w = cardWords(visitor);
  assert.ok(w.length <= 42, `${w.length} words: ${w.join(' ')}`);
  assert.doesNotMatch(visitor, /visitors this week|average visit|pro-proof/, 'that line lives on SPONSOR and BBRK');
  // PRO v5: LOGIN and REDEEM behind one quiet line, in + Details; GIFT is for members.
  assert.match(visitor.split('<details')[1], /id="pro-keylinks" hidden><a class="card-link" href="\?c=LOGIN" data-cmd="LOGIN">LOGIN<\/a> <a class="card-link" href="\?c=REDEEM" data-cmd="REDEEM">REDEEM<\/a><\/span>/);
  assert.doesNotMatch(visitor, /data-cmd="GIFT"/);
  const st = { status: 'active', seat: 12, canGift: true, interval: 'year', currentPeriodEnd: new Date(Date.UTC(2027, 8, 27, 12)).toISOString() };
  const k = cardWords(mainHtml({ key: KEY, st, has: all }));
  assert.ok(k.length <= 25, `${k.length} words: ${k.join(' ')}`);
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
  // MANAGE PLAN is on PRO for a key holder with billing, as before.
  assert.match(mainHtml({ key: KEY, st: { status: 'active', seat: 3, canGift: true }, has: all }), /id="pro-manage"/);
  // LOGIN and REDEEM with nothing after them: a box on the page, not a line of how-to.
  assert.deepEqual(parseCommand('REDEEM').args, { show: true });
});

// ---- house rules -----------------------------------------------------------------------------

test('house rules on the new PRO copy: no brand word, no em dash, no emoji, no advice line up front', () => {
  const src = readFileSync('public/screens/pro.js', 'utf8') + readFileSync('public/screens/pro.css', 'utf8');
  assert.doesNotMatch(src, new RegExp(['bloom', 'berg'].join(''), 'i'));
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(src, /32,000/);
  const front = mainHtml({ next: 43, has: all }).split('<details')[0];
  assert.doesNotMatch(front, /advice|advise|should buy|recommend/i);
  // No amber or orange in the new styles.
  assert.doesNotMatch(readFileSync('public/screens/pro.css', 'utf8'), /amber|orange|hsl\((2\d|3\d|4\d),/i);
});

// ---- "No ads." stays true for Pro --------------------------------------------------------------

test('no ads for Pro: no SPONSORED BY on a gauge screen, no AD or SPONSOR line in the strip', async () => {
  const { gaugeSponsorHtml, markGaugeSponsor } = await import('../public/screens/sponsor.js');
  const { stripItems } = await import('../public/sponsor-strip.js');
  const cfg = { lines: [], house: [{ text: 'YOUR COMPANY HERE.', cmd: 'SPONSOR' }], gauges: { pizza: { name: 'Acme Pizza' } }, line: null };
  assert.equal(gaugeSponsorHtml(cfg, 'pizza'), '<span class="meta-note">SPONSORED BY ACME PIZZA</span>');
  assert.equal(gaugeSponsorHtml(cfg, 'pizza', { pro: true }), '');
  // The gauge screen's hook, with the config from /api/sponsors.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => cfg });
  try {
    const meta = () => { const calls = []; return { calls, isConnected: true, insertAdjacentHTML(pos, html) { calls.push(html); } }; };
    const free = meta();
    const paid = meta();
    markGaugeSponsor(free, 'pizza', { pro: () => false });
    markGaugeSponsor(paid, 'pizza', { pro: () => true });
    await new Promise((r) => { setTimeout(r, 20); });
    assert.equal(free.calls.length, 1);
    assert.match(free.calls[0], /SPONSORED BY ACME PIZZA/);
    assert.deepEqual(paid.calls, [], 'Pro sees no sponsor label');
  } finally { globalThis.fetch = realFetch; }
  // The status strip: house AD lines and paid SPONSOR lines, none for Pro.
  assert.equal(stripItems(cfg)[0].label, 'AD');
  assert.deepEqual(stripItems(cfg, { pro: true }), []);
  assert.deepEqual(stripItems({ ...cfg, lines: [{ name: 'Acme', text: 'Pizza', url: 'https://acme.example' }] }, { pro: true }), []);
  // The share card is public: it keeps SPONSORED BY (lib/og-weird.js has no Pro switch).
  assert.match(readFileSync('lib/og-weird.js', 'utf8'), /SPONSORED BY \$\{m\.sponsor\}/);
  // The gauge screen still calls the hook, which checks Pro itself.
  assert.match(readFileSync('public/screens/weird.js', 'utf8'), /markGaugeSponsor\(el\.querySelector\('#wd-meta'\), g\.id\)/);
  assert.match(readFileSync('public/screens/sponsor.js', 'utf8'), /export function markGaugeSponsor\(metaEl, id, \{ pro = isPro \} = \{\}\)/);
});
