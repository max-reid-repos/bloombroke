// WHATIF growth: plain search titles for catalogue items, one sitemap URL per item,
// the /embed pages (framable, footer locked), the EMBED snippets and the GUESS card.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { seoItem, seoWords, whatifItemMeta, whatifSitemapUrls, priceText, habitSpend } from '../lib/whatif-seo.js';
import { certVersion } from '../data/whatif-cert.js';
import { sitemapUrls, commandMeta } from '../lib/seo.js';
import { securityHeaders } from '../lib/embed.js';
import { mountEmbeds, EMBED_SOURCE, EMBED_NOT_ADVICE, embedSentence } from '../lib/embed-pages.js';
import { whatifEmbedSnippet, guessEmbedSnippet } from '../public/embed-snippet.js';
import { guessCardModel, guessTree, makeGuessCard, GUESS_ASK, GUESS_LINK } from '../lib/og-guess.js';
import { renderPng } from '../lib/og.js';
import { makeGuess } from '../data/guess.js';
import { parseCommand } from '../public/app.js';

const catalog = JSON.parse(readFileSync(new URL('../data/whatif-products.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-09-27T12:00:00Z');
const OTHER = new RegExp(['bloom', 'berg'].join(''), 'i'); // the name this site never writes

const model = (command, extra = {}) => ({
  command, big: '$8,770', multiple: '13.5x', spent: 'You spent $649.00', ribbon: 'iPhone 6', holding: '25.7 shares of Apple',
  loss: false, receipt: ['iPhone 6'], doodle: 'phones', fit: { ribbon: 3.8, big: 11, lines: 2.4, mult: 3 }, ...extra,
});

// ---- Search titles ----------------------------------------------------------------

test('SEO: a gadget gets a plain "instead of" title and a description with the engine numbers', () => {
  const meta = whatifItemMeta('WHATIF IPHONE6', model('WHATIF IPHONE6'), { catalog, now: NOW });
  assert.equal(meta.title, 'What if you bought Apple stock instead of the iPhone 6?');
  assert.equal(meta.description, 'An iPhone 6 cost $649 in Sep 2014. The same money in Apple stock is worth $8,770 today (13.5x). Price only, split-adjusted. Hindsight, not advice.');
  assert.equal(meta.url, 'https://bloombroke.com/?c=WHATIF+IPHONE6');
  assert.equal(meta.image, `https://bloombroke.com/og/whatif.png?c=WHATIF+IPHONE6&v=${certVersion(model('WHATIF IPHONE6'))}`, 'v: the numbers\' own image');
  assert.equal(whatifItemMeta('WHATIF IPHONE6', null, { catalog, now: NOW }).image, 'https://bloombroke.com/og/whatif.png?c=WHATIF+IPHONE6', 'no numbers yet: no version');
  assert.match(meta.alt, /^A WHATIF certificate\. An iPhone 6 cost \$649 in Sep 2014\. In Apple stock the same money is worth \$8,770 today \(13\.5x\)\.$/);
  // Any case or spacing is the same page.
  assert.equal(whatifItemMeta('whatif   iphone6', null, { catalog, now: NOW }).url, meta.url);
  assert.equal(seoWords(seoItem('WHATIF IPAD', catalog), null).title, 'What if you bought Apple stock instead of the first iPad?');
  assert.match(seoWords(seoItem('WHATIF IPHONE3G', catalog), null).fact, /^An iPhone 3G cost \$199 on contract in Jul 2008\.$/);
  assert.match(seoWords(seoItem('WHATIF XBOXONE', catalog), null).fact, /^An Xbox One cost/);
});

test('SEO: a habit says what a day of it cost; numbers from the model', () => {
  const m = model('WHATIF LATTE', { big: '$9,944', multiple: '1.0x', spent: 'You spent $9,765', ribbon: '5 years of lattes' });
  const meta = whatifItemMeta('WHATIF LATTE', m, { catalog, now: NOW });
  assert.equal(meta.title, 'What if you put $5.95 a day of lattes into Starbucks stock instead?');
  assert.equal(meta.description, '5 years of lattes cost $9,765. The same money in Starbucks stock, bought each month, is worth $9,944 today (1.0x). Price only, split-adjusted. Hindsight, not advice.');
  assert.equal(whatifItemMeta('WHATIF PRIME', null, { catalog, now: NOW }).title, 'What if you put $139 a year of Amazon Prime into Amazon stock instead?');
});

test('SEO: a vice likewise; a BLS-priced one names the thing, so its title does not move monthly', () => {
  const beer = whatifItemMeta('WHATIF BEER', model('WHATIF BEER', { big: '$4,302', multiple: '1.2x', spent: 'You spent $3,739', ribbon: '10 years of six-packs' }), { catalog, now: NOW });
  assert.equal(beer.title, 'What if you put the money for a six-pack of beer a week into AB InBev stock instead?');
  assert.equal(beer.description, '10 years of six-packs cost $3,739. The same money in AB InBev stock, bought each month, is worth $4,302 today (1.2x). Price only, split-adjusted. Hindsight, not advice.');
  assert.equal(whatifItemMeta('WHATIF BETTING', null, { catalog, now: NOW }).title, 'What if you put $20 a week of bets into DraftKings stock instead?');
  const soda = catalog.recurring.find((r) => r.id === 'soda');
  assert.equal(habitSpend(soda, { now: NOW }), habitSpend(soda, { now: new Date('2031-01-01') }));
});

test('SEO fallback: no model (slow quote) keeps the title, the description has no number', () => {
  const g = whatifItemMeta('WHATIF IPHONE6', null, { catalog, now: NOW });
  assert.equal(g.title, 'What if you bought Apple stock instead of the iPhone 6?');
  assert.equal(g.description, 'An iPhone 6 cost $649 in Sep 2014. See what the same money in Apple stock is worth today. Price only, split-adjusted. Hindsight, not advice.');
  const h = whatifItemMeta('WHATIF LATTE', null, { catalog, now: NOW });
  assert.equal(h.description, '5 years of lattes, put into Starbucks stock each month instead. See what it is worth today. Price only, split-adjusted. Hindsight, not advice.');
  for (const meta of [g, h]) assert.doesNotMatch(meta.description, /\d+(\.\d+)?x\)/);
  // A model for another command is not used.
  assert.doesNotMatch(whatifItemMeta('WHATIF IPHONE6', model('WHATIF IPHONE7'), { catalog, now: NOW }).description, /8,770/);
});

test('SEO: lists, periods and your own purchases (MY) keep the certificate title (null here)', () => {
  for (const c of ['WHATIF IPHONE6 IPHONE7', 'WHATIF LATTE:3Y', 'WHATIF MY NVDA 500 2020-01-15', 'WHATIF APPLE', 'WHATIF', 'WHATIF NOPE', 'AAPL']) {
    assert.equal(whatifItemMeta(c, null, { catalog, now: NOW }), null, c);
  }
});

test('SEO copy: every item title and description, no em dash, no banned words, not advice', () => {
  for (const p of [...catalog.products, ...catalog.recurring]) {
    const hit = seoItem(`WHATIF ${p.id}`, catalog);
    assert.ok(hit, p.id);
    const w = seoWords(hit, model(hit.command), { now: NOW });
    for (const s of [w.title, w.description, w.alt]) {
      // No bracket left over from a catalogue name (the multiple's own brackets aside).
      assert.doesNotMatch(s.replace(/\(\d[\d.,]*x\)/g, ''), /\u2014|\bbuy now\b|\bsell\b|\(|undefined|NaN/i, `${p.id}: ${s}`);
      assert.doesNotMatch(s, OTHER, p.id);
    }
    assert.match(w.title, /^What if you (bought|put) .+ stock instead( of .+)?\?$/, p.id);
  }
  assert.equal(priceText(299.99), '$299.99');
  assert.equal(priceText(57400), '$57,400');
});

// ---- Sitemap ----------------------------------------------------------------------

test('sitemap: exactly one URL per catalogue item, the same as its canonical, no duplicates', () => {
  const urls = sitemapUrls();
  assert.equal(new Set(urls).size, urls.length, 'no duplicates');
  const items = [...catalog.products, ...catalog.recurring];
  const whatifItems = urls.filter((u) => /\?c=WHATIF\+/.test(u));
  assert.equal(whatifItems.length, items.length);
  assert.deepEqual(whatifSitemapUrls(catalog), whatifItems);
  for (const p of items) {
    const canonical = whatifItemMeta(`WHATIF ${p.id}`, null, { catalog, now: NOW }).url;
    assert.equal(urls.filter((u) => u === canonical).length, 1, p.id);
  }
  assert.ok(!urls.some((u) => /%3A|MY\+|\+[A-Z0-9]+\+/.test(u.replace(/^.*c=WHATIF/, ''))), 'no periods, no MY, no lists');
});

// ---- Embeds -----------------------------------------------------------------------

async function serve(getCert, fn, opts = {}) {
  const app = express();
  const headers = securityHeaders();
  app.use((req, res, next) => { res.set(headers); next(); });
  mountEmbeds(app, { build: 'testbuild', getCert, catalog, ...opts });
  app.get('/', (req, res) => res.type('html').send('<!doctype html>home'));
  app.use((req, res) => res.status(404).type('html').send('<!doctype html>404'));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

const certFor = async (c) => {
  if (/\bMY\b/i.test(c)) throw new Error('MY must never reach getCert from an embed');
  const hit = seoItem(c, catalog);
  if (/SLOW/.test(c)) return new Promise(() => {});
  return hit ? model(hit.command) : null;
};

function assertFooter(html, what) {
  assert.ok(html.includes(EMBED_SOURCE), `${what}: source line`);
  assert.equal(EMBED_SOURCE, 'Prices: daily closes from a market data provider, split-adjusted, price only.');
  assert.ok(html.includes(EMBED_NOT_ADVICE), `${what}: not advice`);
  assert.equal(EMBED_NOT_ADVICE, 'Hindsight. Not financial advice.');
  assert.match(html, /<footer class="em-foot">[\s\S]*<a href="https:\/\/bloombroke\.com\/\?c=[^"]+" target="_blank" rel="noopener">bloombroke\.com<\/a><\/footer>/, `${what}: link`);
}

function assertFramable(res, what) {
  assert.equal(res.headers.get('x-frame-options'), null, `${what}: no X-Frame-Options`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors \*/, what);
  assert.doesNotMatch(csp, /datafa\.st|cloudflareinsights|googleapis/, `${what}: nothing from elsewhere`);
  assert.equal(res.headers.get('set-cookie'), null, `${what}: no cookie`);
}

test('embed /whatif: the card, the footer, framable; no analytics, no third-party anything', async () => {
  await serve(certFor, async (base) => {
    const res = await fetch(`${base}/embed/whatif?c=WHATIF+IPHONE6`);
    assert.equal(res.status, 200);
    assertFramable(res, 'whatif');
    const html = await res.text();
    assertFooter(html, 'whatif');
    assert.match(html, /<p class="em-big">\$8,770<\/p>/);
    assert.match(html, /An iPhone 6 cost \$649 in Sep 2014\./);
    assert.match(html, /href="https:\/\/bloombroke\.com\/\?c=WHATIF\+IPHONE6" target="_blank"/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /<html lang="en" class="is-embed">/, 'goal.js never loads analytics here');
    assert.equal(res.headers.get('cache-control'), 'private, max-age=600', 'a nonce page is never in a shared cache');
    assert.doesNotMatch(html, /<script|datafa\.st|fonts\.googleapis|localStorage|\u2014/);
    assert.doesNotMatch(html, OTHER);
    // The inline style runs only with this response's nonce.
    const nonce = /style-src 'nonce-([^']+)'/.exec(res.headers.get('content-security-policy'))[1];
    assert.ok(html.includes(`<style nonce="${nonce}">`));
  });
});

test('embed footer cannot be turned off by any parameter', async () => {
  await serve(certFor, async (base) => {
    const tries = ['footer=0', 'nofooter=1', 'hide=footer', 'embed=1', 'footer=false&source=0', 'c=WHATIF+IPHONE6&c=x', 'style=display:none', 'theme=clean&brand=0'];
    for (const q of tries) {
      for (const pathName of ['/embed/whatif?c=WHATIF+IPHONE6&', '/embed/guess?']) {
        const res = await fetch(`${base}${pathName}${q}`);
        const html = await res.text();
        assertFooter(html, `${pathName}${q}`);
      }
    }
  });
});

test('embed /whatif: a bad list is a 404 and a slow answer a 503, both with the footer', async () => {
  await serve(certFor, async (base) => {
    const bad = await fetch(`${base}/embed/whatif?c=WHATIF+NOPE`);
    assert.equal(bad.status, 404);
    assertFramable(bad, 'bad');
    assertFooter(await bad.text(), 'bad');
    const slow = await fetch(`${base}/embed/whatif?c=WHATIF+SLOW`);
    assert.equal(slow.status, 503);
    assert.equal(slow.headers.get('cache-control'), 'no-store');
    assertFooter(await slow.text(), 'slow');
    const none = await fetch(`${base}/embed/nothing`);
    assert.equal(none.status, 404);
    assert.equal(none.headers.get('cache-control'), 'private, max-age=600');
    assertFooter(await none.text(), 'none');
    // Your own purchase (MY), alone or in a list: no embed, and getCert is never asked.
    for (const c of ['WHATIF MY 5 A DAY AAPL SINCE 2018', 'WHATIF IPHONE6 MY NVDA 500 2020-01-15', 'whatif my 500 nvda on 2020-01-15']) {
      const mine = await fetch(`${base}/embed/whatif?${new URLSearchParams({ c })}`);
      assert.equal(mine.status, 404, c);
      const html = await mine.text();
      assert.match(html, /There is no embed here\./, c);
      assertFooter(html, c);
    }
  }, { waitMs: 50 });
});

test('embed /guess: the frame, our own script only, footer linking to GUESS', async () => {
  await serve(certFor, async (base) => {
    const res = await fetch(`${base}/embed/guess`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, max-age=600');
    assertFramable(res, 'guess');
    const html = await res.text();
    assertFooter(html, 'guess');
    assert.match(html, /<a href="https:\/\/bloombroke\.com\/\?c=GUESS" target="_blank" rel="noopener">bloombroke\.com<\/a>/);
    const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(scripts, ['/v/testbuild/embed-guess.js']);
    const font = await fetch(`${base}/embed/fonts/mono-800.ttf`);
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/ttf');
    assert.equal((await fetch(`${base}/embed/fonts/..%2F..%2Fserver.js`)).status, 404);
  });
});

test('framing: only /embed/* may be framed; every other route keeps SAMEORIGIN and frame-ancestors self', async () => {
  await serve(certFor, async (base) => {
    for (const p of ['/', '/terms', '/?c=WHATIF+IPHONE6', '/embedx', '/v/testbuild/embed-guess.js']) {
      const res = await fetch(base + p);
      assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', p);
      assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self'/, p);
      assert.doesNotMatch(res.headers.get('content-security-policy'), /frame-ancestors \*/, p);
    }
  });
  // The real server mounts the embeds before its catch-all page.
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.ok(server.indexOf('mountEmbeds(app') > 0 && server.indexOf('mountEmbeds(app') < server.indexOf('app.use((req, res) => sendIndex(res, 404))'));
});

test('embed guess script: its own storage key, no analytics, no other storage', () => {
  const js = readFileSync(new URL('../public/embed-guess.js', import.meta.url), 'utf8');
  assert.match(js, /EMBED_STORE_KEY = 'bb\.embed\.guess'/);
  const keys = [...js.matchAll(/localStorage\.(setItem|getItem|removeItem)\(([^,)]+)/g)].map((m) => m[2].trim());
  assert.ok(keys.length && keys.every((k) => k === 'EMBED_STORE_KEY'), keys.join());
  assert.doesNotMatch(js, /datafa|document\.cookie|sessionStorage|https:\/\/(?!bloombroke\.com)/);
});

test('embed sentence: a catalogue item says what it cost; a list says what was spent', () => {
  assert.equal(embedSentence(model('WHATIF IPHONE6'), catalog), 'An iPhone 6 cost $649 in Sep 2014.');
  assert.equal(embedSentence(model('WHATIF IPHONE6 LATTE', { ribbon: '2 things you bought', spent: 'You spent $2,000' }), catalog), '2 things you bought cost $2,000.');
  assert.equal(embedSentence(model('WHATIF IPHONE6 IPHONE7 IPHONE8', { ribbon: '3 iPhones', spent: 'You spent $1,997.00' }), catalog), '3 iPhones cost $1,997.00.');
  assert.equal(embedSentence(model('WHATIF LATTE:3Y', { ribbon: '3 years of lattes', spent: 'You spent $5,900' }), catalog), '3 years of lattes cost $5,900.');
});

// ---- EMBED buttons ------------------------------------------------------------------

test('EMBED copies the right one-line snippet', () => {
  assert.equal(whatifEmbedSnippet('WHATIF IPHONE6'), '<iframe src="https://bloombroke.com/embed/whatif?c=WHATIF+IPHONE6" width="600" height="420" style="border:0" loading="lazy" title="Bloombroke WHATIF"></iframe>');
  assert.equal(whatifEmbedSnippet('WHATIF LATTE:3Y'), '<iframe src="https://bloombroke.com/embed/whatif?c=WHATIF+LATTE%3A3Y" width="600" height="420" style="border:0" loading="lazy" title="Bloombroke WHATIF"></iframe>');
  assert.doesNotMatch(whatifEmbedSnippet('WHATIF "><script>'), /"><script>/);
  assert.equal(guessEmbedSnippet(), '<iframe src="https://bloombroke.com/embed/guess" width="600" height="420" style="border:0" loading="lazy" title="Bloombroke GUESS"></iframe>');
  const whatif = readFileSync(new URL('../public/screens/whatif.js', import.meta.url), 'utf8');
  assert.match(whatif, /data-embed="\$\{esc\(d\.cert\.command\)\}"[^>]*>Embed<\/button>/, 'Embed: an item of the SHARE menu');
  assert.match(whatif, /copyText\(whatifEmbedSnippet\(b\.dataset\.embed\)\)/);
  assert.match(whatif, /d\.cert && !d\.mine \? `<button type="button" class="wi-mi" role="menuitem" data-embed=/, 'no EMBED on MY results');
  assert.match(whatif, /if \(ok\) goal\('whatif_embed', \{ kind: 'whatif' \}, \{ once: b\.dataset\.embed \}\);/);
  const guess = readFileSync(new URL('../public/screens/guess.js', import.meta.url), 'utf8');
  assert.match(guess, /class="card-link gs-link gs-embed"[^>]*>EMBED<\/button>/, 'a text link beside COPY RESULT');
  assert.match(guess, /ctx\.copy\(guessEmbedSnippet\(\)\)/);
});

// ---- GUESS card ---------------------------------------------------------------------

const SECRET_POOL = [
  { ticker: 'ZQXV', name: 'Secret Answer Corp', sector: 'UTIL' },
  { ticker: 'WQJK', name: 'Other Name Inc', sector: 'ENERGY' },
];
const fakeChart = async () => ({ points: Array.from({ length: 400 }, (_, i) => ({ t: Date.UTC(2025, 8, 1) + i * 86_400_000, v: 100 + Math.sin(i / 20) * 10 + i / 10 })) });

test('GUESS card: the model has the number, the date and % values only; never the answer', async () => {
  const game = makeGuess({ getChart: fakeChart, getCaps: async () => ({ stocks: [] }), secret: 'x'.repeat(40), now: () => NOW, pool: SECRET_POOL });
  const puzzle = await game.todayPuzzle();
  const m = guessCardModel(puzzle);
  assert.deepEqual(Object.keys(m).sort(), ['date', 'end', 'n', 'points']);
  assert.ok(m.points.length <= 262 && m.points.every(Number.isFinite));
  const text = JSON.stringify(m) + JSON.stringify(guessTree(m));
  for (const secret of ['ZQXV', 'Secret Answer', 'WQJK', 'Other Name', 'UTIL', 'ENERGY']) assert.ok(!text.includes(secret), secret);
  assert.ok(text.includes(GUESS_ASK) && text.includes(GUESS_LINK) && text.includes(`GUESS #${puzzle.n}`));
  assert.equal(GUESS_ASK, 'Can you name this stock?');
  assert.equal(GUESS_LINK, 'bloombroke.com/?c=GUESS');
  assert.doesNotMatch(text, /\u2014/);
  assert.doesNotMatch(text, OTHER);
  assert.equal(guessCardModel({ n: 1, series: [[1, 2]] }), null);
});

test('GUESS card: drawn once per puzzle, cached until the next one, site card when the puzzle is down', async () => {
  let draws = 0;
  const puzzle = { n: 3, date: '2026-09-29', series: Array.from({ length: 30 }, (_, i) => [i, i - 5]), pool: [['ZQXV', 'Secret Answer Corp']] };
  const card = makeGuessCard({ todayPuzzle: async () => puzzle, render: async () => { draws += 1; return Buffer.from('png'); }, fallback: async () => Buffer.from('site'), now: () => NOW.getTime() });
  const a = await card.png();
  const b = await card.png();
  assert.equal(draws, 1);
  assert.equal(a.png.toString(), 'png');
  assert.equal(b.png, a.png);
  assert.ok(a.maxAge >= 60 && a.maxAge <= 3600);
  const down = makeGuessCard({ todayPuzzle: async () => { throw new Error('down'); }, render: async () => Buffer.from('png'), fallback: async () => Buffer.from('site') });
  const d = await down.png();
  assert.equal(d.png.toString(), 'site');
  assert.equal(d.maxAge, 300);
});

test('GUESS card renders a 1200x630 PNG, and ?c=GUESS points og:image at it', async () => {
  const series = Array.from({ length: 250 }, (_, i) => [i, Math.round(Math.sin(i / 15) * 800) / 100]);
  const png = await renderPng(guessTree(guessCardModel({ n: 12, date: '2026-10-08', series })));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
  const meta = commandMeta('GUESS', parseCommand);
  assert.equal(meta.image, 'https://bloombroke.com/og/guess.png');
  assert.match(meta.alt, /Can you name this stock\?/);
});

// ---- WHATIF card cache --------------------------------------------------------------

test('WHATIF card: only the real card on live prices is "real" (kept 10 minutes); stale and site cards are not', async (t) => {
  const { whatifCard } = await import('../lib/og.js');
  const { mkdtempSync, rmSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-card-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const row = { id: 'iphone6', kind: 'once', name: 'iPhone 6', company: 'Apple', ticker: 'AAPL', bought: '2014-09-19', close: 25, buys: 1, paid: 649, shares: 25.96, price: 250, value: 6490, multiple: 10 };
  const result = (stale) => ({ rows: [row], total: { paid: 649, value: 6490, gain: 5841, multiple: 10, pct: 900 }, stale });
  const deps = (stale) => ({ catalog, getWhatif: async () => result(stale), cacheDir: dir });
  const bad = await whatifCard('WHATIF NOPE', deps(false));
  assert.equal(bad.real, false);
  const stale = await whatifCard('WHATIF IPHONE6', deps(true));
  assert.equal(stale.real, false, 'last-known prices');
  assert.ok(stale.png.length > 1000);
  assert.deepEqual(readdirSync(dir), [], 'a stale card and model never go to disk');
  const live = await whatifCard('WHATIF IPHONE6', deps(false));
  assert.equal(live.real, true);
  const refused = await whatifCard('WHATIF MY 5 A DAY AAPL SINCE 2018', { catalog, getWhatif: async () => ({ ...result(false), rows: [{ ...row, id: 'mine1', mine: { short: '$5 a day', plural: '$5 a day', family: 'MY-AAPL', doodle: 'box' } }] }) }, { allow: () => false });
  assert.equal(refused.real, false, 'over the MY limit: the site card');
  assert.equal(refused.busy, true, 'kept a minute, not five');
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /sendPng\(res, card\.png, card\.busy \? 60 : card\.real \? 600 : 300\)/);
});
