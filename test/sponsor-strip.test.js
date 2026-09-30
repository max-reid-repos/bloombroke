// The sponsor strip: config, rotation, labels, links, Pro, and the SPONSOR screen.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { cleanSponsors, cleanUrl, loadSponsors, mountSponsors, sponsorPrice, SPONSORS_FILE, MAX_LINES, MAX_HOUSE, TEXT_MAX } from '../lib/sponsors.js';
import { stripItems, itemHtml, mountStrip, stripHidden, ROTATE_MS, SLIDE_MS, MAX_SPONSOR_LINES } from '../public/sponsor-strip.js';
import { stripShownBatch } from '../public/goal.js';
import { sponsorHtml, shownCount, shownLine, priceText, mailtoFor, tryLine, canTry, pointAtStrip, render, REFRESH_MS, HERO, POINT, FINE, MAILTO, PHONE_MQ, SHOWN_DEF, SHOWN_DETAIL, TRY_MAX, TRY_LABEL } from '../public/screens/sponsor.js';
import { cardWords } from '../public/kit.js';
import { hereText, paintHere, mountHereNow, clearOfBrand, HERE_MS, HERE_MIN } from '../public/here-now.js';
import { findCommand } from '../public/registry.js';
import { parseCommand } from '../public/app.js';

// A stand-in for the strip's host element: innerHTML, a class list and listeners.
function fakeHost() {
  const cls = new Set();
  const ls = {};
  return {
    innerHTML: '',
    offsetWidth: 0,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), has: (c) => cls.has(c) },
    addEventListener(t, f) { (ls[t] ||= []).push(f); },
    removeEventListener(t, f) { ls[t] = (ls[t] || []).filter((x) => x !== f); },
    fire(t) { for (const f of ls[t] || []) f(); },
    listeners: ls,
  };
}
const text = (h) => h.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const house = (n) => Array.from({ length: n }, (_, i) => ({ text: `House line ${i + 1}`, cmd: 'SPONSOR' }));

// ---- config ----------------------------------------------------------------------------------

test('config: the new shape, the old single line, validation', () => {
  const cfg = cleanSponsors({
    lines: [{ name: 'Acme Tea', text: 'Loose leaf tea', url: 'https://acme.example/tea?utm_source=bb#x' }, { name: '', text: 'no name' }],
    house: [{ text: 'Rent this line.', cmd: 'sponsor' }, { text: 'Bad command', cmd: 'NOPE' }, { text: 'x'.repeat(61), cmd: 'SPONSOR' }, { text: 'Default command' }],
    gauges: { pizza: { name: 'Acme Pizza' } },
  });
  assert.deepEqual(cfg.lines, [{ name: 'Acme Tea', text: 'Loose leaf tea', url: 'https://acme.example/tea' }]);
  assert.deepEqual(cfg.house, [{ text: 'Rent this line.', cmd: 'SPONSOR' }, { text: 'Default command', cmd: 'SPONSOR' }]);
  assert.deepEqual(cfg.gauges, { pizza: { name: 'Acme Pizza' } });
  assert.deepEqual(cfg.line, cfg.lines[0], 'the first line, for older pages');
  // The old shape still works: its line comes first.
  const old = cleanSponsors({ line: { name: 'Old', text: 'Still here', url: 'https://old.example' }, lines: [{ name: 'New', text: 'Too' }], gauges: {} });
  assert.deepEqual(old.lines.map((l) => l.name), ['Old', 'New']);
  assert.deepEqual(cleanSponsors({ line: null, gauges: {} }), { lines: [], house: [], gauges: {}, line: null });
  assert.deepEqual(cleanSponsors('nonsense'), { lines: [], house: [], gauges: {}, line: null });
  // Limits, plain text, https only.
  assert.equal(cleanSponsors({ lines: Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, text: 'x' })) }).lines.length, MAX_LINES);
  assert.equal(MAX_LINES, MAX_SPONSOR_LINES);
  assert.equal(cleanSponsors({ house: house(9) }).house.length, MAX_HOUSE);
  assert.equal(cleanSponsors({ lines: [{ name: 'A', text: 'Hot \u{1F525}' }] }).lines.length, 0);
  assert.equal(cleanSponsors({ lines: [{ name: 'A', text: 'one \u2014 two' }] }).lines.length, 0);
  assert.equal(cleanSponsors({ lines: [{ name: 'A', text: 'B', url: 'http://a.example' }] }).lines[0].url, null);
  assert.equal(cleanUrl('javascript:alert(1)'), null);
});

test('config: the committed file has 3 house lines, no paid ones; plain, short, cheeky', () => {
  const raw = JSON.parse(readFileSync(SPONSORS_FILE, 'utf8'));
  assert.deepEqual(raw.lines, []);
  assert.equal(raw.house.length, 3);
  const cfg = loadSponsors();
  assert.equal(cfg.house.length, 3);
  for (const h of cfg.house) {
    assert.ok(h.text.length < 60, h.text);
    assert.doesNotMatch(h.text, /\u2014|\p{Extended_Pictographic}/u);
    assert.equal(h.cmd, 'SPONSOR');
  }
});

test('/api/sponsors serves the cleaned file', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-spon-'));
  const file = path.join(dir, 's.json');
  writeFileSync(file, JSON.stringify({ lines: [{ name: 'A', text: 'B', url: 'https://a.example/?utm=1' }], house: [{ text: 'Rent me', cmd: 'SPONSOR' }] }));
  const app = express();
  mountSponsors(app, { file, log: { error() {} }, price: '' });
  const priced = express();
  mountSponsors(priced, { file, log: { error() {} }, price: '99' });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const server2 = await new Promise((r) => { const s = priced.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const d = await (await fetch(`http://127.0.0.1:${server.address().port}/api/sponsors`)).json();
    assert.deepEqual(d, { lines: [{ name: 'A', text: 'B', url: 'https://a.example/' }], house: [{ text: 'Rent me', cmd: 'SPONSOR' }], gauges: {}, line: { name: 'A', text: 'B', url: 'https://a.example/' }, price: null });
    const p = await (await fetch(`http://127.0.0.1:${server2.address().port}/api/sponsors`)).json();
    assert.equal(p.price, 99, 'SPONSOR_PRICE, as whole dollars a week');
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => server2.close(r));
    loadSponsors();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- labels, links, Pro ----------------------------------------------------------------------

test('labels: paid lines say SPONSOR and open the site; our own say AD and run a command', () => {
  const paid = stripItems(cleanSponsors({ lines: [{ name: 'Acme', text: 'Tea', url: 'https://acme.example' }, { name: 'NoLink', text: 'Words' }], house: house(2) }));
  assert.deepEqual(paid.map((i) => [i.kind, i.label]), [['paid', 'SPONSOR'], ['paid', 'SPONSOR']], 'house lines wait while there are paid ones');
  assert.equal(itemHtml(paid[0]), '<a class="spon-item" href="https://acme.example/" rel="sponsored noopener" referrerpolicy="no-referrer" target="_blank"><span class="sponsor-k">SPONSOR</span><span class="spon-text">Acme: Tea</span></a>');
  assert.equal(itemHtml(paid[1]), '<span class="spon-item"><span class="sponsor-k">SPONSOR</span><span class="spon-text">NoLink: Words</span></span>');
  const own = stripItems(cleanSponsors({ house: house(2) }));
  assert.deepEqual(own.map((i) => i.label), ['AD', 'AD']);
  assert.equal(itemHtml(own[0]), '<a class="spon-item" href="?c=SPONSOR" data-cmd="SPONSOR"><span class="sponsor-k">AD</span><span class="spon-text">House line 1</span></a>');
  assert.doesNotMatch(itemHtml(own[0]), /target=|rel=/, 'an AD line stays in the terminal');
  assert.match(itemHtml({ kind: 'house', label: 'AD', text: '<b>x</b> & y', cmd: 'SPONSOR' }), /&lt;b&gt;x&lt;\/b&gt; &amp; y/);
});

test('Pro users see nothing: no paid line, no AD line', () => {
  const cfg = cleanSponsors({ lines: [{ name: 'Acme', text: 'Tea' }], house: house(3) });
  assert.deepEqual(stripItems(cfg, { pro: true }), []);
  assert.deepEqual(stripItems(cleanSponsors({ house: house(3) }), { pro: true }), []);
  assert.deepEqual(stripItems(null), []);
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /stripItems\(sponsorCfg, \{ pro: isPro\(\) \}\)/);
});

// ---- rotation ---------------------------------------------------------------------------------

test('rotation: a new line every 4 seconds, with a short slide, looping', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const host = fakeHost();
    const s = mountStrip(host, stripItems(cleanSponsors({ house: house(3) })));
    assert.equal(text(host), 'AD House line 1');
    assert.equal(host.classList.has('is-sliding'), false, 'no slide on the first line');
    mock.timers.tick(ROTATE_MS - 1);
    assert.equal(s.index, 0);
    mock.timers.tick(1);
    assert.equal(text(host), 'AD House line 2');
    assert.equal(host.classList.has('is-sliding'), true);
    mock.timers.tick(SLIDE_MS);
    assert.equal(host.classList.has('is-sliding'), false, 'the slide lasts 180 ms');
    mock.timers.tick(ROTATE_MS * 2);
    assert.equal(text(host), 'AD House line 1', 'back to the first');
    s.stop();
    mock.timers.tick(ROTATE_MS * 3);
    assert.equal(s.index, 0, 'stopped');
    assert.equal((host.listeners.mouseenter || []).length, 0, 'listeners removed');
  } finally { mock.timers.reset(); }
  assert.ok(SLIDE_MS >= 150 && SLIDE_MS <= 200);
  assert.equal(ROTATE_MS, 4000);
});

test('rotation: holds while hovered or focused, and while the tab is hidden', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    let hidden = false;
    const host = fakeHost();
    const s = mountStrip(host, stripItems(cleanSponsors({ house: house(3) })), { isHidden: () => hidden });
    host.fire('mouseenter');
    mock.timers.tick(ROTATE_MS * 2);
    assert.equal(s.index, 0, 'hover holds it');
    host.fire('mouseleave');
    host.fire('focusin');
    mock.timers.tick(ROTATE_MS);
    assert.equal(s.index, 0, 'keyboard focus holds it');
    host.fire('focusout');
    mock.timers.tick(ROTATE_MS);
    assert.equal(s.index, 1);
    hidden = true;
    mock.timers.tick(ROTATE_MS * 3);
    assert.equal(s.index, 1, 'a hidden tab does not rotate');
    hidden = false;
    mock.timers.tick(ROTATE_MS);
    assert.equal(s.index, 2);
    s.stop();
  } finally { mock.timers.reset(); }
});

test('rotation: reduced motion swaps with no slide; one line never rotates', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const host = fakeHost();
    const s = mountStrip(host, stripItems(cleanSponsors({ house: house(2) })), { reduceMotion: true });
    mock.timers.tick(ROTATE_MS);
    assert.equal(text(host), 'AD House line 2', 'same rotation');
    assert.equal(host.classList.has('is-sliding'), false, 'no animation');
    s.stop();
    const one = fakeHost();
    const s1 = mountStrip(one, stripItems(cleanSponsors({ house: house(1) })));
    mock.timers.tick(ROTATE_MS * 3);
    assert.equal(s1.index, 0);
    s1.stop();
    // One showing is 4 s on a visible screen, however many lines: a sole line (a sole paid
    // line) counts again every 4 s it stays; nothing while the tab is hidden.
    let hidden = false;
    const n = [];
    const solo = mountStrip(fakeHost(), stripItems(cleanSponsors({ lines: [{ name: 'Acme', text: 'Hi' }] })), { isHidden: () => hidden, onShow: (item) => n.push(item.kind) });
    assert.deepEqual(n, ['paid'], 'shown once at mount');
    mock.timers.tick(ROTATE_MS * 3);
    assert.equal(n.length, 4, 'and once every 4 s');
    hidden = true;
    mock.timers.tick(ROTATE_MS * 5);
    assert.equal(n.length, 4, 'nothing while hidden');
    hidden = false;
    mock.timers.tick(ROTATE_MS);
    assert.equal(n.length, 5);
    solo.stop();
    mock.timers.tick(ROTATE_MS * 2);
    assert.equal(n.length, 5, 'nothing after stop');
    // Several lines: the same unit (one a tick), also while hovered (the line stays on screen).
    const m = [];
    const h = fakeHost();
    const multi = mountStrip(h, stripItems(cleanSponsors({ house: house(3) })), { onShow: () => m.push(1) });
    mock.timers.tick(ROTATE_MS * 2);
    assert.equal(m.length, 3);
    h.fire('mouseenter');
    mock.timers.tick(ROTATE_MS * 2);
    assert.equal(multi.index, 2, 'held while hovered');
    assert.equal(m.length, 5, 'still one showing a tick');
    multi.stop();
  } finally { mock.timers.reset(); }
  const css = readFileSync('public/style.css', 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.spon-strip\.is-sliding \.spon-item \{ animation: none; \} \}/);
});

test('position: the strip fills the free space and sits centred in it, clear of the legal links; phones as before', () => {
  const css = readFileSync('public/style.css', 'utf8');
  const legal = readFileSync('public/legal.css', 'utf8');
  assert.match(legal, /\.status-legal \{ display: flex; flex: 0 0 auto;/, 'the legal block never shrinks');
  assert.match(css, /\.status-sponsor \{ flex: 1 1 0; min-width: 0; display: flex; justify-content: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
  assert.doesNotMatch(css, /\.status-sponsor \{[^}]*margin-left: auto/, 'no longer pushed against the legal links');
  assert.match(css, /\.status-sponsor > \.spon-item \{ max-width: 100%; min-width: 0; \}/);
  assert.match(css, /@media \(max-width: 639px\) \{ \.status-sponsor \{ flex: 0 1 auto; justify-content: flex-start; \} \}/);
  assert.match(css, /\.spon-strip \.spon-item \{ display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
  const html = readFileSync('public/index.html', 'utf8');
  assert.match(html, /<span id="status-sponsor" class="status-sponsor spon-strip" aria-live="off" hidden><\/span>/);
  assert.ok(html.indexOf('id="status-msg"') < html.indexOf('id="status-sponsor"') && html.indexOf('id="status-sponsor"') < html.indexOf('id="status-legal"'), 'between the status text and the legal block');
});

// ---- the SPONSOR screen ---------------------------------------------------------------------

const FULL = {
  audience: { live: 7, visitors: { today: 17, d7: 68, d30: 400 }, pageviews: { today: 50, d7: 243, d30: 900 }, avgVisitSec: 480,
    countries: [{ name: 'United States', pct: 60.4 }, { name: 'Japan', pct: 10 }], globe: { window: '7d', countries: [{ cc: 'US', visitors: 45 }, { cc: 'JP', visitors: 7 }], other: 4 } },
  inventory: { stripShown: { today: 100, d7: 5678 } },
};
test('SPONSOR screen: one column: kicker, headline, how often the strip was shown and what that counts, the price, EMAIL, the rules, TRY YOUR LINE, the BBRK link; the rest in Details', () => {
  const page = sponsorHtml({ has: () => true, bbrk: FULL, cfg: { ...cleanSponsors({ house: house(3) }), price: 99 } });
  assert.equal(HERO, 'Your line on every screen.');
  assert.match(page, /^<section class="card spon-card" aria-label="Sponsor"><div class="card-head"><p class="tag card-kicker">SPONSOR<\/p><h2 class="card-hero card-hero-44 num">Your line <span class="nowrap">on every screen\.<\/span><\/h2>/);
  // The number and, right under it, what it counts.
  assert.match(page, /<p class="card-sub"><span id="spon-views">Shown 5,678 times this week\.<\/span><span class="spon-def">One showing = 4 seconds on a visible screen\.<\/span><\/p>/);
  assert.equal(SHOWN_DEF, 'One showing = 4 seconds on a visible screen.');
  assert.equal(ROTATE_MS, 4000, 'the 4 seconds the definition names');
  // The price, then the one primary button: EMAIL.
  assert.match(page, /<div class="card-act"><p class="spon-price" id="spon-price">\$99 a week<\/p><a class="btn card-btn btn-solid" href="mailto:hello@bloombroke\.com\?subject=Sponsor%20Bloombroke" id="spon-email">EMAIL hello@bloombroke\.com<\/a><\/div>/);
  assert.equal((page.match(/btn-solid/g) || []).length, 1, 'one white primary');
  assert.equal((page.match(/class="btn /g) || []).length, 1, 'no second button');
  assert.equal(FINE, 'One rotating line. No tracking code. Hidden for Pro.');
  assert.match(page, /<p class="card-note">One rotating line\. No tracking code\. Hidden for Pro\.<\/p>/);
  // TRY YOUR LINE: a label and one input (no form, no name, the longest line we run).
  assert.equal(TRY_LABEL, 'TRY YOUR LINE');
  assert.equal(TRY_MAX, TEXT_MAX, 'the same limit as a paid line (lib/sponsors.js)');
  assert.match(page, /<div class="card-media"><div class="spon-try"><label class="tag" for="spon-try">TRY YOUR LINE<\/label><input class="card-input spon-try-input" id="spon-try" type="text" maxlength="100" [^>]*><\/div><\/div>/);
  assert.doesNotMatch(page, /<form|name="/);
  // Numbers: a text link to BBRK.
  assert.match(page, /<p class="card-links"><span class="spon-numbers">Numbers: <a class="card-link" href="\?c=BBRK" data-cmd="BBRK">BBRK<\/a><\/span><\/p>/);
  // Gone: the mock terminal, the second button, the three tiles, the globe.
  assert.doesNotMatch(page, /spon-term|YOUR COMPANY HERE|card-art|card-facts|<dl class="card-facts|spon-globe|<canvas|BBRK NUMBERS|PAGE VIEWS|About [\d,-]+ views/);
  const [top, details] = page.split('<details class="how card-more"');
  // + Details: what the number counts in full, where, what we refuse, the audience (in
  // BBRK's words), the sources; WEIRD only there.
  assert.ok(details.includes(SHOWN_DETAIL));
  assert.match(SHOWN_DETAIL, /last 7 days/);
  assert.match(SHOWN_DETAIL, /Lines share the showings: with 3 lines in rotation, each gets about a third\./);
  assert.match(details, /<dt class="tag">Not for<\/dt><dd>No investment products, brokers, exchanges, crypto, funds or tips\.<\/dd>/);
  assert.match(details, /<dt class="tag">Visitors<\/dt><dd>68 in 7 days, 8m 00s average visit<\/dd>/);
  assert.match(details, /<dt class="tag">Countries<\/dt><dd>United States 60% · Japan 10%<\/dd>/);
  assert.doesNotMatch(top, /WEIRD|United States/);
  assert.match(details, /<a class="spon-weird" href="\?c=WEIRD" data-cmd="WEIRD">Or a WEIRD gauge<\/a>/);
  assert.doesNotMatch(sponsorHtml({ has: () => false }), /WEIRD|BBRK/, 'no link to a command that is not here');
  assert.equal(POINT, '↓ this line, every screen');
  const w = cardWords(page);
  assert.ok(w.length <= 35, `${w.length} words: ${w.join(" ")}`);
  assert.doesNotMatch(page, /DataFast|—|TBD/);
  assert.doesNotMatch(page, new RegExp(['bloom', 'berg'].join(''), 'i'));
  assert.equal(parseCommand('SPONSOR').name, 'SPONSOR');
  // While loading: --, and no price line.
  const empty = sponsorHtml({ has: () => true });
  assert.match(empty, /Shown -- times this week\./);
  assert.match(empty, /<p class="spon-price" id="spon-price" hidden><\/p>/);
});

test('SPONSOR price: from SPONSOR_PRICE through /api/sponsors; hidden entirely when unset', () => {
  assert.equal(sponsorPrice('99'), 99);
  assert.equal(sponsorPrice(' $1,200 '), 1200);
  for (const v of [undefined, '', '  ', '0', '-5', '9.99', 'ninety', '99 a week', '1234567']) assert.equal(sponsorPrice(v), null, String(v));
  assert.equal(priceText({ price: 99 }), '$99 a week');
  assert.equal(priceText({ price: 1200 }), '$1,200 a week');
  for (const cfg of [null, {}, { price: null }, { price: 0 }, { price: '99' }, { price: 9.5 }]) assert.equal(priceText(cfg), '', JSON.stringify(cfg));
  const unset = sponsorHtml({ has: () => true, bbrk: FULL, cfg: { price: null } });
  assert.match(unset, /<p class="spon-price" id="spon-price" hidden><\/p>/);
  assert.doesNotMatch(unset.split('<details')[0].replace(/<[^>]+>/g, ' '), /\$|a week|TBD|price/i, 'no price, no placeholder');
  assert.match(sponsorHtml({ has: () => true, cfg: { price: 99 } }), /<p class="spon-price" id="spon-price">\$99 a week<\/p>/);
  assert.match(readFileSync('public/screens/sponsor.css', 'utf8'), /\.spon-price\[hidden\] \{ display: none; \}/);
  // The key is in .env.example; the browser config passes it through.
  assert.match(readFileSync('.env.example', 'utf8'), /^SPONSOR_PRICE=$/m);
  assert.match(readFileSync('public/sponsor-strip.js', 'utf8'), /price: d\.price \}/);
});

test('SPONSOR shown: the real strip count of the last 7 days, said plainly; a zero is said, not printed', () => {
  assert.equal(shownCount(FULL), 5678);
  assert.equal(shownCount({ inventory: { stripShown: { d7: null } } }), null);
  assert.equal(shownCount(null), null);
  assert.equal(shownCount({ inventory: { stripShown: { d7: '12' } } }), null, 'numbers only');
  assert.equal(shownLine(2097), 'Shown 2,097 times this week.');
  assert.equal(shownLine(1), 'Shown 1 time this week.');
  assert.equal(shownLine(0), 'Not shown yet this week.');
  assert.equal(shownLine(null), 'Shown -- times this week.');
  // Never page views, never visitors in its place.
  assert.equal(shownCount({ audience: { pageviews: { d7: 300 }, visitors: { d7: 96 } } }), null);
});

test('SPONSOR mailto: the typed line goes into the EMAIL body, encoded', () => {
  assert.equal(MAILTO, 'mailto:hello@bloombroke.com?subject=Sponsor%20Bloombroke');
  assert.equal(mailtoFor(''), MAILTO);
  assert.equal(mailtoFor('   '), MAILTO);
  assert.equal(mailtoFor('Acme: fresh beans'), `${MAILTO}&body=Our%20line%3A%20Acme%3A%20fresh%20beans`);
  const m = mailtoFor('A&B #1? "x" <y>\ncc=me@x.com&subject=hi');
  assert.equal(m, `${MAILTO}&body=Our%20line%3A%20A%26B%20%231%3F%20%22x%22%20%3Cy%3E%20cc%3Dme%40x.com%26subject%3Dhi`);
  assert.equal(m.split('&').length, 2, 'one subject and one body: a typed & or = cannot add a field');
  assert.doesNotMatch(m, /[#\s"<>\n]/);
  assert.ok(decodeURIComponent(mailtoFor('x'.repeat(500)).split('body=')[1]).length <= 'Our line: '.length + TRY_MAX);
});

test('SPONSOR try your line: shows in the real strip as text, holds it still, and is never stored or sent', async () => {
  // tryLine: the text goes in data-try (the CSS draws it), never into markup.
  const attrs = {};
  const cls = new Set();
  const real = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; }, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } };
  tryLine(real, '  <b>Acme</b>   now ');
  assert.equal(attrs['data-try'], '<b>Acme</b> now');
  assert.ok(cls.has('is-try'));
  tryLine(real, '');
  assert.equal(attrs['data-try'], undefined);
  assert.ok(!cls.has('is-try'));
  tryLine(null, 'x'); // no strip (Pro): nothing
  const css = readFileSync('public/screens/sponsor.css', 'utf8');
  assert.match(css, /\.status-sponsor\.is-try > \* \{ display: none; \}/, 'the strip\'s own line is hidden');
  assert.match(css, /\.status-sponsor\.is-try::after \{\s*content: attr\(data-try\);/, 'the typed text, as text');
  assert.match(css, /\.status-sponsor\.is-try::before \{\s*content: 'SPONSOR';/, 'marked like a paid line');
  // The shell's strip (app.js: isHidden is stripHidden) holds still and counts nothing
  // while a typed line covers it; afterwards it rotates and counts again.
  assert.match(readFileSync('public/app.js', 'utf8'), /isHidden: \(\) => stripHidden\(sponsorEl\)/);
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const host = fakeHost();
    host.classList.contains = (c) => host.classList.has(c);
    host.setAttribute = () => {};
    host.removeAttribute = () => {};
    const shown = [];
    const st = mountStrip(host, stripItems(cleanSponsors({ house: house(3) })), { isHidden: () => stripHidden(host, { hidden: false }), onShow: () => shown.push(1) });
    assert.equal(shown.length, 1);
    tryLine(host, 'Acme');
    mock.timers.tick(ROTATE_MS * 5);
    assert.equal(st.index, 0, 'held still under the typed line');
    assert.equal(shown.length, 1, 'no showing counted while it is covered');
    tryLine(host, '');
    mock.timers.tick(ROTATE_MS);
    assert.equal(st.index, 1, 'rotates again');
    assert.equal(shown.length, 2, 'and counts again');
    st.stop();
    assert.equal(stripHidden(host, { hidden: true }), true, 'a hidden tab');
  } finally { mock.timers.reset(); }
  // Long text: cut to the longest line we run.
  tryLine(real, 'x'.repeat(500));
  assert.equal(attrs['data-try'].length, TRY_MAX);
  tryLine(real, '');
  // Only where the strip shows: not for Pro, not in an embed, not with no strip.
  const shownStrip = { hidden: false };
  const page = (embed) => ({ documentElement: { classList: { contains: (c) => embed && c === 'is-embed' } } });
  assert.equal(canTry(shownStrip, { pro: () => false, doc: page(false) }), true);
  assert.equal(canTry(shownStrip, { pro: () => true, doc: page(false) }), false, 'Pro: no strip');
  assert.equal(canTry(shownStrip, { pro: () => false, doc: page(true) }), false, 'an embed');
  assert.equal(canTry({ hidden: true }, { pro: () => false, doc: page(false) }), false, 'the strip hidden');
  assert.equal(canTry(null, { pro: () => false, doc: page(false) }), false);
  assert.match(readFileSync('public/screens/sponsor.css', 'utf8'), /\.spon-card > \.card-media\[hidden\] \{ display: none; \}/);
  // The screen: typing mirrors into the strip and the EMAIL link; closing puts the strip back.
  const listeners = {};
  const input = { value: '', addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; } };
  const email = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const stripEl = { ...real, hidden: false, getBoundingClientRect: () => ({ left: 0, width: 100, top: 700, right: 100 }), querySelector: () => null };
  const prevDoc = globalThis.document;
  const saved = [];
  const store = { setItem: (...a) => saved.push(a) };
  const prevLs = globalThis.localStorage;
  globalThis.localStorage = store;
  globalThis.document = { getElementById: (id) => (id === 'status-sponsor' ? stripEl : null) };
  const cleanups = [];
  const fetches = [];
  try {
    const el = { set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; }, isConnected: true,
      querySelector: (sel) => ({ '#spon-try': input, '#spon-email': email }[sel] ?? null) };
    render(el, {}, { status() {}, signal: null, onCleanup: (f) => cleanups.push(f), live() {}, fetchJSON: async (u) => { fetches.push(u); return FULL; } });
    input.value = 'Acme Coffee: beans & more';
    listeners.input();
    assert.equal(attrs['data-try'], 'Acme Coffee: beans & more');
    assert.ok(cls.has('is-try'));
    assert.equal(email.attrs.href, mailtoFor('Acme Coffee: beans & more'));
    for (const f of cleanups) f();
    assert.ok(!cls.has('is-try'), 'closed: the strip is back');
    assert.equal(listeners.input, undefined);
  } finally {
    globalThis.document = prevDoc;
    globalThis.localStorage = prevLs;
  }
  assert.deepEqual(saved, [], 'nothing stored');
  assert.deepEqual(fetches, ['/api/bbrk'], 'nothing sent: only our numbers are asked for');
  const src = readFileSync('public/screens/sponsor.js', 'utf8');
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|sendBeacon|method: 'POST'|goal\(/, 'never saved, never sent');
});

test('SPONSOR refresh: the numbers again every minute through ctx.live (paused while hidden)', async () => {
  const calls = [];
  const lives = [];
  const cleanups = [];
  const nodes = {};
  const node = (k) => (nodes[k] ||= { innerHTML: '', textContent: '', isConnected: true, hidden: false, attrs: {}, setAttribute(a, v) { this.attrs[a] = v; } });
  const el = { set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; }, isConnected: true,
    querySelector: (sel) => ({ '#spon-views': node('views'), '#spon-details': node('details'), '#spon-price': node('price') }[sel] ?? null) };
  let answer = FULL;
  const ctx = {
    status() {}, signal: null, onCleanup: (f) => cleanups.push(f), live: (fn, ms) => lives.push([fn, ms]),
    fetchJSON: async (u) => { calls.push(u); return answer; },
  };
  render(el, {}, ctx);
  const flush = () => new Promise((r) => setImmediate(r));
  await flush();
  assert.deepEqual(calls, ['/api/bbrk']);
  assert.equal(lives.length, 1);
  assert.equal(lives[0][1], REFRESH_MS);
  assert.equal(REFRESH_MS, 60_000);
  assert.equal(node('views').textContent, 'Shown 5,678 times this week.');
  assert.match(node('details').innerHTML, /68 in 7 days/);
  answer = { ...FULL, inventory: { stripShown: { d7: 6000 } } };
  lives[0][0]();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(node('views').textContent, 'Shown 6,000 times this week.');
  for (const f of cleanups) f();
  answer = { ...FULL, inventory: { stripShown: { d7: 9999 } } };
  lives[0][0]();
  await flush();
  assert.doesNotMatch(node('views').textContent, /9,999/, 'nothing painted after the screen closes');
  // ctx.live is the shell's liveTimer: it skips a hidden tab and catches up when shown.
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /const paused = \(\) => document\.hidden \|\| !embedVisible;/);
  assert.match(app, /live\(fn, ms\) \{ cleanups\.push\(liveTimer\(fn, ms\)\); \}/);
  assert.doesNotMatch(readFileSync('public/screens/sponsor.js', 'utf8'), /setInterval|ctx\.every/, 'no timer of its own');
});

test('SPONSOR open: the real strip is outlined with a label above it until the screen closes; nothing for Pro', () => {
  const cls = new Set();
  const added = [];
  const real = { hidden: false, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) }, querySelector: () => null,
    getBoundingClientRect: () => ({ left: 400, width: 300, top: 700, right: 700 }) };
  const tag = { style: {}, offsetWidth: 180, offsetHeight: 16, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.gone = true; } };
  const doc = { getElementById: (id) => (id === 'status-sponsor' ? real : null), createElement: () => tag, body: { appendChild: (t) => added.push(t) } };
  const ls = {};
  const win = { innerWidth: 1536, addEventListener: (t, f) => { ls[t] = f; }, removeEventListener: (t) => { delete ls[t]; } };
  const stop = pointAtStrip(doc, win);
  assert.ok(cls.has('is-spot'));
  assert.equal(added[0], tag);
  assert.equal(tag.textContent, POINT);
  assert.equal(tag.className, 'spon-point');
  assert.equal(tag.attrs['aria-hidden'], 'true');
  assert.equal(tag.style.left, '460px', 'centred over the line');
  assert.equal(tag.style.top, '680px', 'just above it');
  assert.ok(ls.resize, 'moves with the window');
  real.getBoundingClientRect = () => ({ left: 0, width: 100, top: 800, right: 100 });
  ls.resize();
  assert.equal(tag.style.left, '8px', 'kept on screen');
  stop();
  assert.ok(!cls.has('is-spot'));
  assert.ok(tag.gone);
  assert.equal(ls.resize, undefined);
  assert.equal(tag.hidden, false, 'a page that does not scroll: always shown');
  // A desktop whose #screen scrolls down to the big globe: only while scrolled to the bottom.
  const scr = { scrollTop: 0, scrollHeight: 1500, clientHeight: 770 };
  const ddoc = { ...doc, getElementById: (id) => (id === 'screen' ? scr : doc.getElementById(id)) };
  const dls = {};
  const dwin = { innerWidth: 1440, innerHeight: 900, addEventListener: (t, f) => { dls[t] = f; }, removeEventListener: (t) => { delete dls[t]; } };
  const dstop = pointAtStrip(ddoc, dwin);
  assert.equal(tag.hidden, true, 'at the top: hidden, it would sit on the globe');
  scr.scrollHeight = 700; // the screen's content got shorter: no scroll, shown
  dstop.refresh();
  assert.equal(tag.hidden, false, 'refresh() after the numbers change');
  scr.scrollHeight = 1500;
  dstop.refresh();
  scr.scrollTop = 1500 - 770;
  dls.scroll();
  assert.equal(tag.hidden, false, 'at the bottom: shown');
  dstop();
  assert.equal(dls.scroll, undefined);
  // A phone: only while the page is scrolled to the bottom.
  const se = { scrollTop: 0, scrollHeight: 1600 };
  const pdoc = { ...doc, scrollingElement: se };
  const pls = {};
  const pwin = { innerWidth: 390, innerHeight: 844, matchMedia: (q) => ({ matches: q === PHONE_MQ }), addEventListener: (t, f) => { pls[t] = f; }, removeEventListener: (t) => { delete pls[t]; } };
  const pstop = pointAtStrip(pdoc, pwin);
  assert.equal(tag.hidden, true, 'at the top of a phone page: hidden, it would sit on the buttons');
  se.scrollTop = 1600 - 844;
  pls.scroll();
  assert.equal(tag.hidden, false, 'at the bottom: shown, over the room the page keeps for it');
  se.scrollTop = 300;
  pls.scroll();
  assert.equal(tag.hidden, true);
  pstop();
  assert.equal(pls.scroll, undefined);
  assert.match(readFileSync('public/screens/sponsor.css', 'utf8'), /\.spon-card \{ padding-bottom: 48px; \}/, 'room at the end for the label');
  real.hidden = true; // Pro: no strip, nothing to point at
  const none = pointAtStrip(doc, win);
  assert.ok(!cls.has('is-spot'));
  none();
  const css = readFileSync('public/style.css', 'utf8');
  assert.match(css, /\.status-sponsor\.is-spot \{ outline: 1px solid var\(--accent\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.status-sponsor\.is-spot \{ animation: none; \} \}/);
  // Never an empty frame: no slide in while outlined (it starts below the frame), and a
  // line of its own if the strip has none.
  assert.match(css, /\.status-sponsor\.is-spot\.is-sliding \.spon-item \{ animation: none; \}/);
  assert.match(css, /\.status-sponsor\.is-spot:empty::before \{ content: 'YOUR LINE HERE';/);
  const own = readFileSync('public/screens/sponsor.css', 'utf8');
  assert.match(own, /\.spon-point \{\s*position: fixed;/);
  assert.match(own, /\.wd-tile \{ display: flex;/, 'WEIRD and DESK tiles keep their base styles');
  assert.doesNotMatch(own, /amber|orange|#f5a|#ffa|#ff9/i);
});

// ---- N HERE NOW in the top bar ---------------------------------------------------------------

test('here now: hidden when unknown, 0 or 1; one dim token by the clock; hidden under 380 px', () => {
  assert.equal(hereText(7), '7 HERE NOW');
  assert.equal(hereText(1234), '1,234 HERE NOW');
  assert.equal(hereText(2), '2 HERE NOW', 'from 2');
  for (const v of [0, 1, null, undefined, NaN, -3, 2.5, '7']) assert.equal(hereText(v), '', String(v));
  assert.equal(HERE_MIN, 2);
  const el = { textContent: 'x', innerHTML: '', hidden: false };
  paintHere(el, null);
  assert.deepEqual([el.textContent, el.hidden], ['', true]);
  paintHere(el, 3);
  assert.deepEqual([el.innerHTML, el.hidden], ['3 HERE<span class="here-x"> NOW</span>', false], 'NOW drops on a phone');
  assert.match(el.title, /^3 here now/);
  paintHere(el, 0);
  assert.equal(el.hidden, true);
  paintHere(el, 1);
  assert.equal(el.hidden, true, '1 is most likely the viewer');
  paintHere(el, 9, { fits: () => false });
  assert.equal(el.hidden, true, 'never on top of the name');
  // Room: clear of the name and the seat at the left.
  const box = (left, right, hidden = false) => ({ hidden, getBoundingClientRect: () => ({ left, right }) });
  const bar = (tokLeft, kids) => ({ ...box(tokLeft, tokLeft + 50), ownerDocument: { querySelector: () => ({ children: kids }) } });
  assert.equal(clearOfBrand(bar(140, [box(8, 104), box(110, 200, true)])), true);
  assert.equal(clearOfBrand(bar(91, [box(8, 104)])), false);
  assert.equal(clearOfBrand(bar(150, [box(8, 104), box(110, 170)])), false, 'the seat counts when shown');
  assert.equal(clearOfBrand({}), true);
  assert.equal(HERE_MS, 60_000);
  const html = readFileSync('public/index.html', 'utf8');
  assert.match(html, /<div class="clock" aria-live="off">\s*<span id="here-now" class="here-now num" hidden><\/span>\s*<span class="label">NEW YORK<\/span>/);
  const css = readFileSync('public/style.css', 'utf8');
  assert.match(css, /\.here-now \{ color: var\(--dim\);/);
  assert.match(css, /\.here-now\[hidden\] \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 379px\) \{ \.here-now \{ display: none; \} \}/);
  assert.match(css, /@media \(max-width: 639px\) \{ \.here-now \{ font-size: 11px; letter-spacing: 0; \} \.here-x \{ display: none; \} \}/);
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /mountHereNow\(\$\('here-now'\), \{ timer: liveTimer \}\)/);
});

test('here now: asks /api/live, again every minute while visible; a failure hides it', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const urls = [];
    let answer = { here: 5 };
    let hidden = false;
    const fetchImpl = async (u) => { urls.push(u); if (answer === 'fail') throw new Error('down'); return { ok: true, json: async () => answer }; };
    const el = { textContent: '', innerHTML: '', hidden: true };
    const flush = () => new Promise((r) => setImmediate(r));
    const stop = mountHereNow(el, { fetchImpl, isHidden: () => hidden });
    await flush();
    assert.deepEqual(urls, ['/api/live']);
    assert.deepEqual([el.innerHTML, el.hidden], ['5 HERE<span class="here-x"> NOW</span>', false]);
    answer = { here: null };
    mock.timers.tick(HERE_MS);
    await flush();
    assert.equal(el.hidden, true, 'unknown: hidden');
    hidden = true;
    mock.timers.tick(HERE_MS * 3);
    await flush();
    assert.equal(urls.length, 2, 'a hidden tab asks nothing');
    hidden = false;
    answer = 'fail';
    mock.timers.tick(HERE_MS);
    await flush();
    assert.equal(el.hidden, true);
    stop();
    mock.timers.tick(HERE_MS * 2);
    await flush();
    assert.equal(urls.length, 3, 'stopped');
  } finally { mock.timers.reset(); }
});

test('counting: one strip_shown per line shown in a visible tab, batched; clicks at once', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const sent = [];
    const clicks = [];
    const batch = stripShownBatch({ send: (n) => sent.push(n), doc: null, win: null });
    let hidden = false;
    const host = fakeHost();
    const s = mountStrip(host, stripItems(cleanSponsors({ house: house(3) })), { isHidden: () => hidden, onShow: () => batch.add(), onAnyClick: () => clicks.push(1), onPaidClick: () => {} });
    assert.equal(batch.pending, 1, 'the first line, once');
    mock.timers.tick(ROTATE_MS * 3);
    assert.equal(batch.pending, 4, 'one per rotation, never two');
    hidden = true;
    mock.timers.tick(ROTATE_MS * 3);
    assert.equal(batch.pending, 4, 'a hidden tab shows nothing, counts nothing');
    hidden = false;
    mock.timers.tick(60_000 - ROTATE_MS * 6);
    assert.equal(sent.reduce((a, n) => a + n, 0) + batch.pending, 4 + Math.floor((60_000 - ROTATE_MS * 6) / ROTATE_MS), 'every line shown counted once, nothing lost');
    assert.ok(sent.length >= 1 && sent.every((n) => n >= 1 && n <= 20));
    const click = (paid) => ({ target: { closest: (q) => (q.startsWith('a.spon-item') && (paid || !q.includes('sponsored')) ? {} : null) } });
    for (const f of host.listeners.click) f(click(false));
    assert.equal(clicks.length, 1);
    s.stop();
  } finally { mock.timers.reset(); }
  // The status bar wires it once; the SPONSOR preview never counts.
  const app = readFileSync('public/app.js', 'utf8');
  assert.equal((app.match(/onShow: \(\) => shown\.add\(\)/g) || []).length, 1);
  assert.equal((app.match(/stripShownBatch\(\)/g) || []).length, 1);
  assert.doesNotMatch(readFileSync('public/screens/sponsor.js', 'utf8'), /onShow|stripShownBatch|countOnly/);
  assert.deepEqual(stripItems(cleanSponsors({ house: house(3) }), { pro: true }), [], 'Pro: no strip, nothing counted');
});

test('sponsor_click: sent for a paid line, never for an AD line', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const clicks = [];
    const click = (paid) => ({ target: { closest: (q) => (q === '.spon-item' || (paid && q.includes('sponsored')) ? {} : null) } });
    const host = fakeHost();
    const s = mountStrip(host, stripItems(cleanSponsors({ lines: [{ name: 'A', text: 'B', url: 'https://a.example' }] })), { onPaidClick: () => clicks.push('paid') });
    for (const f of host.listeners.click) f(click(true));
    for (const f of host.listeners.click) f(click(false));
    assert.deepEqual(clicks, ['paid']);
    s.stop();
  } finally { mock.timers.reset(); }
  const src = readFileSync('public/sponsor-strip.js', 'utf8');
  assert.match(src, /goal\('sponsor_click'\)/);
  assert.match(src, /closest\?\.\('a\.spon-item\[rel~="sponsored"\]'\)/);
});

test('SPONSOR hero: one line on a desktop, a phone breaks only before "on every screen." (kit.css Rule G)', () => {
  const page = sponsorHtml({ has: () => true });
  assert.match(page, /<h2 class="card-hero card-hero-44 num">Your line <span class="nowrap">on every screen\.<\/span><\/h2>/);
  assert.doesNotMatch(page, /<br/);
  const kit = readFileSync('public/kit.css', 'utf8');
  assert.match(kit, /Rule G: A hero never ends a line on a preposition or an article \(on, of, for, the, a\)\.\s+Wrap the final phrase in nowrap and let the size do the rest\./);
  assert.match(kit, /\n\.nowrap \{ white-space: nowrap; \}/);
  const css = readFileSync('public/screens/sponsor.css', 'utf8');
  assert.match(css, /\.spon-card \.card-hero \{ width: max-content; max-width: min\(720px, calc\(100vw - 32px\)\); \}/, 'the hero 720 px at most, wider than the column');
  assert.match(css, /\.spon-card \{ max-width: min\(560px, 100%\); \}/, 'the column stays 560 px');
});
