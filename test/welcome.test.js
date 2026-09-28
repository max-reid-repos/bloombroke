// WELCOME: the first-visit card (public/consent.js + public/screens/welcome.js) and the
// rolling hints in the command bar (public/hints.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCommand } from '../public/app.js';
import { TERMS_VERSION } from '../public/legal-version.js';
import { ensureConsent, commitWelcome, welcomeHtml, consentStore, needsConsent, CONSENT_KEY, CONSENT_TEXT } from '../public/consent.js';
import * as welcome from '../public/screens/welcome.js';
import { GOALS, GOAL_PROPS, cleanProps } from '../public/goal.js';
import { HINTS, MARKET_HINTS, QUIRKY_HINTS, HINT_KEY, HINT_STOP, startHints, triedCount, countTried, hintsDone } from '../public/hints.js';

const { WELCOME_CHIPS, SURPRISE_PICKS, pickSurprise, chipChoice, chipNav, chipsHtml } = welcome;
const BANNED = new RegExp(['bloom', 'berg'].join(''), 'i');

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const brokenStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
// goal() options that send to a fake DataFast and nowhere else.
function fakeGoals() {
  const sent = [];
  return { sent, opts: { win: { datafast: (...a) => sent.push(a) }, nav: {}, fetchImpl: undefined, pro: () => false } };
}

// ---- the record of acceptance ---------------------------------------------------

test('welcome: continuing records the acceptance with the current version, whatever the way', () => {
  for (const choice of [{ cmd: '' }, { cmd: 'nvidia' }, { cmd: 'GUESS', chip: 'guess' }, { cmd: 'SECTORS MAP', surprise: 'sectors' }]) {
    const local = memStorage();
    const store = consentStore({ local, session: memStorage() });
    assert.equal(needsConsent(store.get()), true);
    const { opts } = fakeGoals();
    const cmd = commitWelcome(choice, { store, now: () => new Date('2026-09-28T10:00:00Z'), goalOpts: opts });
    const rec = JSON.parse(local.getItem(CONSENT_KEY));
    assert.deepEqual(rec, { version: TERMS_VERSION, acceptedAt: '2026-09-28T10:00:00.000Z' });
    assert.equal(needsConsent(store.get()), false, 'accepted');
    assert.equal(cmd, String(choice.cmd).trim());
  }
});

test('welcome: goals: welcome_chip with the chip, welcome_surprise with the kind, welcome_typed with nothing', () => {
  const { sent, opts } = fakeGoals();
  const store = consentStore({ local: memStorage() });
  commitWelcome({ cmd: 'GUESS', chip: 'guess' }, { store, goalOpts: opts });
  commitWelcome({ cmd: 'PIZZA', surprise: 'weird' }, { store, goalOpts: opts });
  commitWelcome({ cmd: 'my secret words' }, { store, goalOpts: opts });
  commitWelcome({ cmd: '   ' }, { store, goalOpts: opts });
  assert.deepEqual(sent, [['welcome_chip', { chip: 'guess' }], ['welcome_surprise', { kind: 'weird' }], ['welcome_typed']], 'never the words typed; START alone sends nothing');
  for (const g of ['welcome_chip', 'welcome_typed', 'welcome_surprise']) assert.ok(GOALS.includes(g), g);
  assert.deepEqual(GOAL_PROPS.welcome_chip, ['chip']);
  assert.deepEqual(GOAL_PROPS.welcome_surprise, ['kind']);
  for (const c of WELCOME_CHIPS) assert.deepEqual(cleanProps('welcome_chip', { chip: c.chip }), { chip: c.chip }, `${c.chip} is a short fixed label`);
  for (const k of new Set(SURPRISE_PICKS.map((p) => p.kind))) assert.deepEqual(cleanProps('welcome_surprise', { kind: k }), { kind: k });
});

// ---- the chips -------------------------------------------------------------------

test('welcome: four chips, each a real command with a 2-4 word caption', () => {
  assert.deepEqual(WELCOME_CHIPS.map((c) => c.cmd), ['GUESS', 'WHATIF IPHONE6', 'GRAVEYARD', 'AAPL 1Y']);
  for (const c of WELCOME_CHIPS) {
    const p = parseCommand(c.cmd);
    assert.equal(p.error, undefined, c.cmd);
    assert.notEqual(p.name, 'UNKNOWN', c.cmd);
    const words = c.cap.split(/\s+/).length;
    assert.ok(words >= 2 && words <= 4, `${c.cmd}: ${c.cap}`);
  }
  assert.equal(parseCommand('AAPL 1Y').name, 'QUOTE');
});

test('welcome: a chip means accept and run its command', () => {
  WELCOME_CHIPS.forEach((c, i) => assert.deepEqual(chipChoice({ dataset: { chip: String(i) } }), { cmd: c.cmd, chip: c.chip }));
  assert.equal(chipChoice({ dataset: { chip: '9' } }), null);
  assert.equal(chipChoice(null), null);
  const s = chipChoice({ dataset: { surprise: '1' } }, () => 0);
  assert.ok(SURPRISE_PICKS.some((p) => p.cmd === s.cmd && p.kind === s.surprise));
});

test('welcome: SURPRISE ME picks only from its allow-list, and every kind comes up', () => {
  const allowed = new Set(SURPRISE_PICKS.map((p) => p.cmd));
  const kinds = new Set();
  for (const r of [0, 0.1, 0.25, 0.3, 0.5, 0.6, 0.75, 0.9, 0.999999, 1, -1, NaN, Infinity, 'x']) {
    const p = pickSurprise(() => r);
    assert.ok(allowed.has(p.cmd), `${r}: ${p.cmd}`);
    kinds.add(p.kind);
  }
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 500; i++) { const p = pickSurprise(rand); assert.ok(allowed.has(p.cmd)); kinds.add(p.kind); }
  assert.deepEqual([...kinds].sort(), ['graveyard', 'sectors', 'weird', 'whatif']);
});

test('welcome: the allow-list is fun commands that exist (gauges, stones, WHATIF items, SECTORS MAP)', () => {
  const stones = new Set(JSON.parse(readFileSync('data/graveyard.json', 'utf8')).map((e) => e.ticker));
  const cat = JSON.parse(readFileSync('data/whatif-products.json', 'utf8'));
  const items = new Set([...cat.products, ...cat.recurring].map((p) => p.id.toUpperCase()));
  for (const { cmd, kind } of SURPRISE_PICKS) {
    const p = parseCommand(cmd);
    assert.equal(p.error, undefined, cmd);
    if (kind === 'weird') assert.ok(!cmd.includes(' ') && p.name === cmd, cmd);
    if (kind === 'graveyard') { assert.equal(p.name, 'GRAVEYARD'); assert.ok(stones.has(p.args.ticker), cmd); }
    if (kind === 'whatif') { assert.equal(p.name, 'WHATIF'); assert.ok(items.has(cmd.split(' ')[1]), cmd); }
    if (kind === 'sectors') assert.deepEqual([p.name, p.args.view], ['SECTORS', 'MAP']);
  }
});

test('welcome: arrows move between the chips, Down from the input, Up back to it', () => {
  const n = WELCOME_CHIPS.length + 1; // and SURPRISE ME
  assert.equal(chipNav(-1, 'ArrowDown', n), 0);
  assert.equal(chipNav(-1, 'ArrowLeft', n), null, 'the input keeps its own arrows');
  assert.equal(chipNav(-1, 'ArrowRight', n), null);
  assert.equal(chipNav(0, 'ArrowRight', n), 1);
  assert.equal(chipNav(1, 'ArrowDown', n), 2);
  assert.equal(chipNav(n - 1, 'ArrowRight', n), n - 1, 'stops at the end');
  assert.equal(chipNav(2, 'ArrowLeft', n), 1);
  assert.equal(chipNav(0, 'ArrowUp', n), -1, 'back to the input');
  assert.equal(chipNav(3, 'Home', n), 0);
  assert.equal(chipNav(0, 'End', n), n - 1);
  assert.equal(chipNav(0, 'a', n), null);
});

// ---- the card's words ---------------------------------------------------------------

const visibleText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

test('welcome: the legal line is on the card, readable before any chip, with the three links', () => {
  const html = welcomeHtml(welcome);
  const legal = html.indexOf('id="consent-body"');
  assert.ok(legal > html.indexOf('wc-surprise'), 'under the chips');
  const text = visibleText(html);
  assert.ok(text.includes('Information only, not advice. By continuing you agree to the Terms and Privacy Policy and confirm you are 18+.'), text);
  for (const href of ['/terms', '/privacy', '/disclaimer']) assert.ok(html.includes(`href="${href}"`), href);
  assert.match(html, /aria-describedby="consent-body"/);
  assert.equal(CONSENT_TEXT.title, 'BLOOMBROKE');
  assert.ok(CONSENT_TEXT.line.split(/\s+/).length <= 12);
  // Without the chips module the card still shows the legal line, the input and START.
  const bare = welcomeHtml(null);
  assert.ok(visibleText(bare).includes('confirm you are 18+'));
  assert.match(bare, /consent-input/);
  assert.match(bare, /consent-accept/);
  assert.doesNotMatch(bare, /wc-chip/);
});

test('welcome: at most 60 words on the card; house rules in the new files', () => {
  const words = visibleText(welcomeHtml(welcome)).split(' ').filter((w) => /\w/.test(w));
  assert.ok(words.length <= 60, `${words.length} words`);
  for (const f of ['public/consent.js', 'public/screens/welcome.js', 'public/screens/welcome.css', 'public/hints.js']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, BANNED, f);
    assert.doesNotMatch(s, /—/, `${f}: no em dash`);
    assert.doesNotMatch(s, /amber|orange|#ffb|#f90|hsla?\((2\d|3\d|4\d|5\d),/i, `${f}: no amber`);
    assert.doesNotMatch(s, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${f}: no emoji`);
  }
  const copy = visibleText(welcomeHtml(welcome)) + ' ' + chipsHtml() + ' ' + HINTS.join(' ');
  assert.doesNotMatch(copy, /\b(should|recommend|best stock|buy now|sell now|guaranteed)\b/i, 'no advice wording');
});

// ---- the card in a page (a tiny fake DOM) ------------------------------------------------

function fakePage({ coarse = false, typed = '' } = {}) {
  const listeners = { win: {}, doc: {} };
  const on = (bag) => (type, fn) => { (bag[type] ||= []).push(fn); };
  const off = (bag) => (type, fn) => { bag[type] = (bag[type] || []).filter((f) => f !== fn); };
  const el = (props = {}) => ({ focus() { page.doc.activeElement = this; }, addEventListener: on(props.bag = {}), ...props });
  const cmd = el({ id: 'cmd', value: typed });
  const page = {
    listeners,
    cmd,
    appended: [],
    win: { location: { pathname: '/' }, matchMedia: () => ({ matches: coarse }), addEventListener: on(listeners.win), removeEventListener: off(listeners.win) },
    doc: {
      activeElement: cmd,
      getElementById: (id) => (id === 'cmd' ? cmd : null),
      addEventListener: on(listeners.doc),
      removeEventListener: off(listeners.doc),
      contains: () => true,
      body: {
        appendChild(wrap) { page.appended.push(wrap); wrap.isConnected = true; },
      },
      createElement() {
        const wrap = el({ className: '', parts: {}, remove() { this.isConnected = false; } });
        Object.defineProperty(wrap, 'innerHTML', {
          set(html) {
            wrap.html = html;
            const chips = [...html.matchAll(/data-(chip|surprise)="(\d+)"/g)].map(([, k, v]) => el({ dataset: { [k]: v }, closest() { return this; } }));
            wrap.parts = { '.consent-input': el({ value: '' }), '.consent-accept': el({ tagName: 'BUTTON' }), '.consent-box': el({}), '.consent-bar': el({}), chips };
          },
        });
        wrap.querySelector = (s) => wrap.parts[s] || null;
        wrap.querySelectorAll = (s) => (s.includes('wc-chip') ? wrap.parts.chips : []);
        wrap.contains = (x) => Object.values(wrap.parts).flat().includes(x);
        return wrap;
      },
    },
  };
  page.fire = (bag, type, e) => { for (const fn of [...(bag[type] || [])]) fn(e); };
  page.key = (key, extra = {}) => {
    const e = { key, preventDefault() { e.prevented = true; }, stopImmediatePropagation() { e.stopped = true; }, ...extra };
    page.fire(listeners.win, 'keydown', e);
    return e;
  };
  return page;
}

test('welcome card: a chip accepts and runs (its command lands in the command bar), with the version', async () => {
  const page = fakePage();
  const local = memStorage();
  const store = consentStore({ local });
  const { sent, opts } = fakeGoals();
  const done = ensureConsent({ doc: page.doc, win: page.win, store, ready: () => welcome, goalOpts: opts });
  const wrap = page.appended[0];
  assert.ok(wrap && wrap.className.includes('consent-welcome'), 'shown at once when the chips are here');
  assert.equal(page.doc.activeElement, wrap.parts['.consent-input'], 'typing goes to the card\'s input');
  const graveyard = wrap.parts.chips[2];
  page.fire(wrap.bag, 'click', { target: graveyard });
  assert.equal(await done, true);
  assert.equal(page.cmd.value, 'GRAVEYARD', 'app.js runs what is in the bar');
  assert.equal(JSON.parse(local.getItem(CONSENT_KEY)).version, TERMS_VERSION);
  assert.equal(wrap.isConnected, false, 'the card is gone');
  assert.deepEqual(sent, [['welcome_chip', { chip: 'graveyard' }]]);
  assert.equal((page.listeners.win.keydown || []).length, 0, 'keys go back to the terminal');
});

test('welcome card: Enter in the input accepts and runs what is typed; keys never reach the terminal', async () => {
  const page = fakePage({ typed: 'tes' });
  const store = consentStore({ local: memStorage() });
  const { sent, opts } = fakeGoals();
  const done = ensureConsent({ doc: page.doc, win: page.win, store, ready: () => welcome, goalOpts: opts });
  const wrap = page.appended[0];
  const field = wrap.parts['.consent-input'];
  assert.equal(field.value, 'tes', 'words typed before the card carry over');
  // A letter typed while a chip has focus goes to the input.
  wrap.parts.chips[0].focus();
  const e = page.key('l');
  assert.equal(e.stopped, true);
  assert.equal(field.value, 'tesl');
  assert.equal(page.doc.activeElement, field);
  // Arrow Down from the input: the first chip. Up: back.
  page.key('ArrowDown');
  assert.equal(page.doc.activeElement, wrap.parts.chips[0]);
  page.key('ArrowUp');
  assert.equal(page.doc.activeElement, field);
  field.value = 'tesla';
  const enter = page.key('Enter');
  assert.equal(enter.prevented, true);
  assert.equal(await done, true);
  assert.equal(page.cmd.value, 'tesla');
  assert.equal(needsConsent(store.get()), false);
  assert.deepEqual(sent, [['welcome_typed']]);
});

test('welcome card: Enter on a chip runs that chip; SURPRISE ME runs an allowed pick', async () => {
  const page = fakePage();
  const store = consentStore({ local: memStorage() });
  const { opts } = fakeGoals();
  const done = ensureConsent({ doc: page.doc, win: page.win, store, ready: () => welcome, rand: () => 0.99, goalOpts: opts });
  const wrap = page.appended[0];
  wrap.parts.chips[4].focus(); // SURPRISE ME
  page.key('Enter');
  assert.equal(await done, true);
  assert.ok(SURPRISE_PICKS.some((p) => p.cmd === page.cmd.value), page.cmd.value);
});

test('welcome card: on a phone the focus rests on the card, not the input', async () => {
  const page = fakePage({ coarse: true });
  const store = consentStore({ local: memStorage() });
  const done = ensureConsent({ doc: page.doc, win: page.win, store, ready: () => welcome, goalOpts: fakeGoals().opts });
  const wrap = page.appended[0];
  assert.equal(page.doc.activeElement, wrap.parts['.consent-box']);
  page.fire(wrap.parts['.consent-bar'].bag, 'submit', { preventDefault() {} }); // START
  assert.equal(await done, true);
  assert.equal(page.cmd.value, '', 'START alone: HOME, nothing to run');
});

test('welcome card: waits for its chips; Enter before it shows accepts nothing; no chips still works', async () => {
  const page = fakePage();
  const store = consentStore({ local: memStorage() });
  let release;
  const load = () => new Promise((r) => { release = r; });
  const done = ensureConsent({ doc: page.doc, win: page.win, store, ready: () => null, load, goalOpts: fakeGoals().opts });
  assert.equal(page.appended.length, 0, 'not yet');
  page.key('g');
  const early = page.key('Enter');
  assert.equal(early.stopped, true);
  assert.equal(needsConsent(store.get()), true, 'nothing accepted before the card shows');
  await Promise.resolve();
  release(null); // the chips did not load
  await new Promise((r) => setTimeout(r, 0));
  const wrap = page.appended[0];
  assert.ok(wrap, 'the card shows anyway');
  assert.equal(wrap.className, 'consent', 'plain card, no chips');
  assert.equal(wrap.parts['.consent-input'].value, 'g', 'the letter typed meanwhile is kept');
  page.key('Enter');
  assert.equal(await done, true);
  assert.equal(page.cmd.value, 'g');
});

test('welcome card: not shown on the legal pages or once accepted', async () => {
  const page = fakePage();
  const local = memStorage();
  local.setItem(CONSENT_KEY, JSON.stringify({ version: TERMS_VERSION, acceptedAt: new Date().toISOString() }));
  assert.equal(await ensureConsent({ doc: page.doc, win: page.win, store: consentStore({ local }), ready: () => welcome }), false);
  page.win.location.pathname = '/terms';
  assert.equal(await ensureConsent({ doc: page.doc, win: page.win, store: consentStore({ local: memStorage() }), ready: () => welcome }), false);
  assert.equal(page.appended.length, 0);
});

// ---- rolling hints -------------------------------------------------------------------------

function clock() {
  let t = 0;
  let q = [];
  let id = 0;
  return {
    schedule: (fn, ms) => { id += 1; q.push({ id, at: t + ms, fn }); return id; },
    cancel: (x) => { q = q.filter((j) => j.id !== x); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at);
        const j = q[0];
        if (!j || j.at > end) break;
        q.shift();
        t = j.at;
        j.fn();
      }
      t = end;
    },
    get pending() { return q.length; },
  };
}

test('hints: typed out letter by letter, held, then the next; stop puts the plain placeholder back', () => {
  const c = clock();
  const input = { placeholder: 'Type a command' };
  const h = startHints({ input, schedule: c.schedule, cancel: c.cancel, every: 3000, typeMs: 40 });
  assert.equal(input.placeholder, 'T', 'typing starts at once');
  c.advance(40);
  assert.equal(input.placeholder, 'Tr');
  c.advance(40 * HINTS[0].length);
  assert.equal(input.placeholder, HINTS[0]);
  c.advance(3000);
  assert.ok(HINTS[1].startsWith(input.placeholder) && input.placeholder.length < HINTS[1].length, input.placeholder);
  c.advance(40 * HINTS[1].length);
  assert.equal(input.placeholder, HINTS[1]);
  h.stop();
  assert.equal(input.placeholder, 'Type a command');
  assert.equal(c.pending, 0, 'no timer left');
  assert.equal(h.running, false);
});

test('hints: reduced motion swaps whole hints every few seconds', () => {
  const c = clock();
  const input = { placeholder: 'plain' };
  const seen = [];
  startHints({ input, reduced: () => true, schedule: c.schedule, cancel: c.cancel, every: 3000 });
  seen.push(input.placeholder);
  for (let i = 0; i < HINTS.length; i++) { c.advance(1000); seen.push(input.placeholder); c.advance(2000); seen.push(input.placeholder); }
  for (const s of seen) assert.ok(HINTS.includes(s), `a whole hint: ${s}`);
  assert.equal(new Set(seen).size, HINTS.length, 'all of them, in turn');
});

test('hints: typing (or a focused bar on a phone) holds the hint; empty again, it rolls on', () => {
  const c = clock();
  const input = { placeholder: 'plain', value: '' };
  let focused = false;
  startHints({ input, paused: () => input.value !== '' || focused, schedule: c.schedule, cancel: c.cancel, every: 3000, typeMs: 40 });
  c.advance(80);
  input.value = 'A'; // typing starts mid-hint: the whole hint, then it waits
  c.advance(40);
  assert.equal(input.placeholder, HINTS[0]);
  c.advance(30_000);
  assert.equal(input.placeholder, HINTS[0], 'held while typing');
  input.value = '';
  focused = true;
  c.advance(30_000);
  assert.equal(input.placeholder, HINTS[0], 'held while the bar has focus');
  focused = false;
  c.advance(3000 + 40 * HINTS[1].length);
  assert.equal(input.placeholder, HINTS[1], 'rolls on');
});

test('hints: stop for good after three commands; returning visitors never see them; storage may fail', () => {
  const s = memStorage();
  assert.equal(hintsDone({ storage: s }), false);
  assert.equal(countTried(s), 1);
  assert.equal(countTried(s), 2);
  assert.equal(hintsDone({ storage: s }), false);
  assert.equal(countTried(s), HINT_STOP);
  assert.equal(hintsDone({ storage: s }), true, 'three run: done');
  assert.equal(countTried(s), HINT_STOP, 'the count stops there');
  assert.equal(s.getItem(HINT_KEY), String(HINT_STOP));
  assert.equal(hintsDone({ storage: memStorage(), historyLength: 3 }), true, 'three recent commands saved already');
  assert.equal(hintsDone({ storage: memStorage(), historyLength: 2 }), false);
  // Blocked storage: never throws, and the page's own count still stops them.
  assert.equal(triedCount(brokenStorage), 0);
  assert.equal(hintsDone({ storage: brokenStorage }), false);
  let n = 0;
  for (let i = 0; i < 3; i++) n = countTried(brokenStorage, n);
  assert.equal(n, HINT_STOP);
  const garbage = memStorage();
  garbage.setItem(HINT_KEY, 'lots');
  assert.equal(triedCount(garbage), 0);
});

test('hints: the list and app.js wiring', () => {
  assert.deepEqual(HINTS, ['Try AAPL 1Y', 'Try GRAVEYARD', 'Try FX 500 USD THB', 'Try GUESS', 'Try WHY NVDA', 'Try SECTORS MAP', 'Try CPI', 'Try WHATIF IPHONE6', 'Try GOLD', 'Try WEIRD']);
  // A market command, then a quirky one, in turn, all the way round (the list wraps too).
  HINTS.forEach((h, i) => assert.ok((i % 2 ? QUIRKY_HINTS : MARKET_HINTS).includes(h), `${i}: ${h}`));
  assert.equal(HINTS.length % 2, 0, 'the last (quirky) is followed by the first (market)');
  assert.equal(new Set(HINTS).size, HINTS.length);
  for (const h of HINTS) assert.notEqual(parseCommand(h.replace(/^Try /, '')).name, 'UNKNOWN', h);
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /if \(!fromUrl\) noteTried\(\);/, 'every command run counts');
  assert.match(app, /hintsDone\(\{ historyLength: cmdHistory\.length \}\)/);
  assert.match(app, /reduced: \(\) => reduceMotion\.matches/);
  assert.match(app, /if \(glowNext && cmd\.name === 'HOME'\) glowOnce\(\);/, 'the first HOME after the card glows');
});
