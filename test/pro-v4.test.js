// PRO v4: the visitor sees what Pro gives. The minis (screens/pro-demo.js) drawn from fake
// data with the quotes call stubbed; real prices only (none made up when the quotes fail);
// reduced motion shows the last frame; the timers stop when the screen is left or the tab
// is hidden; the member view is unchanged; the quiet PRO lines (WATCH, ALERTS) are for
// visitors only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chatScript, chatHtml, chipPrices, typingMs, deviceIds, devicesHtml, alertLevel, alertPing, chatPing,
  pingsHtml, adsHtml, play, demoTracks, startDemo, guessNumber, LINES, ANA, JOE, FALLBACK_WATCH, HOUSE_LINE,
  LEGAL_LINE, prevCloseAt, drawStill,
} from '../public/screens/pro-demo.js';
import { mainHtml, visitorHtml, seedBits, seatCardInner, CAPTIONS, KEY_Q, HERO_PRICE } from '../public/screens/pro.js';
import { alertPayload, chatPayload } from '../pro/push-send.js';
import { puzzleNumber } from '../data/guess.js';
import { cardWords } from '../public/kit.js';
import { emptyWatchHtml, WATCH_PRO_LINE } from '../public/screens/watch.js';
import { topLineHtml, ALERTS_PRO_LINE } from '../public/screens/alerts.js';
import { HONEST_LINE } from '../public/alerts.js';
import { DEFAULT_WATCHLIST } from '../public/watchlist.js';
import { proChatLineHtml, CHAT_PRO_LINE } from '../public/screens/guess.js';

const all = () => true;
const NOW = Date.UTC(2026, 8, 29, 15, 30);
const NVDA = { ticker: 'NVDA', name: 'NVIDIA Corporation', kind: 'stock', realTime: true, last: 191.2, prevClose: 185, change: 6.2, changePct: 3.35 };
const QUOTES = [NVDA, { ticker: 'AAPL', name: 'Apple Inc.', kind: 'stock', realTime: true, last: 338.4, change: -2.67, changePct: -0.78 },
  { ticker: 'TSLA', name: 'Tesla, Inc.', kind: 'stock', realTime: false, last: 402.1, change: 1.1, changePct: 0.27 }];
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// A fake page: timers that run when told, a document that can hide, a store, a root.
function fakeTimers() {
  let n = 0;
  const q = new Map();
  return {
    q,
    setTimeout(fn, ms) { n += 1; q.set(n, { fn, ms }); return n; },
    clearTimeout(id) { q.delete(id); },
    // Run the timer due first (all of them at once when several are due together).
    step() {
      if (!q.size) return false;
      const min = Math.min(...[...q.values()].map((t) => t.ms));
      const due = [...q.entries()].filter(([, t]) => t.ms === min);
      for (const [id] of due) q.delete(id);
      for (const t of q.values()) t.ms -= min; // time passes for the others, not for new ones
      for (const [, t] of due) t.fn();
      return true;
    },
  };
}
function fakeDoc() {
  const fns = new Set();
  return {
    hidden: false,
    addEventListener(t, f) { if (t === 'visibilitychange') fns.add(f); },
    removeEventListener(t, f) { if (t === 'visibilitychange') fns.delete(f); },
    fire() { for (const f of [...fns]) f(); },
    get listeners() { return fns.size; },
  };
}
function fakeRoot() {
  const els = { '#pd-chat': { innerHTML: '', isConnected: true }, '#pd-dev': { innerHTML: '', isConnected: true }, '#pd-pings': { innerHTML: '', isConnected: true }, '#pd-ads': { innerHTML: '', isConnected: true } };
  return { els, isConnected: true, querySelector: (s) => els[s] || null };
}
const store = (watch) => ({ get: (k, fb) => (k === 'bb.watch' ? (watch === undefined ? fb : watch) : fb) });
const flush = () => new Promise((r) => { setImmediate(r); });

function ctxWith({ quotes = QUOTES, fail = false, watch = ['AAPL', 'NVDA', 'TSLA'] } = {}) {
  const calls = [];
  const ac = new AbortController();
  return {
    calls, ac, signal: ac.signal, store: store(watch),
    fetchJSON: async (url, opts) => { calls.push({ url, opts }); if (fail) throw Object.assign(new Error('down'), { code: 'unavailable' }); return { quotes }; },
  };
}

// ---- the chat --------------------------------------------------------------------------

test('chat mini: four messages from @ana and @joe, the real chat builders, a real price receipt', () => {
  const list = chatScript(NVDA, NOW);
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((m) => m.name), ['ana', 'joe', 'ana', 'joe']);
  assert.deepEqual(list[0].tickers, [{ sym: 'NVDA', price: 185 }], 'the stamp is the real previous close');
  assert.deepEqual(list[1].card, { cmd: 'FISHTANK', title: 'FISHTANK' });
  assert.equal(list[2].kind, 'guess');
  assert.deepEqual(list[2].guess, { n: guessNumber(NOW), tries: 4, solved: true });
  const { quotes } = chipPrices(NVDA);
  assert.deepEqual(quotes, { NVDA: 191.2 }, 'live is the real last');
  const html = chatHtml(list, 4, quotes, NOW);
  // The move since the last close, from the two real numbers: 191.20 / 185 - 1 = +3.4%.
  assert.match(html, /<button type="button" class="cm-chip up" data-sym="NVDA" title="185\.00 when sent">\$NVDA 191\.20 \+3\.4% since<\/button>/);
  assert.match(html, /data-card="FISHTANK"/);
  assert.match(html, /GUESS #\d+<\/span><span class="num">4\/6<\/span>/);
  assert.match(html, />ana</);
  assert.match(html, />joe</);
  assert.equal((html.match(/class="cm[ "]/g) || []).length, 4);
  // One by one: n messages, and the newest slides in.
  assert.equal((chatHtml(list, 2, quotes, NOW).match(/class="cm[ "]/g) || []).length, 2);
  assert.match(chatHtml(list, 2, quotes, NOW, true), /class="cm pd-in" data-id="2"/);
  assert.match(chatHtml(list, 3, quotes, NOW, true), /class="cm cm-guess pd-in" data-id="3"/);
  // A typing pace: a pause before each, longer lines longer, under 3 seconds.
  const ms = list.map((_, i) => typingMs(i, list));
  assert.ok(ms.every((x) => x >= 500 && x <= 2800), ms.join());
  // The pixel avatars: seeded, the same every time, drawn by pixel-avatar.js.
  assert.equal(ANA.avatar, chatScript(null, NOW)[0].avatar);
  assert.notEqual(ANA.avatar, JOE.avatar);
  assert.match(html, /<svg class="px-av cm-av"/);
  // GUESS #n agrees with the server's puzzle number.
  assert.equal(guessNumber(NOW), puzzleNumber('2026-09-29'));
});

test('the receipt is stamped when its price was the price: 4:00 PM New York on the trading day before the quote', () => {
  // The quote's day is Monday Sep 28: its previous close is Friday Sep 25, 4:00 PM EDT (20:00 UTC).
  assert.equal(prevCloseAt({ asOf: '2026-09-28' }, NOW), Date.UTC(2026, 8, 25, 20));
  assert.equal(prevCloseAt({ asOf: '2026-09-29T11:02:00.000-0400' }, NOW), Date.UTC(2026, 8, 28, 20));
  // Winter time: 4:00 PM EST is 21:00 UTC.
  assert.equal(prevCloseAt({ asOf: '2026-12-08' }, NOW), Date.UTC(2026, 11, 7, 21));
  // No quote: the weekday before today in New York (Tuesday Sep 29: Monday).
  assert.equal(prevCloseAt(null, NOW), Date.UTC(2026, 8, 28, 20));
  assert.equal(prevCloseAt(null, Date.UTC(2026, 8, 27, 15)), Date.UTC(2026, 8, 25, 20), 'a Sunday: Friday');
  // The chat: the receipt under its own day row, the rest under TODAY.
  const list = chatScript({ ...NVDA, asOf: '2026-09-28' }, NOW);
  assert.equal(list[0].at, Date.UTC(2026, 8, 25, 20));
  assert.ok(list.slice(1).every((m) => m.at > NOW - 5 * 60_000 && m.at <= NOW));
  const html = chatHtml(list, 4, chipPrices(NVDA).quotes, NOW);
  const days = [...html.matchAll(/<div class="cm-day" role="separator">([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(days, ['SEP 25', 'TODAY']);
  assert.ok(html.indexOf('SEP 25') < html.indexOf('$NVDA') && html.indexOf('$NVDA') < html.indexOf('TODAY'));
});

test('chat mini: friendly lines, no advice (MAS): no buy or sell, targets, ratings, signals', () => {
  const words = LINES.join(' ');
  assert.doesNotMatch(words, /\b(buy|sell|target|going up|rating|signal|advice|should|moon|bullish|bearish|undervalued|overvalued)\b/i);
  assert.doesNotMatch(words, /—|\p{Extended_Pictographic}/u);
});

test('no quote, no number: the chip without numbers and no price alert', () => {
  const list = chatScript(null, NOW);
  assert.deepEqual(list[0].tickers, [{ sym: 'NVDA' }]);
  const { quotes } = chipPrices(null);
  assert.deepEqual(quotes, {});
  const html = chatHtml(list, 4, quotes, NOW);
  assert.match(html, /<button type="button" class="cm-chip" data-sym="NVDA" title="Open NVDA">\$NVDA<\/button>/);
  // A quote with a last but no previous close: the live price only, never a made-up move.
  const lastOnly = chipPrices({ last: 191.2 });
  assert.match(chatHtml(chatScript({ last: 191.2 }, NOW), 1, lastOnly.quotes, NOW), />\$NVDA 191\.20<\/button>/);
  assert.equal(alertPing('NVDA', null), null);
  assert.equal(alertPing('NVDA', undefined), null);
  assert.equal(alertPing('NVDA', 0), null);
  assert.equal(alertLevel(NaN), null);
});

// ---- pings -----------------------------------------------------------------------------

test('pings: the words the server sends; the level a round number just under the real last', () => {
  assert.equal(alertLevel(191.2), 190);
  assert.equal(alertLevel(228.86), 225);
  assert.equal(alertLevel(225), 220, 'never at or above the price');
  assert.equal(alertLevel(1250.5), 1250);
  assert.equal(alertLevel(45.3), 45);
  for (const last of [191.2, 228.86, 1250.5, 45.3, 3.217]) {
    const mine = alertPing('NVDA', last);
    const real = alertPayload({ symbol: 'NVDA', op: '>', level: alertLevel(last), dp: 2, client_id: 'x' }, last);
    assert.equal(mine.t, real.t);
    assert.equal(mine.b, real.b);
  }
  assert.deepEqual(alertPing('NVDA', 191.2), { t: 'NVDA above 190', b: 'NVDA 191.20 · above your 190' });
  const chat = chatPayload({ seat: 12, name: 'joe', text: 'x' });
  assert.deepEqual(chatPing('joe'), { t: chat.t, b: chat.b });
  assert.deepEqual(chatPing('joe'), { t: 'New message from @joe', b: 'Open CHAT to read it.' });
  const html = pingsHtml([alertPing('NVDA', 191.2), chatPing('joe')], NOW, true);
  assert.match(html, /src="\/icon-192\.png"/);
  // Newest on top, and it slides in.
  assert.ok(html.indexOf('New message from @joe') < html.indexOf('NVDA above 190'));
  assert.match(html, /<div class="pd-note pd-in">[^]*?New message from @joe/);
});

// ---- devices and ads --------------------------------------------------------------------

test('every device: the visitor own watchlist (4 at most), AAPL NVDA TSLA when empty; the same rows twice', () => {
  assert.deepEqual(deviceIds(store(['MSFT', 'GOLD'])), ['MSFT', 'GOLD']);
  assert.deepEqual(deviceIds(store(['A', 'B', 'C', 'D', 'E'])), ['A', 'B', 'C', 'D']);
  assert.deepEqual(deviceIds(store([])), FALLBACK_WATCH);
  assert.deepEqual(FALLBACK_WATCH, ['AAPL', 'NVDA', 'TSLA']);
  assert.deepEqual(deviceIds(store(undefined)), DEFAULT_WATCHLIST.slice(0, 4), 'never set: the list WATCH shows');
  const byId = Object.fromEntries(QUOTES.map((x) => [x.ticker, x]));
  const html = devicesHtml(['AAPL', 'NVDA', 'TSLA'], byId, { laptop: 3, phone: 1, fresh: 'phone' });
  const [laptop, phone] = html.split('<div class="pd-phone">');
  assert.equal((laptop.match(/<tr class="row-link/g) || []).length, 3);
  assert.equal((phone.match(/<tr class="row-link/g) || []).length, 1);
  assert.match(phone, /<tr class="row-link pd-in" data-cmd="AAPL"/);
  assert.match(laptop, /338\.40/, 'the real last');
  assert.equal((devicesHtml(['AAPL'], {}, {}).match(/<tr class="row-link/g) || []).length, 0);
  // No quote: dashes, as WATCH shows.
  assert.match(devicesHtml(['AAPL'], {}, { laptop: 1 }), /<td class="num last">--<\/td>/);
});

test('no drift: the AD line is a house line of data/sponsors.json, the clean line the status line of index.html', () => {
  const house = JSON.parse(readFileSync('data/sponsors.json', 'utf8')).house;
  assert.ok(house.some((l) => l.text === HOUSE_LINE.text && l.cmd === HOUSE_LINE.cmd), HOUSE_LINE.text);
  assert.equal(HOUSE_LINE.label, 'AD');
  const index = readFileSync('public/index.html', 'utf8');
  const legal = /<span id="status-legal" class="status-legal">([^]*?)<\/span>\s*<\/div>|<span id="status-legal" class="status-legal">([^\n]*)/.exec(index);
  assert.ok(legal, 'the status line is in index.html');
  const words = (legal[1] || legal[2]).replace(/<span class="legal-sep"[^>]*>[^<]*<\/span>/g, '|').replace(/<[^>]+>/g, '').split('|').map((w) => w.trim());
  assert.deepEqual(LEGAL_LINE, words.slice(0, 2), words.join(' | '));
});

test('no ads: the real sponsor line (the house line), then it slides away and leaves a clean line', () => {
  assert.match(adsHtml({ state: 'ad' }), /<a class="spon-item" href="\?c=SPONSOR" data-cmd="SPONSOR"><span class="sponsor-k">AD<\/span><span class="spon-text">This line is for rent\. No tracking, no pop-ups\.<\/span><\/a>/);
  assert.match(adsHtml({ state: 'leaving' }), /spon-strip pd-out/);
  // The clean line: the status line's own legal words, no AD.
  const clean = adsHtml({ state: 'clean', entering: true });
  assert.doesNotMatch(clean, /spon-item/);
  assert.match(clean, /<span class="pd-term-legal pd-in">Not financial advice<span class="pd-term-sep" aria-hidden="true">·<\/span><span class="pd-term-link">Terms<\/span><\/span>/);
  assert.match(readFileSync('public/index.html', 'utf8'), /<span class="legal-line">Not financial advice<\/span>[^]*?>Terms<\/a>/, 'the same words as the real status line');
  // A terminal with something in it: a chart line and rows.
  assert.match(clean, /<polyline points=/);
  assert.equal((clean.match(/<i><\/i>/g) || []).length, 7, 'three window dots and four rows');
  // The still picture: the AD line struck through.
  assert.match(adsHtml({ state: 'struck' }), /class="pd-term-spon spon-strip pd-struck"><a class="spon-item"/);
  assert.match(readFileSync('public/screens/pro-demo.css', 'utf8'), /\.pd-struck \.spon-item \{ text-decoration: line-through;/);
});

test('no ads timing: the AD line about 2 s, it slides away, the clean line about 2 s, again', async () => {
  const root = fakeRoot();
  const timers = fakeTimers();
  const d = startDemo(root, ctxWith(), { reduce: false, timers, doc: fakeDoc() });
  await flush();
  const ads = () => root.els['#pd-ads'].innerHTML;
  const adsTimer = () => [...timers.q.values()].find((t) => t.ms === 2000 && /spon-item/.test(ads()));
  assert.match(ads(), /spon-item/);
  assert.ok(adsTimer(), 'the AD line stays about 2 s');
  const seen = ['ad'];
  let cleanHold = false;
  for (let i = 0; i < 60 && seen.length < 5; i++) {
    timers.step();
    const s = /pd-out/.test(ads()) ? 'leaving' : /pd-term-legal/.test(ads()) ? 'clean' : 'ad';
    if (seen[seen.length - 1] !== s) {
      seen.push(s);
      if (s === 'clean') cleanHold = [...timers.q.values()].some((t) => t.ms === 2000);
    }
  }
  assert.deepEqual(seen, ['ad', 'leaving', 'clean', 'ad', 'leaving'], seen.join());
  assert.ok(cleanHold, 'the clean line stays about 2 s');
  d.stop();
});

// ---- the player: motion, pause, clean up -------------------------------------------------

test('startDemo: one quotes call, then every mini draws from it; the frames advance on the timers', async () => {
  const root = fakeRoot();
  const ctx = ctxWith();
  const timers = fakeTimers();
  const doc = fakeDoc();
  const demo = startDemo(root, ctx, { reduce: false, timers, doc });
  await flush();
  assert.equal(ctx.calls.length, 1);
  assert.equal(ctx.calls[0].url, '/api/quotes?s=AAPL,NVDA,TSLA');
  assert.equal(ctx.calls[0].opts.signal, ctx.signal);
  // Frame 0: an empty chat, an empty lock screen, the sponsor line on.
  assert.equal((root.els['#pd-chat'].innerHTML.match(/class="cm[ "]/g) || []).length, 0);
  assert.match(root.els['#pd-ads'].innerHTML, /spon-item/);
  assert.equal(timers.q.size, 4, 'one timer per mini');
  for (let i = 0; i < 40 && !/data-id="4"/.test(root.els['#pd-chat'].innerHTML); i++) timers.step();
  assert.match(root.els['#pd-chat'].innerHTML, /\$NVDA 191\.20 \+3\.4% since/);
  assert.match(root.els['#pd-chat'].innerHTML, /data-id="4"/);
  for (let i = 0; i < 40 && !/NVDA above/.test(root.els['#pd-pings'].innerHTML); i++) timers.step();
  assert.match(root.els['#pd-pings'].innerHTML, /NVDA above 190/);
  assert.match(root.els['#pd-pings'].innerHTML, /NVDA 191\.20 · above your 190/);
  demo.stop();
  assert.equal(timers.q.size, 0);
  assert.equal(doc.listeners, 0);
});

test('quotes fail: the minis run with no numbers, never an invented price', async () => {
  const root = fakeRoot();
  const ctx = ctxWith({ fail: true });
  const timers = fakeTimers();
  startDemo(root, ctx, { reduce: true, timers, doc: fakeDoc() });
  await flush();
  const chat = root.els['#pd-chat'].innerHTML;
  assert.match(chat, />\$NVDA<\/button>/);
  assert.doesNotMatch(text(chat), /\d+\.\d\d|% since/);
  assert.doesNotMatch(root.els['#pd-pings'].innerHTML, /NVDA above/, 'no price alert without a price');
  assert.match(root.els['#pd-pings'].innerHTML, /New message from @joe/);
  assert.doesNotMatch(text(root.els['#pd-dev'].innerHTML), /\d+\.\d\d/);
  assert.match(root.els['#pd-dev'].innerHTML, /<td class="num last">--<\/td>/);
});

test('reduced motion: each mini shows its last frame and no timer runs', async () => {
  const root = fakeRoot();
  const timers = fakeTimers();
  const doc = fakeDoc();
  const demo = startDemo(root, ctxWith(), { reduce: true, timers, doc });
  await flush();
  assert.equal(timers.q.size, 0);
  assert.equal(doc.listeners, 0);
  assert.equal((root.els['#pd-chat'].innerHTML.match(/class="cm[ "]/g) || []).length, 4, 'all four messages');
  assert.doesNotMatch(root.els['#pd-chat'].innerHTML, /pd-in/);
  const [laptop, phone] = root.els['#pd-dev'].innerHTML.split('<div class="pd-phone">');
  assert.equal((laptop.match(/<tr class="row-link"/g) || []).length, 3);
  assert.equal((phone.match(/<tr class="row-link"/g) || []).length, 3);
  assert.match(root.els['#pd-pings'].innerHTML, /NVDA above 190[^]*|New message/);
  assert.equal((root.els['#pd-pings'].innerHTML.match(/class="pd-note"/g) || []).length, 2);
  assert.match(root.els['#pd-ads'].innerHTML, /pd-struck"><a class="spon-item"/, 'the AD line struck through');
  assert.equal(demo.player.pending, 0);
  // And the CSS keeps the slide off too.
  assert.match(readFileSync('public/screens/pro-demo.css', 'utf8'), /@media \(prefers-reduced-motion: reduce\) \{\s*\.pd-in, \.pd-out \{ animation: none; \}/);
});

test('leaving PRO stops everything: the abort signal, a mini gone from the page, stop() during the quotes call', async () => {
  // The screen is left (app.js aborts ctx.signal): no timer, no listener.
  let root = fakeRoot();
  let ctx = ctxWith();
  let timers = fakeTimers();
  let doc = fakeDoc();
  startDemo(root, ctx, { reduce: false, timers, doc });
  await flush();
  assert.ok(timers.q.size > 0);
  ctx.ac.abort();
  assert.equal(timers.q.size, 0);
  assert.equal(doc.listeners, 0);
  // A redraw took the minis off the page: the next tick stops them all.
  root = fakeRoot();
  ctx = ctxWith();
  timers = fakeTimers();
  doc = fakeDoc();
  const d = startDemo(root, ctx, { reduce: false, timers, doc });
  await flush();
  root.els['#pd-dev'].isConnected = false;
  const before = root.els['#pd-chat'].innerHTML;
  timers.step();
  assert.equal(d.player.stopped, true);
  assert.equal(timers.q.size, 0);
  assert.equal(root.els['#pd-chat'].innerHTML, before, 'nothing drawn after');
  // Left before the quotes came back: it never starts.
  root = fakeRoot();
  ctx = ctxWith();
  timers = fakeTimers();
  const e = startDemo(root, ctx, { reduce: false, timers, doc: fakeDoc() });
  e.stop();
  await flush();
  assert.equal(e.player, null);
  assert.equal(timers.q.size, 0);
  assert.equal(root.els['#pd-chat'].innerHTML, '');
  // An aborted signal before the start: nothing at all.
  const ac = new AbortController();
  ac.abort();
  const t2 = fakeTimers();
  const p = play(demoTracks({ chat: { innerHTML: '', isConnected: true } }, {}), { timers: t2, doc: fakeDoc(), signal: ac.signal });
  assert.equal(p.stopped, true);
  assert.equal(t2.q.size, 0);
});

test('embeds and DESK panels: the still pictures, no quotes call, no timer, no number', async () => {
  const root = fakeRoot();
  const ctx = ctxWith();
  const p = drawStill(root, { ...ctx, embed: true });
  await flush();
  assert.equal(ctx.calls.length, 0, 'no quotes call');
  assert.equal(p.pending, 0);
  assert.equal((root.els['#pd-chat'].innerHTML.match(/class="cm[ "]/g) || []).length, 4);
  assert.match(root.els['#pd-chat'].innerHTML, />\$NVDA<\/button>/);
  assert.doesNotMatch(text(root.els['#pd-chat'].innerHTML + root.els['#pd-pings'].innerHTML + root.els['#pd-dev'].innerHTML), /\d+\.\d\d/);
  assert.match(root.els['#pd-ads'].innerHTML, /pd-struck/);
  // PRO never starts the live minis there.
  const src = readFileSync('public/screens/pro.js', 'utf8');
  assert.match(src, /if \(ctx\?\.embed \|\| !host\.querySelector\('#pd-chat'\) \|\| !ctx\?\.signal\) return;/);
  assert.match(src, /if \(ctx\?\.embed && host\.querySelector\('#pd-chat'\)\) \{\s*Promise\.all\(\[loadModule\(DEMO_JS[^\n]*\n\s*\.then\(\(\[m\]\) => \{ if \(host\.isConnected && host\.querySelector\('#pd-chat'\)\) m\.drawStill\(host, ctx\); \}\)/);
  assert.ok(src.indexOf('m.drawStill(host, ctx)') < src.indexOf('m.startDemo(host, ctx)'));
});

test('a hidden tab: the minis wait, and go on when it is shown again', async () => {
  const root = fakeRoot();
  const timers = fakeTimers();
  const doc = fakeDoc();
  const d = startDemo(root, ctxWith(), { reduce: false, timers, doc });
  await flush();
  assert.equal(timers.q.size, 4);
  doc.hidden = true;
  doc.fire();
  assert.equal(timers.q.size, 0);
  assert.equal(d.player.stopped, false);
  doc.hidden = false;
  doc.fire();
  assert.equal(timers.q.size, 4);
  d.stop();
});

test('the screen code: PRO loads the minis by name for a visitor only, stops them on a redraw, never for LOGIN or GIFT', () => {
  const src = readFileSync('public/screens/pro.js', 'utf8');
  assert.match(src, /export const DEMO_JS = 'screens\/pro-demo\.js';/);
  assert.match(src, /loadModule\(DEMO_JS, \{ recover: false \}\)/);
  assert.match(src, /v\.demo\?\.stop\(\);/);
  assert.match(src, /if \(ctx\?\.embed \|\| !host\.querySelector\('#pd-chat'\) \|\| !ctx\?\.signal\) return;/);
  assert.doesNotMatch(src, /import[^;]*pro-demo/, 'not a static import: LOGIN, REDEEM and GIFT never load it');
});

// ---- the visitor view -----------------------------------------------------------------------

test('visitor view: the kit slots in order, the price the only big number, one primary button, captions', () => {
  const html = mainHtml({ next: 43, has: all });
  const order = ['card-art', 'card-kicker', 'card-hero', 'card-sub', 'card-act', 'card-note', 'card-media', 'card-links', 'card-more'].map((c) => html.indexOf(c));
  assert.ok(order.every((i) => i >= 0), order.join());
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal((html.match(/btn-solid/g) || []).length, 1);
  assert.equal((html.match(/card-hero-/g) || []).length, 1);
  assert.match(html, /<p class="tag card-kicker">PRO<\/p><h2 class="card-hero card-hero-60 num" id="pro-hero" aria-label="\$420 a year"><span id="pro-price">\$420<\/span><\/h2>/);
  assert.match(mainHtml({ next: 43, plan: 'month', has: all }), /aria-label="\$42 a month"><span id="pro-price">\$42<\/span>/);
  assert.deepEqual(HERO_PRICE, { year: '$420', month: '$42' });
  for (const c of Object.values(CAPTIONS)) assert.ok(html.includes(`<figcaption class="pd-cap">${c}</figcaption>`), c);
  for (const id of ['pd-chat', 'pd-dev', 'pd-pings', 'pd-ads']) assert.match(html, new RegExp(`id="${id}" role="img" aria-label="[^"]+" inert>`), id);
  assert.match(html, new RegExp(`id="pro-keyq" aria-expanded="false" aria-controls="pro-keylinks">${KEY_Q.replace('?', '\\?')}</button>`));
  assert.equal((html.match(/class="pd-ticket"/g) || []).length, 3);
  // The seat is a bonus now, with a seeded avatar: the same seat, the same face.
  assert.deepEqual(seedBits(43), seedBits(43));
  assert.notDeepEqual(seedBits(43), seedBits(44));
  assert.equal(seatCardInner(43), seatCardInner(43));
  assert.match(visitorHtml({ next: null }), /-----/);
  // The words: the budget of test/layout-rules.test.js.
  const w = cardWords(html.replace('<span id="pro-test" hidden>', '<span id="pro-test">'));
  assert.equal(w.length, 35, w.join(' '));
  assert.equal(cardWords(html).length, 31);
  // + Details keeps FREE and PRO and the terms.
  const d = html.split('<details')[1];
  assert.match(d, />FREE</);
  assert.match(d, />PRO</);
  assert.match(d, /Every month or every year, as you picked, until you cancel\./);
});

test('member view unchanged: a key keeps the v3 key view and the REACTIVATE view, no minis', () => {
  const st = { status: 'active', seat: 12, canGift: true, interval: 'year', currentPeriodEnd: new Date(Date.UTC(2027, 8, 27, 12)).toISOString() };
  const key = ['BB', '7KQ2', 'M9XD', 'HT4P', 'WZ3C'].join('-'); // a fake key, built from parts (gitleaks)
  const on = mainHtml({ key, st, has: all });
  const off = mainHtml({ key, st: { status: 'canceled', seat: 7 }, has: all });
  for (const html of [on, off]) {
    assert.doesNotMatch(html, /pd-|pro-v4|card-wide|pro-keyq/);
  }
  assert.match(off, /<h2 class="card-hero card-hero-96 num" id="pro-seat" aria-label="Your SEAT 00007">/);
});

// ---- the quiet PRO lines -----------------------------------------------------------------------

test('moment lines: WATCH empty, ALERTS and the GUESS end say what PRO adds, 10 words at most, PRO a link; never for Pro', () => {
  for (const line of [WATCH_PRO_LINE, ALERTS_PRO_LINE, CHAT_PRO_LINE]) {
    assert.ok(line.split(/\s+/).length <= 10, line);
    assert.match(line, /\bPRO\b/);
    assert.doesNotMatch(line, /—|\p{Extended_Pictographic}/u);
  }
  const link = '<a class="pro-line-link" href="?c=PRO" data-cmd="PRO">PRO</a>';
  assert.ok(emptyWatchHtml().includes(`<p class="empty-note">Saved on this device. ${link} syncs it.</p>`));
  assert.doesNotMatch(emptyWatchHtml({ pro: true }), /empty-note|data-cmd="PRO"/);
  assert.doesNotMatch(emptyWatchHtml({ embed: true }), /empty-note|data-cmd="PRO"/, 'not in an embed or a DESK panel');
  assert.match(readFileSync('public/screens/watch.js', 'utf8'), /emptyWatchHtml\(\{ pro: isPro\(\), embed: Boolean\(ctx\.embed\) \}\)/);
  const s = { get: () => false };
  assert.equal(topLineHtml(s, false), `${HONEST_LINE} <span class="al-pro">${link} pings your phone when the tab is closed.</span>`);
  assert.equal(topLineHtml(s, true), HONEST_LINE);
  assert.equal(topLineHtml(s, false, true), HONEST_LINE, 'not in an embed or a DESK panel');
  assert.match(readFileSync('public/screens/alerts.js', 'utf8'), /topLineHtml\(ctx\.store, isPro\(\), Boolean\(ctx\.embed\)\)/);
  // With closed-tab alerts on (a Pro device), the line says so and nothing more.
  assert.doesNotMatch(topLineHtml({ get: () => true }, false), /data-cmd="PRO"/);
  // No pop-ups: a line, not a dialog.
  for (const f of ['public/screens/watch.js', 'public/screens/alerts.js']) assert.doesNotMatch(readFileSync(f, 'utf8'), /showModal|<dialog/);
  // GUESS: where Pro sees POST TO CHAT, a visitor sees the line; nothing while unknown, for Pro, or in an embed.
  assert.equal(proChatLineHtml(true), `<p class="gs-pro">${link}: compare scores with friends in CHAT.</p>`);
  assert.equal(proChatLineHtml(false), '');
  const g = readFileSync('public/screens/guess.js', 'utf8');
  assert.match(g, /\$\{proChatLineHtml\(!ctx\.embed && chat\?\.visitor === true\)\}/);
  assert.match(g, /if \(!pro\.isPro\(\)\) \{\s*\/\/ [^\n]*\n\s*chat = \{ pro: false, rooms: \[\], visitor: true \};/);
  assert.match(g, /chat = \{ pro: true, key: pro\.getKey\(\), header: pro\.HEADER, rooms: postable\(d\.rooms\) \};/, 'Pro: no visitor flag');
});
