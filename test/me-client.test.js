// ME, the browser half: the card page per state (screens/me.js), the pixel avatar module
// (pixel-avatar.js: the stable encoding other builds use), this device's preferences
// (pro.js: START SCREEN, CLOCK), the top bar's seat (app.js), the command and its words,
// and the copy rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardWords } from '../public/kit.js';
import {
  meHtml, planFacts, renewing, draftOf, draftPerson, shownBits, gridHtml, swatchesHtml, deviceHtml, confirmHtml, keyDataHtml,
  NOT_PRO_LINE, RENEWING, NEW_KEY_ASK, DELETE_ASK, USERNAME_RE, oneAtATime, SAVE_NOW, ME_ROWS,
} from '../public/screens/me.js';
import { extraHtml } from '../public/screens/chat.js';
import {
  encode, decode, draw, initials, initialsOf, initialsBits, bitsOf, colorOf, avatarSvg, nameHtml, pathOf, flat, blank, FONT, COLORS,
} from '../public/pixel-avatar.js';
import {
  cleanPrefs, startCommand, clockFace, DEFAULT_PREFS, START_SCREENS, SYNC_DOCS, PREFS_KEY,
} from '../public/pro.js';
import { parseCommand, linkPlan, seatHtml, badgeCount, nyClock } from '../public/app.js';
import { findCommand } from '../public/registry.js';
import { DETAIL } from '../public/registry-detail.js';
import { USERNAME_RE as SERVER_RE } from '../pro/chat.js';
import { resolveInput, splitWords, FILLER } from '../public/resolve.js';

const all = () => true;
const KEY = 'BB-AAAA-BBBB-CCCC-DDDD'; // a made-up key (not a real one): only its shape matters here
const ST = { status: 'active', seat: 2, canGift: true, interval: 'year', currentPeriodEnd: new Date(Date.UTC(2027, 8, 27, 12)).toISOString() };
const TOM = { seat: 2, username: 'Tom', color: 3, avatar: null };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ---- the page, per state ------------------------------------------------------------------

test('ME without Pro: ME, one line, PRO, this device (START and CLOCK only), LOGIN and REDEEM', () => {
  const html = meHtml({ has: all });
  assert.match(html, /<h2 class="card-hero card-hero-60 num">ME<\/h2>/);
  assert.ok(html.includes(`<p class="card-sub">${NOT_PRO_LINE}</p>`));
  assert.match(html, /<a class="btn card-btn btn-solid" href="\?c=PRO" data-cmd="PRO">PRO<\/a>/);
  assert.match(html, /data-pref="start">HOME</);
  assert.match(html, /data-pref="clock">NEW YORK</);
  assert.doesNotMatch(html, /data-pref="sound"|data-pref="tape"|me-form|card-more/, 'no Pro parts, no key and data without a key');
  assert.match(html, /data-cmd="LOGIN">LOGIN<.*data-cmd="REDEEM">REDEEM</s);
  assert.ok(cardWords(html).length <= 20);
  // A key whose Pro ended: the same, plus MANAGE PLAN and the key and data in + Details.
  const lapsed = meHtml({ key: KEY, st: { ...ST, status: 'canceled' }, has: all });
  assert.match(lapsed, /id="me-manage">MANAGE PLAN</);
  assert.match(lapsed, /<details class="how card-more">/);
  assert.match(lapsed, /id="me-newkey">NEW KEY<.*id="me-delete">DELETE MY ACCOUNT</s);
});

test('ME with Pro: the avatar and username in its colour, #00002, the editor, the plan, this device, the links', () => {
  const html = meHtml({ key: KEY, st: ST, me: TOM, tape: true, prefs: { start: 'DESK', clock: 'local', sound: true }, has: all });
  assert.match(html, /<p class="tag card-kicker">ME<\/p>/);
  assert.match(html, /<span class="me-hero" id="me-hero" data-nc="3"><span class="me-hero-av" id="me-hero-av"><svg class="px-av" viewBox="0 0 8 8" width="64" height="64"/);
  assert.match(html, /<span class="me-hero-name" id="me-hero-name">Tom<\/span>/);
  assert.match(html, /<span class="me-badge" id="me-badge">#00002<\/span>/);
  assert.match(html, /<input class="card-input me-input" id="me-name" type="text" maxlength="15"[^>]*value="Tom"/);
  assert.equal((html.match(/class="me-sw"/g) || []).length, 8);
  assert.match(html, /data-color="3" data-nc="3" aria-checked="true"/);
  assert.equal((html.match(/class="me-px"/g) || []).length, 64);
  assert.equal((html.match(/class="me-px"[^>]*tabindex="0"/g) || []).length, 1, 'one pixel in the Tab order; arrows move');
  assert.match(html, /id="me-reset"[^>]*>RESET<.*id="me-clear">CLEAR</s);
  assert.equal((html.match(/btn-solid/g) || []).length, 1, 'SAVE is the one primary button');
  assert.match(html, /<button type="submit" class="btn card-btn btn-solid" id="me-save">SAVE<\/button>/);
  assert.match(html, /<dt class="tag">PLAN<\/dt><dd class="num">Yearly<\/dd>/);
  assert.match(html, /<dt class="tag">RENEWS<\/dt><dd class="num">Sep 27, 2027<\/dd>/);
  assert.match(html, /data-pref="start">DESK</);
  assert.match(html, /data-pref="clock">LOCAL</);
  assert.match(html, /data-pref="sound" aria-pressed="true">ON</);
  assert.match(html, /data-pref="tape" aria-pressed="true">ON</);
  assert.match(html, /id="me-manage">MANAGE PLAN<.*id="me-cancel">CANCEL<.*data-cmd="GIFT">GIFT</s);
  // + Details: KEY AND DATA, closed.
  assert.match(html, /<details class="how card-more"><summary>Details<\/summary>/);
  for (const w of ['SHOW KEY', 'NEW KEY', 'LOG OUT', 'DOWNLOAD MY DATA', 'DELETE MY ACCOUNT']) assert.ok(html.split('<details')[1].includes(`>${w}<`), w);
  assert.ok(cardWords(html).length <= 30, cardWords(html).join(' '));
  // No username yet: SEAT 00002, no badge; the initials are the seat's digits.
  const none = meHtml({ key: KEY, st: ST, me: null, has: all });
  assert.match(none, /id="me-hero-name">SEAT 00002</);
  assert.match(none, /id="me-badge" hidden>/);
  // Set to end: no CANCEL; a gift month: neither billing link.
  assert.doesNotMatch(meHtml({ key: KEY, st: { ...ST, cancelAtPeriodEnd: true }, me: TOM, has: all }), /id="me-cancel"/);
  const gift = meHtml({ key: KEY, st: { status: 'gift', seat: 9, giftUntil: new Date(Date.now() + 9e8).toISOString() }, me: TOM, has: all });
  assert.doesNotMatch(gift, /me-manage|me-cancel/);
  assert.match(gift, /<dd class="num">Gift<\/dd>/);
});

test('ME: NEW KEY and DELETE never send two requests: a second Enter while one runs does nothing', async () => {
  const once = oneAtATime();
  let calls = 0;
  let finish;
  const slow = () => new Promise((r) => { calls += 1; finish = r; });
  const first = once(slow);
  assert.equal(once.busy(), true);
  assert.equal(await once(slow), false, 'the second press is dropped');
  assert.equal(await once(slow), false);
  finish();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  assert.equal(once.busy(), false);
  // A failed request frees it again.
  await assert.rejects(once(async () => { throw new Error('offline'); }));
  assert.equal(once.busy(), false);
  // The screen sends both through it, and checks it before anything else.
  const src = readFileSync('public/screens/me.js', 'utf8');
  assert.match(src, /if \(!kind \|\| kind === 'renewing' \|\| once\.busy\(\)\) return;/);
  assert.match(src, /await once\(\(\) => sendAnswer\(kind\)\);/);
  assert.match(src, /async function sendAnswer\(kind\) \{[\s\S]*pro\.rotateKey\(\)[\s\S]*pro\.deleteAccount\(\)/);
});

test('ME: NEW KEY says save it at once and where to write; the plan links sit right under the plan', () => {
  assert.equal(SAVE_NOW, 'Save it right away. If this page fails, write to hello@bloombroke.com.');
  assert.ok(NEW_KEY_ASK.endsWith(SAVE_NOW));
  assert.ok(ME_ROWS.find(([k]) => k === 'New key')[1].endsWith(SAVE_NOW));
  const html = meHtml({ key: KEY, st: ST, me: TOM, has: all });
  const at = (s) => html.indexOf(s);
  assert.ok(at('RENEWS') < at('id="me-manage"') && at('id="me-cancel"') < at('class="me-device"'), 'MANAGE PLAN and CANCEL before THIS DEVICE');
  assert.match(html, /<p class="me-plan-links">.*id="me-manage">MANAGE PLAN<.*id="me-cancel">CANCEL<.*data-cmd="GIFT">GIFT</s);
});

test('CHAT: TODAY\'S GUESS shows each player with their avatar and coloured username', () => {
  const x = extraHtml({ id: 9, readOnly: false }, null, { n: 2, of: 6, scores: [{ seat: 2, name: 'Ann', color: 4, avatar: null, tries: 2, solved: true }, { seat: 7, name: null, tries: 6, solved: false }] });
  assert.match(x, /<svg class="px-av cm-av"[^>]*data-nc="4">.*<span data-nc="4">Ann<\/span> <span class="cm-seat">#2<\/span>/s);
  assert.match(x, /SEAT <span class="cm-seat">7<\/span>/);
});

test('ME: the questions, one line each; DELETE also wants the word; renewing says cancel first', () => {
  assert.equal(text(confirmHtml('key')), `${NEW_KEY_ASK} ENTER: NEW KEY ESC: CANCEL`);
  assert.match(confirmHtml('key'), /role="alertdialog"[^>]*tabindex="-1" data-confirm="key"/);
  assert.equal(text(confirmHtml('delete')), `${DELETE_ASK} ENTER: DELETE ESC: CANCEL`);
  assert.match(confirmHtml('delete'), /<input class="me-del-in" id="me-del"/);
  assert.equal(confirmHtml(null), '');
  assert.equal(confirmHtml('renewing'), `<p class="me-warn" role="status">${RENEWING}</p>`, 'cancel first, where DELETE was pressed');
  const asking = meHtml({ key: KEY, st: ST, me: TOM, confirm: 'delete', has: all });
  assert.match(asking, /<details class="how card-more" open>/, 'open while asking');
  assert.match(keyDataHtml({ confirm: 'key' }), /<div id="me-confirm"><div class="desk-confirm me-confirm"/);
  assert.equal(RENEWING, 'Cancel first: press CANCEL. Then delete.');
  assert.equal(renewing(ST), true);
  assert.equal(renewing({ ...ST, cancelAtPeriodEnd: true }), false);
  assert.equal(renewing({ ...ST, cancelAt: ST.currentPeriodEnd }), false);
  for (const status of ['canceled', 'gift', 'gift_ended', 'demo']) assert.equal(renewing({ ...ST, status }), false, status);
  assert.equal(renewing({ ...ST, status: 'past_due' }), true);
  assert.equal(renewing(null), false);
});

test('ME: plan facts; the draft; the grid and swatches', () => {
  assert.deepEqual(planFacts({ ...ST, interval: 'month' }).map((f) => f.label), ['PLAN', 'RENEWS']);
  assert.deepEqual(planFacts({ ...ST, cancelAtPeriodEnd: true }).map((f) => f.label), ['PLAN', 'ENDS']);
  assert.deepEqual(planFacts({ ...ST, status: 'past_due' }).at(-1), { value: 'Failed', label: 'PAYMENT', cls: 'down' });
  const d = draftOf({ username: 'tom_lee', color: null, avatar: null });
  assert.deepEqual(d, { username: 'tom_lee', color: null, bits: null });
  assert.equal(colorOf(draftPerson(d, 13)), 13 % 8, 'no colour picked: the seat picks');
  assert.equal(encode(shownBits(d, 13)), initials('tom_lee'), 'the initials follow the name');
  assert.equal(encode(shownBits({ username: 'x y', bits: null }, 42)), initials('42'), 'no valid name yet: the seat');
  assert.equal(draftOf({ avatar: 'ff00000000000000' }).bits.filter(Boolean).length, 8);
  assert.match(gridHtml(blank(), 9), /data-i="9" aria-pressed="false" aria-label="Row 2, column 2" tabindex="0"/);
  assert.match(swatchesHtml(0), /role="radio" data-color="0" data-nc="0" aria-checked="true" aria-label="Colour 1" tabindex="0"/);
  assert.equal(USERNAME_RE.source, SERVER_RE.source, 'the same rule as the server');
});

// ---- the pixel avatar module ---------------------------------------------------------------

test('pixel avatar: 16 lower-case hex, row-major, top row first, the top-left pixel is bit 63, 1 is lit', () => {
  const grid = Array.from({ length: 8 }, () => Array(8).fill(false));
  grid[0][0] = true;
  assert.equal(encode(grid), '8000000000000000', 'bit 63 (the first hex digit\'s high bit) is the top-left pixel');
  grid[7][7] = true;
  assert.equal(encode(grid), '8000000000000001', 'bit 0 is the bottom-right pixel');
  assert.equal(encode(flat(grid)), '8000000000000001', '64 in a row works too');
  const back = decode('8000000000000001');
  assert.equal(back.length, 8);
  assert.ok(back.every((row) => row.length === 8));
  assert.equal(back[0][0], true);
  assert.equal(back[0][1], false);
  assert.equal(back[7][7], true);
  assert.equal(decode('8000000000000001'.toUpperCase())[0][0], true, 'upper case reads');
  for (const bad of [null, '', '123', 'zzzzzzzzzzzzzzzz', '80000000000000011']) assert.equal(decode(bad), null, String(bad));
  // Round trips, every pixel.
  for (let i = 0; i < 64; i++) {
    const g = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (__, c) => r * 8 + c === i));
    const hex = encode(g);
    assert.match(hex, /^[0-9a-f]{16}$/);
    assert.deepEqual(decode(hex), g, `pixel ${i}`);
  }
  assert.equal(encode(blank()), '0000000000000000');
});

test('pixel avatar: initials in a 3x5 font, the seat\'s digits without a name', () => {
  assert.equal(initialsOf('tom_lee'), 'TL');
  assert.equal(initialsOf('TomLee'), 'TL');
  assert.equal(initialsOf('tom'), 'TO');
  assert.equal(initialsOf('Q'), 'Q');
  assert.equal(initialsOf('', 2), '2');
  assert.equal(initialsOf(null, 12345), '45');
  assert.equal(initialsOf('', null), '');
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') assert.match(FONT[ch], /^[01]{15}$/, ch);
  // T and L: T's top row in columns 0 to 2, L's first column in column 4, rows 2 to 6.
  const tl = decode(initials('tom_lee'));
  assert.deepEqual(tl[2].map(Number), [1, 1, 1, 0, 1, 0, 0, 0]);
  assert.deepEqual(tl[6].map(Number), [0, 1, 0, 0, 1, 1, 1, 0]);
  assert.deepEqual([tl[0], tl[1], tl[7]].flat().filter(Boolean), [], 'the rows around stay dark');
  // One glyph sits in the middle.
  assert.deepEqual(decode(initials('7'))[2].map(Number), [0, 0, 1, 1, 1, 0, 0, 0]);
  assert.equal(encode(initialsBits('')), '0000000000000000');
  assert.deepEqual(bitsOf({ avatar: 'ffffffffffffffff' }).every(Boolean), true, 'an avatar wins over initials');
});

test('pixel avatar: draw() on a canvas, and the SVG and name markup', () => {
  const rects = [];
  const ctx = { fillRect: (...a) => rects.push(a) };
  assert.equal(draw(ctx, '8000000000000001', 10, 20, 3, 'red'), true);
  assert.equal(ctx.fillStyle, 'red');
  assert.deepEqual(rects, [[10, 20, 3, 3], [31, 41, 3, 3]]);
  assert.equal(draw(ctx, 'nope', 0, 0, 1, 'red'), false);
  assert.equal(pathOf(decode('ff00000000000000').flat()), 'M0 0h8v1h-8z', 'a run is one rectangle');
  const svg = avatarSvg({ seat: 5, name: 'Ann', color: 6 });
  assert.match(svg, /^<svg class="px-av" viewBox="0 0 8 8" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true" focusable="false" data-nc="6"><rect width="8" height="8" fill="currentColor" opacity="\.16"\/><path fill="currentColor" d="/);
  assert.doesNotMatch(avatarSvg({ seat: 5 }, { inline: false }), /data-nc/, 'the colour from a parent');
  // The site's CSP allows no inline styles: colours are data-nc rules in style.css.
  for (const html of [svg, nameHtml({ seat: 4, name: 'x' }), seatHtml({ username: 'x' }, 2)]) assert.doesNotMatch(html, /style=/);
  const css = readFileSync('public/style.css', 'utf8');
  for (let i = 0; i < 8; i++) assert.ok(css.includes(`[data-nc="${i}"] { color: var(--name-${i}); }`), `rule ${i}`);
  assert.equal(nameHtml({ seat: 4, name: '<b>' }), '<span data-nc="4">&lt;b&gt;</span>');
  assert.equal(nameHtml({ seat: 4, name: null }), '<span>SEAT 4</span>');
  assert.equal(colorOf({ seat: 9, color: 2 }), 2);
  assert.equal(colorOf({ seat: 9, color: null }), 1);
  assert.equal(colorOf({ seat: 9, color: 11 }), 1, 'a colour out of range falls back');
  assert.equal(COLORS, 8);
  assert.doesNotMatch(readFileSync('public/pixel-avatar.js', 'utf8'), /^import /m, 'no imports: other builds use it as is');
});

test('name colours: 8 in style.css, none amber, none equal to --up, --down or --accent', () => {
  const css = readFileSync('public/style.css', 'utf8');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  const val = (name) => new RegExp(`${name}: (hsl\\([^)]+\\))`).exec(root)?.[1];
  const names = Array.from({ length: 8 }, (_, i) => val(`--name-${i}`));
  assert.ok(names.every(Boolean), 'all 8 are defined in :root');
  for (const v of ['--up', '--down', '--accent']) assert.ok(!names.includes(val(v)), v);
  // Hue away from amber and orange (20 to 60 degrees), and from the up green and down red.
  const hue = (v) => Number(/hsl\((\d+)/.exec(v)[1]);
  const sat = (v) => Number(/, (\d+)%/.exec(v)[1]);
  for (const v of names) {
    if (sat(v) < 20) continue; // a grey has no hue to speak of
    const h = hue(v);
    assert.ok(!(h >= 20 && h <= 60), `${v}: not amber or orange`);
    assert.ok(Math.min(Math.abs(h - 147), 360 - Math.abs(h - 147)) >= 25, `${v}: not near --up`);
    assert.ok(Math.min(h, 360 - h) >= 25, `${v}: not near --down`);
  }
  // Contrast with --panel: WCAG relative luminance, at least 4.5:1.
  const rgb = (v) => {
    const [h, s, l] = /hsl\((\d+), (\d+)%, (\d+)%\)/.exec(v).slice(1).map(Number);
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n) => { const k = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
  };
  const lum = (c) => c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((acc, x, i) => acc + x * [0.2126, 0.7152, 0.0722][i], 0);
  const panel = lum(rgb(val('--panel')));
  for (const v of names) assert.ok((lum(rgb(v)) + 0.05) / (panel + 0.05) >= 4.5, `${v} on --panel`);
});

// ---- this device -------------------------------------------------------------------------------

test('prefs: cleaned, START SCREEN applies only without ?c=, CLOCK changes the top bar only', () => {
  assert.deepEqual(cleanPrefs(null), DEFAULT_PREFS);
  assert.deepEqual(cleanPrefs({ start: 'GRID', clock: 'local', sound: true, extra: 1 }), { start: 'GRID', clock: 'local', sound: true });
  assert.deepEqual(cleanPrefs({ start: 'LOGOUT', clock: 'mars', sound: 'yes' }), DEFAULT_PREFS, 'only the listed screens, only true');
  assert.deepEqual(START_SCREENS, ['HOME', 'DESK', 'GRID', 'WATCH', 'MARKETS', 'NEWS']);
  for (const s of START_SCREENS) assert.ok(!['UNKNOWN', 'SOON'].includes(parseCommand(s).name), s);
  assert.equal(startCommand('', { start: 'DESK' }), 'DESK');
  assert.equal(startCommand('?c=AAPL', { start: 'DESK' }), null, 'a link\'s own screen wins');
  assert.equal(startCommand('?embed=1', { start: 'GRID' }), 'GRID');
  assert.equal(startCommand('', { start: 'HOME' }), null);
  assert.equal(startCommand('', null), null);
  const d = new Date(2026, 8, 29, 7, 5, 9);
  assert.deepEqual(clockFace(d, { clock: 'local' }), { label: 'LOCAL', time: '07:05:09' });
  assert.deepEqual(clockFace(d, { clock: 'ny' }, nyClock), { label: 'NEW YORK', time: nyClock(d) });
  assert.deepEqual(clockFace(d, null, nyClock).label, 'NEW YORK');
  assert.equal(SYNC_DOCS.prefs, PREFS_KEY);
  // The app reads them: the first screen and the clock.
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /const start = embed \? null : startCommand\(location\.search, getPrefs\(\)\);/);
  assert.match(app, /linkPlan\(start \|\| fromQuery\(location\.search\)\)/);
  assert.match(app, /const face = clockFace\(now, clockPrefs, nyClock\);/);
  // Data times stay New York: nothing else reads the clock preference.
  for (const f of ['public/kit.js', 'public/freshness.js', 'public/provenance.js']) assert.doesNotMatch(readFileSync(f, 'utf8'), /getPrefs|clockFace/, f);
  assert.match(deviceHtml({ prefs: { start: 'NEWS' } }), /data-pref="start">NEWS</);
});

// ---- the command, the seat, CHAT @name -------------------------------------------------------------

test('ME: a command with SETTINGS and ACCOUNT; the top bar seat opens it', () => {
  for (const w of ['ME', 'me', 'SETTINGS', 'account']) assert.equal(parseCommand(w).name, 'ME', w);
  assert.equal(findCommand('ME').category, 'Pro');
  assert.deepEqual(findCommand('ME').aliases, ['SETTINGS', 'ACCOUNT']);
  assert.ok(DETAIL.ME.source && DETAIL.ME.delay);
  assert.deepEqual(linkPlan('ME'), { url: 'ME', show: 'ME', ask: null });
  const html = readFileSync('public/index.html', 'utf8');
  assert.match(html, /<a id="seat" class="seat num" href="\/\?c=ME" data-cmd="ME" hidden><\/a>/);
  // The seat: avatar, username in its colour, #00002; SEAT 00002 without a name.
  const top = seatHtml({ username: 'Tom', color: 1, avatar: null }, 2);
  assert.match(top, /^<svg class="px-av seat-av"[^>]*data-nc="1">/);
  assert.match(top, /<\/svg> <span class="seat-name" data-nc="1">Tom<\/span> <span class="seat-n dim">#00002<\/span>$/);
  // A long name gives way (an ellipsis) before the seat runs into the clock; the avatar and #seat stay.
  const css = readFileSync('public/style.css', 'utf8');
  assert.match(css, /\.seat-name \{ display: inline-block; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; \}/);
  assert.match(css, /@media \(max-width: 639px\) \{ \.seat-name \{ max-width: 8ch; \} \}/);
  assert.match(seatHtml(null, 2), /<\/svg> SEAT 00002$/);
  assert.match(seatHtml({ username: '<i>x</i>' }, 2), /&lt;i&gt;x&lt;\/i&gt;/);
  assert.equal(badgeCount('CHAT 3'), 3);
  assert.equal(badgeCount('CHAT 99+'), 99);
  assert.equal(badgeCount(''), 0);
});

test('ME is a command, but "me" in plain words stays a filler word (resolve.js)', async () => {
  const deps = { search: async () => [], checkTicker: async () => false };
  assert.deepEqual(await resolveInput('show me AAPL 5Y', deps), { confident: true, from: 'show me AAPL 5Y', command: 'AAPL 5Y' });
  assert.equal((await resolveInput('show me the price of tesla', deps)).command, 'TSLA');
  assert.deepEqual(splitWords('show me AAPL 5Y').map((p) => p.kind), ['filler', 'filler', 'other', 'range']);
  assert.ok(FILLER.has('me'));
  // Typed alone, ME is the command: the router takes it before the resolver.
  for (const w of ['ME', 'me', ' Me ']) assert.equal(parseCommand(w).name, 'ME', w);
});

test('CHAT @name: parsed, a link asks first, the NAME button opens ME', () => {
  const p = parseCommand('CHAT @Tom_Lee');
  assert.deepEqual([p.name, p.args.name, p.input, p.mutates, p.view], ['CHAT', 'TOM_LEE', 'CHAT @TOM_LEE', true, 'CHAT']);
  assert.equal(linkPlan('CHAT @tom').ask.question, 'Chat with @TOM?');
  assert.equal(parseCommand('CHAT @ab').error, 'usage', 'too short');
  const chat = readFileSync('public/screens/chat.js', 'utf8');
  assert.match(chat, /<a class="chip cl-name" href="\?c=ME" data-cmd="ME">NAME<\/a>/);
  assert.doesNotMatch(chat, /editName|cl-name-form|\/api\/chat\/me/, 'the old inline NAME edit is gone');
  assert.match(chat, /body = cmd\.args\.name \? \{ name: cmd\.args\.name \} : \{ seats: cmd\.args\.seats \}/);
});

// ---- copy ----------------------------------------------------------------------------------------------

test('copy rules: no em dash, no emoji, no amber, no brand word, no advice words up front', () => {
  const brand = new RegExp(['bloom', 'berg'].join(''), 'i');
  const pages = [meHtml({ has: all }), meHtml({ key: KEY, st: ST, me: TOM, has: all }), meHtml({ key: KEY, st: ST, me: TOM, confirm: 'delete', has: all })];
  for (const html of pages) {
    assert.doesNotMatch(html, /—/);
    assert.doesNotMatch(html, /\p{Extended_Pictographic}/u);
    assert.doesNotMatch(html, /amber/i);
    assert.doesNotMatch(html, brand);
    assert.doesNotMatch(html.split('<details')[0], /\b(advice|advise|you should|we recommend|buy now|invest in)\b/i);
  }
  for (const f of ['public/screens/me.js', 'public/screens/me.css', 'public/pixel-avatar.js', 'legal/terms.md', 'legal/privacy.md']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /—/, f);
    assert.doesNotMatch(src, brand, f);
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, f);
  }
  assert.doesNotMatch(readFileSync('public/screens/me.css', 'utf8'), /amber|orange|#[0-9a-f]{3,6}\b|hsl\(/i, 'colours from style.css');
});
