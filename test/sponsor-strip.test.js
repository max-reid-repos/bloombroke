// The sponsor strip: config, rotation, labels, links, Pro, and the SPONSOR screen.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { cleanSponsors, cleanUrl, loadSponsors, mountSponsors, SPONSORS_FILE, MAX_LINES, MAX_HOUSE } from '../lib/sponsors.js';
import { stripItems, itemHtml, mountStrip, createStripCounter, ROTATE_MS, SLIDE_MS, MAX_SPONSOR_LINES, FLUSH_MS, MAX_BATCH } from '../public/sponsor-strip.js';
import { sponsorHtml, FACTS, NOT_FOR, PROOF, proofLinks, numbersHtml, gaugePreviewHtml, PREVIEW_SPONSOR, bottomMockHtml, fmtDur, topCountry, spotlightStrip, SPOT_MS } from '../public/screens/sponsor.js';
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

test('rotation: a new line every 7 seconds, with a short slide, looping', () => {
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
  assert.equal(ROTATE_MS, 7000);
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

test('SPONSOR screen: a mock of the bottom rows, facts, proof, email for rates; short', () => {
  const mock = bottomMockHtml();
  assert.match(mock, /BOTTOM ROW, EVERY SCREEN/);
  assert.match(mock, /<div class="spon-mock-row"><span class="spon-mock-msg"><\/span><span class="spon-strip spon-mock-strip" id="spon-demo"><\/span><span class="spon-mock-legal"><span class="spon-mock-nfa">Not financial advice · <\/span>Terms · Feedback<\/span><\/div>/, 'the ad line in its real place, legal links on its right');
  assert.match(mock, /<div class="spon-mock-keys"><span>F1 HELP<\/span>/, 'the key bar under it');
  const all = sponsorHtml({ has: () => true });
  assert.ok(all.includes(mock));
  for (const f of [...FACTS, NOT_FOR]) assert.ok(all.includes(f), f);
  assert.deepEqual(FACTS, ['Not shown to Pro users.', 'Rotates every 7 s, up to 8 sponsors.', 'No tracking, no pixels, no scripts.']);
  assert.match(all, /data-cmd="BBRK">BBRK<\/a>/);
  for (const c of ['CHANGES', 'DATA', 'MCP', 'WEIRD']) assert.match(all, new RegExp(`data-cmd="${c}">${c}</a>`));
  assert.match(all, /Email for rates: <a href="mailto:hello@bloombroke\.com">/);
  assert.doesNotMatch(all, /\$\d/, 'no prices');
  const some = sponsorHtml({ has: (c) => c === 'WEIRD' });
  for (const c of ['BBRK', 'CHANGES', 'DATA', 'MCP']) assert.doesNotMatch(some, new RegExp(`data-cmd="${c}"`));
  assert.doesNotMatch(sponsorHtml({ has: () => false }), /class="spon-proof"/);
  assert.ok(proofLinks().some(([c]) => c === 'WEIRD'));
  // Under 90 words with real-looking numbers, the links on main, a gauge, and the longest
  // house line in the mock. The gauge's line and source are hidden in the preview (CSS).
  const words = (h) => h.replace(/<p class="wd-(line|src)">[\s\S]*?<\/p>/g, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  const page = sponsorHtml({ bbrk: { audience: { visitors: { d7: 1234 }, avgVisitSec: 102, countries: [{ name: 'United States', pct: 41 }] }, inventory: { stripShown: { d7: 5678 } } },
    gauge: { ok: true, headline: 'HORMUZ 3 SHIPS/DAY', line: 'a b c', source: 'IMF PortWatch' } });
  const longest = Math.max(...loadSponsors().house.map((h) => h.text.split(/\s+/).length)) + 1;
  assert.ok(words(page) + longest <= 90, `${words(page) + longest} words`);
  assert.match(readFileSync('public/style.css', 'utf8'), /\.spon-tile \.wd-line, \.spon-tile \.wd-src \{ display: none; \}/);
  assert.equal(parseCommand('SPONSOR').name, 'SPONSOR');
  assert.doesNotMatch(all, /—/);
});

test('SPONSOR numbers: visitors, average visit, strip shown and top country; -- until data; no game counts', () => {
  const b = { audience: { visitors: { today: 50, d7: 1234, d30: 4000 }, avgVisitSec: 102, returningPct: 30, desktopPct: 60, countries: [{ name: 'United States', pct: 41.4 }, { name: 'India', pct: 9 }], referrers: [], source: 'DataFast', as_of: '2026-09-27' },
    inventory: { stripShown: { today: 100, d7: 5678 }, stripClicks: { today: 1, d7: 9 }, embedLoads: { today: 0, d7: 2 }, mcpCalls: { today: 0, d7: 3 } } };
  const html = numbersHtml(b);
  assert.deepEqual([...html.matchAll(/<th scope="row">([^<]+)<\/th><td class="num">([^<]+)<\/td>/g)].map((m) => [m[1], m[2]]),
    [['Visitors (7d)', '1,234'], ['Avg visit', '1m 42s'], ['Strip shown (7d)', '5,678'], ['Top country', 'United States 41%']]);
  assert.equal((numbersHtml(null).match(/>--</g) || []).length, 4);
  assert.equal((numbersHtml({ audience: {}, inventory: {} }).match(/>--</g) || []).length, 4);
  assert.doesNotMatch(html, /WHATIF|GUESS|MCP calls/);
  assert.equal(fmtDur(40), '40s');
  assert.equal(fmtDur(605), '10m 05s');
  assert.equal(fmtDur(null), '--');
  assert.equal(topCountry([]), '--');
  assert.match(sponsorHtml({ has: () => true }), /SITE NUMBERS <a class="code" href="\?c=BBRK" data-cmd="BBRK">BBRK<\/a>/);
  assert.doesNotMatch(sponsorHtml({ has: (c) => c !== 'BBRK' }), /SITE NUMBERS/);
  const tile = gaugePreviewHtml({ ok: true, headline: 'HORMUZ 3 SHIPS/DAY', line: 'x', source: 'IMF PortWatch' });
  assert.match(tile, /data-cmd="CANAL"/);
  assert.match(tile, new RegExp(PREVIEW_SPONSOR));
  assert.deepEqual(loadSponsors().gauges, {}, 'a preview only');
});

test('SPONSOR opens: the real strip is outlined for 2 s; reduced motion keeps a still outline', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const cls = new Set();
    const real = { hidden: false, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } };
    const doc = { getElementById: (id) => (id === 'status-sponsor' ? real : null) };
    spotlightStrip(doc);
    assert.ok(cls.has('is-spot'));
    mock.timers.tick(SPOT_MS - 1);
    assert.ok(cls.has('is-spot'));
    mock.timers.tick(1);
    assert.ok(!cls.has('is-spot'));
    real.hidden = true; // Pro: no strip, nothing to outline
    assert.equal(spotlightStrip(doc), null);
  } finally { mock.timers.reset(); }
  assert.equal(SPOT_MS, 2000);
  const css = readFileSync('public/style.css', 'utf8');
  assert.match(css, /\.status-sponsor\.is-spot \{ outline: 1px solid var\(--accent\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.status-sponsor\.is-spot \{ animation: none; \} \}/);
});

test('counting: lines shown in a visible tab, sent in batches of 1 to 20 a minute; clicks at once', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const sent = [];
    const counter = createStripCounter({ post: (b) => sent.push(b) });
    let hidden = false;
    const host = fakeHost();
    const s = mountStrip(host, stripItems(cleanSponsors({ house: house(3) })), { isHidden: () => hidden, onShow: () => counter.shown(), onClick: () => counter.click(), onPaidClick: () => {} });
    assert.equal(counter.pending, 1, 'the first line, shown');
    mock.timers.tick(ROTATE_MS * 3);
    assert.equal(counter.pending, 4);
    hidden = true;
    mock.timers.tick(ROTATE_MS * 3);
    assert.equal(counter.pending, 4, 'a hidden tab shows nothing, counts nothing');
    hidden = false;
    mock.timers.tick(FLUSH_MS - ROTATE_MS * 6);
    assert.deepEqual(sent.filter((b) => b.name === 'strip_shown'), [{ name: 'strip_shown', n: counter.pending === 0 ? sent[0].n : sent[0].n }]);
    assert.ok(sent[0].n >= 1 && sent[0].n <= MAX_BATCH);
    // A click on any line, paid or AD.
    const click = (paid) => ({ target: { closest: (q) => (q === '.spon-item' || (paid && q.includes('sponsored')) ? {} : null) } });
    for (const f of host.listeners.click) f(click(false));
    assert.deepEqual(sent.at(-1), { name: 'strip_click' });
    // Never more than 20 in one post; the rest waits for the next minute.
    for (let i = 0; i < 25; i++) counter.shown();
    const before = counter.pending;
    counter.flush();
    assert.equal(sent.at(-1).n, MAX_BATCH);
    assert.equal(counter.pending, before - MAX_BATCH);
    assert.equal(counter.flush() > 0, true);
    assert.equal(counter.flush(), 0, 'nothing to send: no post');
    s.stop();
    counter.stop();
  } finally { mock.timers.reset(); }
  // Pro: no lines, so no strip and nothing counted (app.js creates the counter with the strip).
  assert.deepEqual(stripItems(cleanSponsors({ house: house(3) }), { pro: true }), []);
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /onShow: \(\) => stripCount\?\.shown\(\), onClick: \(\) => stripCount\?\.click\(\)/);
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
  assert.match(src, /closest\('a\.spon-item\[rel~="sponsored"\]'\)/);
});
