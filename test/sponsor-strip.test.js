// The sponsor strip: config, rotation, labels, links, Pro, and the SPONSOR screen.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { cleanSponsors, cleanUrl, loadSponsors, mountSponsors, SPONSORS_FILE, MAX_LINES, MAX_HOUSE } from '../lib/sponsors.js';
import { stripItems, itemHtml, mountStrip, ROTATE_MS, SLIDE_MS, MAX_SPONSOR_LINES } from '../public/sponsor-strip.js';
import { stripShownBatch } from '../public/goal.js';
import { sponsorHtml, proofParts, proofHtml, visitLen, cleanDown, weeklyViews, viewsLine, paidLines, pointAtStrip, sponCaption, render, REFRESH_MS, HERO, POINT, FINE, MAILTO, PHONE_MQ } from '../public/screens/sponsor.js';
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
  mountSponsors(app, { file, log: { error() {} } });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const d = await (await fetch(`http://127.0.0.1:${server.address().port}/api/sponsors`)).json();
    assert.deepEqual(d, { lines: [{ name: 'A', text: 'B', url: 'https://a.example/' }], house: [{ text: 'Rent me', cmd: 'SPONSOR' }], gauges: {}, line: { name: 'A', text: 'B', url: 'https://a.example/' } });
  } finally {
    await new Promise((r) => server.close(r));
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
// Visible words: anything with a letter or a digit, tags and hidden parts left out.
const words = (h) => h.replace(/<[^>]+aria-hidden="true"[^>]*>[^<]*<\/span>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/g, ' ')
  .split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

test('SPONSOR screen: YOUR AD HERE with the globe, one live line, email and BBRK; about 45 words', () => {
  const page = sponsorHtml({ has: () => true, bbrk: FULL, cfg: cleanSponsors({ house: house(3) }) });
  assert.match(page, /<section class="spon-page" aria-label="Sponsor">\s*<h2 class="spon-hero">YOUR AD HERE<\/h2>\s*<div id="spon-proof"/, 'YOUR AD HERE on its own row');
  assert.match(page, /<p class="spon-fine">[^<]*<\/p>\s*<figure class="spon-globe"><canvas role="img" aria-label="Globe of visitors by country, last 7 days: US 45, JP 7, other 4\."><\/canvas><figcaption class="dim">7D by place · 7 live now<\/figcaption><\/figure>\s*<\/section>/, 'the globe under the fine print, its caption under it');
  assert.equal(HERO, 'YOUR AD HERE');
  assert.match(page, /<p class="spon-live"><span class="spon-part">243 page views this week<\/span><span class="spon-dot" aria-hidden="true"> · <\/span><span class="spon-part">8 min visits<\/span>/);
  assert.doesNotMatch(page, /here now/, 'right now is in the globe caption, not twice');
  assert.match(page, /<p class="spon-views">Your line: about 5,600 views a week<\/p>/);
  assert.equal(MAILTO, 'mailto:hello@bloombroke.com?subject=Sponsor%20Bloombroke');
  assert.match(page, /<p class="spon-act"><a class="spon-mail" href="mailto:hello@bloombroke\.com\?subject=Sponsor%20Bloombroke">EMAIL hello@bloombroke\.com<\/a><a class="spon-mail spon-bbrk" href="\?c=BBRK" data-cmd="BBRK">BBRK NUMBERS<\/a><\/p>/, 'BBRK is a button beside the email, same style');
  assert.equal((page.match(/<a /g) || []).length, 3, 'the email, BBRK and one tiny WEIRD link');
  assert.match(page, /<a class="spon-weird" href="\?c=WEIRD" data-cmd="WEIRD">Or a WEIRD gauge<\/a>/);
  assert.doesNotMatch(sponsorHtml({ has: () => false }), /WEIRD|BBRK/, 'no link to a command that is not here');
  assert.match(sponsorHtml({ has: (c) => c === 'BBRK' }), /data-cmd="BBRK"/);
  assert.equal((page.match(/class="spon-fine"/g) || []).length, 1, 'one line of fine print');
  assert.match(page, new RegExp(FINE.replace(/\./g, '\\.')));
  assert.equal(POINT, '↓ this line, every screen');
  const n = words(page) + words(POINT);
  assert.ok(n <= 49, `${n} words with live now in the caption`);
  const quiet = words(sponsorHtml({ has: () => true, bbrk: { ...FULL, audience: { ...FULL.audience, live: 0 } } })) + words(POINT);
  assert.ok(quiet <= 46, `${quiet} words`);
  // Gone: the fact rows, the numbers table, the gauge preview, the mock.
  assert.doesNotMatch(page, /spon-facts|spon-nums|SITE NUMBERS|spon-mock|wd-tile|CANAL|data-cmd="(CHANGES|DATA|MCP)"/);
  assert.doesNotMatch(page, /\$\d/, 'no prices');
  assert.doesNotMatch(page, /—/);
  assert.doesNotMatch(page, new RegExp(['bloom', 'berg'].join(''), 'i'));
  assert.equal(parseCommand('SPONSOR').name, 'SPONSOR');
  // While loading: -- for every number, the plain caption.
  const empty = sponsorHtml({ has: () => true });
  assert.match(empty, /-- page views this week/);
  assert.match(empty, /Your line: -- views a week/);
  assert.match(empty, /<figcaption class="dim">7D by place<\/figcaption>/);
  const css = readFileSync('public/screens/sponsor.css', 'utf8');
  assert.match(css, /@media \(max-width: 639px\) \{[\s\S]*\.spon-globe \{ align-self: stretch;/, 'as wide as the page on a phone (test/globe.test.js has the rest)');
});

test('SPONSOR live line: page views lead; -- for anything missing; short country names; caption live above 0 only', () => {
  assert.deepEqual(proofParts(FULL), ['243 page views this week', '8 min visits', '60% US']);
  assert.deepEqual(proofParts(null), ['-- page views this week', '-- min visits', '-- top country']);
  assert.deepEqual(proofParts({ audience: { live: 0, pageviews: { d7: 1234 }, avgVisitSec: 40, countries: [{ name: 'Japan', pct: 10.4 }] } }), ['1,234 page views this week', '40 s visits', '10% Japan']);
  assert.deepEqual(proofParts({ audience: { visitors: { d7: 68 }, pageviews: {}, avgVisitSec: null, countries: [] } }), ['-- page views this week', '-- min visits', '-- top country'], 'never visitors in place of page views');
  assert.equal(proofParts({ audience: { countries: [{ name: 'United Kingdom', pct: 5 }] } })[2], '5% UK');
  assert.equal(visitLen(429), '7 min');
  assert.equal(visitLen(-1), '-- min');
  assert.match(proofHtml(FULL), /<span class="spon-part">60% US<\/span><\/p>/);
  assert.match(proofHtml({ audience: { pageviews: { d7: '<b>' } } }), /-- page views this week/, 'only numbers');
  assert.equal(sponCaption(FULL), '7D by place · 7 live now');
  assert.equal(sponCaption({ audience: { live: 0 } }), '7D by place');
  assert.equal(sponCaption({ audience: { live: 1 } }), '7D by place', '1 is most likely the viewer');
  assert.equal(sponCaption({ audience: { live: 2 } }), '7D by place · 2 live now');
  assert.equal(sponCaption(null), '7D by place');
});

test('SPONSOR refresh: numbers and globe dots again every minute through ctx.live (paused while hidden)', async () => {
  const calls = [];
  const lives = [];
  const cleanups = [];
  const nodes = {};
  const node = (k) => (nodes[k] ||= { innerHTML: '', textContent: '', isConnected: true, hidden: false, attrs: {}, setAttribute(a, v) { this.attrs[a] = v; } });
  const el = { set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; }, isConnected: true,
    querySelector: (sel) => ({ '#spon-proof': node('proof'), '.spon-globe canvas': null, '.spon-globe figcaption': node('cap'), '.spon-globe': node('fig') }[sel] ?? null) };
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
  assert.match(node('proof').innerHTML, /243 page views this week/);
  assert.equal(node('cap').textContent, '7D by place · 7 live now');
  answer = { ...FULL, audience: { ...FULL.audience, pageviews: { d7: 300 }, live: 0 } };
  lives[0][0]();
  await flush();
  assert.equal(calls.length, 2);
  assert.match(node('proof').innerHTML, /300 page views this week/);
  assert.equal(node('cap').textContent, '7D by place');
  for (const f of cleanups) f();
  answer = { ...FULL, audience: { ...FULL.audience, pageviews: { d7: 999 } } };
  lives[0][0]();
  await flush();
  assert.doesNotMatch(node('proof').innerHTML, /999/, 'nothing painted after the screen closes');
  // ctx.live is the shell's liveTimer: it skips a hidden tab and catches up when shown.
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /const paused = \(\) => document\.hidden \|\| !embedVisible;/);
  assert.match(app, /live\(fn, ms\) \{ cleanups\.push\(liveTimer\(fn, ms\)\); \}/);
  assert.doesNotMatch(readFileSync('public/screens/sponsor.js', 'utf8'), /setInterval|ctx\.every/, 'no timer of its own');
});

test('SPONSOR views a week: last 7 days strip_shown over the paid lines plus yours, rounded down; -- when missing', () => {
  const shown = (d7) => ({ inventory: { stripShown: { d7 } } });
  const paid = (n) => cleanSponsors({ lines: Array.from({ length: n }, (_, i) => ({ name: `S${i}`, text: 'x' })), house: house(3) });
  assert.equal(paidLines(cleanSponsors({ house: house(3) })), 0, 'house lines do not count');
  assert.equal(paidLines(paid(2)), 2);
  assert.equal(paidLines(null), 0);
  assert.equal(weeklyViews(shown(192), null), 190, 'no paid lines: all of it');
  assert.equal(weeklyViews(shown(192), cleanSponsors({ house: house(3) })), 190);
  assert.equal(weeklyViews(shown(5678), paid(1)), 2800, '5678 / 2 = 2839, down to 2800');
  assert.equal(weeklyViews(shown(5678), paid(2)), 1800, '5678 / 3 = 1892.7, down to 1800');
  assert.equal(weeklyViews(shown(99), null), 99);
  assert.equal(weeklyViews(shown(0), null), 0);
  assert.equal(weeklyViews(shown(null), null), null);
  assert.equal(weeklyViews(null, null), null);
  assert.equal(weeklyViews({ inventory: {} }, null), null);
  assert.deepEqual([cleanDown(12345), cleanDown(100), cleanDown(109), cleanDown(1999), cleanDown(7.9), cleanDown(-1), cleanDown(NaN)], [12000, 100, 100, 1900, 7, null, null]);
  assert.equal(viewsLine(190), 'Your line: about 190 views a week');
  assert.equal(viewsLine(12000), 'Your line: about 12,000 views a week');
  assert.equal(viewsLine(null), 'Your line: -- views a week');
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
  assert.match(readFileSync('public/screens/sponsor.css', 'utf8'), /\.spon-page \{ gap: 14px; padding-top: 8px; padding-bottom: 44px; \}/);
  real.hidden = true; // Pro: no strip, nothing to point at
  const none = pointAtStrip(doc, win);
  assert.ok(!cls.has('is-spot'));
  none();
  const css = readFileSync('public/style.css', 'utf8');
  assert.match(css, /\.status-sponsor\.is-spot \{ outline: 1px solid var\(--accent\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.status-sponsor\.is-spot \{ animation: none; \} \}/);
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
