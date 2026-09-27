// NO SUCH TICKER. YET.: did-you-mean rows, GRAVEYARD, IPO IT's guard, the share cards
// and the FEEDBACK prefill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import sharp from 'sharp';
import { parseCommand, didYouMeanHtml, urlFor } from '../public/app.js';
import { findCommand } from '../public/registry.js';
import { dymRows, graveBeatsQuote, pickGraves, ipoShape, matchNoSuch, findGrave, tombstoneLine, dayText, ipoLinks, graveLinks, FEEDBACK_PREFILL, MAX_ROWS } from '../public/nosuch.js';
import { noSuchExtra, graveyardTable, tombstoneHtml, ipoHtml, ipoPreviewHtml, yardHtml, TITLE_YET } from '../public/screens/nosuch.js';
import { setPrefill, takePrefill } from '../public/screens/feedback.js';
import { GOALS, GOAL_PROPS, cleanProps } from '../public/goal.js';
import {
  loadGraveyard, parseBlocklist, loadBlocklist, ipoAllowed, flagged, makeNoSuchCards, mountNoSuch, nosuchMeta, tombstoneTree, ipoTree, IPO_MAX_AGE, TOMB_MAX_AGE,
} from '../lib/og-nosuch.js';
import { W, H } from '../lib/og.js';

const BANNED = new RegExp(['bloom', 'berg'].join(''), 'i');
const RAW = JSON.parse(readFileSync(new URL('../data/graveyard.json', import.meta.url), 'utf8'));
const GRAVE = loadGraveyard();
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
  assert.match(html, /No ticker called <span class="code">DATA<\/span>/);
  assert.match(html, /Type <a class="code"[^>]*>HELP<\/a> for every command\.<\/p>$/, 'HELP is the last line');
  assert.doesNotMatch(html, /A company name works too|A ticker is one word/, 'the old text is gone');
});

test('graveyard: every entry is sourced and well formed', () => {
  assert.ok(RAW.length >= 20, `${RAW.length} entries`);
  assert.equal(GRAVE.length, RAW.length, 'every entry passes the loader');
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
    assert.ok(e.name.length <= 28 && e.what.length <= 34, e.ticker);
  }
  const text = JSON.stringify(RAW);
  assert.doesNotMatch(text, BANNED);
  assert.doesNotMatch(text, /—/, 'no em dashes');
  assert.doesNotMatch(text, /\bbuy\b|return/i, 'history, not advice');
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
  assert.match(html, /ns-stone/);
  assert.match(html, /SHARE ON X/);
  assert.match(html, /GRAVEYARD\+LEH/);
  assert.doesNotMatch(html, /IPO IT/, 'a tombstone, not a joke');
  assert.match(tombstoneHtml(leh), /R\.I\.P\./);
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
  assert.match(noSuchExtra('MAXX', { grave: null, ipo: true }, { ticker: 'MAXX', next: 2 }), /data-cmd="IPO IT MAXX" data-ipo data-key="2">IPO IT</);
  assert.doesNotMatch(noSuchExtra('MAXX', { grave: null, ipo: false }, { ticker: 'MAXX' }), /IPO IT/);
  assert.equal(TITLE_YET, 'No such ticker. Yet.');
});

test('FEEDBACK prefill: "Tell us." carries Please add: WORD, used once', () => {
  const html = noSuchExtra('MAXX', { grave: null, ipo: false }, { ticker: 'MAXX' });
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
  assert.match(html, /Quote: <a class="code dim" href="\?c=%24LEH" data-cmd="\$LEH">\$LEH<\/a>/);
  assert.doesNotMatch(noSuchExtra('LEH', { grave: findGrave(GRAVE, 'LEH') }, { ticker: 'LEH' }), /Quote:/);
});

test('the unknown-word page: certificate preview and THE GRAVEYARD row', () => {
  let i = 0;
  const seq = [0.1, 0.9, 0.5, 0.3, 0.7];
  const four = pickGraves(GRAVE, 4, () => seq[i++ % seq.length]);
  assert.equal(four.length, 4);
  assert.equal(new Set(four.map((e) => e.ticker)).size, 4, 'no repeats');
  assert.equal(pickGraves([], 4).length, 0);
  const html = noSuchExtra('MAXX', { grave: null, ipo: true }, { ticker: 'MAXX', next: 1, yard: four });
  assert.match(html, /class="ns-mini"[^>]*data-cmd="IPO IT MAXX" data-ipo/);
  assert.match(html, /\$MAXX<\/span><span class="ns-mini-stamp">NOT A REAL SECURITY/);
  assert.equal((html.match(/class="ns-mini-stone"/g) || []).length, 4);
  for (const e of four) assert.match(html, new RegExp(`data-cmd="GRAVEYARD ${e.ticker}"`));
  assert.doesNotMatch(noSuchExtra('MAXX', { grave: null, ipo: false }, { ticker: 'MAXX', yard: four }), /ns-mini"/, 'no IPO, no preview');
  assert.equal(yardHtml([]), '');
  assert.match(ipoPreviewHtml('MAXX'), /certificate\.webp/);
});
