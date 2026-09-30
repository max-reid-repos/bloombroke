// NO SUCH TICKER. YET.: did-you-mean rows, GRAVEYARD, IPO IT's guard, the share cards
// and the FEEDBACK prefill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import sharp from 'sharp';
import { parseCommand, urlFor } from '../public/app.js';
import { didYouMeanHtml } from '../public/cards.js';
import { findCommand } from '../public/registry.js';
import { dymRows, graveBeatsQuote, pickGraves, ipoShape, matchNoSuch, findGrave, tombstoneLine, dayText, ipoLinks, graveLinks, FEEDBACK_PREFILL, MAX_ROWS } from '../public/nosuch.js';
import { noSuchExtra as extraSlots, graveyardTable, ipoHtml, tickerPageHtml, certHtml, certSerial, graveMatches, ripRowHtml, TITLE_YET } from '../public/screens/nosuch.js';
import { stoneHtml } from '../public/screens/graveyard.js';
import { setPrefill, takePrefill } from '../public/screens/feedback.js';
import { GOALS, GOAL_PROPS, cleanProps } from '../public/goal.js';
import {
  loadGraveyard, parseBlocklist, loadBlocklist, ipoAllowed, flagged, byteLru, IPO_MEMORY, IPO_RATE, IPO_GLOBAL, BUSY_MAX_AGE, REFUSED_MAX_AGE, makeNoSuchCards, mountNoSuch, nosuchMeta, tombstoneTree, ipoTree, IPO_MAX_AGE, TOMB_MAX_AGE,
} from '../lib/og-nosuch.js';
import { W, H, makeRateLimit } from '../lib/og.js';

const BANNED = new RegExp(['bloom', 'berg'].join(''), 'i');
const RAW = JSON.parse(readFileSync(new URL('../data/graveyard.json', import.meta.url), 'utf8'));
const GRAVE = loadGraveyard();
// The NO SUCH card with this screen's slots in it, as app.js draws it.
const noSuchExtra = (word, info, opts = {}) => didYouMeanHtml(word || '', {}, opts.ticker || null, { extra: extraSlots(word, info, opts) });
// A made-up word list for the tests: the real one is data/ipo-blocklist.txt.
const BLOCK = parseBlocklist('# test\nZZTOP\n*QQQX\nbad1\n');

test('did you mean: at most 3 rows, never the words typed', () => {
  const found = {
    commands: [{ cmd: 'DATA', summary: 'same as typed' }, { cmd: 'HELP DATA', summary: 'x' }],
    symbols: [{ cmd: 'DATA', name: 'echo' }, { cmd: 'DAT', name: 'A' }, { cmd: 'DATS', name: 'B' }, { cmd: 'DATX', name: 'C' }],
  };
  const rows = dymRows(found, 'data', 'DATA');
  assert.equal(rows.length, MAX_ROWS);
  assert.ok(rows.every(([c]) => c !== 'DATA'), 'the word typed is never suggested');
  assert.deepEqual(rows.map(([c]) => c), ['DAT', 'DATS', 'DATX'], 'on NO SUCH TICKER, symbols first');
  assert.deepEqual(dymRows({ commands: [{ cmd: 'APPL', summary: '' }], symbols: [{ cmd: 'AAPL', name: 'Apple' }] }, 'APPL', 'APPL'), [['AAPL', 'Apple']]);
  const html = didYouMeanHtml('DATA', found, 'DATA');
  assert.doesNotMatch(html, /data-cmd="DATA"/);
  assert.match(html, /data-key="3"/);
  assert.doesNotMatch(html, /data-key="4"/);
  assert.match(html, /No such ticker\. Yet\.<\/p><h2 class="card-hero card-hero-60 num">\$DATA<\/h2>/);
  assert.match(html, /<a class="card-link" href="\?c=HELP" data-cmd="HELP">ALL COMMANDS<\/a><\/p>/, 'HELP is the last link');
  assert.doesNotMatch(html, /A company name works too|A ticker is one word/, 'the old text is gone');
});

test('graveyard: every entry is sourced and well formed', () => {
  assert.ok(RAW.length >= 20, `${RAW.length} entries`);
  assert.equal(GRAVE.length, RAW.filter((e) => !e.zombie).length, 'every stone passes the loader (zombies: test/graveyard.test.js)');
  const seen = new Set();
  for (const e of RAW) {
    assert.match(e.ticker, /^[A-Z]{1,5}$/, e.ticker);
    assert.ok(!seen.has(e.ticker), `${e.ticker} once`);
    seen.add(e.ticker);
    assert.ok(Array.isArray(e.src) && e.src.length >= 1, `${e.ticker} has src`);
    for (const u of e.src) assert.match(u, /^https:\/\/[^\s]+$/, `${e.ticker} src`);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, e.ticker);
    assert.ok(Number.isFinite(Date.parse(e.date)), e.ticker);
    if ('listed' in e) assert.ok(Number.isInteger(e.listed) && e.listed <= Number(e.date.slice(0, 4)), `${e.ticker} listed`);
    for (const w of e.also || []) assert.match(w, /^[A-Z]{3,12}$/, `${e.ticker} also`);
    assert.ok(e.name.length <= (e.zombie ? 40 : 28) && e.what.length <= 34, e.ticker);
  }
  const text = JSON.stringify(RAW);
  assert.doesNotMatch(text, BANNED);
  assert.doesNotMatch(text, /—/, 'no em dashes');
  const shown = JSON.stringify(RAW.map((e) => [e.what, e.epitaph, e.cause, e.seoTitle, e.peakLine]));
  assert.doesNotMatch(shown, /\bbuy\b|\bsell\b|returns?\b|you should|will (rise|fall)/i, 'history, not advice');
});

test('graveyard: lookup by old ticker or by name word; the line reads right', () => {
  const leh = findGrave(GRAVE, 'leh');
  assert.equal(leh?.ticker, 'LEH');
  assert.equal(findGrave(GRAVE, 'LEHMAN')?.ticker, 'LEH');
  assert.equal(findGrave(GRAVE, 'MAXX'), null);
  assert.equal(findGrave(GRAVE, ''), null);
  assert.equal(dayText('2008-09-15'), '15 Sep 2008');
  assert.match(tombstoneLine(leh), /^LEH\. Lehman Brothers\.( Listed \d{4}\.)? Filed for bankruptcy 15 Sep 2008\.$/);
  const html = noSuchExtra('LEH', { grave: leh, ipo: false }, { ticker: 'LEH' });
  assert.match(html, /gv-stone/);
  assert.match(html, /PAY RESPECTS/);
  assert.match(html, /SHARE ON X/);
  assert.match(html, /GRAVEYARD\+LEH/);
  assert.doesNotMatch(html, /IPO IT/, 'a tombstone, not a joke');
  assert.match(stoneHtml(leh), /R\.I\.P\./);
  const table = graveyardTable(GRAVE);
  assert.equal((table.match(/<tr>/g) || []).length, GRAVE.length + 1);
  assert.match(table, /data-cmd="GRAVEYARD LEH"/);
});

test('GRAVEYARD and IPO IT: the router, never a pro-terminal code as a command', () => {
  assert.equal(parseCommand('GRAVEYARD').name, 'GRAVEYARD');
  assert.deepEqual(parseCommand('graveyard leh').args, { ticker: 'LEH' });
  assert.equal(urlFor('GRAVEYARD LEH').url, 'GRAVEYARD LEH');
  const ipo = parseCommand('ipo it maxx');
  assert.equal(ipo.name, 'IPOIT');
  assert.equal(ipo.args.word, 'MAXX');
  assert.equal(urlFor('IPO IT MAXX').url, 'IPO IT MAXX');
  assert.equal(parseCommand('IPO IT TOOLONG').args.word, null);
  assert.equal(parseCommand('IPO IT M4X').args.word, null);
  assert.equal(parseCommand('IPO IT A B').args.word, null);
  assert.notEqual(parseCommand('IPO').name, 'IPOIT', 'IPO alone is not a command');
  assert.equal(matchNoSuch('IPO', ['MAXX']), null);
  assert.equal(findCommand('IPO'), null);
  assert.equal(findCommand('GRAVEYARD').name, 'GRAVEYARD');
  assert.equal(findCommand('IPOIT'), null, 'IPO IT is not listed');
});

test('IPO IT guard: A-Z, 1 to 5 letters, never a live ticker, a word the library flags or an extra listed word', () => {
  assert.equal(ipoShape('maxx'), 'MAXX');
  for (const bad of ['', 'TOOLNG', 'M4X', 'BRK.B', 'A B', '<b>', 'MAX$', 'ÅBC', 'AAPL', 'NVDA']) assert.equal(ipoShape(bad), null, bad);
  assert.equal(ipoAllowed('maxx', BLOCK), 'MAXX');
  assert.equal(ipoAllowed('ZZTOP', BLOCK), null, 'whole word');
  assert.equal(ipoAllowed('AQQQX', BLOCK), null, 'root inside a word');
  assert.equal(ipoAllowed('QQX', BLOCK), 'QQX', 'a root blocks only where it appears');
  // The obscenity library: mild words from its own dataset, built so no word sits in the repo.
  for (const w of ['A' + 'SS', 'SE' + 'X', 'SH' + 'IT']) {
    assert.equal(flagged(w), true, 'the library flags it');
    assert.equal(ipoAllowed(w, parseBlocklist('')), null, 'refused with no extra list');
  }
  for (const w of ['MAXX', 'CLASS', 'BASS', 'HELLO']) assert.equal(flagged(w), false, w);
  assert.equal(ipoAllowed('MAXX', parseBlocklist('')), 'MAXX', 'the library is the base list: an empty extra list is fine');
  assert.equal(ipoAllowed('MAXX'), 'MAXX');
  assert.deepEqual([...BLOCK.words], ['ZZTOP'], 'bad lines are dropped');
  const shipped = loadBlocklist();
  assert.ok(shipped.words instanceof Set && Array.isArray(shipped.roots));
  assert.equal(ipoAllowed('MAXX', loadBlocklist('/nonexistent/file')), 'MAXX', 'a missing extra list: the library still guards');
  assert.equal(ipoAllowed('A' + 'SS', loadBlocklist('/nonexistent/file')), null);
  // The screen: IPO IT only when the server said yes, and only for a ticker.
  const page = (ipo, top = null) => tickerPageHtml({ typed: 'MAXX', word: 'MAXX', info: { grave: null, ipo }, top, graves: GRAVE });
  assert.match(page(true, { kind: 'live', id: 'MAX', name: 'MAX', cmd: 'MAX' }), /data-cmd="IPO IT MAXX" data-ipo data-key="2">IPO IT</, 'key 2 under the Did-you-mean line');
  assert.doesNotMatch(page(false), /IPO IT/);
  assert.equal(TITLE_YET, 'No such ticker. Yet.');
});

test('FEEDBACK prefill: "Tell us." carries Please add: WORD, used once', () => {
  const html = tickerPageHtml({ typed: 'MAXX', word: 'MAXX', info: { grave: null, ipo: false }, graves: GRAVE });
  assert.match(html, /Want it on Bloombroke\? <a [^>]*data-cmd="FEEDBACK" data-prefill="Please add: MAXX">Tell us\.<\/a>/);
  assert.equal(FEEDBACK_PREFILL('MAXX'), 'Please add: MAXX');
  setPrefill('Please add: MAXX');
  assert.equal(takePrefill(), 'Please add: MAXX');
  assert.equal(takePrefill(), '', 'once');
});

test('goals and share links', () => {
  for (const g of ['notfound_seen', 'graveyard_seen', 'ipo_made', 'ipo_shared']) assert.ok(GOALS.includes(g), g);
  assert.deepEqual(GOAL_PROPS.ipo_shared, ['via']);
  assert.deepEqual(cleanProps('ipo_shared', { via: 'x' }), { via: 'x' });
  const l = ipoLinks('MAXX', 'https://bloombroke.com');
  assert.equal(l.url, 'https://bloombroke.com/?c=IPO+IT+MAXX');
  assert.equal(l.image, '/og/ipo.png?t=MAXX');
  assert.match(new URL(l.x).searchParams.get('text'), /I listed \$MAXX\. Shares outstanding: 1\. Price: \$0\.00\./);
  const g = graveLinks(findGrave(GRAVE, 'LEH'), 'https://bloombroke.com');
  assert.equal(g.url, 'https://bloombroke.com/?c=GRAVEYARD+LEH');
  const html = ipoHtml('MAXX', l);
  assert.match(html, /SHARE ON X/);
  assert.match(html, /COPY LINK/);
  assert.match(html, /not a real security/i);
});

test('share meta: GRAVEYARD <ticker> and IPO IT <word> only', () => {
  const deps = { graveyard: GRAVE, block: BLOCK };
  const m = nosuchMeta('GRAVEYARD LEH', deps);
  assert.match(m.image, /\/og\/tombstone\.png\?t=LEH$/);
  assert.match(m.url, /\?c=GRAVEYARD\+LEH$/);
  assert.equal(nosuchMeta('GRAVEYARD LEHMAN', deps).url, m.url);
  assert.equal(nosuchMeta('GRAVEYARD', deps), null);
  assert.equal(nosuchMeta('GRAVEYARD MAXX', deps), null);
  assert.match(nosuchMeta('ipo it maxx', deps).image, /\/og\/ipo\.png\?t=MAXX$/);
  assert.equal(nosuchMeta('IPO IT ZZTOP', deps), null);
  assert.equal(nosuchMeta(`IPO IT ${'SE' + 'X'}`, { graveyard: GRAVE, block: parseBlocklist('') }), null, 'the library refuses it');
  assert.equal(nosuchMeta('AAPL', deps), null);
  for (const v of Object.values(nosuchMeta('IPO IT MAXX', deps))) assert.doesNotMatch(v, /—/);
});

test('cards: tombstone and listing certificate render 1200x630, no banned words', async () => {
  const leh = findGrave(GRAVE, 'LEH');
  for (const tree of [tombstoneTree(leh), await ipoTree('MAXX')]) {
    const s = JSON.stringify(tree);
    assert.doesNotMatch(s, BANNED);
    assert.doesNotMatch(s, /—/);
  }
  assert.match(JSON.stringify(await ipoTree('MAXX')), /NOT A REAL SECURITY/);
  const cards = makeNoSuchCards({ graveyard: GRAVE, block: BLOCK });
  for (const out of [await cards.tombstone('LEH'), await cards.ipo('MAXX')]) {
    const info = await sharp(out.png).metadata();
    assert.equal(info.format, 'png');
    assert.equal(info.width, W);
    assert.equal(info.height, H);
  }
});

test('OG routes: render once, then serve from memory; anything refused gets the site card', async () => {
  const siteCard = await sharp({ create: { width: W, height: H, channels: 3, background: '#05080C' } }).png().toBuffer();
  let renders = 0;
  const fake = Buffer.from('card');
  const app = express();
  mountNoSuch(app, { graveyard: GRAVE, block: BLOCK, render: async () => { renders += 1; return fake; }, fallback: async () => siteCard });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const get = async (p) => { const r = await fetch(base + p); return { r, body: Buffer.from(await r.arrayBuffer()) }; };
    let { r, body } = await get('/og/ipo.png?t=maxx');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('cache-control'), `public, max-age=${IPO_MAX_AGE}`);
    assert.deepEqual(body, fake);
    await get('/og/ipo.png?t=MAXX');
    assert.equal(renders, 1, 'cached');
    ({ r, body } = await get('/og/tombstone.png?t=LEH'));
    assert.equal(r.headers.get('cache-control'), `public, max-age=${TOMB_MAX_AGE}`);
    await get('/og/tombstone.png?t=LEH');
    assert.equal(renders, 2, 'cached');
    for (const p of ['/og/ipo.png?t=ZZTOP', '/og/ipo.png?t=TOOLONG', '/og/ipo.png?t=%3Cb%3E', '/og/ipo.png', '/og/tombstone.png?t=MAXX', '/og/tombstone.png?t=LEHMAN']) {
      ({ r, body } = await get(p));
      assert.equal(r.status, 200, p);
      assert.deepEqual(body, siteCard, p);
      assert.equal(r.headers.get('cache-control'), 'public, max-age=300', p);
    }
    assert.equal(renders, 2);
    const info = await (await fetch(`${base}/api/nosuch?t=leh`)).json();
    assert.equal(info.grave.ticker, 'LEH');
    assert.equal(info.ipo, false);
    assert.deepEqual(await (await fetch(`${base}/api/nosuch?t=MAXX`)).json(), { grave: null, ipo: true, wins: false });
    assert.deepEqual(await (await fetch(`${base}/api/nosuch?t=ZZTOP`)).json(), { grave: null, ipo: false, wins: false });
    assert.equal((await (await fetch(`${base}/api/nosuch?t=${'SE' + 'X'}`)).json()).ipo, false);
    const all = await (await fetch(`${base}/api/graveyard`)).json();
    assert.equal(all.entries.length, GRAVE.length);
  } finally {
    server.close();
  }
});

test('the screens say it short: no banned words, no em dashes, no advice', () => {
  const src = ['../public/nosuch.js', '../public/screens/nosuch.js', '../lib/og-nosuch.js', '../public/nosuch.css']
    .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, BANNED);
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, /\bbuy\b/i);
  assert.doesNotMatch(src, /amber|orange|#F[0-9A-F]A[0-9A-F]{3}\b/i);
});

test('graveyard beats a non-US quote; a US listing wins', async () => {
  assert.equal(graveBeatsQuote({ name: 'Lampetia AG', currency: 'EUR', exchange: 'Frankfurt Stock Exchange' }), true);
  assert.equal(graveBeatsQuote({ name: 'Twitter (delisted)', currency: 'USD' }), true);
  assert.equal(graveBeatsQuote(null), true);
  assert.equal(graveBeatsQuote({ name: 'Waste Management Inc', currency: 'USD', exchange: 'NYSE' }), false);
  const quotes = { LEH: { name: 'Lampetia AG', currency: 'EUR' }, WM: { name: 'Waste Management Inc', currency: 'USD' } };
  const app = express();
  mountNoSuch(app, { graveyard: GRAVE, block: BLOCK, getQuote: async (t) => quotes[t] || null, render: async () => Buffer.from('x'), fallback: async () => Buffer.from('y') });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ask = async (t) => (await fetch(`${base}/api/nosuch?t=${t}`)).json();
    assert.equal((await ask('LEH')).wins, true, 'LEH on Frankfurt: the tombstone');
    assert.equal((await ask('WM')).wins, false, 'WM on the NYSE: the quote');
    assert.equal((await ask('ENE')).wins, true, 'no quote at all');
    assert.equal((await ask('LEHMAN')).wins, false, 'a name word is not a ticker to beat');
  } finally {
    server.close();
  }
  const html = noSuchExtra('LEH', { grave: findGrave(GRAVE, 'LEH'), ipo: false, wins: true }, { ticker: 'LEH', quote: true });
  assert.match(html, /<a class="card-link" href="\?c=%24LEH" data-cmd="\$LEH" title="Quote: \$LEH, another listing">\$LEH<\/a>/);
  assert.doesNotMatch(noSuchExtra('LEH', { grave: findGrave(GRAVE, 'LEH') }, { ticker: 'LEH' }), /Quote:/);
});

test('NO SUCH TICKER: the certificate is made out to what was typed; stones only when the letters match', () => {
  const four = pickGraves(GRAVE, 4, () => 0.5);
  assert.equal(four.length, 4, 'pickGraves stays for other callers');
  // The certificate: the typed ticker, ONE SHARE, today's date, a serial from the letters.
  const cert = certHtml('MAXX', { day: '2026-09-30' });
  assert.match(cert, /certificate\.webp/);
  assert.match(cert, /<span class="nsc nsc-big" aria-hidden="true">\$MAXX<\/span>/);
  assert.match(cert, /ONE SHARE/);
  assert.match(cert, /Issued 30 Sep 2026/);
  assert.match(cert, new RegExp(`No\\. ${certSerial('MAXX')}`));
  assert.match(cert, /class="nsc-stamp" aria-hidden="true">NOT A REAL SECURITY</);
  assert.match(cert, /role="img" aria-label="A listing certificate: one share of \$MAXX, issued 30 Sep 2026/);
  assert.equal(certSerial('MAXX'), certSerial('maxx'), 'the same letters, the same serial');
  assert.notEqual(certSerial('MAXX'), certSerial('MAXY'));
  assert.match(certSerial('Q'), /^\d{6}$/);
  // The page: the hero, IPO IT, the certificate right with its share links (the IPO IT page).
  const html = tickerPageHtml({ typed: 'MAXX', word: 'MAXX', info: { ipo: true }, graves: GRAVE, day: '2026-09-30' });
  assert.match(html, /^<section class="card card-wide card-split ns-card ns-tk"/);
  assert.match(html, /card-hero-96 num">\$MAXX<\/h2><p class="card-sub">Nobody has listed it\. Be the first\./);
  assert.match(html, /data-cmd="IPO IT MAXX" data-ipo data-key="1">IPO IT</);
  assert.match(html, /<div class="card-art"><div class="ns-cert-col"><figure class="ns-cert2"[\s\S]*SHARE ON X[\s\S]*data-copy="https:\/\/bloombroke\.com\/\?c=IPO\+IT\+MAXX"/);
  assert.doesNotMatch(html, /gv-stone|ns-rip/, 'no dead ticker matches MAXX: no stones, never random ones');
  // Not listable (a blocked word): the words alone, no certificate, no share.
  const bare = tickerPageHtml({ typed: 'MAXX', word: 'MAXX', info: { ipo: false }, graves: GRAVE });
  assert.doesNotMatch(bare, /ns-cert2|SHARE ON X|card-split/);
  // LEHM: LEH stands under the words, in the stone art, a link to its page.
  assert.deepEqual(graveMatches('LEHM', GRAVE).map((e) => e.ticker), ['LEH']);
  assert.deepEqual(graveMatches('XQZT', GRAVE), []);
  assert.ok(graveMatches('ENR', GRAVE).length <= 3);
  const lehm = tickerPageHtml({ typed: 'LEHM', word: 'LEHM', info: { ipo: true }, graves: GRAVE });
  assert.match(lehm, /<a class="ns-rip-stone" href="\?c=GRAVEYARD\+LEH" data-cmd="GRAVEYARD LEH"[^>]*><figure class="gv-stone is-small/);
  assert.equal(ripRowHtml([]), '');
});

test('IPO cards: memory only, bounded by entries and bytes', () => {
  assert.ok(IPO_MEMORY.entries <= 500 && IPO_MEMORY.bytes <= 64 * 1024 * 1024);
  const c = byteLru({ entries: 3, bytes: 10 });
  c.set('A', Buffer.alloc(4));
  c.set('B', Buffer.alloc(4));
  assert.equal(c.size, 2);
  c.set('C', Buffer.alloc(4)); // 12 bytes: A goes
  assert.equal(c.get('A'), undefined);
  assert.equal(c.bytes, 8);
  c.get('B');
  c.set('D', Buffer.alloc(1));
  c.set('E', Buffer.alloc(1)); // 4 entries: C (least recent) goes
  assert.equal(c.get('C'), undefined);
  assert.ok(c.get('B'));
  c.set('F', Buffer.alloc(11)); // bigger than the whole cache: never kept
  assert.equal(c.get('F'), undefined);
  const src = readFileSync(new URL('../lib/og-nosuch.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /writeFile|mkdir|rename|CACHE_DIR|writeAtomic/, 'no disk cache');
});

test('IPO cards: per-address, all-address and waiting limits give the site card, kept short', async () => {
  let renders = 0;
  const site = Buffer.from('site');
  const cards = makeNoSuchCards({
    graveyard: GRAVE, block: BLOCK, fallback: async () => site,
    render: async () => { renders += 1; return Buffer.from(`card${renders}`); },
    allow: makeRateLimit({ renders: 2, windowMs: 60_000, addresses: 10 }),
    allowAll: makeRateLimit({ renders: 3, windowMs: 60_000, addresses: 1 }),
  });
  const words = ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE'].map((w) => w.replace(/./g, (ch, i) => (i === 3 ? 'Q' : ch)));
  const a1 = await cards.ipo(words[0], '1.1.1.1');
  const a2 = await cards.ipo(words[1], '1.1.1.1');
  assert.equal(a1.drawn && a2.drawn, true);
  assert.equal(a1.maxAge, 604800);
  const a3 = await cards.ipo(words[2], '1.1.1.1');
  assert.deepEqual([a3.png, a3.maxAge, a3.drawn], [site, BUSY_MAX_AGE, false], 'per address');
  assert.deepEqual((await cards.ipo(words[0], '1.1.1.1')).png, a1.png, 'a kept card costs nothing');
  assert.equal((await cards.ipo(words[2], '2.2.2.2')).drawn, true);
  const b = await cards.ipo(words[3], '3.3.3.3');
  assert.deepEqual([b.png, b.maxAge], [site, BUSY_MAX_AGE], 'across all addresses');
  assert.equal(renders, 3);
  const r = await cards.ipo('ZZTOP', '4.4.4.4');
  assert.deepEqual([r.png, r.maxAge, r.drawn], [site, REFUSED_MAX_AGE, false], 'refused word');
  assert.equal(renders, 3);
  assert.ok(IPO_RATE.renders <= 30 && IPO_GLOBAL.renders <= 600);
});

test('IPO cards: a flood of new words waits in a short line, the rest get the site card', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let renders = 0;
  const site = Buffer.from('site');
  const cards = makeNoSuchCards({
    graveyard: GRAVE, block: BLOCK, fallback: async () => site, pendingMax: 2,
    render: async () => { renders += 1; await gate; return Buffer.from('card'); },
  });
  const ask = ['MAXA', 'MAXB', 'MAXC', 'MAXD'].map((w, i) => cards.ipo(w, `9.9.9.${i}`));
  const late = await ask[2];
  assert.deepEqual([late.png, late.maxAge], [site, BUSY_MAX_AGE]);
  assert.equal(cards.pending(), 2);
  release();
  const done = await Promise.all(ask);
  assert.deepEqual(done.map((d) => d.drawn), [true, true, false, false]);
  assert.equal(cards.pending(), 0);
  // A failed render: the site card, kept short, nothing kept.
  const bad = makeNoSuchCards({ graveyard: GRAVE, block: BLOCK, fallback: async () => site, render: async () => { throw new Error('boom'); } });
  const f = await bad.ipo('MAXE', '8.8.8.8');
  assert.deepEqual([f.png, f.maxAge, f.drawn], [site, BUSY_MAX_AGE, false]);
  assert.equal(bad.cache.size, 0);
});

test('the share page never draws a card: meta only', () => {
  let renders = 0;
  const app = express();
  const ns = mountNoSuch(app, { graveyard: GRAVE, block: BLOCK, render: async () => { renders += 1; return Buffer.from('x'); }, fallback: async () => Buffer.from('y') });
  for (let i = 0; i < 50; i += 1) ns.meta(`IPO IT MX${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
  assert.equal(renders, 0);
  assert.equal(ns.cache.size, 0);
});
