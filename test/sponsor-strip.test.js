// The sponsor strip: config, rotation, labels, links, Pro, and the SPONSOR screen.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { cleanSponsors, cleanUrl, loadSponsors, mountSponsors, SPONSORS_FILE, MAX_LINES, MAX_HOUSE } from '../lib/sponsors.js';
import { stripItems, itemHtml, mountStrip, ROTATE_MS, SLIDE_MS, MAX_SPONSOR_LINES } from '../public/sponsor-strip.js';
import { sponsorHtml, FACTS, NOT_FOR, PROOF, proofLinks, numbersHtml, gaugePreviewHtml, PREVIEW_SPONSOR } from '../public/screens/sponsor.js';
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

test('the strip is cut before the legal links are: it shrinks, they never do', () => {
  const css = readFileSync('public/style.css', 'utf8');
  const legal = readFileSync('public/legal.css', 'utf8');
  assert.match(legal, /\.status-legal \{ display: flex; flex: 0 0 auto;/);
  assert.match(css, /\.status-sponsor \{ flex: 0 1 auto; min-width: 0;[^}]*overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
  assert.match(css, /\.spon-strip \.spon-item \{ display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
  const html = readFileSync('public/index.html', 'utf8');
  assert.match(html, /<span id="status-sponsor" class="status-sponsor spon-strip" aria-live="off" hidden><\/span>/, 'hidden until lines load; not read aloud on every turn');
  assert.ok(html.indexOf('id="status-sponsor"') < html.indexOf('id="status-legal"'));
});

// ---- SPONSOR screen ---------------------------------------------------------------------------

test('SPONSOR screen: preview, four facts, proof links only for commands that exist, email for rates', () => {
  const all = sponsorHtml({ has: () => true });
  assert.match(all, /<div class="spon-preview"[^>]*><span class="spon-strip" id="spon-demo"><\/span><\/div>/);
  for (const f of [...FACTS, NOT_FOR]) assert.ok(all.includes(f), f);
  assert.deepEqual(FACTS, ['Every screen, every visitor who is not Pro.', 'Lines rotate every 7 s. Up to 8 sponsors.', 'No tracking, no pixels, no scripts.']);
  for (const [c] of PROOF) assert.match(all, new RegExp(`data-cmd="${c}">${c}</a>`));
  assert.match(all, /Email for rates: <a href="mailto:hello@bloombroke\.com">/);
  assert.doesNotMatch(all, /\$\d/, 'no prices');
  // Missing commands: their links are hidden; none left, no list at all.
  const some = sponsorHtml({ has: (c) => c === 'WEIRD' });
  assert.match(some, /data-cmd="WEIRD">WEIRD<\/a> gauges/);
  for (const c of ['BBRK', 'CHANGES', 'DATA', 'MCP']) assert.doesNotMatch(some, new RegExp(`data-cmd="${c}"`));
  assert.doesNotMatch(sponsorHtml({ has: () => false }), /class="spon-proof"/);
  // By default it asks the registry.
  assert.ok(proofLinks().some(([c]) => c === 'WEIRD'));
  // Short: under 90 words on screen with every link, the numbers, the gauge and a house
  // line in the strip preview. The gauge's long line is hidden in the preview (CSS).
  const words = (h) => h.replace(/<p class="wd-line">[^<]*<\/p>/g, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  const full = sponsorHtml({ has: () => true, bbrk: { counts: { whatif_run: { today: 12, d7: 340 }, guess_played: { today: 5, d7: 61 }, mcp_call: { today: 1, d7: 9 } } },
    gauge: { ok: true, headline: 'HORMUZ 3 SHIPS/DAY', line: '7-day average; 1-year average 35', source: 'IMF PortWatch' } });
  assert.ok(words(full) + 10 <= 90, `${words(full)} words`);
  assert.match(readFileSync('public/style.css', 'utf8'), /\.spon-tile \.wd-line \{ display: none; \}/);
  assert.equal(parseCommand('SPONSOR').name, 'SPONSOR');
  assert.doesNotMatch(all, /\u2014/);
});

test('SPONSOR proof: live site numbers from BBRK, and a real gauge tile with a preview sponsor', () => {
  const html = numbersHtml({ counts: { whatif_run: { today: 1234, d7: 5678 }, guess_played: { today: 0, d7: 3 }, mcp_call: null } });
  assert.match(html, /<th scope="row">WHATIF results<\/th><td class="num">1,234<\/td><td class="num">5,678<\/td>/);
  assert.match(html, /<th scope="row">GUESS games<\/th><td class="num">0<\/td><td class="num">3<\/td>/);
  assert.match(html, /<th scope="row">MCP calls<\/th><td class="num">--<\/td><td class="num">--<\/td>/, 'unknown is --');
  assert.equal((numbersHtml(null).match(/>--</g) || []).length, 6, 'before it loads, all --');
  const withBbrk = sponsorHtml({ has: () => true });
  assert.match(withBbrk, /SITE NUMBERS <a class="code" href="\?c=BBRK" data-cmd="BBRK">BBRK<\/a>/);
  assert.doesNotMatch(sponsorHtml({ has: (c) => c !== 'BBRK' }), /SITE NUMBERS/, 'no BBRK command, no numbers block');
  const tile = gaugePreviewHtml({ ok: true, headline: 'HORMUZ 3 SHIPS/DAY', line: 'x', source: 'IMF PortWatch' });
  assert.match(tile, /data-cmd="CANAL"/);
  assert.match(tile, /HORMUZ 3 SHIPS\/DAY/);
  assert.match(tile, new RegExp(PREVIEW_SPONSOR));
  assert.match(tile, /title="A preview: no gauge is sponsored yet"/);
  assert.match(gaugePreviewHtml(null), /LOADING/);
  // A preview only: the sponsor config is untouched.
  assert.deepEqual(loadSponsors().gauges, {});
  // The proof links resolve for commands on main now.
  for (const c of ['BBRK', 'MCP', 'WEIRD']) assert.ok(findCommand(c), c);
  assert.deepEqual(proofLinks().map(([c]) => c).filter((c) => ['BBRK', 'MCP', 'WEIRD'].includes(c)), ['BBRK', 'MCP', 'WEIRD']);
});

test('sponsor_click: sent for a paid line, never for an AD line', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    const clicks = [];
    const click = (sel) => ({ target: { closest: (q) => (sel === 'paid' && q.includes('sponsored') ? {} : null) } });
    const host = fakeHost();
    const s = mountStrip(host, stripItems(cleanSponsors({ lines: [{ name: 'A', text: 'B', url: 'https://a.example' }] })), { onPaidClick: () => clicks.push('paid') });
    for (const f of host.listeners.click) f(click('paid'));
    for (const f of host.listeners.click) f(click('house'));
    assert.deepEqual(clicks, ['paid']);
    s.stop();
  } finally { mock.timers.reset(); }
  const src = readFileSync('public/sponsor-strip.js', 'utf8');
  assert.match(src, /goal\('sponsor_click'\)/);
  assert.match(src, /closest\?\.\('a\.spon-item\[rel~="sponsored"\]'\)/, 'only links marked sponsored count');
});
