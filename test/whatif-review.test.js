// WHATIF design review (Sep 29): the picker is the shelf (big cards, a click runs one, a
// family opens its chips, Space fills a basket, RUN at two or more, YOUR OWN on one line),
// and the result says each amount once (no sentence, no SPENT line, no multiple in the
// status line, one line under the certificate on a phone). The amounts stay exactly
// what the engine works out: frozen here for three commands.
// The picker runs in a small DOM (test/fixtures/tiny-dom.js), with the real render().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { El, mount, flush, fakeDocument } from './fixtures/tiny-dom.js';
import { render, ownWords, certLine, certLineHtml, resultHtml, shareLinks, videoHtml, SHELF_LINE, shelfCols, tableHtml, chipScroll, PHONE_MQ, LOSS_WORDS } from '../public/screens/whatif.js';
import { getCatalog, getWhatif, catalog } from '../data/whatif-service.js';
import { certModel } from '../data/whatif-cert.js';
import { cardWords } from '../public/kit.js';

const NOW = new Date('2026-09-27T12:00:00Z');

// The browser bits render() touches that the tiny DOM leaves out. The phone query can be
// flipped (phone.set(true)), and tells the picker, like a window crossing 639 px.
El.prototype.scrollIntoView = function scrollIntoView() {};
const phone = {
  matches: false,
  fns: new Set(),
  addEventListener(t, f) { this.fns.add(f); },
  removeEventListener(t, f) { this.fns.delete(f); },
  set(v) { this.matches = v; for (const f of [...this.fns]) f({ matches: v }); },
};
globalThis.window ??= {};
globalThis.window.matchMedia = (q) => (q === PHONE_MQ ? phone : { matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.window.addEventListener ??= () => {};
globalThis.window.removeEventListener ??= () => {};
const doc = fakeDocument();
globalThis.document = doc;

// Every picker's leave-the-screen hooks, so a test can start with no other picker listening.
const everyCleanup = [];
const leaveAll = () => everyCleanup.splice(0).forEach((f) => f());

async function picker(tokens = []) {
  const el = mount();
  const runs = [];
  const status = [];
  const cleanups = [];
  const ctx = {
    fetchJSON: async (url) => { assert.equal(url, '/api/whatif/catalog'); return getCatalog(); },
    signal: null,
    run: (c) => runs.push(c),
    status: (...a) => status.push(a),
    onCleanup: (f) => { cleanups.push(f); everyCleanup.push(f); },
  };
  render(el, { args: { tokens }, input: ['WHATIF', ...tokens].join(' ') }, ctx);
  await flush();
  const shelf = el.querySelector('.wi-shelf');
  const card = (sel) => shelf.querySelector(sel);
  const click = (target, extra = {}) => shelf.dispatch('click', { target, detail: 1, ...extra });
  const key = (k, target) => shelf.dispatch('keydown', { key: k, target });
  const bar = () => el.querySelector('.wi-bar');
  const run = () => el.querySelector('#wi-run');
  const tray = () => shelf.querySelector('.wi-chips:not([hidden])');
  return { el, shelf, card, click, key, runs, status, bar, run, cleanups, tray };
}

test('picker: the shelf is the screen; big cards in rows of four on pencil lines; no line under the title', async () => {
  const p = await picker();
  assert.doesNotMatch(p.el.textContent, /Pick what you bought|See what the stock would be worth now/, 'the subline is gone');
  assert.equal(p.el.querySelector('.wi-intro'), null);
  assert.match(p.el.querySelector('.panel-label').textContent, /WHAT IF YOU HAD BOUGHT THE STOCK\?/, 'the title keeps the question');
  // The tabs stay; YOUR OWN is one line beside them, not a card.
  assert.deepEqual(p.el.querySelectorAll('.seg-item').map((b) => b.textContent), ['GADGETS', 'CARS', 'GAMES', 'HABITS', 'VICES']);
  assert.ok(p.el.querySelector('#wi-own-in'));
  assert.equal(p.el.querySelector('[data-own]').tag, 'form');
  assert.equal(p.shelf.querySelector('.wi-own'), p.shelf.querySelector('[data-own]'), 'no YOUR OWN card on the shelf');
  // Rows of four (two on a phone), each followed by the pencil line (an inline SVG).
  assert.equal(shelfCols(false), 4);
  assert.equal(shelfCols(true), 2);
  const rows = p.shelf.querySelectorAll('.wi-row');
  assert.ok(rows.length >= 2);
  for (const r of rows.slice(0, -1)) assert.equal(r.querySelectorAll('.wi-card').length, 4);
  assert.equal(p.shelf.querySelectorAll('svg').length, rows.length, 'one pencil line under each row');
  for (const r of rows) {
    const box = r.parent;
    assert.deepEqual(box.children.map((k) => k.tag), ['ul', 'svg', 'div'], 'a row box: the cards, the line, the chips tray');
    assert.equal(r.getAttribute('role'), 'listbox');
    assert.equal(box.children[1].getAttribute('aria-hidden'), 'true', 'the line: hidden, outside the list');
    assert.equal(r.querySelector('svg'), null);
  }
  assert.equal(p.shelf.getAttribute('role'), null, 'the shelf itself is not a list');
  assert.match(SHELF_LINE, /^<svg class="wi-line" viewBox="0 0 400 12" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M2 6\.4 C /);
  assert.doesNotMatch(SHELF_LINE, /<image|href=|style=/, 'drawn, not an image file');
  // The RUN bar waits for a basket of two.
  assert.equal(p.bar().hidden, true);
  const css = readFileSync('public/screens/whatif.css', 'utf8');
  assert.match(css, /\.wi-doodle \{ display: block; width: 160px; height: 160px;/, 'the doodle at 160 px');
  assert.match(css, /\.wi-row \{\n  list-style: none; margin: 0; padding: 0;\n  display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 639px\) \{\n  \.wi-row \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.wi-line path \{ fill: none; stroke: var\(--wi-pencil\);/);
  // No empty panel under the shelf: the panel ends where it ends.
  assert.match(css, /html:not\(\.is-embed\) \.view > \.panel\.wi-panel:not\(\[hidden\]\) \{ flex: 0 1 auto !important;/);
});

test('picker: a click (or Enter) on a single card runs it at once', async () => {
  const p = await picker();
  p.click(p.card('[data-id="ipad"]'));
  assert.deepEqual(p.runs, ['WHATIF IPAD']);
  p.key('Enter', p.card('[data-id="macbookair"]'));
  assert.deepEqual(p.runs, ['WHATIF IPAD', 'WHATIF MACBOOKAIR']);
  // A habit runs with its years box.
  const v = await picker(['VICES']);
  const beer = v.card('[data-id="beer"]');
  beer.querySelector('input[data-spec]').value = '10';
  v.click(beer);
  assert.deepEqual(v.runs, ['WHATIF BEER:10Y']);
});

test('picker: a family card opens its chips under its row; a chip runs that model', async () => {
  const p = await picker();
  const fam = p.card('[data-fam="IPHONE"]');
  assert.equal(p.tray(), null);
  p.click(fam);
  assert.deepEqual(p.runs, [], 'a family does not run');
  const chips = p.tray();
  assert.ok(chips, 'the chips open');
  // Right under the family's row (after its pencil line), before the next row.
  const box = fam.closest('.wi-rowbox');
  assert.deepEqual(box.children.map((k) => k.tag), ['ul', 'svg', 'div']);
  assert.equal(box.children[2], chips);
  assert.equal(p.card('[data-fam="IPHONE"]'), fam, 'the cards are not redrawn');
  assert.match(fam.getAttribute('class'), /\bis-open\b/);
  assert.equal(fam.getAttribute('aria-expanded'), null, 'no aria-expanded on an option');
  assert.equal(chips.querySelectorAll('[data-chip]').length, 18);
  // The chips are buttons, pressed when in the basket; not options.
  for (const c of chips.querySelectorAll('[data-chip]')) {
    assert.equal(c.tag, 'button');
    assert.equal(c.getAttribute('role'), null);
    assert.equal(c.getAttribute('aria-pressed'), 'false');
  }
  p.click(chips.querySelector('[data-chip="iphone7"]'));
  assert.deepEqual(p.runs, ['WHATIF IPHONE7']);
  p.key('Enter', p.shelf.querySelector('[data-chip="iphone11"]'));
  assert.deepEqual(p.runs, ['WHATIF IPHONE7', 'WHATIF IPHONE11']);
  // Enter on the family card opens it too; a second click (or Esc) closes it.
  p.click(p.card('[data-fam="IPHONE"]'));
  assert.equal(p.tray(), null, 'closed again');
  p.key('Enter', p.card('[data-fam="IPHONE"]'));
  assert.ok(p.tray());
  p.key('Escape', p.shelf.querySelector('[data-chip="iphone6"]'));
  assert.equal(p.tray(), null, 'Esc closes the chips');
  // Other shelves' families: PlayStation on GAMES.
  const g = await picker(['GAMES']);
  g.click(g.card('[data-fam="PLAYSTATION"]'));
  g.click(g.shelf.querySelector('[data-chip="ps5"]'));
  assert.deepEqual(g.runs, ['WHATIF PS5']);
});

test('picker: Space (or the box) adds to the basket; RUN, white, shows only at two or more', async () => {
  const p = await picker();
  p.key(' ', p.card('[data-id="ipad"]'));
  assert.deepEqual(p.runs, [], 'Space never runs');
  assert.match(p.card('[data-id="ipad"]').getAttribute('class'), /\bis-on\b/, 'the card shows its check');
  assert.equal(p.card('[data-id="ipad"]').getAttribute('aria-selected'), 'true');
  assert.ok(p.card('[data-id="ipad"]').querySelector('[data-box]'), 'the small box');
  assert.equal(p.bar().hidden, true, 'one in the basket: no RUN');
  // The box: a click on it adds, it does not run.
  p.click(p.card('[data-id="macbookair"]').querySelector('[data-box]'));
  assert.deepEqual(p.runs, []);
  assert.equal(p.bar().hidden, false, 'two: RUN');
  assert.equal(p.run().textContent, 'RUN 2');
  assert.match(p.run().getAttribute('class'), /\bbtn-solid\b/, 'RUN is the white one');
  // A family: Space adds its first model (iPhone 6) and opens its chips; Space on a chip adds that one.
  p.key(' ', p.card('[data-fam="IPHONE"]'));
  assert.equal(p.run().textContent, 'RUN 3');
  assert.equal(p.card('[data-fam="IPHONE"]').querySelector('.wi-cname').textContent, 'iPhone 6');
  p.key(' ', p.shelf.querySelector('[data-chip="iphone8"]'));
  assert.equal(p.run().textContent, 'RUN 4');
  assert.equal(p.shelf.querySelector('[data-chip="iphone8"]').getAttribute('aria-pressed'), 'true');
  assert.match(p.el.querySelector('#wi-count').textContent, /^iPhone 6, iPhone 8, iPad \(first\), MacBook Air \(2008\)$/);
  // Space again drops it.
  p.key(' ', p.shelf.querySelector('[data-chip="iphone8"]'));
  assert.equal(p.run().textContent, 'RUN 3');
  // Another shelf keeps the basket; RUN runs all of it, in catalogue order.
  p.el.querySelector('.wi-tabs').dispatch('click', { target: p.el.querySelector('[data-value="VICES"]') });
  p.key(' ', p.card('[data-id="beer"]'));
  p.run().dispatch('click');
  assert.deepEqual(p.runs, ['WHATIF IPHONE6 IPAD MACBOOKAIR BEER:10Y']);
  // Only one white button on the picker.
  assert.equal(p.el.querySelectorAll('.btn-solid').length, 1);
  // Arrow keys move; [ and ] change the shelf.
  const q = await picker();
  q.key('ArrowRight', q.card('[data-fam="IPHONE"]'));
  assert.equal(q.card('[data-id="ipad"]').focused, true);
  q.key(']', q.card('[data-id="ipad"]'));
  assert.equal(q.el.querySelector('.seg-item.is-active').textContent, 'CARS');
});

test('picker: WHATIF EDIT fills the basket; WHATIF IPHONE puts every iPhone in it', async () => {
  const e = await picker(['EDIT', 'IPHONE6', 'LATTE:3Y']);
  assert.equal(e.bar().hidden, false);
  assert.equal(e.run().textContent, 'RUN 2');
  e.run().dispatch('click');
  assert.deepEqual(e.runs, ['WHATIF IPHONE6 LATTE:3Y']);
  const all = await picker(['IPHONE']);
  assert.equal(all.run().textContent, 'RUN 18');
  // Your own purchase from EDIT: a card on the shelf, in the basket; a click runs it alone.
  const m = await picker(['EDIT', 'IPHONE6', 'MY', '1200', 'AAPL', '2015']);
  const mine = m.card('[data-mine]');
  assert.ok(mine, 'your own purchase stays reachable');
  assert.equal(m.run().textContent, 'RUN 2');
  m.click(mine);
  assert.deepEqual(m.runs, ['WHATIF MY 1200 AAPL 2015']);
  m.key(' ', mine);
  assert.equal(m.bar().hidden, true, 'dropped from the basket, still on the shelf');
  assert.ok(m.card('[data-mine]'));
});

test('YOUR OWN: one line; it parses (whatif-mine.js) and Enter runs it; a line it cannot read says why', async () => {
  // Any order: a ticker, a date and dollars; or the command's own words.
  assert.deepEqual(ownWords('AAPL 2019-01-01 5000', NOW), ['MY', '5000', 'AAPL', '2019-01-01']);
  assert.deepEqual(ownWords('aapl 2019 5000', NOW), ['MY', '5000', 'AAPL', '2019']);
  assert.deepEqual(ownWords('5000 AAPL 2019', NOW), ['MY', '5000', 'AAPL', '2019']);
  assert.deepEqual(ownWords('$5,000 AAPL 2019-03', NOW), ['MY', '5000', 'AAPL', '2019-03']);
  assert.deepEqual(ownWords('AAPL $2,020 2015', NOW), ['MY', '2020', 'AAPL', '2015'], 'dollars marked with $ or a comma');
  assert.deepEqual(ownWords('WHATIF MY 1200 AAPL 2015', NOW), ['MY', '1200', 'AAPL', '2015']);
  assert.deepEqual(ownWords('5 A DAY SBUX SINCE 2018', NOW), ['MY', '5', 'A', 'DAY', 'SBUX', 'SINCE', '2018']);
  assert.throws(() => ownWords('', NOW), /Type a ticker, a date and dollars/);
  assert.throws(() => ownWords('AAPL 2099 5000', NOW), /in the future/);
  assert.throws(() => ownWords('AAPL banana', NOW), /./);

  const p = await picker();
  const input = p.el.querySelector('#wi-own-in');
  assert.equal(input.getAttribute('placeholder'), 'Your own: AAPL 2019-01-01 5000');
  input.value = 'AAPL 2019-01-01 5000';
  p.el.querySelector('[data-own]').dispatch('submit');
  assert.deepEqual(p.runs, ['WHATIF MY 5000 AAPL 2019-01-01']);
  input.value = 'AAPL 1200.50 2015';
  p.el.querySelector('[data-own]').dispatch('submit');
  assert.equal(p.runs.length, 1, 'not run');
  assert.match(p.el.querySelector('[data-own-msg]').textContent, /whole dollars|not an amount|not a date/i);
});

// ---- The result -------------------------------------------------------------------

const LAST = { AAPL: 255.46, NVDA: 178.19, SBUX: 84.5, BUD: 61.2 };
const quoteImpl = async (t) => ({ last: LAST[t] ?? 100, asOf: '2026-09-25T20:00:00Z' });
async function result(tokens) {
  const d = await getWhatif(tokens, { quoteImpl, chartImpl: async () => null, risk: true, now: NOW });
  const command = `WHATIF ${tokens.join(' ')}`;
  d.cert = certModel(d, catalog, command);
  return { d, html: resultHtml(d, { key: command, links: shareLinks(d.cert, 'https://bloombroke.com'), video: videoHtml(d, 'webcodecs') }) };
}

// Worked out on main (aee5b82) with the same fixed prices: nothing in this change may move them.
const FROZEN = {
  'IPHONE6': { paid: 649, value: 6568.682250396197, multiple: 10.121236133122029, shares: [25.713153724247228], jar: 461.1681861603678, cert: ['$6,569', 'You spent $649.00', '25.7 shares of Apple', '10.1x'] },
  'IPHONE6 RTX3080 LATTE:3Y': { paid: 7480.737700964628, value: 22215.801078284043, multiple: 2.969733997680383, shares: [25.713153724247228, 56.08376459261042, 66.90595047491831], jar: 6877.332533370037, cert: ['$22,216', 'You spent $7,481', 'in 3 companies', '3.0x'] },
  'BEER:10Y': { paid: 3739.2634499999995, value: 3375.7525478709476, multiple: 0.9027854263306716, shares: [55.159355357368426], jar: 3189.1626386530534, cert: ['$3,376', 'You spent $3,739', '55.2 shares of AB InBev', '0.9x'] },
};

test('every amount is the engine\'s, unchanged: IPHONE6, a basket of three, BEER:10Y', async () => {
  for (const [cmd, want] of Object.entries(FROZEN)) {
    const { d, html } = await result(cmd.split(' '));
    assert.equal(d.total.paid, want.paid, `${cmd} paid`);
    assert.equal(d.total.value, want.value, `${cmd} value`);
    assert.equal(d.total.multiple, want.multiple, `${cmd} multiple`);
    assert.deepEqual(d.rows.map((r) => r.shares), want.shares, `${cmd} shares`);
    assert.equal(d.replay.points.at(-1).jar, want.jar, `${cmd} jar`);
    assert.equal(d.replay.points.at(-1).stock, want.value, `${cmd}: the race ends on the result`);
    assert.deepEqual([d.cert.big, d.cert.spent, d.cert.holding, d.cert.multiple], want.cert, `${cmd} certificate`);
    // The page shows the certificate's words, the phone line the same numbers, the table the engine's.
    assert.ok(html.includes(`<div class="wc wc-big" data-fs="${d.cert.fit.big}">${want.cert[0]}</div>`), `${cmd}: the big amount`);
    assert.ok(html.includes(certLineHtml(d.cert)));
    const loss = d.total.value < d.total.paid;
    assert.equal(d.cert.loss, loss);
    assert.equal(certLine(d.cert), `${want.cert[1].replace('You spent', 'Spent')} · ${want.cert[2].replace(/ of .*$/, '').replace(/^in /, '')} · ${want.cert[3]}${loss ? ` · ${LOSS_WORDS}` : ''}`);
    assert.ok(html.includes(tableHtml(d)), `${cmd}: the table in + Details`);
  }
});

test('result: no sentence, one white SHARE, no SPENT line, an empty status line; the phone line', async () => {
  for (const cmd of Object.keys(FROZEN)) {
    const { html } = await result(cmd.split(' '));
    assert.doesNotMatch(html, /card-sub|You paid/, `${cmd}: no sentence`);
    assert.equal((html.match(/btn-solid/g) || []).length, 1, `${cmd}: one white button`);
    assert.match(html, /class="btn card-btn btn-solid" id="wi-share-btn" aria-haspopup="menu"[^>]*>SHARE</, `${cmd}: it is SHARE, opening the menu`);
    assert.doesNotMatch(html.split('<details')[0].replace(/<figure[\s\S]*?<\/figure>/, '').replace(/<p class="wi-certline[\s\S]*?<\/p>/, ''), /spent/i, `${cmd}: no SPENT outside the certificate and its phone line`);
    assert.ok(cardWords(html).length <= 12, `${cmd}: ${cardWords(html).join(' ')}`);
  }
  const replay = readFileSync('public/whatif-replay.js', 'utf8');
  assert.match(replay, /export const LINE_KEYS = \['stock', 'jar'\];/);
  assert.match(replay, /export const LINE_LABELS = \{ stock: 'STOCK', jar: 'CASH IN A JAR' \};/);
  // The status line: nothing on a result (old prices still warn), nothing on the picker.
  const js = readFileSync('public/screens/whatif.js', 'utf8');
  assert.doesNotMatch(js, /ctx\.status\(`WHATIF: \$\{/);
  assert.doesNotMatch(js, /PICKED'|PICKED`/);
  // The phone: the certificate keeps its title, the amount and "worth today"; one line under it.
  assert.equal(certLineHtml({ spent: 'You spent $649.00', holding: '25.7 shares of Apple', multiple: '13.4x' }), '<p class="wi-certline num" aria-hidden="true">Spent $649.00 · 25.7 shares · 13.4x</p>');
  const css = readFileSync('public/screens/whatif.css', 'utf8');
  assert.match(css, /\.wi-cert \.wc-receipt, \.wi-cert \.wc-l1, \.wi-cert \.wc-l2, \.wi-cert \.wc-seal \{ display: none; \}/);
  assert.doesNotMatch(css, /\.wc-(ribbon|big|today)[^{]*\{[^}]*display: none/, 'the title, the amount and "worth today" stay');
});

test('the share image and the download keep today\'s certificate (the engine and og files are not this change\'s)', () => {
  // /og/whatif.png draws from data/whatif-cert.js and lib/og.js; the page's phone rules are
  // CSS on .wi-cert only. The download is the same /og/whatif.png.
  const share = readFileSync('public/screens/whatif.js', 'utf8');
  assert.match(share, /image: `\/og\/whatif\.png\?\$\{new URLSearchParams\(\{ c: m\.command \}\)\}`/);
  assert.match(share, /href="\$\{esc\(links\.image\)\}" download="bloombroke-whatif\.png"/);
});

// ---- Review nits (Sep 29, second pass) --------------------------------------------------

test('Esc with the chips open: caught first on the document, whatever has the focus; the app never goes back', async () => {
  leaveAll();
  const p = await picker();
  let back = 0;
  // The app's own Esc (app.js, after the capture phase): back a screen unless the key was
  // already handled (default prevented, propagation stopped).
  const press = (target) => { const e = doc.key('Escape', target); if (!e.prevented && !e.stopped) back += 1; return e; };
  const before = doc.count('keydown');
  p.click(p.card('[data-fam="IPHONE"]'));
  assert.ok(p.tray());
  assert.equal(doc.count('keydown'), before + 1, 'listening while the chips are open');
  // The focus on RUN, on a shelf tab, on the page: each closes the chips and stops the key.
  for (const target of [p.run(), p.el.querySelector('[data-value="CARS"]'), p.el]) {
    if (!p.tray()) p.click(p.card('[data-fam="IPHONE"]'));
    const e = press(target);
    assert.ok(e.prevented && e.stopped, 'the key stops here');
    assert.equal(p.tray(), null, 'the chips close');
  }
  assert.equal(back, 0, 'never back a screen');
  assert.equal(doc.count('keydown'), before, 'removed once closed');
  // Closed: Esc is the app's again.
  press(p.el);
  assert.equal(back, 1);
  // Leaving the screen with the chips open removes it too.
  p.click(p.card('[data-fam="IPHONE"]'));
  assert.equal(doc.count('keydown'), before + 1);
  p.cleanups.forEach((f) => f());
  assert.equal(doc.count('keydown'), before);
});

test('Space and chip toggles change only the state: no card (and no picture) is drawn again', async () => {
  const p = await picker();
  const imgs = () => p.shelf.querySelectorAll('img');
  const first = imgs();
  p.key(' ', p.card('[data-id="ipad"]'));
  p.key(' ', p.card('[data-fam="IPHONE"]'));
  p.key(' ', p.shelf.querySelector('[data-chip="iphone8"]'));
  p.click(p.shelf.querySelector('[data-chip="iphone11"]').querySelector('[data-box]'));
  p.key(' ', p.card('[data-id="ipad"]'));
  const after = imgs();
  assert.equal(after.length, first.length);
  assert.ok(after.every((img, i) => img === first[i]), 'the same image elements');
  assert.equal(p.run().textContent, 'RUN 3');
  assert.equal(p.card('[data-fam="IPHONE"]').querySelector('.wi-cname').textContent, 'iPhone, 3 models');
  assert.equal(p.card('[data-id="ipad"]').getAttribute('aria-selected'), 'false');
});

test('phone: two cards a row, a new layout when the window crosses 639 px, the chips scroll to the one in the basket', async () => {
  leaveAll();
  phone.set(true);
  try {
    const p = await picker(['EDIT', 'IPHONE6']);
    const rows = () => p.shelf.querySelectorAll('.wi-row');
    assert.ok(rows().slice(0, -1).every((r) => r.querySelectorAll('.wi-card').length === 2), 'two a row');
    const phoneRows = rows().length;
    // Wider than a phone: four a row (fewer rows), the basket kept.
    phone.set(false);
    assert.ok(rows().slice(0, -1).every((r) => r.querySelectorAll('.wi-card').length === 4), 'four a row');
    assert.ok(rows().length < phoneRows);
    assert.equal(p.card('[data-fam="IPHONE"]').getAttribute('aria-selected'), 'true');
    phone.set(true);
    assert.equal(rows().length, phoneRows, 'two a row again');
    // The chips: iPhone 6 (the 7th chip) starts in the middle of the row.
    const at = (el) => (el.classList.contains('wi-chip') ? el.parent.children.indexOf(el) * 80 : 20);
    El.prototype.getBoundingClientRect = function rect() { return { left: at(this) }; };
    Object.defineProperty(El.prototype, 'clientWidth', { configurable: true, get() { return 300; } });
    Object.defineProperty(El.prototype, 'offsetWidth', { configurable: true, get() { return 70; } });
    p.click(p.card('[data-fam="IPHONE"]'));
    const row = p.tray().querySelector('.wi-chips-row');
    assert.equal(row.scrollLeft, chipScroll({ scrollLeft: 0, rowLeft: 20, rowWidth: 300, chipLeft: 6 * 80, chipWidth: 70 }));
    assert.equal(row.scrollLeft, 6 * 80 - 20 - (300 - 70) / 2);
    assert.match(row.getAttribute('class'), /\bscroll-x\b/, 'the row scrolls sideways, its edges fade');
    assert.equal(chipScroll({ scrollLeft: 0, rowLeft: 0, rowWidth: 300, chipLeft: 10, chipWidth: 70 }), 0, 'never before the start');
    const css = readFileSync('public/screens/whatif.css', 'utf8');
    assert.match(css, /@media \(max-width: 639px\) \{[\s\S]*?\.wi-chips-row \{ flex-wrap: nowrap; \}/);
  } finally {
    phone.set(false);
    delete El.prototype.getBoundingClientRect;
    delete El.prototype.clientWidth;
    delete El.prototype.offsetWidth;
  }
});

test('YOUR OWN: Enter runs it alone; ADD (an outline key) puts it in the basket to run with more', async () => {
  const p = await picker();
  const add = p.el.querySelector('[data-own-add]');
  assert.equal(add.tag, 'button');
  assert.equal(add.getAttribute('type'), 'button');
  assert.match(add.getAttribute('class'), /^btn wi-own-add$/, 'an outline key, not white');
  assert.equal(add.textContent, 'ADD');
  const input = p.el.querySelector('#wi-own-in');
  input.value = 'AAPL 2019-01-01 5000';
  p.el.querySelector('.wi-tabs').dispatch('click', { target: add });
  assert.deepEqual(p.runs, [], 'ADD does not run');
  assert.equal(input.value, '', 'the line is empty for the next one');
  const mine = p.card('[data-mine]');
  assert.ok(mine, 'a card of its own, first on the shelf');
  assert.equal(mine.getAttribute('aria-selected'), 'true');
  assert.equal(p.bar().hidden, true, 'one in the basket');
  p.key(' ', p.card('[data-id="ipad"]'));
  assert.equal(p.run().textContent, 'RUN 2');
  p.run().dispatch('click');
  assert.deepEqual(p.runs, ['WHATIF IPAD MY 5000 AAPL 2019-01-01']);
  // A line it cannot read: nothing added, the reason under it.
  input.value = 'AAPL 2099 5000';
  p.el.querySelector('.wi-tabs').dispatch('click', { target: add });
  assert.match(p.el.querySelector('[data-own-msg]').textContent, /in the future/);
  assert.equal(p.shelf.querySelectorAll('[data-mine]').length, 1);
  // Enter still runs it alone.
  input.value = '1200 MSFT 2015';
  p.el.querySelector('[data-own]').dispatch('submit');
  assert.equal(p.runs.at(-1), 'WHATIF MY 1200 MSFT 2015');
});

test('a loss on a phone: the line under the certificate says so, in the loss colour', async () => {
  const { d, html } = await result(['BEER:10Y']);
  assert.equal(d.cert.loss, true, 'fixed prices: BEER:10Y is below what was paid');
  assert.equal(certLine(d.cert), `Spent ${d.cert.spent.replace('You spent ', '')} · 55.2 shares · 0.9x · less than you paid`);
  assert.ok(html.includes(`<p class="wi-certline num" aria-hidden="true">Spent $3,739 · 55.2 shares · 0.9x · <span class="down">less than you paid</span></p>`));
  const { html: win } = await result(['IPHONE6']);
  assert.doesNotMatch(win, /less than you paid/);
  // The on-page certificate: a long name wraps to two lines before it is cut; a long title wraps.
  const css = readFileSync('public/screens/whatif.css', 'utf8');
  assert.match(css, /\.wc-receipt span \{\n  max-width: 10\.5cqw; white-space: normal; overflow: hidden;\n  display: -webkit-box; -webkit-line-clamp: 2;/);
  assert.doesNotMatch(css, /text-overflow: ellipsis; \}\n\/\* The title/);
  assert.match(css, /\.wc-ribbon \{ max-width: 36%; white-space: normal; line-height: 1\.05; \}/);
  assert.match(readFileSync('public/screens/whatif.js', 'utf8'), /n\.style\.fontSize = `max\(11px, \$\{v\}cqw\)`/, 'never under 11 px');
});
