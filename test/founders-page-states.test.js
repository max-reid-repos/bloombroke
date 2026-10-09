// FOUNDERS charge day, the page half (lib/founders-page.js, public/founders.js) and the
// PRO / ME screens for a founders seat (screens/pro.js, screens/me.js): the token and
// session id leave the address first, the pay-link return polls slowly, every /founders
// answer says no-referrer, the frozen line, the failed-card line, and a founders seat has
// no MANAGE or CANCEL and never blocks DELETE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { mountFoundersPages, foundersPage, emptyState, COPY, CHARGE_COPY, keyCardHtml } from '../lib/founders-page.js';
import {
  readFragment, readPaid, cleanUrl, askPaid, untilText, payHero, payNote, TOKEN_RE as CLIENT_TOKEN_RE, LOST, PAID_WAITS, STILL,
} from '../public/founders.js';
import { TOKEN_RE, FROZEN_MESSAGE, CONTACT } from '../pro/founders.js';
import { statusText, foundersText, mainHtml, keyFacts } from '../public/screens/pro.js';
import { renewing, planFacts, meHtml } from '../public/screens/me.js';

const TOKEN = 'A'.repeat(20) + '_-' + 'b9'.repeat(10) + 'z'; // 43 characters, the shape only
const all = () => true;
const KEY = 'BB-AAAA-BBBB-CCCC-DDDD'; // a made-up key: only its shape matters here

// ---- the fragment and the session id -----------------------------------------------------

test('readFragment: #claim= and #pay= with the token; its shape checked like the server', () => {
  assert.equal(TOKEN.length, 43);
  assert.equal(String(CLIENT_TOKEN_RE), String(TOKEN_RE), 'the client checks the same shape as the API');
  assert.deepEqual(readFragment(`#claim=${TOKEN}`), { kind: 'claim', token: TOKEN, ok: true });
  assert.deepEqual(readFragment(`#pay=${TOKEN}`), { kind: 'pay', token: TOKEN, ok: true });
  assert.equal(readFragment(`#claim=${TOKEN}x`).ok, false, 'too long');
  assert.equal(readFragment('#claim=').ok, false, 'empty');
  assert.equal(readFragment(`#claim=${TOKEN.slice(0, 42)}!`).ok, false, 'a character outside base64url');
  for (const h of ['', '#', '#fuel', `#other=${TOKEN}`, `claim=${TOKEN}`, null, undefined]) assert.equal(readFragment(h), null, String(h));
});

test('readPaid and cleanUrl: the seat stays in the address, the session id goes', () => {
  assert.deepEqual(readPaid('?paid=7&s=cs_test_a1B2c3D4e5F6'), { seat: 7, s: 'cs_test_a1B2c3D4e5F6' });
  assert.deepEqual(readPaid('?paid=42'), { seat: 42, s: '' });
  assert.deepEqual(readPaid('?paid=7&s=nonsense'), { seat: 7, s: '' }, 'a session id of the wrong shape is never sent');
  for (const q of ['', '?paid=0', '?paid=43', '?paid=07', '?paid=x', '?s=cs_test_a1B2c3D4e5F6']) assert.equal(readPaid(q), null, q);
  assert.equal(cleanUrl({ pathname: '/founders', search: '?paid=7&s=cs_test_a1B2c3D4e5F6' }, { seat: 7, s: 'cs_test_a1B2c3D4e5F6' }), '/founders?paid=7');
  assert.equal(cleanUrl({ pathname: '/founders', search: '' }, null), '/founders', 'the fragment goes, the path stays');
});

test('founders.js: the address is cleaned at the top, before any other code; goal.js loads after it', () => {
  const src = readFileSync('public/founders.js', 'utf8');
  const take = src.indexOf('const SECRETS =');
  assert.ok(take > 0);
  for (const later of ['async function post', 'function founders()', 'function tips()', 'async function claim', 'async function pay']) {
    assert.ok(src.indexOf(later) > take, `${later} comes after the address is cleaned`);
  }
  assert.match(src, /window\.history\.replaceState\(null, '', cleanUrl\(loc, paid\)\)/);
  assert.doesNotMatch(src, /^\s*import /m, 'no imports: nothing runs before it');
  assert.doesNotMatch(src, /localStorage|sessionStorage/, 'the token is never stored');
  assert.doesNotMatch(src, /^(?:(?:const|let|var) [^=\n]+= )?await /m, 'no top-level await (it would let goal.js run first)');
  // The page: founders.js is the first script, goal.js (analytics) after it.
  const html = foundersPage(emptyState({}), {});
  const f = html.indexOf('founders.js"></script>');
  const g = html.indexOf('goal.js"></script>');
  assert.ok(f > 0 && g > f, 'founders.js before goal.js');
  assert.match(html, /<script type="module" src="\/founders\.js"><\/script>/, 'a module script (runs in order, not async)');
});

test('a link opened in a tab already on /founders: the fragment leaves the address first, then the link is used in place', () => {
  const src = readFileSync('public/founders.js', 'utf8');
  const h = src.slice(src.indexOf("window.addEventListener('hashchange'"));
  const body = h.slice(0, h.indexOf('\n  });'));
  const clear = body.indexOf('window.history.replaceState');
  assert.ok(clear > 0);
  for (const later of ['readFragment(', 'claim(', 'pay(']) assert.ok(body.indexOf(later) > clear, `${later} after the fragment is cleared`);
  assert.doesNotMatch(body, /reload\(/, 'no reload: the token is never put back in the address');
  assert.match(src, /main\.replaceChildren\(tpl\.content\.cloneNode\(true\), \.\.\.main\.querySelectorAll\('template'\)\)/, 'the templates stay for a second link');
});

test('ME answers with the same founders class as PRO (pro/me-routes.js passes the lookup)', () => {
  const src = readFileSync('pro/me-routes.js', 'utf8');
  assert.match(src, /const statusOf = \(lic\) => publicStatus\(lic, now\(\), mode, \{ classOf \}\);/);
  assert.equal((src.match(/planOf\(statusOf\(lic\)\)/g) || []).length, 2, 'GET /api/me and DOWNLOAD MY DATA');
});

test('the API\'s line for a link that cannot work is the one the page shows without asking', () => {
  assert.equal(CONTACT, 'hello@bloombroke.com');
  assert.equal(LOST, `This link does not work. Email ${CONTACT}.`);
  assert.ok(readFileSync('pro/founders.js', 'utf8').includes('const LOST = `This link does not work. Email ${CONTACT}.`;'));
});

// ---- the pay-link return: slow polling --------------------------------------------------------

test('askPaid: the key at once; pending waits 3, 6, 12, 24, 30 s, 6 asks at most, then still processing', async () => {
  const calls = [];
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); };
  const now = await askPaid({ seat: 7, s: 'cs_test_x' }, { send: async (url, body) => { calls.push([url, body]); return { key: 'BB-K' }; }, sleep });
  assert.deepEqual(now, { key: 'BB-K' });
  assert.deepEqual(calls, [['/api/founders/paid', { s: 'cs_test_x', seat: 7 }]]);
  assert.deepEqual(slept, []);
  let n = 0;
  const third = await askPaid({ seat: 7, s: 'cs_test_x' }, { send: async () => (++n === 3 ? { key: 'BB-3' } : { pending: true, status: 202 }), sleep });
  assert.deepEqual(third, { key: 'BB-3' });
  assert.deepEqual(slept, [3000, 6000]);
  slept.length = 0;
  n = 0;
  const never = await askPaid({ seat: 7, s: 'cs_test_x' }, { send: async () => { n++; return { pending: true }; }, sleep });
  assert.deepEqual(never, { still: true });
  assert.equal(n, 6, 'six asks: well under the 20 per 10 minutes the routes share');
  assert.deepEqual(slept, PAID_WAITS);
  assert.deepEqual(PAID_WAITS, [3000, 6000, 12000, 24000, 30000]);
  assert.equal(STILL, 'Still processing. Check your email for the link to your key.');
  // An error answer (shown already, refunding, rate limited) stops the asking.
  await assert.rejects(askPaid({ seat: 7, s: 'cs_test_x' }, { send: async () => { throw new Error('This key was shown once already. Use the link in your email.'); }, sleep }), /shown once/);
});

test('the pay card: the seat and class, the end in the viewer\'s own time, its zone named', () => {
  assert.equal(payHero({ seat: 17, class: 'founder' }), 'Founder seat 17');
  assert.equal(payHero({ seat: 3, class: 'ten' }), 'Five-year seat 3');
  assert.equal(untilText('2026-12-18T14:05:00.000Z', 'en-US', 'UTC'), 'Dec 18, 2:05 PM UTC');
  assert.equal(untilText('2026-12-18T14:05:00.000Z', 'en-US', 'Asia/Bangkok'), 'Dec 18, 9:05 PM GMT+7');
  assert.equal(untilText('nonsense'), '');
  assert.match(payNote({ payUntil: '2026-12-18T14:05:00.000Z' }), /^This link works until Dec 1[89], /);
});

// ---- the routes ----------------------------------------------------------------------------------

async function serve(founders) {
  const app = express();
  mountFoundersPages(app, { founders, log: { log() {}, error() {} } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { get: (u) => fetch(base + u), close: () => new Promise((r) => { server.close(r); }) };
}

function fakeFounders({ frozen = false } = {}) {
  const st = { ...emptyState({}), open: !frozen, ended: false, committedUsd: 840, seatsTaken: 2, seats: Array.from({ length: 42 }, (_, i) => ({ seat: i + 1, class: i < 10 ? 'ten' : 'founder', status: i < 2 ? 'committed' : 'open', handle: null })) };
  const confirms = [];
  return {
    confirms,
    status: () => st,
    store: { frozen: () => frozen },
    async confirm(s) { confirms.push(s); return { pending: true }; },
    async cancel() { return false; },
  };
}

test('GET /founders: Referrer-Policy no-referrer in every state; ?paid= is the key card alone, no analytics, no Stripe call', async () => {
  const f = fakeFounders();
  const s = await serve(f);
  try {
    for (const u of ['/founders', '/founders/', '/founders?s=cs_test_founders000001', '/founders?release=3.abc', '/founders?paid=7&s=cs_test_a1B2c3D4e5F6', '/founders?paid=7', '/founders?paid=99&s=cs_test_a1B2c3D4e5F6']) {
      const r = await s.get(u);
      assert.equal(r.status, 200, u);
      assert.equal(r.headers.get('referrer-policy'), 'no-referrer', u);
    }
    const r = await s.get('/founders?paid=7&s=cs_test_a1B2c3D4e5F6');
    const html = await r.text();
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok(html.includes(keyCardHtml('paid')), 'the key card');
    assert.ok(html.includes(CHARGE_COPY.again.paid));
    assert.doesNotMatch(html, /goal\.js/, 'no analytics on the return page');
    assert.doesNotMatch(html, /fd-seats|fd-main|<template/, 'nothing else on it');
    assert.match(html, /<title>Your Pro key \| Bloombroke<\/title>/);
    assert.deepEqual(f.confirms, ['cs_test_founders000001'], 'a pay session (?paid=, even a bad seat) is never sent to the seat checkout confirm');
    const bad = await (await s.get('/founders?paid=99&s=cs_test_a1B2c3D4e5F6')).text();
    assert.doesNotMatch(bad, /goal\.js/, 'a bad ?paid= gets the normal page without analytics');
    // The normal page carries the two charge-day cards, inert, for the fragment links.
    const page = await (await s.get('/founders')).text();
    assert.match(page, /<template id="fd-tpl-claim"><section class="card fd-card fd-key-card" id="fd-key-card"/);
    assert.match(page, /<template id="fd-tpl-pay"><section class="card fd-card fd-pay-card" id="fd-pay-card"/);
    assert.match(page, /goal\.js/, 'analytics on the normal page (after founders.js)');
    assert.equal((page.match(/btn-solid/g) || []).length, 1, 'still the one solid button: the cards wait as outlines');
  } finally { await s.close(); }
});

test('GET /founders, frozen: "Seats are closed. Founders reached the goal." with the closed look', async () => {
  const s = await serve(fakeFounders({ frozen: true }));
  try {
    const html = await (await s.get('/founders')).text();
    assert.equal(COPY.frozen, FROZEN_MESSAGE);
    assert.equal(FROZEN_MESSAGE, 'Seats are closed. Founders reached the goal.');
    assert.ok(html.includes(`<p class="card-note">${FROZEN_MESSAGE}</p>`));
    assert.ok(!html.includes(COPY.soon) && !html.includes(COPY.open));
    assert.ok(!html.includes('class="fd-pick"'), 'no seat can be picked');
    const solid = html.replace(/<template[\s\S]*?<\/template>/g, '');
    assert.equal((solid.match(/btn-solid/g) || []).length, 0, 'buttons disabled outlines, as when closed');
    assert.equal((solid.match(/<button type="button" class="btn card-btn"[^>]*disabled>/g) || []).length, 2);
  } finally { await s.close(); }
});

test('How it works: the failed-card line, in the words of Terms 2.2', () => {
  const html = foundersPage(emptyState({}), {});
  const line = 'If your card fails on the charge day, we email you a link to pay within 3 days. If you do not pay, we give the seat back.';
  assert.ok(COPY.how.includes(line));
  assert.ok(html.includes(`<li>${line}</li>`));
  const terms = readFileSync('legal/terms.md', 'utf8');
  assert.ok(terms.includes('If your card fails on the charge day, we email you a link to pay within 3 days.'));
  assert.ok(terms.includes('we give the seat back'));
  assert.doesNotMatch(line, /—/);
});

// ---- PRO and ME for a founders seat ----------------------------------------------------------

const FOUNDER_BEFORE = { active: true, status: 'active', seat: 5, founders: true, foundersClass: 'founder', canGift: false };
const TEN_BEFORE = { ...FOUNDER_BEFORE, foundersClass: 'ten' };
const TEN_AFTER = { ...FOUNDER_BEFORE, foundersClass: 'ten', termUntil: '2031-12-02T00:00:00.000Z', cancelAt: '2031-12-02T00:00:00.000Z' };

test('status text: a five-year seat ends (or starts on go-live day), a founder seat renews one year after go-live', () => {
  assert.equal(foundersText(TEN_AFTER), 'Five-year seat, ends Dec 2, 2031');
  assert.equal(statusText(TEN_AFTER), 'Five-year seat, ends Dec 2, 2031', 'not "(cancelled, will not renew)"');
  assert.equal(statusText({ ...TEN_AFTER, foundersClass: null }), 'Five-year seat, ends Dec 2, 2031', 'an end says five-year without the class');
  assert.equal(statusText(TEN_BEFORE), 'Five-year seat, starts on go-live day');
  assert.equal(statusText(FOUNDER_BEFORE), 'Founder seat, renews one year after go-live');
  assert.equal(statusText({ ...FOUNDER_BEFORE, foundersClass: null }), 'Founders seat, dates start on go-live day', 'no class from the server yet');
  // Not a founders seat, or one that ended: as before.
  assert.equal(statusText({ status: 'active' }), 'ACTIVE');
  assert.equal(statusText({ ...TEN_AFTER, status: 'canceled', active: false }), 'CANCELED');
  for (const st of [TEN_AFTER, TEN_BEFORE, FOUNDER_BEFORE]) assert.doesNotMatch(statusText(st), /—|cancel/i);
  // The key's facts: a five-year seat's end five years out carries its year.
  assert.deepEqual(keyFacts(TEN_AFTER).at(-1), { value: 'Dec 2, 2031', label: 'ENDS, NO RENEWAL' });
  assert.equal(keyFacts(TEN_BEFORE).length, 1, 'before go-live: the seat only');
});

test('PRO key view: a founders seat has no MANAGE PLAN or CANCEL; the line under the key says what it is', () => {
  for (const st of [FOUNDER_BEFORE, TEN_BEFORE, TEN_AFTER]) {
    const html = mainHtml({ key: KEY, st, has: all });
    assert.doesNotMatch(html, /id="pro-manage"|id="pro-cancel"/, st.foundersClass);
    assert.ok(html.includes(`<p class="card-sub">${foundersText(st)}</p>`), st.foundersClass);
    assert.match(html, /id="pro-show"/, 'SHOW KEY stays');
  }
  // A lapsed five-year seat: no MANAGE PLAN either.
  assert.doesNotMatch(mainHtml({ key: KEY, st: { ...TEN_AFTER, status: 'canceled', active: false, termUntil: null, cancelAt: null }, has: all }), /id="pro-manage"/);
  // Pro yearly still has both.
  const yearly = mainHtml({ key: KEY, st: { status: 'active', seat: 2, interval: 'year', currentPeriodEnd: '2027-09-27T12:00:00.000Z' }, has: all });
  assert.match(yearly, /id="pro-manage"/);
  assert.match(yearly, /id="pro-cancel"/);
});

test('ME: a founders seat never blocks DELETE, has no MANAGE PLAN or CANCEL, and its plan says which kind', () => {
  for (const st of [FOUNDER_BEFORE, TEN_BEFORE, TEN_AFTER]) {
    assert.equal(renewing(st), false, 'DELETE goes ahead (pro/me-routes.js willRenew: no subscription)');
    const html = meHtml({ key: KEY, st, has: all });
    assert.doesNotMatch(html, /id="me-manage"|id="me-cancel"/);
    assert.match(html, /id="me-delete"/);
  }
  assert.equal(renewing({ status: 'active', interval: 'year', currentPeriodEnd: '2027-09-27T12:00:00.000Z' }), true, 'Pro yearly still says cancel first');
  assert.deepEqual(planFacts(FOUNDER_BEFORE), [{ value: 'Founder', label: 'PLAN' }]);
  assert.deepEqual(planFacts(TEN_BEFORE), [{ value: 'Five-year', label: 'PLAN' }]);
  assert.deepEqual(planFacts(TEN_AFTER).map((f) => [f.value, f.label]), [['Five-year', 'PLAN'], ['Dec 2, 2031', 'ENDS']]);
  assert.deepEqual(planFacts({ ...FOUNDER_BEFORE, foundersClass: null }), [{ value: 'Founders', label: 'PLAN' }]);
});
