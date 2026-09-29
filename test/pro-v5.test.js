// PRO v5, "one stage, four keys": the visitor sees one large demo at a time in a terminal
// panel with a key row (1 PINGS 2 CHAT 3 EVERY DEVICE 4 SEAT). The stages (screens/pro-demo.js)
// drawn with the quotes call stubbed; real prices only (none made up when the quotes fail);
// the stage moves on until the visitor presses a key, clicks or hovers, then stays; reduced
// motion shows the last frames and moves nothing; the timers stop when the screen is left,
// the tab is hidden or the page is redrawn. The member views are unchanged; the quiet PRO
// lines (WATCH, ALERTS, GUESS, an alert set, DESK) are for visitors only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chatScript, chatHtml, chipPrices, alertPing, chatPing, pingsHtml, deviceList, devicesMeta, devicesHtml, seatStageHtml,
  startDemo, drawStill, stageOf, guessNumber, prevCloseAt, LINES, ANA, JOE, DEMO_WATCH, CHAT_MS, STAGE_MS, SEAT_UNKNOWN, OPEN_CHAT,
} from '../public/screens/pro-demo.js';
import {
  mainHtml, visitorHtml, stageHtml, stageKeyFor, seedBits, STAGES, HERO, RULE, KICKER, KEY_Q, CANCEL_NOTE, TEST_LINE, PRO_ROWS, FREE_ROWS, DEMO_BANNER,
} from '../public/screens/pro.js';
import { alertPayload, chatPayload } from '../pro/push-send.js';
import { puzzleNumber } from '../data/guess.js';
import { cardWords } from '../public/kit.js';
import { emptyWatchHtml, WATCH_PRO_LINE } from '../public/screens/watch.js';
import { topLineHtml, ALERTS_PRO_LINE, ALERT_SET_PRO_LINE, alertSetLineHtml, PUSH_FLAG } from '../public/screens/alerts.js';
import { HONEST_LINE } from '../public/alerts.js';
import { proChatLineHtml, CHAT_PRO_LINE } from '../public/screens/guess.js';
import { deskProLineHtml, DESK_PRO_LINE, DESK_PRO_FLAG } from '../public/screens/desk.js';
import { FKEYS, panelByNumber, numberedItem } from '../public/app.js';
import { mount, fakeDocument, fakeTimers, flush } from './fixtures/tiny-dom.js';

const all = () => true;
const NOW = Date.UTC(2026, 8, 29, 15, 30);
const NVDA = { ticker: 'NVDA', name: 'NVIDIA Corporation', kind: 'stock', realTime: true, last: 191.2, prevClose: 185.6, change: 5.6, changePct: 3.02, asOf: '2026-09-29' };
const QUOTES = [NVDA, { ticker: 'AAPL', name: 'Apple Inc.', kind: 'stock', realTime: true, last: 338.4, change: -2.67, changePct: -0.78 },
  { ticker: 'SPX', name: 'S&P 500', kind: 'index', realTime: true, last: 7680.6, change: -3.1, changePct: -0.04 }];
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const LINK = '<a class="pro-line-link" href="?c=PRO" data-cmd="PRO">PRO</a>';
const store = (watch) => ({ get: (k, fb) => (k === 'bb.watch' ? (watch === undefined ? fb : watch) : fb) });

function ctxWith({ quotes = QUOTES, fail = false, watch = ['AAPL', 'NVDA'] } = {}) {
  const calls = [];
  const ac = new AbortController();
  return {
    calls, ac, signal: ac.signal, store: store(watch),
    fetchJSON: async (url, opts) => { calls.push({ url, opts }); if (fail) throw Object.assign(new Error('down'), { code: 'unavailable' }); return { quotes }; },
  };
}
// The visitor's card in a tiny DOM, and the stage started on it with fake timers.
async function stage({ reduce = false, fail = false, watch, seat = () => null, first, hold } = {}) {
  const root = mount(mainHtml({ has: all }));
  const ctx = ctxWith({ fail, watch });
  const timers = fakeTimers();
  const doc = fakeDocument();
  const d = startDemo(root, ctx, { reduce, timers, doc, seat, first, hold, now: () => NOW });
  await flush();
  const view = root.querySelector('#pd-stage');
  const on = () => root.querySelectorAll('[data-stage]').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => Number(t.dataset.stage));
  const title = () => `${root.querySelector('#pd-stage-label').textContent} ${root.querySelector('#pd-stage-meta').textContent}`.replace(/\s+/g, ' ').trim();
  return { root, ctx, timers, doc, d, view, on, title };
}

// ---- the visitor view -------------------------------------------------------------------

test('visitor view: one split card, the words then the stage; the hero is the promise at 24, one primary button', () => {
  const html = mainHtml({ next: 43, has: all });
  assert.match(html, /^<section class="card card-split pro-card pro-v5" aria-label="Bloombroke Pro"><div class="card-art"><div class="pd-stagebox"/);
  const order = ['card-art', 'card-col', 'card-kicker', 'card-hero', 'card-sub', 'card-act', 'card-note', 'card-more'].map((c) => html.indexOf(c));
  assert.ok(order.every((i) => i >= 0), order.join());
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // The words come first on a phone and sit on the left on a desktop (pro.css moves the art).
  const css = readFileSync('public/screens/pro.css', 'utf8');
  assert.match(css, /\.pro-v5 > \.card-art \{ order: 2; \}/);
  assert.match(css, /\.card\.card-split\.pro-v5 \{ grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\); align-items: start; \}/);
  // The hero: words, not a number, from ONE constant, at 24 (18 on a phone: kit.css).
  assert.equal(HERO, RULE);
  assert.ok(html.includes(`<p class="tag card-kicker">${KICKER}</p><h2 class="card-hero card-hero-24 num">${HERO}</h2>`));
  assert.equal((html.match(/card-hero-/g) || []).length, 1);
  assert.doesNotMatch(html.split('<details')[0], /card-hero-(96|60|44)/);
  assert.equal((html.match(/btn-solid/g) || []).length, 1, 'one primary button');
  assert.match(html, /<button type="button" class="btn card-btn btn-solid" id="pro-sub" data-plan="year">SUBSCRIBE<\/button>/, 'no plan word');
  // Each price once above Details, both visible, the picked one pressed.
  const front = text(html.split('<details')[0]);
  assert.equal((front.match(/\$420 a year/g) || []).length, 1);
  assert.equal((front.match(/\$42 a month/g) || []).length, 1);
  assert.match(html, /id="pro-plan-month" data-plan="month" aria-pressed="false">\$42 a month<\/button><button [^>]*id="pro-plan-year" data-plan="year" aria-pressed="true">\$420 a year</);
  assert.match(css, /\.pro5-plan\[aria-pressed="true"\] \{ font-weight: 700; \}/);
  assert.match(readFileSync('public/screens/pro.css', 'utf8'), /\.pro3-plan\[aria-pressed="true"\] \{ color: var\(--text\);/, 'the picked one in the bright colour');
  // The note: "Cancel any time.", and the test-mode line, hidden until the server says test.
  assert.match(html, new RegExp(`<p class="card-note">${CANCEL_NOTE.replace('.', '\\.')}<span id="pro-year-note" hidden>[^<]*</span><span id="pro-test" hidden>${TEST_LINE.replace('.', '\\.')}</span></p>`));
  assert.equal(TEST_LINE, 'Test mode: no card is charged yet.');
  // No seat card, no gift tickets, no captions above Details any more.
  assert.doesNotMatch(html.split('<details')[0], /pd-seat|pd-ticket|figcaption|No ads|pro-keyq/);
});

test('the stage frame: a title strip like a panel head, one view, the key row 1 to 4, the first key on', () => {
  const html = stageHtml();
  assert.deepEqual(STAGES.map((s) => s.label), ['PINGS', 'CHAT', 'EVERY DEVICE', 'SEAT']);
  assert.deepEqual(STAGES.map((s) => s.meta), ['demo', 'demo', 'demo', 'yours forever']);
  assert.match(html, /<div class="pd-stage-head"><span class="pd-stage-label" id="pd-stage-label">PINGS<\/span><span class="pd-stage-meta" id="pd-stage-meta"><span aria-hidden="true">·<\/span> demo<\/span><\/div>/);
  assert.match(html, /<div class="pd-stage" id="pd-stage" role="img" aria-label="[^"]+" inert><\/div>/);
  const keys = [...html.matchAll(/<button type="button" role="tab" class="pd-key" data-stage="(\d)" aria-selected="(true|false)" aria-controls="pd-stage"><span class="pd-key-n">\d<\/span><span class="pd-key-l">([^<]+)<\/span><\/button>/g)];
  assert.deepEqual(keys.map((k) => [k[1], k[2], k[3]]), [['1', 'true', 'PINGS'], ['2', 'false', 'CHAT'], ['3', 'false', 'EVERY DEVICE'], ['4', 'false', 'SEAT']]);
  assert.match(html, /<div class="pd-keys" role="tablist" aria-label="What Pro gives">/);
  // It fills the art column; nothing else floats beside it.
  assert.match(readFileSync('public/screens/pro.css', 'utf8'), /\.pd-stagebox \{ display: flex; flex-direction: column; width: 100%;/);
});

test('word budget: 35 words above Details in live mode, 42 in test mode (test/layout-rules.test.js)', () => {
  const html = mainHtml({ next: 4, has: all });
  assert.equal(cardWords(html).length, 35, cardWords(html).join(' '));
  assert.equal(cardWords(html.replace('<span id="pro-test" hidden>', '<span id="pro-test">')).length, 42);
});

test('Details: FREE and PRO with no LIVE tags, "No ad line", the tape, the key line, the terms, the test card last', () => {
  const d = mainHtml({ next: 4, has: all }).split('<details')[1];
  assert.doesNotMatch(d, /pro-tag|>LIVE</);
  assert.ok(PRO_ROWS.some(([n]) => n === 'No ad line'));
  assert.ok(PRO_ROWS.some(([n, , c]) => n === 'Your own ticker tape' && c === 'TAPE'));
  assert.ok(d.includes('>No ad line<'));
  assert.match(d, /Your own ticker tape/);
  for (const [n] of FREE_ROWS) assert.ok(d.includes(n.split(' ').pop()), n);
  // Key or gift code? on top, with its LOGIN and REDEEM reveal.
  assert.match(d, new RegExp(`^[^]*?<div class="card-details"><p class="pro-keyline"><button type="button" class="card-link" id="pro-keyq" aria-expanded="false" aria-controls="pro-keylinks">${KEY_Q.replace('?', '\\?')}</button><span class="pro-keylinks" id="pro-keylinks" hidden><a [^>]*data-cmd="LOGIN">LOGIN</a> <a [^>]*data-cmd="REDEEM">REDEEM</a></span></p>`));
  // The rule is the hero now, so Details does not say it again.
  assert.ok(!d.includes(RULE));
  // The terms stay; the test card is last, hidden until test mode.
  assert.match(d, /Every month or every year, as you picked, until you cancel\./);
  assert.match(d, new RegExp(`<p class="pro-demo" id="pro-demo" role="note" hidden>${DEMO_BANNER.replace(/[.]/g, '\\.')}</p></div></details>`));
});

test('member views unchanged: the key view and REACTIVATE have no stage, no keys, their own note', () => {
  const st = { status: 'active', seat: 12, canGift: true, interval: 'year', currentPeriodEnd: new Date(Date.UTC(2027, 8, 27, 12)).toISOString() };
  const key = ['BB', '7KQ2', 'M9XD', 'HT4P', 'WZ3C'].join('-'); // a fake key, built from parts (gitleaks)
  const on = mainHtml({ key, st, has: all });
  const off = mainHtml({ key, st: { status: 'canceled', seat: 7 }, has: all });
  for (const html of [on, off]) assert.doesNotMatch(html, /pd-|pro-v5|card-split|data-stage|pro-keyq/);
  assert.match(off, /<h2 class="card-hero card-hero-96 num" id="pro-seat" aria-label="Your SEAT 00007">/);
  assert.match(off, /id="pro-sub" data-plan="year" data-label="REACTIVATE">REACTIVATE YEARLY</);
  assert.match(off, /Renews until cancelled · REACTIVATE keeps this key/);
  // The rule line stays in a member's Details.
  assert.ok(on.split('<details')[1].includes(RULE));
});

// ---- the keys ----------------------------------------------------------------------------

test('keys: 1 to 4 pick a stage, M and Y a plan, never from the command bar or a field; no clash', () => {
  const body = mount('<div id="x"></div>', 'body');
  const cmd = mount('<input id="cmd">').querySelector('#cmd');
  const input = mount('<form><input id="login-key"></form>').querySelector('input');
  const key = (k, target = body, mods = {}) => stageKeyFor({ key: k, target, metaKey: false, ctrlKey: false, altKey: false, repeat: false, ...mods });
  assert.deepEqual(['1', '2', '3', '4'].map((k) => key(k)), [{ stage: 0 }, { stage: 1 }, { stage: 2 }, { stage: 3 }]);
  assert.deepEqual([key('m'), key('M'), key('y'), key('Y')], [{ plan: 'month' }, { plan: 'month' }, { plan: 'year' }, { plan: 'year' }]);
  for (const k of ['0', '5', '9', 'F1', 'Enter', 'Escape', ' ', 'a', 'ArrowDown']) assert.equal(key(k), null, k);
  // The command bar and any field keep their typing (3988.HK, MSFT, a key or a code).
  for (const k of ['1', '3', 'm', 'Y']) { assert.equal(key(k, cmd), null, k); assert.equal(key(k, input), null, k); }
  // Modifiers and a held key: not ours (Ctrl K is the menu; Alt+digit and Cmd+digit the browser's).
  for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }]) assert.equal(key('1', body, mods), null);
  // A dialog (MENU, the welcome) keeps its keys.
  assert.equal(key('2', mount('<div role="dialog"><button id="b">x</button></div>').querySelector('#b')), null);
  // No clash with the function keys, the panel numbers or the did-you-mean digits.
  assert.ok(!FKEYS.some((f) => ['1', '2', '3', '4', 'M', 'Y', 'm', 'y'].includes(f.key)));
  const page = mount(mainHtml({ has: all }));
  for (const n of [1, 2, 3, 4]) {
    assert.equal(panelByNumber(page, n), null, `no panel "${n})" on PRO`);
    assert.equal(numberedItem(page, n), null, `no data-key or data-num ${n} on PRO`);
  }
  // The handler: capture on document, stopped with the view (source).
  const src = readFileSync('public/screens/pro.js', 'utf8');
  assert.match(src, /doc\.addEventListener\('keydown', onKey, true\);/);
  assert.match(src, /ctx\?\.signal\?\.addEventListener\?\.\('abort', off, \{ once: true \}\);/);
  assert.match(src, /v\.keysOff\?\.\(\);/);
  assert.match(src, /if \(!box \|\| ctx\?\.embed\) return;/, 'no keys in an embed or a DESK panel');
});

// ---- the stages: builders ------------------------------------------------------------------

test('1 PINGS: a chat ping with the $NVDA receipt line and a price alert at the previous close rounded down, in push-send words', () => {
  const chat = chatPing('joe', NVDA);
  const real = chatPayload({ seat: 12, name: 'joe', text: 'x' });
  assert.equal(chat.t, real.t);
  assert.equal(chat.t, 'New message from @joe');
  // The live price and the move since the previous close: 191.20 / 185.60 - 1 = +3.0%.
  assert.equal(chat.b, '$NVDA 191.20 +3.0% since');
  assert.equal(chat.dir, 'up');
  assert.equal(chatPing('joe', { last: 180, prevClose: 185.6 }).dir, 'down');
  const alert = alertPing('NVDA', NVDA);
  assert.equal(alert.level, 185, 'N: the previous close rounded down');
  assert.deepEqual({ t: alert.t, b: alert.b }, { t: 'NVDA above 185', b: 'NVDA 191.20 · above your 185' });
  const payload = alertPayload({ symbol: 'NVDA', op: alert.op, level: alert.level, dp: 2, client_id: 'x' }, NVDA.last);
  assert.deepEqual({ t: alert.t, b: alert.b }, { t: payload.t, b: payload.b });
  // A price under N: the true side ("below"), still push-send's words.
  const under = alertPing('NVDA', { last: 184.2, prevClose: 185.6 });
  assert.equal(under.t, 'NVDA below 185');
  assert.deepEqual({ t: under.t, b: under.b }, (({ t, b }) => ({ t, b }))(alertPayload({ symbol: 'NVDA', op: '<', level: 185, dp: 2 }, 184.2)));
  // The newest on top (the chat), sliding in; the icon of the app.
  const html = pingsHtml([chat, alert], NOW, true);
  assert.ok(html.indexOf('New message from @joe') < html.indexOf('NVDA above 185'));
  assert.match(html, /^<div class="pd-lock"><span class="pd-lock-time num">\d\d:\d\d<\/span><div class="pd-notes"><div class="pd-note pd-in">/);
  assert.equal((html.match(/pd-in/g) || []).length, 1, 'only the top card slides in');
  assert.match(html, /<span class="pd-note-b up">\$NVDA 191\.20 \+3\.0% since<\/span>/);
  // On a phone: no phone frame, the two cards the stage's width (pro-demo.css).
  const css = readFileSync('public/screens/pro-demo.css', 'utf8');
  assert.match(css, /@media \(max-width: 639px\) \{\s*\/\*[^*]*\*\/\s*\.pd-lock \{ width: 100%; height: 100%; margin: 0; padding: 16px 12px; border: 0; border-radius: 0; background: none; \}\s*\.pd-lock-time \{ display: none; \}/);
  assert.match(css, /\.pd-lock \{[^}]*width: 336px;/, 'about 320 px on a desktop');
});

test('no quote, no number: the pings, the chat and the rows without a single price', () => {
  assert.equal(alertPing('NVDA', null), null);
  assert.equal(alertPing('NVDA', { last: 191.2 }), null, 'no previous close: no level');
  assert.equal(alertPing('NVDA', { prevClose: 185 }), null, 'no last: no alert');
  assert.deepEqual(chatPing('joe', null), { t: 'New message from @joe', b: OPEN_CHAT, dir: '' });
  assert.equal(chatPing('joe', null).b, chatPayload({ seat: 1, name: 'joe', text: 'x' }).b, 'push-send words');
  for (const id of ['pings', 'chat', 'dev']) {
    const st = stageOf(id, { byId: {}, ids: DEMO_WATCH, now: NOW });
    assert.doesNotMatch(text(st.draw(st.frames - 1, false)), /\d+\.\d\d|% since/, id);
  }
});

test('2 CHAT: the real chat builders, three messages, @ana and @joe with no seat numbers, the receipt at the previous close', () => {
  const list = chatScript(NVDA, NOW);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((m) => m.name), ['ana', 'ana', 'joe']);
  assert.deepEqual(list[0].tickers, [{ sym: 'NVDA', price: 185.6 }], 'the stamp is the real previous close');
  assert.equal(list[0].at, prevCloseAt(NVDA, NOW));
  assert.equal(list[0].at, Date.UTC(2026, 8, 28, 20), 'Monday 4:00 PM New York');
  assert.deepEqual(list[1].guess, { n: guessNumber(NOW), tries: 4, solved: true });
  assert.equal(guessNumber(NOW), puzzleNumber('2026-09-29'));
  assert.equal(list[2].text, LINES[1]);
  assert.ok(list.every((m) => m.seat === undefined), 'no seats');
  assert.equal(ANA.seat, undefined);
  assert.equal(JOE.seat, undefined);
  const html = chatHtml(list, 3, chipPrices(NVDA).quotes, NOW);
  assert.match(html, /<button type="button" class="cm-chip up" data-sym="NVDA" title="185\.60 when sent">\$NVDA 191\.20 \+3\.0% since<\/button>/);
  assert.match(html, /GUESS #\d+<\/span><span class="num">4\/6<\/span>/);
  assert.match(html, />ana</);
  assert.match(html, />joe</);
  assert.match(html, /<svg class="px-av cm-av"/, 'their avatars');
  assert.doesNotMatch(html, /cm-seat|#--|SEAT/, 'no seat number on a demo person');
  for (const who of html.match(/<span class="cm-who">[^]*?<\/span><\/span>/g)) assert.doesNotMatch(who.replace(/<[^>]+>/g, ''), /#|\d/, who);
  const days = [...html.matchAll(/<div class="cm-day" role="separator">([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(days, ['SEP 28', 'TODAY']);
  // The receipt lands about 600 ms after the stage opens; the newest slides in.
  assert.equal(CHAT_MS[0], 600);
  assert.match(chatHtml(list, 1, {}, NOW, true), /class="cm pd-in" data-id="1"/);
  // Friendly lines: no buy or sell, no targets, ratings or signals.
  assert.doesNotMatch(LINES.join(' '), /\b(buy|sell|target|rating|signal|advice|should|moon|bullish|bearish)\b/i);
  // Text at 16 px, not 13.
  assert.match(readFileSync('public/screens/pro-demo.css', 'utf8'), /\.pd-chat\.ct-msgs \{[^}]*font-size: 16px; \}/);
  assert.match(readFileSync('public/screens/pro-demo.css', 'utf8'), /\.pd-chat \.cm-chip \{ font-size: 16px; \}/);
});

test('3 EVERY DEVICE: the visitor own list (4 at most, "your watchlist"); SPX NDX NVDA MSFT and "demo" when empty', () => {
  assert.deepEqual(deviceList(store(['MSFT', 'GOLD'])), { ids: ['MSFT', 'GOLD'], own: true });
  assert.deepEqual(deviceList(store(['AAPL', 'NVDA', 'TSLA', 'GOLD', 'BTC'])).ids, ['AAPL', 'NVDA', 'TSLA', 'GOLD']);
  assert.deepEqual(deviceList(store([])), { ids: ['SPX', 'NDX', 'NVDA', 'MSFT'], own: false });
  assert.deepEqual(deviceList(store(undefined)), { ids: DEMO_WATCH, own: false }, 'never set');
  assert.deepEqual(deviceList({ get() { throw new Error('storage'); } }), { ids: DEMO_WATCH, own: false });
  assert.equal(devicesMeta(true), 'your watchlist');
  assert.equal(devicesMeta(false), 'demo');
  const byId = Object.fromEntries(QUOTES.map((x) => [x.ticker, x]));
  const html = devicesHtml(['AAPL', 'NVDA'], byId, { phone: true });
  const [laptop, phone] = html.split('<div class="pd-phone">');
  assert.equal((laptop.match(/<tr class="row-link/g) || []).length, 2);
  assert.equal((phone.match(/<tr class="row-link/g) || []).length, 2, 'the same rows on the phone');
  assert.match(laptop, /338\.40/, 'the real last');
  assert.match(laptop, /\u22120\.78%/, 'the real change');
  assert.equal((devicesHtml(['AAPL'], byId, { phone: false }).split('<div class="pd-phone">')[1].match(/<tr/g) || []).length, 0, 'frame 0: the phone empty');
  assert.match(devicesHtml(['AAPL'], {}, {}), /<td class="num last">--<\/td>/, 'no quote: dashes');
});

test('4 SEAT: the real next seat or SEAT 0000_, a blank @______, an empty avatar slot, one ticket of 3 gift months', () => {
  const html = seatStageHtml(43);
  assert.match(html, /<span class="pd-seat-slot"><\/span><span class="pd-seat-handle">@______<\/span><span class="pd-seat-num num"><span class="pro3-word">SEAT <\/span><span class="pro3-zero">000<\/span>43<\/span>/);
  assert.equal((html.match(/class="pd-ticket"/g) || []).length, 1);
  assert.match(html, /<span class="pd-ticket-n num">3<\/span><span class="pd-ticket-u">GIFT MONTHS<\/span>/);
  assert.equal(SEAT_UNKNOWN, '0000_');
  for (const n of [null, undefined, 0, -1, 'x', 4.5]) assert.match(seatStageHtml(n), /SEAT <\/span><span class="pro3-zero">0000_<\/span><\/span>/, String(n));
  assert.match(seatStageHtml(12345), /SEAT <\/span><span class="pro3-zero"><\/span>12345</);
  // The seeded avatars of ana and joe: the same seed, the same face.
  assert.deepEqual(seedBits('ana'), seedBits('ana'));
  assert.notDeepEqual(seedBits('ana'), seedBits('joe'));
});

// ---- the stage: the player -------------------------------------------------------------------

test('the stage: one quotes call, then PINGS; it moves on every 6 s, round the four', async () => {
  const s = await stage({ watch: ['AAPL', 'NVDA'] });
  assert.equal(s.ctx.calls.length, 1);
  assert.equal(s.ctx.calls[0].url, '/api/quotes?s=AAPL,NVDA');
  assert.equal(s.ctx.calls[0].opts.signal, s.ctx.signal);
  assert.deepEqual(s.on(), [1]);
  assert.equal(s.title(), 'PINGS · demo');
  assert.match(s.view.textContent, /New message from @joe\$NVDA 191\.20 \+3\.0% since/);
  assert.match(s.view.textContent, /NVDA above 185NVDA 191\.20 · above your 185/);
  assert.equal(STAGE_MS, 6000);
  assert.equal(s.d.auto, true);
  s.timers.advance(5999);
  assert.deepEqual(s.on(), [1]);
  s.timers.advance(1);
  assert.deepEqual(s.on(), [2]);
  assert.equal(s.title(), 'CHAT · demo');
  assert.equal(s.view.querySelectorAll('.cm').length, 0, 'the thread starts empty');
  s.timers.advance(600);
  assert.equal(s.view.querySelectorAll('.cm').length, 1, 'the receipt lands at 600 ms');
  assert.ok(s.view.querySelector('.cm.pd-in'));
  s.timers.advance(STAGE_MS - 600);
  assert.deepEqual(s.on(), [3]);
  assert.equal(s.title(), 'EVERY DEVICE · your watchlist');
  s.timers.advance(STAGE_MS);
  assert.deepEqual(s.on(), [4]);
  assert.equal(s.title(), 'SEAT · yours forever');
  s.timers.advance(STAGE_MS);
  assert.deepEqual(s.on(), [1], 'round again');
  s.d.stop();
  assert.equal(s.timers.q.size, 0);
  assert.equal(s.doc.count('visibilitychange'), 0);
});

test('a key, a click or a hover stops the moving on for good; the picked stage opens', async () => {
  // A pick (a key 1 to 4 or a click on the key row: screens/pro.js calls pick).
  let s = await stage({ watch: [] });
  s.d.pick(2);
  assert.equal(s.d.auto, false);
  assert.deepEqual(s.on(), [3]);
  assert.equal(s.title(), 'EVERY DEVICE · demo', 'an empty list: the demo list');
  assert.match(s.view.textContent, /SPX[^]*NDX[^]*NVDA[^]*MSFT/);
  s.timers.advance(700);
  assert.equal(s.view.querySelector('.pd-pscreen').querySelectorAll('.row-link').length, 4, 'the phone gets the same rows');
  s.timers.advance(60_000);
  assert.deepEqual(s.on(), [3], 'it stays');
  assert.equal(s.timers.q.size, 0);
  s.d.pick(0);
  assert.deepEqual(s.on(), [1]);
  s.timers.advance(60_000);
  assert.deepEqual(s.on(), [1]);
  s.d.stop();
  // A hover: the stage on show stays, its own motion finishes.
  s = await stage();
  s.timers.advance(STAGE_MS);
  assert.deepEqual(s.on(), [2]);
  s.d.hold();
  s.timers.advance(CHAT_MS.reduce((x, y) => x + y, 0));
  assert.equal(s.view.querySelectorAll('.cm').length, 3, 'the chat plays out');
  s.timers.advance(60_000);
  assert.deepEqual(s.on(), [2]);
  assert.equal(s.d.auto, false);
  s.d.stop();
  // Touched before the stage module came in (screens/pro.js remembers it): no moving on.
  s = await stage({ first: 3, hold: true });
  assert.deepEqual(s.on(), [4]);
  s.timers.advance(60_000);
  assert.deepEqual(s.on(), [4]);
  s.d.stop();
});

test('reduced motion: no moving on, no motion inside; each stage its last frame', async () => {
  const s = await stage({ reduce: true });
  assert.equal(s.d.auto, false);
  assert.equal(s.timers.q.size, 0);
  assert.equal(s.view.querySelectorAll('.pd-in').length, 0);
  assert.equal(s.view.querySelectorAll('.pd-note').length, 2);
  s.d.pick(1);
  assert.equal(s.timers.q.size, 0);
  assert.equal(s.view.querySelectorAll('.cm').length, 3, 'all three at once');
  assert.equal(s.view.querySelectorAll('.pd-in').length, 0);
  s.d.pick(2);
  assert.equal(s.view.querySelector('.pd-pscreen').querySelectorAll('.row-link').length, 2, 'the phone rows at once');
  assert.equal(s.timers.q.size, 0);
  s.d.stop();
  // And the CSS keeps the slide off too.
  assert.match(readFileSync('public/screens/pro-demo.css', 'utf8'), /@media \(prefers-reduced-motion: reduce\) \{\s*\.pd-in \{ animation: none; \}/);
});

test('quotes fail: every stage without numbers, never an invented price', async () => {
  const s = await stage({ fail: true });
  assert.match(s.view.textContent, /New message from @joeOpen CHAT to read it\./);
  assert.doesNotMatch(s.view.textContent, /above|below|\d+\.\d\d/);
  for (const i of [1, 2]) {
    s.d.pick(i);
    s.timers.advance(5000);
    assert.doesNotMatch(s.view.textContent, /\d+\.\d\d|% since/, `stage ${i + 1}`);
  }
  s.d.stop();
});

test('the seat stage: the real next seat when it comes, SEAT 0000_ before', async () => {
  let seat = null;
  const s = await stage({ seat: () => seat });
  s.d.pick(3);
  assert.match(s.view.textContent, /SEAT 0000_/);
  seat = 43;
  s.d.refresh();
  assert.match(s.view.textContent, /SEAT 00043/);
  assert.match(s.view.textContent, /@______/);
  assert.match(s.view.textContent, /3GIFT MONTHS/);
  s.d.stop();
});

test('clean up: the screen left (abort), a hidden tab, the stage gone from the page, stop() before the quotes', async () => {
  // Left: no timer, no listener.
  let s = await stage();
  assert.ok(s.timers.q.size > 0);
  s.ctx.ac.abort();
  assert.equal(s.timers.q.size, 0);
  assert.equal(s.doc.count('visibilitychange'), 0);
  assert.equal(s.d.stopped, true);
  // A hidden tab: nothing runs; shown again, it moves on from where it was.
  s = await stage();
  s.d.pick(1);
  s.d.stop();
  s = await stage();
  s.timers.advance(STAGE_MS + 100);
  s.doc.hidden = true;
  s.doc.fire();
  assert.equal(s.timers.q.size, 0);
  assert.equal(s.view.querySelectorAll('.cm').length, 3, 'the last frame while hidden');
  assert.equal(s.d.stopped, false);
  s.doc.hidden = false;
  s.doc.fire();
  assert.equal(s.timers.q.size, 1, 'the next move');
  s.timers.advance(STAGE_MS);
  assert.deepEqual(s.on(), [3]);
  s.d.stop();
  // A redraw took the stage off the page: the next tick stops it all.
  s = await stage();
  s.view.remove();
  s.timers.step();
  assert.equal(s.d.stopped, true);
  assert.equal(s.timers.q.size, 0);
  // Stopped before the quotes came back: it never draws.
  const root = mount(mainHtml({ has: all }));
  const t = fakeTimers();
  const e = startDemo(root, ctxWith(), { reduce: false, timers: t, doc: fakeDocument() });
  e.stop();
  await flush();
  assert.equal(root.querySelector('#pd-stage').children.length, 0);
  assert.equal(t.q.size, 0);
  // An aborted signal before the start: nothing at all.
  const ctx = ctxWith();
  ctx.ac.abort();
  const f = startDemo(mount(mainHtml({ has: all })), ctx, { timers: t, doc: fakeDocument() });
  await flush();
  assert.equal(f.stopped, true);
  assert.equal(ctx.calls.length, 0);
});

test('embeds and DESK panels: the first stage still, no quotes call, no timer, no number', async () => {
  const root = mount(mainHtml({ has: all }));
  const ctx = ctxWith();
  const p = drawStill(root, { ...ctx, embed: true });
  await flush();
  assert.equal(ctx.calls.length, 0);
  assert.equal(p.pending, 0);
  assert.match(root.querySelector('#pd-stage').textContent, /New message from @joe/);
  assert.doesNotMatch(root.querySelector('#pd-stage').textContent, /\d+\.\d\d/);
  const src = readFileSync('public/screens/pro.js', 'utf8');
  assert.match(src, /if \(ctx\?\.embed \|\| !host\.querySelector\('#pd-stage'\) \|\| !ctx\?\.signal\) return;/);
  assert.match(src, /export const DEMO_JS = 'screens\/pro-demo\.js';/);
  assert.doesNotMatch(src, /import[^;]*pro-demo/, 'not a static import: LOGIN, REDEEM and GIFT never load it');
  assert.match(src, /v\.demo\?\.stop\(\);/);
});

test('the status bar: PRO does not say the price again', () => {
  const src = readFileSync('public/screens/pro.js', 'utf8');
  assert.match(src, /ctx\.status\(pro\.isPro\(\) \? 'PRO: ACTIVE' : ''\);/);
  assert.doesNotMatch(src, /PRICE_BOTH/);
});

// ---- the quiet PRO lines -----------------------------------------------------------------------

test('moment lines: WATCH, ALERTS, GUESS as before; an alert set and DESK too; short, PRO a link', () => {
  for (const line of [WATCH_PRO_LINE, ALERTS_PRO_LINE, CHAT_PRO_LINE, ALERT_SET_PRO_LINE, DESK_PRO_LINE]) {
    assert.ok(line.split(/\s+/).length <= 11, line); // the alert line is the owner's 11 words
    assert.match(line, /\bPRO\b/);
    assert.doesNotMatch(line, /—|\p{Extended_Pictographic}/u);
  }
  assert.ok(emptyWatchHtml().includes(`<p class="empty-note">Saved on this device. ${LINK} syncs it.</p>`));
  assert.doesNotMatch(emptyWatchHtml({ pro: true }), /data-cmd="PRO"/);
  assert.doesNotMatch(emptyWatchHtml({ embed: true }), /data-cmd="PRO"/);
  const s = { get: () => false };
  assert.equal(topLineHtml(s, false), `${HONEST_LINE} <span class="al-pro">${LINK} pings your phone when the tab is closed.</span>`);
  assert.equal(topLineHtml(s, true), HONEST_LINE);
  assert.equal(proChatLineHtml(true), `<p class="gs-pro">${LINK}: compare scores with friends in CHAT.</p>`);
  assert.equal(proChatLineHtml(false), '');
});

test('an alert set: "Fires while this tab is open. On your phone too: PRO", a visitor only, not in an embed', () => {
  const s = { get: () => false };
  assert.equal(alertSetLineHtml(s, false, false), `<p class="al-set-pro">Fires while this tab is open. On your phone too: ${LINK}</p>`);
  assert.equal(alertSetLineHtml(s, true, false), '', 'never for Pro');
  assert.equal(alertSetLineHtml(s, false, true), '', 'never in an embed or a DESK panel');
  assert.equal(alertSetLineHtml({ get: (k) => k === PUSH_FLAG }, false, false), '', 'this device pings already');
  // Drawn under "Added ...", only after an alert is added (source).
  const src = readFileSync('public/screens/alerts.js', 'utf8');
  assert.match(src, /setLine = alertSetLineHtml\(ctx\.store, isPro\(\), Boolean\(ctx\.embed\)\);/);
  assert.match(src, /<\/p>` : ''\}\$\{setLine\}\$\{perm\}`;/);
});

test('DESK: "Saved in this browser only. Everywhere: PRO", once per browser, a visitor only', () => {
  const mem = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
  const st = mem();
  assert.equal(deskProLineHtml(false, st), `<span class="desk-pro">Saved in this browser only. Everywhere: ${LINK}</span>`);
  assert.equal(st.m.get(DESK_PRO_FLAG), '1');
  assert.equal(deskProLineHtml(false, st), '', 'once');
  assert.equal(deskProLineHtml(true, mem()), '', 'never for Pro');
  const pro = mem();
  deskProLineHtml(true, pro);
  assert.equal(pro.m.size, 0, 'Pro does not use up the once');
  // Storage that throws: no line (the desk is not saved there either).
  assert.equal(deskProLineHtml(false, { getItem() { throw new Error('blocked'); }, setItem() {} }), '');
  assert.equal(deskProLineHtml(false, { getItem: () => null, setItem() { throw new Error('full'); } }), '');
  assert.equal(deskProLineHtml(false, null), '');
  // In DESK's bar, after the embed check (a DESK panel never draws DESK).
  const src = readFileSync('public/screens/desk.js', 'utf8');
  assert.match(src, /<span class="desk-focus" aria-live="polite"><\/span>\s*\$\{deskProLineHtml\(isPro\(\)\)\}/);
  assert.ok(src.indexOf('if (ctx.embed) {') < src.indexOf('${deskProLineHtml(isPro())}'));
});

// ---- house rules -------------------------------------------------------------------------------

test('copy rules on the new words: plain, no em dash, no emoji, no brand word, no vendor, no advice', () => {
  const words = [HERO, CANCEL_NOTE, TEST_LINE, KEY_Q, ...STAGES.flatMap((s) => [s.label, s.meta, s.aria]), ...LINES, ALERT_SET_PRO_LINE, DESK_PRO_LINE].join(' ');
  assert.doesNotMatch(words, /—|\p{Extended_Pictographic}/u);
  assert.doesNotMatch(words, new RegExp(['bloom', 'berg'].join(''), 'i'));
  assert.doesNotMatch(words, /Yahoo|Polygon|Finnhub|Alpha Vantage|Twelve Data|Nasdaq Data|CNBC|DataFast/i);
  assert.doesNotMatch(words, /\b(advice|advise|you should|we recommend|buy now|invest in)\b/i);
  for (const f of ['public/screens/pro.js', 'public/screens/pro-demo.js', 'public/screens/pro.css', 'public/screens/pro-demo.css']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /—/, f);
    assert.doesNotMatch(src, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(src, /amber|orange/i, f);
  }
  assert.ok(visitorHtml().includes('Bloombroke Pro'));
});
