// HOW TO PLAY: the shared pop-up (public/howto.js, howto.css) and GUESS's content for it
// (public/screens/guess.js). The pop-up in a page runs on a tiny fake DOM here; the real
// browser (flip, sizes, focus) is checked by hand with headless Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { howtoHtml, mountHowto, isHowtoKey, howtoSeen, markHowtoSeen, inFrame, consentBusy, afterConsent, MAX_LINES } from '../public/howto.js';
import { HOWTO, HOWTO_KEY, HOWTO_EXAMPLE, howtoSlots, howtoExampleHtml, howtoLinkHtml, cellHtml, rowsHtml, LEGEND, legendHtml, TRIES } from '../public/screens/guess.js';
import { hintCells, fmtMove, fmtCap, POOL } from '../data/guess.js';
import { cardWords } from '../public/kit.js';

const BRAND = new RegExp(['bloom', 'berg'].join(''), 'i');
const TYPE = [11, 12, 13, 14, 16, 18, 24];
const SPACE = [2, 4, 6, 8, 12, 16, 24, 32];

// What a reader sees: the site's word count (kit.js cardWords: numbers, prices and codes
// are not words), without the screen-reader-only words (.offscreen).
const seen = (html) => html.replace(/<span class="offscreen">[^<]*<\/span>/g, ' ');
const visibleWords = (html) => cardWords(seen(html));
// Every token a reader sees, numbers and signs too.
const allTokens = (html) => seen(html).replace(/<span class="gs-d" aria-hidden="true">[^<]*<\/span>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').split(/\s+/).filter(Boolean);

// ---- the content ---------------------------------------------------------------------------

test('GUESS how to play: the title, the goal, 3 lines, the example, a key of 3, the foot, PLAY', () => {
  assert.equal(HOWTO.title, 'How to play');
  assert.equal(HOWTO.goal, 'Find the mystery stock in 6 guesses.');
  assert.equal(TRIES, 6);
  assert.equal(HOWTO.lines.length, 3);
  assert.equal(MAX_LINES, 3);
  assert.equal(HOWTO.lines[0], 'Chart: its 1-year price, in %.');
  assert.equal(HOWTO.lines[1], 'Each guess gets 4 clues.');
  assert.match(HOWTO.lines[2], /Arrows point to the answer/);
  assert.deepEqual(HOWTO.legend.map((k) => [k.cls, k.label]), [['gs-cell g-hit', 'hit'], ['gs-cell g-near', 'near'], ['gs-cell g-miss', 'miss']]);
  assert.equal(HOWTO.foot, 'A new stock every day at midnight New York time.');
  assert.equal(HOWTO.button, 'PLAY');
  const html = howtoHtml(howtoSlots());
  // The slots in order.
  const order = ['howto-title', 'howto-goal', 'howto-lines', 'howto-ex', 'gs-howto-ex', 'howto-legend', 'howto-foot', ' howto-go"'].map((c) => html.indexOf(c));
  assert.ok(order.every((i) => i >= 0), String(order));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'slots in order');
  // The legend line's meaning is all in the pop-up now.
  for (const w of ['Arrows point to the answer', '>hit<', '>near<', '>miss<']) assert.ok(html.includes(w), w);
});

test('GUESS how to play: 45 visible words at most (the site\'s count), and the count', () => {
  const html = howtoHtml(howtoSlots());
  const words = visibleWords(html);
  assert.ok(words.length <= 45, `${words.length} words: ${words.join(' ')}`);
  assert.equal(words.length, 44, `the count reported: ${words.join(' ')}`);
  // Counting every number and sign too, for the record.
  // (54 with the key's sample letters, A A↑ A↓, which are not words.)
  assert.equal(allTokens(html).length, 54, allTokens(html).join(' '));
  // Screen-reader words and the arrows are not on show.
  assert.ok(!words.includes('Answer') && !words.includes('Green:'), words.join(' '));
});

test('GUESS how to play: the example is a real row, graded as data/guess.js grades it', () => {
  // Guess KO when the answer is MDLZ: both STAPLES; KO +6.2%, MDLZ 10 points higher; KO
  // $300B, MDLZ about $85B (under half); K is 2 letters before M.
  const byTicker = Object.fromEntries(POOL.map((m) => [m.ticker, m]));
  assert.equal(byTicker.KO.sector, 'STAPLES');
  assert.equal(byTicker.MDLZ.sector, 'STAPLES');
  const answer = { ticker: 'MDLZ', sector: 'STAPLES', move: 16.2, cap: 85e9 };
  const guess = { ticker: 'KO', sector: 'STAPLES', move: 6.2, cap: 300e9 };
  assert.deepEqual(hintCells(answer, guess), HOWTO_EXAMPLE.cells);
  assert.equal(fmtMove(6.2), '+6.2%');
  assert.equal(fmtCap(300e9), '$300B');
  // Every grade shows once at least, and both arrows.
  assert.deepEqual([...new Set(HOWTO_EXAMPLE.cells.map((c) => c.grade))].sort(), ['hit', 'miss', 'near']);
  const ex = howtoExampleHtml();
  for (const c of HOWTO_EXAMPLE.cells) assert.ok(ex.includes(cellHtml(c)), `the table's own cell: ${c.key}`);
  assert.match(ex, /<table class="gs-table gs-howto-ex"/);
  assert.match(ex, /↑/);
  assert.match(ex, /↓/);
  assert.match(ex, /<span class="gs-tk">KO<\/span>/);
  // Labelled like the real table: its own header row, the same four labels.
  const head = /<thead>([\s\S]*?)<\/thead>/.exec(ex)[1];
  assert.deepEqual([...head.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]), ['SECTOR', '1Y MOVE', 'SIZE', 'FIRST LETTER']);
  const real = /<thead>([\s\S]*?)<\/thead>/.exec(rowsHtml([]))[1];
  for (const h of ['SECTOR', '1Y MOVE', 'SIZE', 'FIRST LETTER']) assert.ok(real.includes(`<th scope="col">${h}</th>`), h);
  assert.ok(ex.indexOf('<thead>') < ex.indexOf('<tbody>'), 'labels above the cells');
});

test('GUESS how to play: markup and copy rules (no inline sizes, one primary button, no em dash, no emoji, no brand word)', () => {
  const html = howtoHtml(howtoSlots());
  assert.doesNotMatch(html, /style="/);
  assert.doesNotMatch(html, /font-size|\d+px/);
  assert.equal((html.match(/btn-solid/g) || []).length, 1, 'one primary button');
  assert.match(html, /<button type="button" class="btn card-btn btn-solid howto-go" data-howto-close autofocus>PLAY<\/button>/);
  const copy = [HOWTO.title, HOWTO.goal, ...HOWTO.lines, ...HOWTO.legend.map((k) => k.label), HOWTO.foot, HOWTO.button, howtoLinkHtml()].join(' ');
  for (const [name, s] of [['copy', copy], ['markup', html], ['howto.js', readFileSync('public/howto.js', 'utf8')], ['howto.css', readFileSync('public/howto.css', 'utf8')]]) {
    assert.doesNotMatch(s, /—/, `${name}: em dash`);
    assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, `${name}: emoji`);
    assert.doesNotMatch(s, BRAND, `${name}: brand word`);
  }
  // Text is escaped.
  assert.match(howtoHtml({ title: '<b>', lines: ['a & b'] }), /&lt;b&gt;[\s\S]*a &amp; b/);
  assert.equal((howtoHtml({ lines: ['1', '2', '3', '4'] }).match(/<li>/g) || []).length, 3, 'three lines at most');
});

test('GUESS how to play: the stylesheet is on the scales, px only; lines stay short', () => {
  const css = readFileSync('public/howto.css', 'utf8');
  const guessCss = readFileSync('public/screens/guess.css', 'utf8');
  const mine = guessCss.slice(guessCss.indexOf('/* HOW TO PLAY'), guessCss.indexOf('@media (max-width: 639px)'));
  for (const [file, text] of [['howto.css', css], ['guess.css HOW TO PLAY', mine]]) {
    assert.ok(text.length > 200, file);
    const body = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of body.matchAll(/font-size:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      assert.match(v, /^\d+px$/, `${file}: font-size ${v}`);
      assert.ok(TYPE.includes(parseInt(v, 10)), `${file}: font-size ${v} on the type scale`);
    }
    for (const m of body.matchAll(/(?:^|[\s;{])((?:margin|padding)(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap):\s*([^;}]+)/g)) {
      for (const part of m[2].trim().split(/\s+/)) {
        if (part === '0' || part === 'auto') continue;
        assert.match(part, /^\d+px$/, `${file}: ${m[1]} ${m[2]}`);
        assert.ok(SPACE.includes(parseInt(part, 10)), `${file}: ${m[1]} ${part} on the spacing scale`);
      }
    }
    for (const m of body.matchAll(/font-weight:\s*(\d+)/g)) assert.ok(['400', '600', '700'].includes(m[1]), `${file}: weight ${m[1]}`);
  }
  // 480 px wide at most: about 55 characters of 14 px text, under 70ch.
  assert.match(css, /\.howto \{[^}]*max-width: 480px/);
  // Reduced motion: no flip.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.howto-flip \.howto-ex td, \.howto-flip \.howto-ex td > \* \{ animation: none; \}/);
  // The cells flip one by one.
  const delays = [...css.matchAll(/td:nth-of-type\((\d)\)[^{]*\{ animation-delay: (\d+)ms/g)].map((m) => Number(m[2]));
  assert.ok(delays.length >= 4 && delays.every((d, i) => i === 0 || d > delays[i - 1]), String(delays));
});

// ---- the screen ------------------------------------------------------------------------------

test('GUESS: the legend line is now a How to play link (the legend stays in a DESK panel); howto.js loads with the screen only', () => {
  const link = howtoLinkHtml();
  assert.match(link, /<button type="button" class="card-link gs-howto" aria-haspopup="dialog" aria-keyshortcuts="\?">How to play<\/button><span class="gs-key" aria-hidden="true">\?<\/span>/);
  // After the game (no guess input, the focus in the command bar where ? is HELP): the link only.
  assert.equal(howtoLinkHtml(false), '<p class="gs-legend"><button type="button" class="card-link gs-howto" aria-haspopup="dialog">How to play</button></p>');
  assert.equal(legendHtml(), `<p class="gs-legend">${LEGEND}</p>`);
  const src = readFileSync('public/screens/guess.js', 'utf8');
  assert.ok(src.includes("${ctx.embed ? legendHtml() : howtoLinkHtml(!done)}"), 'the link, or the legend in a DESK panel');
  assert.ok(src.includes("loadModule('howto.js', { recover: false })"), 'loaded by name when the screen opens');
  assert.ok(src.includes("stylesOf('howto.js').map(loadCss)"), 'with its stylesheet');
  assert.ok(src.includes("fields: '.gs-in'"), '? in the guess input opens it (a guess never has a ?)');
  assert.ok(src.includes("focus: () => playBody.querySelector('.gs-in:not(:disabled)')"), 'on close the focus goes to the guess input');
  assert.equal(HOWTO_KEY, 'bb.guess.howto');
  // Never on the page from the start.
  const app = readFileSync('public/app.js', 'utf8');
  const index = readFileSync('public/index.html', 'utf8');
  assert.doesNotMatch(app, /howto/);
  assert.doesNotMatch(index, /howto/);
  assert.doesNotMatch(readFileSync('public/embed-guess.js', 'utf8'), /howto/i, 'not in /embed/guess');
});

// ---- the pop-up in a page (a tiny fake DOM) ------------------------------------------------------

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
class FakeObserver {
  static last = null;
  constructor(fn) { this.fn = fn; this.on = false; FakeObserver.last = this; }
  observe() { this.on = true; }
  disconnect() { this.on = false; }
  fire() { if (this.on) this.fn([]); }
}

function fakePage({ storage = memStorage(), consent = false, needed = false, framed = false, embed = false, coarse = false } = {}) {
  const docListeners = {};
  const el = (props = {}) => ({ closest: () => null, ...props });
  const page = { storage, consentEl: consent ? el() : null, needed, dialogs: [] };
  const cmd = el({ id: 'cmd', focus() { page.doc.activeElement = cmd; } });
  page.cmd = cmd;
  page.win = { localStorage: undefined, matchMedia: () => ({ matches: coarse }) };
  Object.defineProperty(page.win, 'localStorage', { get() { if (storage === blocked) throw new Error('denied'); return storage; } });
  page.win.self = page.win;
  page.win.top = framed ? {} : page.win;
  page.doc = {
    activeElement: null,
    documentElement: { classList: { contains: (c) => embed && c === 'is-embed' } },
    querySelector: (s) => (s === '.consent' ? page.consentEl : null),
    getElementById: (id) => (id === 'cmd' ? cmd : null),
    addEventListener(t, fn, cap) { (docListeners[t] ||= []).push({ fn, cap: Boolean(cap) }); },
    removeEventListener(t, fn, cap) { docListeners[t] = (docListeners[t] || []).filter((l) => l.fn !== fn || l.cap !== Boolean(cap)); },
    body: { appendChild(d) { d.connected = true; } },
    createElement(tag) {
      const ls = {};
      const d = {
        tag, open: false, connected: false, attrs: {}, className: '', innerHTML: '',
        setAttribute(k, v) { this.attrs[k] = v; },
        addEventListener(t, fn) { (ls[t] ||= []).push(fn); },
        dispatchEvent(e) { for (const fn of [...(ls[e.type] || [])]) fn(e); },
        showModal() { this.open = true; page.doc.activeElement = this; },
        close() { if (!this.open) return; this.open = false; this.dispatchEvent({ type: 'close' }); },
        remove() { this.connected = false; },
        fire(t, e) { for (const fn of [...(ls[t] || [])]) fn(e); },
      };
      page.dialogs.push(d);
      return d;
    },
  };
  page.openDialog = () => page.dialogs.find((d) => d.open && d.connected) || null;
  page.key = (key, target = el(), extra = {}) => {
    const e = { key, target, preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; }, ...extra };
    // Capture listeners on the document first, then (unless stopped) the bubbling ones.
    const ls = docListeners.keydown || [];
    for (const l of ls.filter((x) => x.cap)) l.fn(e);
    if (!e.stopped) for (const l of ls.filter((x) => !x.cap)) l.fn(e);
    return e;
  };
  page.keyListeners = () => (docListeners.keydown || []).filter((l) => l.cap).length;
  // app.js: Esc away from a text field goes BACK a screen (a bubbling listener).
  page.backs = 0;
  page.doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) page.backs += 1; });
  page.mount = (opts = {}) => mountHowto({ key: opts.key || 'bb.test.howto', slots: howtoSlots(), fields: '.gs-in', doc: page.doc, win: page.win, needed: () => page.needed, Observer: FakeObserver, ...opts });
  return page;
}
const button = (d) => ({ closest: (s) => (s === '[data-howto-close]' ? {} : null) });
let n = 0;
const freshKey = () => `bb.test${(n += 1)}.howto`;

test('how to play: shows once by itself; PLAY closes it, stores the key and puts the focus in the guess input', () => {
  const key = freshKey();
  const page = fakePage();
  const guessInput = { focus() { page.doc.activeElement = guessInput; } };
  const h = page.mount({ key, focus: () => guessInput });
  const d = page.openDialog();
  assert.ok(d, 'open on the first visit');
  assert.equal(d.tag, 'dialog');
  assert.match(d.className, /howto howto-flip/);
  assert.equal(d.attrs['aria-labelledby'], 'howto-title');
  assert.match(d.innerHTML, /How to play/);
  assert.equal(page.storage.getItem(key), null, 'stored when it closes, not before');
  d.fire('click', { target: button(d) });
  assert.equal(page.openDialog(), null, 'PLAY closes it');
  assert.equal(d.connected, false, 'and it leaves the page');
  assert.ok(page.storage.getItem(key), 'the key is stored');
  assert.equal(page.doc.activeElement, guessInput, 'the focus is in the guess input: the next thing is a guess');
  assert.equal(h.isOpen(), false);
  // Esc and the backdrop too.
  for (const how of ['esc', 'backdrop']) {
    page.cmd.focus();
    h.open();
    const d2 = page.openDialog();
    if (how === 'esc') page.key('Escape', d2);
    else d2.fire('click', { target: d2 });
    assert.equal(page.doc.activeElement, guessInput, how);
  }
  h.destroy();
  // No guess input (the game is over): the command bar.
  const over = fakePage();
  const h3 = over.mount({ key: freshKey(), focus: () => null });
  h3.close();
  assert.equal(over.doc.activeElement, over.cmd);
  h3.destroy();
  // The next visit: not by itself.
  const again = fakePage({ storage: page.storage });
  again.mount({ key });
  assert.equal(again.openDialog(), null);
  assert.equal(howtoSeen(key, again.win), true);
});

test('how to play: the link (open()) and ? open it again; ? is ignored while typing in the command bar', () => {
  const key = freshKey();
  const storage = memStorage();
  markHowtoSeen(key, { localStorage: storage });
  const page = fakePage({ storage });
  const h = page.mount({ key });
  assert.equal(page.openDialog(), null, 'seen: not by itself');
  // The link under the table calls open().
  assert.equal(h.open(), true);
  assert.ok(page.openDialog());
  assert.equal(h.open(), false, 'one at a time');
  h.close();
  assert.equal(page.openDialog(), null);
  // ? in the command bar: typed there, nothing opens.
  const inBar = page.key('?', page.cmd);
  assert.equal(page.openDialog(), null);
  assert.notEqual(inBar.prevented, true, 'the ? goes into the command bar');
  // ? in another text field: typed there too.
  page.key('?', { closest: (s) => (s.includes('input') ? {} : null) });
  assert.equal(page.openDialog(), null);
  // ? with Ctrl, Cmd or Alt, or while an IME composes: not ours.
  page.key('?', undefined, { ctrlKey: true });
  page.key('?', undefined, { isComposing: true });
  assert.equal(page.openDialog(), null);
  // ? anywhere else: opens, and the ? never reaches the command bar.
  const e = page.key('?');
  assert.ok(page.openDialog());
  assert.equal(e.prevented, true);
  assert.equal(e.stopped, true);
  h.close();
  // ? in the guess input opens it (a guess never has a ?).
  const gsIn = { closest: (s) => (s === '.gs-in' || s.includes('input') ? {} : null) };
  page.key('?', gsIn);
  assert.ok(page.openDialog());
  h.destroy();
  assert.equal(page.openDialog(), null, 'leaving the screen closes it');
  assert.equal(page.keyListeners(), 0, 'and ? is not ours any more');
});

test('how to play: isHowtoKey is the site\'s hotkey rule', () => {
  const body = { closest: () => null };
  assert.equal(isHowtoKey({ key: '?', target: body }), true);
  assert.equal(isHowtoKey({ key: '/', target: body }), false);
  assert.equal(isHowtoKey({ key: '?', target: { id: 'cmd', closest: () => ({}) } }, 'input'), false, 'never in the command bar, even when a field selector matches');
  assert.equal(isHowtoKey({ key: '?', target: { closest: (s) => (s.includes('textarea') ? {} : null) } }), false);
  assert.equal(isHowtoKey({ key: '?', target: null }), false);
  assert.equal(isHowtoKey(null), false);
});

test('how to play: waits for the WELCOME card, never on top of it', () => {
  const key = freshKey();
  const page = fakePage({ consent: true, needed: true });
  const h = page.mount({ key });
  assert.equal(page.openDialog(), null, 'not while the card is up');
  // The card is accepted: the record first, then the card leaves the page.
  page.needed = false;
  FakeObserver.last.fire();
  assert.equal(page.openDialog(), null, 'still on the page');
  page.consentEl = null;
  FakeObserver.last.fire();
  assert.ok(page.openDialog(), 'opens once the card is gone');
  assert.equal(FakeObserver.last.on, false, 'stops watching');
  h.destroy();
  // The notice still needed but the card not up yet (its chips loading): waits too.
  const early = fakePage({ needed: true });
  const h2 = early.mount({ key: freshKey() });
  assert.equal(early.openDialog(), null);
  h2.destroy();
  assert.equal(FakeObserver.last.on, false, 'leaving the screen stops the wait');
  early.needed = false;
  FakeObserver.last.fire();
  assert.equal(early.openDialog(), null, 'gone: never opens');
  assert.equal(consentBusy({ querySelector: () => null }, () => false), false);
  assert.equal(consentBusy({ querySelector: () => ({}) }, () => false), true);
  // Without MutationObserver it checks now and then.
  let busy = true;
  let opened = 0;
  const stop = afterConsent(() => { opened += 1; }, { doc: { querySelector: () => null }, needed: () => busy, Observer: null, every: 5 });
  busy = false;
  return new Promise((r) => setTimeout(r, 30)).then(() => { stop(); assert.equal(opened, 1); });
});

test('how to play: Esc closes it (and never reaches the terminal); so does a click on the backdrop', () => {
  const page = fakePage();
  const h = page.mount({ key: freshKey() });
  const d = page.openDialog();
  const inside = { closest: () => null };
  d.fire('click', { target: inside });
  assert.ok(page.openDialog(), 'a click inside the box keeps it open');
  assert.equal(d.attrs.tabindex, '-1', 'a click on its text keeps the focus in it');
  const esc = page.key('Escape', inside);
  assert.equal(page.openDialog(), null, 'Esc closes it');
  assert.equal(page.backs, 0, 'and the terminal does not go back');
  assert.equal(esc.prevented, true, 'the terminal does not go back a screen');
  assert.equal(esc.stopped, true);
  h.open();
  const d2 = page.openDialog();
  page.key('a', d2);
  assert.ok(page.openDialog(), 'other keys do nothing');
  d2.fire('click', { target: d2 });
  assert.equal(page.openDialog(), null, 'the backdrop closes it');
  h.destroy();
});

test('how to play: never in a DESK panel, a frame or embed mode; a blocked storage never breaks it', () => {
  for (const opts of [{ framed: true }, { embed: true }]) {
    const page = fakePage(opts);
    const h = page.mount({ key: freshKey() });
    assert.equal(page.openDialog(), null, JSON.stringify(opts));
    assert.equal(h.open(), false, 'not by the link or ? either');
    page.key('?');
    assert.equal(page.openDialog(), null);
    h.destroy();
  }
  assert.equal(inFrame({ get top() { throw new Error('cross-origin'); }, self: {} }, null), true, 'a frame it cannot look out of');
  // Storage that throws: it still shows, closes, and is remembered for this page.
  const key = freshKey();
  const page = fakePage({ storage: blocked });
  assert.equal(howtoSeen(key, page.win), false);
  const h = page.mount({ key });
  assert.ok(page.openDialog());
  h.close();
  assert.equal(page.openDialog(), null);
  assert.equal(howtoSeen(key, page.win), true, 'this page remembers');
  h.destroy();
  // On a touch screen the focus stays put (no keyboard pops up).
  const touch = fakePage({ coarse: true });
  const t = touch.mount({ key: freshKey() });
  t.close();
  assert.notEqual(touch.doc.activeElement, touch.cmd);
  t.destroy();
});

test('how to play: without showModal it still opens and closes', () => {
  const page = fakePage();
  const make = page.doc.createElement.bind(page.doc);
  page.doc.createElement = (tag) => { const d = make(tag); delete d.showModal; d.close = undefined; return d; };
  const h = page.mount({ key: freshKey() });
  const d = page.dialogs.at(-1);
  assert.equal(d.attrs.open, '');
  assert.equal(h.isOpen(), true);
  h.close();
  assert.equal(h.isOpen(), false);
  assert.equal(d.connected, false);
  h.destroy();
});

test('how to play: Esc with the focus on the page (a click on its text) closes it and never goes BACK', () => {
  const page = fakePage();
  const h = page.mount({ key: freshKey() });
  assert.ok(page.openDialog());
  const body = { closest: () => null };
  page.doc.activeElement = body;
  const e = page.key('Escape', body);
  assert.equal(page.openDialog(), null, 'closed');
  assert.equal(e.prevented, true);
  assert.equal(e.stopped, true);
  assert.equal(page.backs, 0, 'app.js never saw it: no BACK');
  // Closed: the Esc handler is gone, Esc is the terminal's again.
  page.key('Escape', body);
  assert.equal(page.backs, 1);
  h.open();
  h.destroy();
  assert.equal(page.keyListeners(), 0, 'destroy removes ? and Esc');
});

test('how to play: never opened by hand on top of the WELCOME card', () => {
  const key = freshKey();
  const storage = memStorage();
  markHowtoSeen(key, { localStorage: storage });
  const page = fakePage({ storage, consent: true });
  const h = page.mount({ key });
  assert.equal(h.open(), false, 'the link does nothing while the card is up');
  page.key('?');
  assert.equal(page.openDialog(), null, 'nor ?');
  page.consentEl = null;
  assert.equal(h.open(), true, 'once the card is gone it opens');
  h.destroy();
  // Without any storage the notice always reads as needed: the link still works.
  const bare = fakePage({ storage: blocked, needed: true });
  const b = bare.mount({ key: freshKey(), auto: false });
  assert.equal(b.open(), true);
  b.destroy();
});
