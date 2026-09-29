// CHAT, the browser side: the CHAT commands, the link question, the screen's pure HTML
// builders (chips, cards, list, thread), the unread badge, the word budget and the copy
// rules. The server side is test/chat.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCommand, urlFor, linkPlan, linkChanges, screenFor } from '../public/app.js';
import {
  chipHtml, textHtml, cardHtml, attachFor, listHtml, messagesHtml, headHtml, composerHtml, countText, notProHtml, emptyHtml, shellHtml,
  emptyText, dayLabel, whoHtml, isEmpty, NOT_PRO, KEEP_NOTE, CLOSED, mergeMessages, waitPause, WAIT_PAUSE_MS,
} from '../public/screens/chat.js';
import { badgeText, paintBadge, mountChatBadge } from '../public/chat-badge.js';
import { findCommand } from '../public/registry.js';
import { buildAssets } from '../lib/assets.js';

const words = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').split(/\s+/).filter(Boolean);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ---- commands ------------------------------------------------------------------------------

test('CHAT: the screen, one seat, a group; leading zeros; 1 to 7 seats; $CHAT is still the stock', () => {
  assert.deepEqual(parseCommand('CHAT'), { name: 'CHAT', input: 'CHAT' });
  const one = parseCommand('chat 42');
  assert.deepEqual([one.name, one.args.seats, one.input, one.mutates, one.view], ['CHAT', [42], 'CHAT 42', true, 'CHAT']);
  assert.deepEqual(parseCommand('CHAT 00042').args.seats, [42]);
  assert.deepEqual(parseCommand('CHAT 42 88 105').args.seats, [42, 88, 105]);
  assert.deepEqual(parseCommand('CHAT 42 42').args.seats, [42]);
  assert.deepEqual(parseCommand('CHAT 1 2 3 4 5 6 7').args.seats.length, 7);
  for (const bad of ['CHAT 1 2 3 4 5 6 7 8', 'CHAT X', 'CHAT 0', 'CHAT 42 AAPL', 'CHAT -4', 'CHAT 1234567890']) {
    const c = parseCommand(bad);
    assert.equal(c.name, 'CHAT', bad);
    assert.equal(c.error, 'usage', bad);
    assert.ok(!c.mutates, bad);
  }
  assert.equal(parseCommand('$CHAT').name, 'QUOTE');
  assert.equal(screenFor('CHAT').js, 'screens/chat.js');
});

test('CHAT with seats: the address bar shows plain CHAT, and a link asks first (Enter or Esc)', () => {
  assert.deepEqual(urlFor('CHAT 42'), { url: 'CHAT', kept: 'CHAT 42' });
  assert.equal(linkChanges(parseCommand('CHAT 42')), true);
  assert.equal(linkChanges(parseCommand('CHAT')), false);
  assert.deepEqual(linkPlan('CHAT 42'), { url: 'CHAT', show: 'CHAT', ask: { run: 'CHAT 42', url: 'CHAT', question: 'Chat with SEAT 42?', verb: 'CHAT' } });
  assert.equal(linkPlan('CHAT 42 88').ask.question, 'Chat with SEAT 42, SEAT 88?');
  assert.deepEqual(linkPlan('CHAT'), { url: 'CHAT', show: 'CHAT', ask: null });
  assert.equal(linkPlan('CHAT X').ask, null, 'a usage error changes nothing');
});

test('registry: CHAT is Pro; no example sends a request to a real seat; HELP explains seats', async () => {
  const e = findCommand('CHAT');
  assert.equal(e.category, 'Pro');
  assert.deepEqual(e.examples, ['CHAT'], 'a click on an example must never message seat 42');
  assert.equal(e.syntax, 'CHAT [seat ...]');
  const { DETAIL } = await import('../public/registry-detail.js');
  assert.equal(DETAIL.CHAT.options.length, 2);
  assert.match(DETAIL.CHAT.source, /deleted after 30 days/);
});

// ---- chips, cards, text ------------------------------------------------------------------------

test('chips: the move since the message, green up, red down; no stamp shows the live price', () => {
  const up = chipHtml({ sym: 'NVDA', price: 175, at: 1 }, 182.4);
  assert.equal(up, '<button type="button" class="cm-chip up" data-sym="NVDA" title="175.00 when sent">$NVDA 182.40 +4.2% since</button>');
  const down = chipHtml({ sym: 'AAPL', price: 250, at: 1 }, 240);
  assert.match(down, /class="cm-chip down"/);
  assert.match(down, />\$AAPL 240\.00 −4\.0% since</);
  const flat = chipHtml({ sym: 'KO', price: 60, at: 1 }, 60.01);
  assert.match(flat, /class="cm-chip"/);
  assert.match(flat, /\$KO 60\.01 0\.0% since/);
  assert.equal(text(chipHtml({ sym: 'MSFT' }, 410.5)), '$MSFT 410.50', 'no stamp: live only');
  assert.equal(text(chipHtml({ sym: 'MSFT', price: 400 }, null)), '$MSFT 400.00', 'no live price: the price when sent');
  assert.equal(text(chipHtml({ sym: 'MSFT' }, null)), '$MSFT');
  assert.doesNotMatch(up + down, /amber|orange/i);
});

test('text: stamped $TICKERs become chips, everything else is escaped text', () => {
  const html = textHtml('$NVDA <b>ripping</b> & $AAPL too, $TSLA not stamped, $5 lunch', [{ sym: 'NVDA', price: 100 }, { sym: 'AAPL' }], { NVDA: 110 });
  assert.match(html, /^<button[^>]+data-sym="NVDA"[^>]*>\$NVDA 110\.00 \+10\.0% since<\/button> &lt;b&gt;ripping&lt;\/b&gt; &amp; <button[^>]+data-sym="AAPL"/);
  assert.match(html, / too, \$TSLA not stamped, \$5 lunch$/);
  assert.equal(textHtml('<img src=x onerror=alert(1)>', []), '&lt;img src=x onerror=alert(1)&gt;');
});

test('cards: a box with title and command; attach only a plain screen you came from', () => {
  assert.equal(cardHtml({ cmd: 'AAPL 1Y', title: 'AAPL 1Y' }), '<button type="button" class="cm-card" data-card="AAPL 1Y"><span class="cm-card-c">AAPL 1Y</span></button>');
  assert.match(cardHtml({ cmd: 'WEIRD', title: 'Weird gauges' }), /<span class="cm-card-t">Weird gauges<\/span><span class="cm-card-c">WEIRD<\/span>/);
  assert.equal(cardHtml(null), '');
  assert.deepEqual(attachFor('aapl 1y'), { cmd: 'AAPL 1Y', title: 'AAPL' }, 'the screen title, the full command');
  assert.equal(attachFor('WEIRD').cmd, 'WEIRD');
  for (const no of ['', null, 'HOME', 'CHAT', 'PRO', 'LOGIN', 'LOGOUT', 'REDEEM', 'GIFT', 'FEEDBACK', 'WATCH ADD AAPL', 'DESK RESET', 'ZZZZZZZZ QQQ', 'BB-AAAA-BBBB-CCCC-DDDD']) {
    assert.equal(attachFor(no), null, String(no));
  }
});

// ---- list and thread -------------------------------------------------------------------------

const ME = { seat: 42, name: 'Tom' };
const ROOMS = [
  { id: 5, kind: 'dm', title: 'Ann 88', members: [{ seat: 42, name: 'Tom' }, { seat: 88, name: 'Ann' }], readOnly: false, unread: 2, last: { at: 1, preview: 'hi', own: false }, blockedByMe: false },
  { id: 9, kind: 'group', title: 'Ann 88, SEAT 105', members: [{ seat: 42, name: 'Tom' }, { seat: 88, name: 'Ann' }, { seat: 105, name: null }], readOnly: false, unread: 0, last: { at: 1, preview: 'ok', own: true } },
];

test('list: YOU and NAME, requests with ACCEPT IGNORE BLOCK, rooms with previews and unread; sent requests are not listed', () => {
  const html = listHtml({ me: ME, requests: { in: [{ seat: 7, name: null, at: 1 }] }, rooms: ROOMS }, 9);
  assert.match(html, /<span class="cl-k">YOU<\/span><span class="cm-who is-own">Tom <span class="cm-seat">42<\/span><\/span><button type="button" class="chip cl-name" data-act="name">NAME<\/button>/);
  assert.match(html, /SEAT <span class="cm-seat">7<\/span>.*data-req="7" data-do="accept">ACCEPT<.*data-do="ignore">IGNORE<.*data-do="block">BLOCK</s);
  assert.match(html, /class="cl-room is-unread" data-room="5">/);
  assert.match(html, /class="cl-room is-open" data-room="9" aria-current="true"/);
  assert.match(html, /<span class="cl-n num">2<\/span>/);
  assert.doesNotMatch(listHtml({ me: ME, rooms: ROOMS }, 5), /cl-n num/, 'the open chat shows no unread count');
  assert.match(html, /You: ok/);
  assert.doesNotMatch(html, /SENT/, 'a list of sent requests would tell which seats have Pro');
  assert.ok(html.indexOf('ACCEPT') < html.indexOf('data-room'), 'requests first');
  assert.equal(whoHtml(88, 'SEAT 1'), '<span class="cm-who">SEAT 1 <span class="cm-seat">88</span></span>', 'the real seat always shows');
});

test('thread: dense lines, a day row where the day changes, own name marked', () => {
  const now = new Date(2026, 8, 28, 15, 0).getTime();
  const m = (id, at, own, t) => ({ id, seat: own ? 42 : 88, name: own ? 'Tom' : 'Ann', own, text: t, card: null, tickers: [], at });
  const html = messagesHtml([m(1, new Date(2026, 8, 27, 9, 5).getTime(), false, 'yo'), m(2, new Date(2026, 8, 28, 14, 2).getTime(), true, 'hey'), m(3, new Date(2026, 8, 28, 14, 3).getTime(), false, 'sup')], {}, now);
  assert.deepEqual([...html.matchAll(/class="cm-day" role="separator">([^<]+)</g)].map((x) => x[1]), ['SEP 27', 'TODAY']);
  assert.match(html, /<span class="cm-t">14:02<\/span><span class="cm-who is-own">Tom <span class="cm-seat">42<\/span><\/span><span class="cm-body"><span class="cm-text">hey<\/span><\/span>/);
  assert.equal(dayLabel(new Date(2025, 0, 3).getTime(), now), 'JAN 3 2025');
});

test('thread head and composer: the menu per kind; closed chats have no composer', () => {
  assert.deepEqual([...headHtml(ROOMS[0]).matchAll(/data-menu="(\w+)">(\w+)</g)].map((x) => x[2]), ['BLOCK', 'REPORT']);
  assert.deepEqual([...headHtml({ ...ROOMS[0], blockedByMe: true }).matchAll(/data-menu="(\w+)">(\w+)</g)].map((x) => x[2]), ['UNBLOCK', 'REPORT']);
  assert.deepEqual([...headHtml(ROOMS[1]).matchAll(/data-menu="(\w+)">(\w+)</g)].map((x) => x[2]), ['ADD', 'LEAVE', 'REPORT']);
  assert.deepEqual([...headHtml({ ...ROOMS[1], readOnly: true }).matchAll(/data-menu="(\w+)">(\w+)</g)].map((x) => x[2]), ['LEAVE', 'REPORT']);
  assert.match(headHtml(ROOMS[1]), /<span class="ct-members">Tom 42, Ann 88, SEAT 105<\/span>/);
  assert.equal(composerHtml({ ...ROOMS[0], readOnly: true }), `<p class="ct-closed muted">${CLOSED}</p>`);
  const c = composerHtml(ROOMS[0], { cmd: 'AAPL 1Y', title: 'AAPL 1Y' });
  assert.match(c, /data-act="attach" aria-pressed="false" title="Attach this screen">\+ AAPL 1Y<\/button><textarea class="cc-input" rows="1" maxlength="500"/);
  assert.doesNotMatch(composerHtml(ROOMS[0], null), /cc-attach/);
  assert.equal(countText(400), '');
  assert.equal(countText(401), '401/500');
});

// ---- the few words -----------------------------------------------------------------------------

test('few words: not Pro is one line and PRO; the empty Pro screen is one sentence, 35 words at most', () => {
  assert.deepEqual(words(notProHtml()), ['CHAT', ...NOT_PRO.split(' '), 'PRO']);
  assert.equal(NOT_PRO, 'Private chat with friends who have Pro.');
  assert.equal(emptyText(42), 'Your seat is 42. Give it to a friend with Pro, then type CHAT and their number.');
  const empty = shellHtml().replace(/<div class="panel-body chat-body">[\s\S]*<\/div>\s*<\/section>$/, `<div class="panel-body chat-body">${emptyHtml(42)}</div></section>`);
  const w = words(empty);
  assert.deepEqual(w.slice(0, 6), ['1)', 'CHAT', ...KEEP_NOTE.split(' ')]);
  assert.ok(w.length <= 35, `${w.length} words: ${w.join(' ')}`);
  assert.equal(isEmpty({ rooms: [], requests: { in: [] } }), true);
  assert.equal(isEmpty({ rooms: [], requests: { in: [{ seat: 1 }] } }), false);
});

// ---- the badge ---------------------------------------------------------------------------------

test('badge: CHAT 2 for Pro with unread, hidden otherwise; asks once on load, never without Pro', async () => {
  assert.equal(badgeText(2), 'CHAT 2');
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(null), '');
  assert.equal(badgeText(120), 'CHAT 99+');
  const el = { textContent: '', hidden: true, title: '' };
  paintBadge(el, 3);
  assert.deepEqual([el.textContent, el.hidden], ['CHAT 3', false]);
  paintBadge(el, 0);
  assert.deepEqual([el.textContent, el.hidden], ['', true]);
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push([url, opts.headers['X-Pro-Key']]); return { ok: true, json: async () => ({ count: 4 }) }; };
  const listeners = {};
  const win = { addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener: (n) => { delete listeners[n]; } };
  const stopFree = mountChatBadge(el, { fetchImpl, win, pro: () => false, key: () => null, timer: () => () => {} });
  assert.deepEqual(calls, [], 'no Pro: no request');
  stopFree();
  const stop = mountChatBadge(el, { fetchImpl, win, pro: () => true, key: () => 'BB-AAAA-BBBB-CCCC-DDDD', timer: () => () => {} });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, [['/api/chat/unread', 'BB-AAAA-BBBB-CCCC-DDDD']]);
  assert.deepEqual([el.textContent, el.hidden], ['CHAT 4', false]);
  listeners['bb:chat-unread']({ detail: 0 });
  assert.equal(el.hidden, true, 'the CHAT screen paints it at once');
  stop();
  assert.equal(listeners['bb:chat-unread'], undefined);
});

test('the page: the badge by the seat, hidden, opens CHAT; only the badge loads at startup', () => {
  const html = readFileSync('public/index.html', 'utf8');
  assert.match(html, /<a id="seat"[^>]*><\/a><a id="chat-badge" class="chat-badge num" href="\/\?c=CHAT" data-cmd="CHAT" hidden><\/a>/);
  const a = buildAssets('public');
  const shell = a.closure('app.js');
  assert.ok(shell.includes('chat-badge.js'));
  assert.ok(!shell.includes('screens/chat.js'), 'the chat screen loads on first use');
  assert.match(readFileSync('public/app.js', 'utf8'), /'screens\/grid\.css', 'screens\/chat\.css',/);
});

// ---- house rules -------------------------------------------------------------------------------

test('copy rules: no brand word, no em dash, no emoji, no amber, no advice words, no real terminal codes', () => {
  for (const f of ['public/screens/chat.js', 'public/screens/chat.css', 'public/chat-badge.js', 'pro/chat.js', 'pro/chat-store.js', 'pro/chat-routes.js', 'scripts/chat-reports.js', 'migrations/013_chat.sql']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(src, /—/, `${f}: em dash`);
    assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${f}: emoji`);
    assert.doesNotMatch(src, /amber|orange|#ffb|#f90/i, `${f}: amber`);
    assert.doesNotMatch(src, /\b(buy now|sell now|strong buy|should buy|buy signal|sell signal|price target)\b/i, `${f}: advice`);
    assert.doesNotMatch(src, /\bMSG\b|\bIB\b/, `${f}: a real terminal function code`);
  }
});

// ---- review fixes -----------------------------------------------------------------------------

test('fix 1: a message from someone else just before yours is never skipped', () => {
  const m = (id, t) => ({ id, text: t });
  // You sent 101 (it came back from SEND first); 100 arrived just before it.
  let list = mergeMessages([m(99, 'a')], [m(101, 'mine')]);
  list = mergeMessages(list, [m(100, 'theirs'), m(101, 'mine')]);
  assert.deepEqual(list.map((x) => x.id), [99, 100, 101]);
  assert.deepEqual(mergeMessages([m(5, 'x')], [m(5, 'x2')]).map((x) => x.text), ['x2'], 'each id once');
  // newer() asks after the last id this view loaded, never after the newest in the list.
  const src = readFileSync('public/screens/chat.js', 'utf8');
  assert.match(src, /messages\?after=\$\{st\.loadedId\}/);
  assert.doesNotMatch(src, /st\.msgs\.push/);
  assert.match(src, /for \(let page = 0; page < 10; page\+\+\)/, 'fix 6: follows more, 10 pages at most');
  assert.match(src, /if \(!d\.more\) break;/);
});

test('fix 2: an evicted or early empty answer pauses before the next wait; a hidden tab stops asking', () => {
  assert.equal(waitPause({ events: [], evicted: true, elapsed: 5 }), WAIT_PAUSE_MS);
  assert.equal(waitPause({ events: [], elapsed: 300 }), WAIT_PAUSE_MS, 'empty and early');
  assert.equal(waitPause({ events: [], elapsed: 25_000 }), 0, 'a full hold');
  assert.equal(waitPause({ events: [{ id: 1 }], elapsed: 10 }), 0, 'events: at once');
  const src = readFileSync('public/screens/chat.js', 'utf8');
  assert.match(src, /if \(document\.hidden\) \{\s+await shown\(\);/);
  assert.match(src, /document\.hidden \? '&read=0' : ''/, 'fix 7: a hidden tab does not mark read');
});
