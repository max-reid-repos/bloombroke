// The Pro structure in the browser and around it: the PRO breakdown, SEAT, GIFT and
// REDEEM routing (codes never in the URL or history), CHAT, SPONSOR and the sponsor line,
// and FEEDBACK (server route, storage, export script, the status strip link).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { parseCommand, urlFor, linkPlan, COMMANDS, SOON, screenTitle } from '../public/app.js';
import { findCommand, LISTED } from '../public/registry.js';
import { seatLabel, statusActive, bareGift, normalizeGiftCode as clientGift, maskGift, PRICE_BOTH } from '../public/pro.js';
import {
  offerHtml, shownRows, FREE_ROWS, PRO_ROWS, LIVE, COMING, RULE, parseLogin, parseRedeem, statusText, giftRowsHtml, GIFT_RULES, parse as parsePro,
} from '../public/screens/pro.js';
import { notProHtml, NOT_PRO } from '../public/screens/chat.js';
import { gaugeSponsorHtml } from '../public/screens/sponsor.js';
import { feedbackPayload, feedbackHtml, counterText, THANKS, EMAIL_LABEL, MAX_FEEDBACK, STATUS } from '../public/screens/feedback.js';
import { cleanSponsors, loadSponsors } from '../lib/sponsors.js';
import { gaugeModel, gaugeTree } from '../lib/og-weird.js';
import { WEIRD_GAUGES } from '../public/screens/weird-gauges.js';
import { normalizeGiftCode as serverGift, generateGiftCode } from '../pro/licence.js';
import { openDb } from '../pro/db.js';
import { createFeedbackStore, mountFeedback, validateFeedback, cleanScreen, KEEP_MS } from '../pro/feedback.js';
import { createLimiter } from '../pro/ratelimit.js';
import { parseArgs, formatFeedback, run as runExport } from '../scripts/feedback-export.js';
import { TERMS_VERSION } from '../public/legal-version.js';

const CODE = 'GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345';
const T0 = Date.UTC(2026, 8, 27, 12);

// ---- PRO breakdown -----------------------------------------------------------------------

test('PRO: free is what you look at, Pro is your own stuff; every row says LIVE or COMING', () => {
  assert.equal(RULE, 'Free is everything you look at. Pro is your own stuff, plus things that work while you are away.');
  assert.ok(FREE_ROWS.every(([, s]) => s === LIVE), 'everything free is live');
  const pro = Object.fromEntries(PRO_ROWS.map(([n, s]) => [n, s]));
  for (const n of ['Watchlist, portfolio, DESK and GRID on every device', 'Your own ticker tape', 'A seat number', 'No sponsor line']) assert.equal(pro[n], LIVE, n);
  assert.ok(FREE_ROWS.some(([n, s]) => n === 'DESK and GRID, saved on this device' && s === LIVE), 'DESK and GRID are free on this device');
  assert.equal(pro['Alerts when the tab is closed'], COMING);
  assert.equal(pro['CHAT with friends who have Pro'], LIVE, 'CHAT is live for Pro');
  // WHATIF with your own purchase is free for everyone (owner, 27 Sep 2026).
  assert.equal(pro['WHATIF with your own purchase'], undefined);
  assert.ok(FREE_ROWS.some(([n, s]) => n === 'WHATIF with your own purchase' && s === LIVE));
  assert.equal(COMING, 'COMING WHEN PRO LAUNCHES');
  const html = offerHtml();
  assert.match(html, />FREE</);
  assert.match(html, />PRO</);
  assert.match(html, /\$42<\/span><span class="hero-unit">A MONTH/);
  assert.match(html, /\$420<\/span><span class="hero-unit">A YEAR/);
  assert.equal((html.match(/COMING WHEN PRO LAUNCHES/g) || []).length, 1);
  assert.equal(PRICE_BOTH, '$42 a month or $420 a year');
  // A row for a command this site does not have is left out, never shown as live.
  const guess = FREE_ROWS.find(([n]) => n === 'GUESS');
  assert.equal(shownRows([guess]).length, findCommand('GUESS') ? 1 : 0);
  assert.doesNotMatch(html, /\u2014/);
});

test('PRO YEARLY leads with the yearly plan; the plan never goes to the server as a price', () => {
  assert.deepEqual(parsePro(['YEARLY']), { plan: 'year' });
  assert.deepEqual(parsePro(['MONTHLY']), { plan: 'month' });
  assert.deepEqual(parsePro([]), {});
  const c = parseCommand('PRO YEARLY');
  assert.equal(c.name, 'PRO');
  assert.deepEqual(c.args, { plan: 'year' });
  assert.equal(urlFor('PRO YEARLY').url, 'PRO YEARLY');
});

test('status text: yearly renewal, gift month', () => {
  const end = new Date(Date.UTC(2027, 8, 27, 12)).toISOString();
  assert.equal(statusText({ status: 'active', interval: 'year', currentPeriodEnd: end }), 'Renews Sep 27, 2027, yearly');
  assert.equal(statusText({ status: 'active', interval: 'year', cancelAtPeriodEnd: true, currentPeriodEnd: end }), 'Active until Sep 27, 2027 (cancelled, will not renew)');
  const until = new Date(Date.now() + 86400000).toISOString();
  assert.match(statusText({ status: 'gift', giftUntil: until }), /^Gift month, until /);
  assert.equal(statusText({ status: 'gift_ended' }), 'Gift month ended');
  assert.equal(statusActive({ status: 'gift', giftUntil: until }), true);
  assert.equal(statusActive({ status: 'gift', giftUntil: new Date(Date.now() - 1).toISOString() }), false);
  assert.equal(statusActive({ status: 'gift' }), false, 'no end date, no Pro');
  assert.equal(statusActive({ status: 'gift_ended' }), false);
});

// ---- SEAT --------------------------------------------------------------------------------

test('seat: SEAT 00042 in the top bar, hidden until the server sends one', () => {
  assert.equal(seatLabel(42), 'SEAT 00042');
  assert.equal(seatLabel(1), 'SEAT 00001');
  assert.equal(seatLabel(123456), 'SEAT 123456');
  for (const bad of [null, undefined, 0, -1, 1.5, '42']) assert.equal(seatLabel(bad), null);
  const html = readFileSync('public/index.html', 'utf8');
  const top = /<header class="topbar">[\s\S]*?<\/header>/.exec(html)[0];
  assert.match(top, /class="wordmark"[^>]*>BLOOMBROKE<\/a><a id="seat" class="seat num" href="\/\?c=PRO" data-cmd="PRO" hidden><\/a>/, 'next to the name, empty and hidden');
  // Only the display reads the seat; it is never sent back.
  const client = readFileSync('public/pro.js', 'utf8');
  assert.doesNotMatch(client, /headers\[[^\]]*\]\s*=\s*[^;]*seat/i);
});

// ---- GIFT and REDEEM routing: the code never reaches the URL or history -----------------------

test('gift codes: client and server read them the same way', () => {
  for (let i = 0; i < 30; i++) {
    const c = generateGiftCode();
    for (const v of [c, c.toLowerCase(), c.replace(/-/g, ''), c.replace(/-/g, ' '), c.slice(5)]) assert.equal(clientGift(v), serverGift(v), v);
  }
  assert.equal(maskGift('2345'), 'GIFT-XXXX-...-2345');
});

test('REDEEM <code>, a pasted code, GIFT <code> and LOGIN <code> all redeem, and keep the code out of the URL and history', () => {
  for (const typed of [`REDEEM ${CODE}`, CODE, CODE.toLowerCase(), CODE.replace(/-/g, ' '), `redeem ${CODE.slice(5)}`]) {
    const c = parseCommand(typed);
    assert.equal(c.name, 'REDEEM', typed);
    assert.deepEqual(c.args, { code: CODE }, typed);
    assert.equal(c.input, 'REDEEM', 'the title shows REDEEM only');
    assert.equal(c.secret, true);
    const u = urlFor(typed.toUpperCase());
    assert.equal(u.url, 'REDEEM');
    assert.equal(u.kept, 'REDEEM');
    // A link never redeems by itself and never keeps the code.
    const plan = linkPlan(typed);
    assert.equal(plan.url, 'REDEEM');
    assert.equal(plan.show, 'REDEEM');
    assert.equal(plan.ask, null);
    assert.equal(parseCommand(plan.show).args.code, undefined);
  }
  assert.deepEqual(parseCommand('REDEEM').args, { show: true });
  assert.deepEqual(parseRedeem(['NOPE']), { error: 'format' });
  assert.equal(urlFor('REDEEM NOPE').kept, 'REDEEM', 'even a wrong code is not kept');
  // GIFT alone is the GIFT screen; GIFT followed by a code redeems it.
  assert.equal(parseCommand('GIFT').name, 'GIFT');
  assert.equal(parseCommand(`GIFT ${CODE.slice(5).replace(/-/g, ' ')}`).name, 'REDEEM');
  // LOGIN with a gift code redeems it; the key never reaches the URL either way.
  assert.deepEqual(parseLogin([CODE]), { gift: CODE });
  assert.equal(urlFor(`LOGIN ${CODE}`).kept, 'LOGIN');
  assert.equal(urlFor(`LOGIN ${CODE}`).url, 'PRO');
  // Words are not codes.
  assert.equal(bareGift(['GIFTS']), null);
  assert.equal(bareGift(['AAPL']), null);
  assert.equal(parseCommand('GIFTS').name === 'REDEEM', false);
});

test('GIFT screen: codes are listed masked with their state; the rules are plain', () => {
  const html = giftRowsHtml([
    { last4: 'AAAA', state: 'unused', expiresAt: T0 },
    { last4: 'BBBB', state: 'redeemed', redeemedAt: T0 },
    { last4: 'CCCC', state: 'expired', expiresAt: T0 },
  ], () => 'SEP 27');
  assert.match(html, /GIFT-XXXX-\.\.\.-AAAA<\/span><span class="pro-tag is-live">UNUSED until SEP 27/);
  assert.match(html, /REDEEMED on SEP 27/);
  assert.match(html, /EXPIRED on SEP 27/);
  assert.match(GIFT_RULES, /up to 3 gift codes/);
  assert.match(GIFT_RULES, /Pro for 30 days, free, with no card/);
  assert.match(GIFT_RULES, /works once and expires 90 days after/);
  assert.match(GIFT_RULES, /A gift licence cannot make gift codes/);
});

// ---- CHAT --------------------------------------------------------------------------------

test('CHAT: in the registry, a Pro command, its own screen (test/chat-client.test.js has the rest)', () => {
  const c = parseCommand('CHAT');
  assert.equal(c.name, 'CHAT');
  assert.equal(c.input, 'CHAT');
  assert.ok(findCommand('CHAT'));
  assert.equal(findCommand('CHAT').category, 'Pro');
  assert.ok(COMMANDS.some((x) => x.name === 'CHAT'));
  assert.ok(!SOON.some((x) => x.name === 'CHAT'), 'its own screen, not the generic soon line');
  const html = notProHtml();
  const text = html.replace(/<[^>]+>/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(text, ['CHAT', NOT_PRO, 'PRO'], 'a card page: CHAT, one line, PRO');
  assert.match(html, /class="btn card-btn btn-solid" href="\?c=PRO" data-cmd="PRO">PRO</);
  assert.equal(screenTitle(c).title, 'CHAT');
});

test('registry: GIFT, REDEEM, SPONSOR and FEEDBACK are listed; SPONSOR is not in the key bar', async () => {
  for (const n of ['GIFT', 'REDEEM', 'SPONSOR', 'FEEDBACK', 'CHAT']) assert.ok(LISTED.some((c) => c.name === n), n);
  assert.equal(parseCommand('IDEA').name, 'FEEDBACK');
  const { FKEYS } = await import('../public/app.js');
  assert.ok(!FKEYS.some((k) => k.cmd === 'SPONSOR'));
  for (const n of ['GIFT', 'REDEEM', 'SPONSOR', 'FEEDBACK', 'CHAT']) {
    const e = findCommand(n);
    assert.doesNotMatch(`${e.summary} ${e.syntax}`, /\u2014/);
  }
});

// ---- Sponsors ------------------------------------------------------------------------------

test('gauge sponsors: SPONSORED BY on the gauge title strip and on its share card', () => {
  const cfg = cleanSponsors({ line: null, gauges: { pizza: { name: 'Acme Pizza' }, 'BAD ID': { name: 'x' }, canal: { name: '' } } });
  assert.deepEqual(cfg.gauges, { pizza: { name: 'Acme Pizza' } });
  assert.equal(gaugeSponsorHtml(cfg, 'pizza'), '<span class="meta-note">SPONSORED BY ACME PIZZA</span>');
  assert.equal(gaugeSponsorHtml(cfg, 'canal'), '');
  // The share card: set the config for this test, then back to the committed one.
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-sp-'));
  try {
    const file = path.join(dir, 'sponsors.json');
    writeFileSync(file, JSON.stringify({ line: null, gauges: { pizza: { name: 'Acme Pizza' } } }));
    loadSponsors(file);
    const g = WEIRD_GAUGES.find((x) => x.id === 'pizza');
    const m = gaugeModel(g, { ok: true, headline: 'BUSY', line: 'x', source: 'pizzint.watch' });
    assert.equal(m.sponsor, 'ACME PIZZA');
    assert.match(JSON.stringify(gaugeTree(m)), /WEIRD DATA · SPONSORED BY ACME PIZZA/);
    const other = gaugeModel(WEIRD_GAUGES.find((x) => x.id !== 'pizza'), null);
    assert.equal('sponsor' in other, false);
  } finally {
    loadSponsors();
    rmSync(dir, { recursive: true, force: true });
  }
  const plain = gaugeModel(WEIRD_GAUGES.find((x) => x.id === 'pizza'), null);
  assert.equal('sponsor' in plain, false, 'no sponsor: the model is exactly as before');
  // The WEIRD gauge screen has one isolated hook.
  const src = readFileSync('public/screens/weird.js', 'utf8');
  assert.equal((src.match(/markGaugeSponsor/g) || []).length, 2, 'an import and one call');
});

// ---- FEEDBACK --------------------------------------------------------------------------------

async function feedbackServer({ max = 5 } = {}) {
  let t = T0;
  const now = () => t;
  const db = openDb(':memory:');
  const store = createFeedbackStore(db, { now });
  const app = express();
  mountFeedback(app, { store, now, limiter: createLimiter({ max, windowMs: 60 * 60 * 1000, now }), log: { error() {} } });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body, { origin = base, headers = {} } = {}) => {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (origin) h.Origin = origin;
    const res = await fetch(`${base}/api/feedback`, { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { db, store, post, base, advance(ms) { t += ms; }, close: () => new Promise((r) => server.close(r)) };
}

test('feedback: validation trims, rejects empty and too long, checks the optional email', () => {
  assert.deepEqual(validateFeedback({ message: '  hi  ', screen: 'aapl 5y' }), { message: 'hi', email: null, screen: 'AAPL 5Y' });
  assert.deepEqual(validateFeedback({ message: 'x', email: ' a@b.co ' }).email, 'a@b.co');
  assert.equal(validateFeedback({ message: 'x', email: '' }).email, null);
  for (const [body, code] of [[{}, 'empty'], [{ message: '   ' }, 'empty'], [{ message: 'x'.repeat(1001) }, 'too_long'], [{ message: 'x', email: 'nope' }, 'bad_email'], [{ message: 'x', email: 5 }, 'bad_email'], [null, 'bad_request'], [[1], 'bad_request']]) {
    assert.throws(() => validateFeedback(body), (e) => e.code === code, JSON.stringify(body));
  }
  assert.equal(validateFeedback({ message: 'x'.repeat(1000) }).message.length, 1000);
  assert.equal(cleanScreen('<script>alert(1)</script>'), '<SCRIPT>ALERT1</SCRIPT>'.replace(/[()]/g, ''));
  assert.equal(cleanScreen('x'.repeat(200)).length, 64);
  assert.equal(cleanScreen(''), null);
  assert.equal(cleanScreen(7), null);
});

test('feedback: a free visitor (no licence, no key) can send one; it is stored with no IP', async () => {
  const s = await feedbackServer();
  try {
    const r = await s.post({ message: '  Please add a dark mode for charts  ', email: 'me@example.com', screen: 'AAPL 5Y' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
    const rows = s.db.prepare('SELECT * FROM feedback').all();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { id: 1, created_at: T0, message: 'Please add a dark mode for charts', email: 'me@example.com', screen: 'AAPL 5Y', legal_version: TERMS_VERSION });
    const cols = s.db.prepare('PRAGMA table_info(feedback)').all().map((c) => c.name);
    assert.deepEqual(cols, ['id', 'created_at', 'message', 'email', 'screen', 'legal_version'], 'no IP column, no licence column');
    assert.equal((await s.post({ message: 'no email' })).status, 200);
    assert.equal(s.db.prepare('SELECT email FROM feedback WHERE id = 2').get().email, null);
    // Bad input is refused and not stored.
    assert.equal((await s.post({ message: '' })).status, 400);
    assert.equal((await s.post('{not json')).status, 400);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 2);
  } finally { await s.close(); }
});

test('feedback: same origin only', async () => {
  const s = await feedbackServer();
  try {
    assert.equal((await s.post({ message: 'x' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await s.post({ message: 'x' }, { origin: null })).status, 403, 'no Origin');
    assert.equal((await s.post({ message: 'x' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await s.post({ message: 'x' }, { origin: 'https://bloombroke.com' })).status, 200, 'the public site');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 1);
  } finally { await s.close(); }
});

test('feedback: the honeypot says thanks and keeps nothing', async () => {
  const s = await feedbackServer();
  try {
    const r = await s.post({ message: 'buy cheap pills', website: 'http://spam.example' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 0);
  } finally { await s.close(); }
});

test('feedback: 5 an hour per IP, in memory; then 429 until the hour is up', async () => {
  const s = await feedbackServer();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await s.post({ message: `note ${i}` })).status, 200);
    const r = await s.post({ message: 'one more' });
    assert.equal(r.status, 429);
    assert.equal(r.body.error, 'rate_limited');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 5);
    s.advance(60 * 60 * 1000);
    assert.equal((await s.post({ message: 'next hour' })).status, 200);
  } finally { await s.close(); }
});

test('feedback: kept 12 months, then pruned', () => {
  let t = T0;
  const db = openDb(':memory:');
  const store = createFeedbackStore(db, { now: () => t });
  store.add({ message: 'old' });
  t += 1000;
  store.add({ message: 'new' });
  t = T0 + KEEP_MS;
  assert.equal(store.prune(), 0, 'exactly 12 months old: still kept');
  t += 1;
  assert.equal(store.prune(), 1);
  assert.deepEqual(store.recent().map((r) => r.message), ['new']);
});

test('feedback export script: newest first, --since and --limit, plain text, --prune', () => {
  assert.deepEqual(parseArgs([]), { since: 0, limit: 50, prune: false, db: null });
  assert.deepEqual(parseArgs(['--since', '2026-09-01', '--limit', '10']), { since: Date.UTC(2026, 8, 1), limit: 10, prune: false, db: null });
  assert.ok(parseArgs(['--since', 'yesterday']).error);
  assert.ok(parseArgs(['--limit', '0']).error);
  assert.ok(parseArgs(['--what']).error);
  assert.equal(parseArgs(['--prune', '--db', '/x.db']).prune, true);
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-fb-'));
  try {
    const file = path.join(dir, 'pro.db');
    let t = Date.UTC(2026, 8, 20, 8, 30);
    const store = createFeedbackStore(openDb(file), { now: () => t });
    store.add({ message: 'first\nsecond line', email: 'a@b.co', screen: 'HOME' });
    t = Date.UTC(2026, 8, 25, 9, 0);
    store.add({ message: 'newer' });
    const db = new Database(file, { readonly: true });
    const all = runExport(db, {}).text;
    assert.ok(all.indexOf('newer') < all.indexOf('first'), 'newest first');
    assert.match(all, /#1 {2}2026-09-20 08:30 UTC {2}screen HOME {2}email a@b\.co {2}legal /);
    assert.match(all, /\n {4}first\n {4}second line\n/);
    assert.match(all, /#2 {2}2026-09-25 09:00 UTC {2}screen -- {2}email --/);
    assert.doesNotMatch(runExport(db, { since: Date.UTC(2026, 8, 21) }).text, /first/);
    assert.equal((runExport(db, { limit: 1 }).text.match(/^#\d/gm) || []).length, 1);
    db.close();
    const rw = new Database(file);
    assert.equal(runExport(rw, { prune: true, now: Date.UTC(2026, 8, 20, 8, 30) + KEEP_MS + 1 }).pruned, 1);
    assert.doesNotMatch(runExport(rw, {}).text, /first/);
    rw.close();
    assert.equal(formatFeedback([]), 'No feedback.\n');
    assert.match(runExport(new Database(':memory:'), {}).text, /No feedback table yet/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('feedback screen: the form, the counter, the email label, thanks, the mail line', () => {
  const html = feedbackHtml();
  assert.match(html, new RegExp(`<textarea id="fb-msg" class="fb-msg" maxlength="${MAX_FEEDBACK}"`));
  assert.equal(MAX_FEEDBACK, 1000);
  assert.match(html, /id="fb-count"[^>]*>0 \/ 1000</);
  assert.equal(counterText(12), '12 / 1000');
  assert.equal(EMAIL_LABEL, 'Email for a reply (optional)');
  assert.match(html, /<label class="fb-l" for="fb-email">Email for a reply \(optional\)<\/label>/);
  assert.match(html, /<span id="fb-q">What should we fix or build\?<\/span>/, 'the question is the hero');
  assert.match(html, /<textarea id="fb-msg"[^>]*aria-labelledby="fb-q"/, 'and it labels the note');
  assert.match(html, /type="submit" class="btn card-btn btn-solid" id="fb-send" title="Ctrl\+Enter sends">SEND</);
  assert.equal((html.match(/btn-solid/g) || []).length, 1, 'one primary button');
  assert.equal(STATUS, 'FEEDBACK: NO IP ADDRESS STORED. CTRL+ENTER SENDS');
  assert.match(html, /name="website"[^>]*tabindex="-1"/, 'the honeypot is out of the tab order');
  assert.match(html, /Or email <a href="mailto:hello@bloombroke\.com">hello@bloombroke\.com<\/a>/);
  assert.equal(THANKS, 'Thanks. We read every one.');
  assert.deepEqual(feedbackPayload({ message: ' hi ', email: ' ', screen: 'AAPL', website: '' }), { message: 'hi', screen: 'AAPL' });
  assert.deepEqual(feedbackPayload({ message: 'hi', email: 'a@b.co', screen: null }), { message: 'hi', screen: null, email: 'a@b.co' });
  // No Pro gate anywhere in the feedback path.
  for (const f of ['public/screens/feedback.js', 'pro/feedback.js']) assert.doesNotMatch(readFileSync(f, 'utf8'), /isPro|X-Pro-Key|requireActive/, f);
});

test('status strip: "Not financial advice · Terms · Feedback" on every screen, for everyone', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const line = /<div class="statusline"[\s\S]*?<\/div>/.exec(html)[0];
  const legal = /<span id="status-legal" class="status-legal">[\s\S]*?<\/span><\/span>|<span id="status-legal" class="status-legal">.*<\/a><\/span>/.exec(line)[0];
  assert.equal(legal.replace(/<[^>]+>/g, '').replace(/&middot;/g, '·'), 'Not financial advice·Terms·Feedback');
  assert.match(legal, /<a href="\/\?c=FEEDBACK" data-cmd="FEEDBACK">Feedback<\/a>/);
  assert.doesNotMatch(legal, /\shidden(\s|>|=)/);
  // The strip is the page's own, outside the screen: every command shows it, and no
  // code hides the Feedback link for anyone.
  assert.ok(html.indexOf('id="status-legal"') > html.indexOf('</main>'));
  assert.doesNotMatch(readFileSync('public/app.js', 'utf8'), /status-legal[^\n]*hidden|FEEDBACK[^\n]*isPro/);
  assert.equal(parseCommand('FEEDBACK').name, 'FEEDBACK');
  assert.equal(urlFor('FEEDBACK').url, 'FEEDBACK');
});

// ---- Legal: one version bump for Pro structure and FEEDBACK ------------------------------------

test('legal: version bumped, so everyone who accepted 1.0 is asked again', async () => {
  const { LEGAL_UPDATED } = await import('../public/legal-version.js');
  const { needsConsent, acceptRecord } = await import('../public/consent.js');
  const { DEFAULT_TERMS_VERSION } = await import('../pro/billing.js');
  assert.equal(TERMS_VERSION, '1.4', 'CHAT: the Messages section and what CHAT stores');
  assert.equal(LEGAL_UPDATED, '28 September 2026');
  assert.equal(needsConsent(acceptRecord('1.0')), true);
  assert.equal(needsConsent(acceptRecord(TERMS_VERSION)), false);
  assert.equal(DEFAULT_TERMS_VERSION, '2026-09-27', 'checkout records the new Terms');
});

test('legal: terms s9, disclaimer and privacy say what the code does', () => {
  const read = (f) => readFileSync(`legal/${f}.md`, 'utf8');
  const terms = read('terms');
  const s9 = terms.slice(terms.indexOf('## 9. Pro subscription'), terms.indexOf('## 10.'));
  for (const must of ['USD 42 a month, or USD 420 a year', 'If you subscribed at an earlier price, you keep that price while your subscription stays active.', 'a yearly subscription renews automatically every year', 'up to 3 gift codes', 'Pro for 30 days, free, with no card', 'works only once', 'within 90 days after it was made',
    'A gift month does not renew', 'A licence from a gift code cannot make gift codes', 'A seat number is for display only', 'cannot be chosen, changed or transferred', 'never reused']) {
    assert.ok(s9.includes(must), `terms s9: ${must}`);
  }
  const disclaimer = read('disclaimer');
  assert.ok(disclaimer.includes('we are not paid by any broker, exchange or investment product issuer for anything shown on the site.'), 'the s2 sentence, true with any allowed sponsor');
  for (const must of ['Sponsor lines rotate in the status line, and each is marked SPONSOR; a sponsor of a WEIRD gauge is marked SPONSORED BY', 'We do not accept sponsors that sell or promote investment products, brokers, exchanges, crypto, funds or tips', 'Sponsors have no say over the data or content']) {
    assert.ok(disclaimer.includes(must), `disclaimer: ${must}`);
  }
  const privacy = read('privacy');
  assert.ok(privacy.includes('We do not share it with advertisers or data brokers.'), 'privacy s6 stays');
  for (const must of ['We add no tracking code to the link', 'one-way hash of the code and its last four characters', 'your seat number', 'We keep feedback for up to 12 months', 'We do not store your IP address with it', 'your email address only to reply to you',
    'the Pro routes and gift codes (a 10 or 15 minute window), the ticker counter, the site counters, the GUESS game and the pay respects button on GRAVEYARD stones (a one minute window), the feedback form (a one hour window) and the MCP endpoint (a one minute, a 10 minute and a 24 hour window)', 'forgets it within one minute after the window ends', 'one minute for the ticker counter, the site counters, GUESS and pay respects; 10 or 15 minutes for the Pro routes and gift codes; one hour for feedback; one minute, 10 minutes and 24 hours for the MCP endpoint', 'DESK layouts',
    'sponsors get no data from us', 'DataFast, counts link clicks, including clicks on sponsor links',
    'kept while your licence exists and for 5 years after your subscription is cancelled', 'unpaid or overdue is kept until the subscription is cancelled', 'keeps only a count of the redeemed codes', '| Gift code records | Deleted 12 months after the code was used or expired.',
    'The licence record is kept for 5 years after the gift month ends']) {
    assert.ok(privacy.includes(must), `privacy: ${must}`);
  }
  for (const f of ['terms', 'privacy', 'disclaimer']) assert.doesNotMatch(read(f), /\u2014/, `${f}: no em dash`);
  // The old, untrue lines are gone.
  assert.ok(!privacy.includes('we do not count or record who sees or clicks it'));
  assert.ok(!privacy.includes('Gift code records are kept for as long as the licence'));
  assert.ok(!privacy.includes('Pro licence record and synced data:** deleted within 30 days'));
  assert.ok(s9.includes('only while the paid subscription that made it is active'));
  assert.ok(s9.includes('we keep the one that started last, cancel the other one and refund its latest payment in full'));
  assert.ok(s9.includes('up to 3 gift codes with the GIFT command over the life of your licence'));
  // What the text promises, checked against the code.
  assert.equal(GIFT_RULES.includes('90 days'), true);
  assert.equal(KEEP_MS, 365 * 24 * 60 * 60 * 1000);
});

// ---- Review fixes ---------------------------------------------------------------------------

test('feedback: terminal escapes and bidi overrides never reach the store or the owner terminal', async () => {
  const { formatFeedback: fmt, safeText } = await import('../scripts/feedback-export.js');
  const red = 'hi \u001b[31mRED\u001b[0m there';
  const osc = 'copy me \u001b]52;c;ZXZpbA==\u0007 done';
  const bidi = 'abc \u202edcba\u202c ok';
  assert.equal(validateFeedback({ message: red }).message, 'hi [31mRED[0m there');
  assert.equal(validateFeedback({ message: osc }).message, 'copy me ]52;c;ZXZpbA== done');
  assert.equal(validateFeedback({ message: bidi }).message, 'abc dcba ok');
  assert.equal(validateFeedback({ message: 'a\u009b31m b\u0085c' }).message, 'a31m bc', 'C1 controls too');
  assert.equal(validateFeedback({ message: 'line one\r\nline two\tend' }).message, 'line one\nline two\tend', 'newline and tab stay');
  assert.throws(() => validateFeedback({ message: '\u001b\u0007' }), (e) => e.code === 'empty');
  for (const email of ['a\u001b[31m@b.co', 'a@b.co\u202e', 'a\u0000@b.co']) {
    assert.throws(() => validateFeedback({ message: 'x', email }), (e) => e.code === 'bad_email', JSON.stringify(email));
  }
  // Rows written some other way still print safely.
  const out = fmt([{ id: 1, created_at: T0, message: `${red}\n${osc}\n${bidi}`, email: 'e\u001b@x.co', screen: 'A\u001bB', legal_version: '1.1' }]);
  assert.doesNotMatch(out, /[\u001b\u0007\u202e\u202c]/);
  assert.match(out, /\\x1b\[31mRED/);
  assert.match(out, /\\x1b\]52;c;ZXZpbA==\\x07/);
  assert.match(out, /\\u202edcba\\u202c/);
  assert.match(out, /email e\\x1b@x\.co/);
  assert.equal(safeText('tab\tkept'), 'tab\tkept');
  // And through the route.
  const s = await feedbackServer();
  try {
    assert.equal((await s.post({ message: osc })).status, 200);
    assert.equal(s.db.prepare('SELECT message FROM feedback').get().message, 'copy me ]52;c;ZXZpbA== done');
  } finally { await s.close(); }
});

test('privacy names every IP-keyed limiter in the code, with its window', () => {
  const privacy = readFileSync('legal/privacy.md', 'utf8');
  const windows = {
    'pro/routes.js': [/windowMs: 10 \* MIN/, /windowMs: 15 \* MIN/],
    'pro/feedback.js': [/windowMs: HOUR/],
    'pro/chat-routes.js': [/windowMs: 15 \* MIN/], // CHAT: wrong keys count in the Pro routes' own limiter
    'data/guess.js': [/windowMs: 60_000/],
    'data/trending.js': [/windowMs: MIN/],
    'lib/mcp/limits.js': [/shortWindowMs: 10 \* 60_000/, /dayWindowMs: 24 \* 60 \* 60_000/, /requestWindowMs: 60_000/],
    'lib/counters.js': [/windowMs: 60_000/], // BBRK site counters
    'lib/graveyard.js': [/max: 30, windowMs: 60_000/], // GRAVEYARD pay respects
  };
  for (const [f, res] of Object.entries(windows)) for (const re of res) assert.match(readFileSync(f, 'utf8'), re, `${f} window changed: update the Privacy Policy`);
  for (const name of ['Pro routes', 'gift codes', 'ticker counter', 'site counters', 'GUESS game', 'pay respects', 'feedback form', 'MCP endpoint']) assert.ok(privacy.includes(name), name);
  // No other file keys a limiter on the IP.
  const users = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (p.endsWith('.js') && readFileSync(p, 'utf8').includes('clientIp(')) users.push(p); } };
  for (const d of ['data', 'lib', 'pro', 'public']) walk(d);
  assert.deepEqual(users.sort(), ['data/guess.js', 'data/trending.js', 'lib/counters.js', 'lib/graveyard.js', 'lib/mcp/server.js', 'pro/chat-routes.js', 'pro/feedback.js', 'pro/ratelimit.js', 'pro/routes.js']);
});
