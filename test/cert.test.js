import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { whatifTokens, normalizeWhatif, certKey, certModel, certVersion, DOODLES, fit, span } from '../data/whatif-cert.js';
import { getWhatif, catalog } from '../data/whatif-service.js';
import { withMeta, certMeta, DEFAULT_META, getCert, rememberCert, whatifCard, renderPng, certificateTree, defaultTree, W, H, CERT_TTL_MS } from '../lib/og.js';
import { whatifItemMeta } from '../lib/whatif-seo.js';
import { shareLinks, certHtml } from '../public/screens/whatif.js';

const NOW = new Date('2026-09-25T15:00:00Z');
// Fixed "today" prices, so the tests never touch the network.
const quoteImpl = async (t) => ({ last: { AAPL: 250, PTON: 5, SBUX: 90, TSLA: 400, NVDA: 180 }[t] ?? 100, asOf: '2026-09-25T15:00:00Z' });
const run = (c) => {
  const n = normalizeWhatif(c, catalog);
  return getWhatif(n.tokens, { quoteImpl, now: NOW }).then((r) => ({ r, m: certModel(r, catalog, n.command) }));
};

test('the ?c= guard is the /api/whatif guard', () => {
  assert.deepEqual(whatifTokens('WHATIF iphone6, latte:3y'), ['IPHONE6', 'LATTE:3Y']);
  assert.deepEqual(whatifTokens('iphone6 iphone8'), ['IPHONE6', 'IPHONE8']);
  assert.equal(whatifTokens('WHATIF <script>'), null);
  assert.equal(whatifTokens('WHATIF ' + 'A'.repeat(25)), null);
  assert.equal(whatifTokens('X '.repeat(41)), null);
  assert.equal(whatifTokens('x'.repeat(601)), null);
  assert.equal(whatifTokens(undefined).length, 0);
});

test('normalising: order, case, repeats and the WHATIF word do not change the key', () => {
  const a = normalizeWhatif('WHATIF IPHONE6 IPHONE8 LATTE:3Y', catalog);
  const b = normalizeWhatif('latte:3y iphone8 iphone6 IPHONE6', catalog);
  assert.equal(a.command, 'WHATIF IPHONE6 IPHONE8 LATTE:3Y');
  assert.equal(a.command, b.command);
  assert.equal(certKey(a.command), certKey(b.command));
  assert.match(certKey(a.command), /^[0-9a-f]{24}$/);
  assert.notEqual(certKey(a.command), certKey('WHATIF IPHONE6'));
  // Not a result: empty, unknown words, family words (the picker), EDIT.
  for (const c of ['', 'WHATIF', 'WHATIF FOO', 'WHATIF IPHONE', 'WHATIF EDIT IPHONE6', 'WHATIF ../../etc']) {
    assert.equal(normalizeWhatif(c, catalog), null, c);
  }
});

test('every catalog item has a short name, a plural and a doodle that exists', () => {
  for (const p of [...catalog.products, ...catalog.recurring]) {
    assert.ok(p.short && p.plural, p.id);
    assert.ok(DOODLES.includes(p.doodle), p.id);
  }
  for (const d of DOODLES) assert.ok(existsSync(new URL(`../public/img/whatif/doodle-${d}.webp`, import.meta.url)), d);
  assert.ok(existsSync(new URL('../public/img/whatif/certificate.webp', import.meta.url)));
});

test('certificate: one company, numbers straight from the engine', async () => {
  const { r, m } = await run('WHATIF IPHONE6 IPHONE8');
  assert.equal(m.ribbon, '2 iPhones');
  assert.equal(m.big, `$${Math.round(r.total.value).toLocaleString('en-US')}`);
  assert.equal(m.spent, 'You spent $1,348');
  const shares = r.rows.reduce((n, x) => n + x.shares, 0);
  assert.equal(m.holding, `${shares.toFixed(1)} shares of Apple`);
  assert.equal(m.multiple, `${r.total.multiple.toFixed(1)}x`);
  assert.equal(m.loss, false);
  assert.equal(m.doodle, 'phones');
  assert.deepEqual(m.receipt, ['iPhone 8', 'iPhone 6']);
  assert.equal(m.share, `My 2 iPhones would be ${m.big} in Apple stock today.`);
});

test('certificate: mixed picks, habits, losers and long lists', async () => {
  const mixed = (await run('WHATIF IPHONE6 MODEL3 RTX3080 PS5 SWITCH LATTE:3Y')).m;
  assert.equal(mixed.ribbon, '6 things you bought');
  assert.equal(mixed.holding, 'in 6 companies');
  assert.equal(mixed.doodle, 'car'); // the Model 3 is the biggest spend
  assert.equal(mixed.receipt.length, 5);
  assert.equal(mixed.receipt[4], '+2 more');
  assert.match(mixed.share, /^The 6 things I bought would be \$[\d,]+ in the makers' stock today\.$/);

  const latte = (await run('WHATIF LATTE:3Y')).m;
  assert.equal(latte.ribbon, '3 years of lattes');
  assert.equal(latte.doodle, 'coffee');
  assert.deepEqual(latte.receipt, ['Latte 3y']);

  const loser = (await run('WHATIF PELOTON')).m;
  assert.equal(loser.ribbon, 'Peloton Bike');
  assert.equal(loser.loss, true);
  assert.equal(loser.doodle, 'bike');

  assert.equal(span(12), '1 year');
  assert.equal(span(18), '18 months');
  assert.equal(span(60), '5 years');
});

test('type sizes shrink so long text stays on the paper', () => {
  assert.equal(fit('2 iPhones', 33, 3.8, 0.46), 3.8);
  const long = fit('$10,883,913,000', 58, 11, 0.6);
  assert.ok(long < 11 && long * 0.6 * 15 <= 58.01);
});

test('copy has no forbidden words and no em dashes', async () => {
  const { m } = await run('WHATIF IPHONE6 MODEL3 LATTE:3Y');
  const all = JSON.stringify([m, DEFAULT_META, certMeta(m)]);
  // The one name this site never prints (spelled in pieces so it is not in the repo either).
  assert.doesNotMatch(all, new RegExp(['bloom', 'berg'].join(''), 'i'));
  assert.doesNotMatch(all, /\u2014/);
});

test('meta: escaped, replaced once, large image card', () => {
  const html = '<head>\n  <meta property="og:title" content="old">\n  <meta name="twitter:card" content="summary">\n</head>';
  const out = withMeta(html, { title: 'A "quote" <script>&\'', description: 'd', image: 'https://bloombroke.com/og/whatif.png?c=WHATIF+IPHONE6&x=1', url: 'https://bloombroke.com/' });
  assert.equal((out.match(/og:title/g) || []).length, 1);
  assert.match(out, /content="A &quot;quote&quot; &lt;script&gt;&amp;&#39;"/);
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /og:image" content="https:\/\/bloombroke\.com\/og\/whatif\.png\?c=WHATIF\+IPHONE6&amp;x=1"/);
  assert.match(out, /twitter:card" content="summary_large_image"/);
  assert.doesNotMatch(out, /content="old"|content="summary"/);
});

test('meta and share links for a result', async () => {
  const { m } = await run('WHATIF LATTE:3Y IPHONE6');
  const meta = certMeta(m);
  assert.match(m.v, /^[0-9a-f]{12}$/);
  assert.equal(meta.image, `https://bloombroke.com/og/whatif.png?c=WHATIF+IPHONE6+LATTE%3A3Y&v=${m.v}`);
  assert.equal(meta.url, 'https://bloombroke.com/?c=WHATIF+IPHONE6+LATTE%3A3Y');
  const links = shareLinks(m, 'https://bloombroke.com');
  assert.equal(links.url, meta.url);
  assert.equal(links.image, `/og/whatif.png?c=WHATIF+IPHONE6+LATTE%3A3Y&v=${m.v}`, 'the download is the same versioned card');
  assert.equal(shareLinks({ ...m, v: undefined }, 'https://bloombroke.com').image, '/og/whatif.png?c=WHATIF+IPHONE6+LATTE%3A3Y');
  const x = new URL(links.x);
  assert.equal(x.origin + x.pathname, 'https://x.com/intent/post');
  assert.equal(x.searchParams.get('text'), m.share);
  assert.equal(x.searchParams.get('url'), `${meta.url}&v=${m.v}`, 'X gets a page URL per version (X caches the card per URL)');
  assert.equal(new URL(x.searchParams.get('url')).searchParams.get('c'), 'WHATIF IPHONE6 LATTE:3Y', 'the page still reads c=');
  assert.equal(new URL(shareLinks({ ...m, v: undefined }, 'https://bloombroke.com').x).searchParams.get('url'), meta.url);
  const html = certHtml({ ...m, ribbon: '<b>' }, links);
  assert.doesNotMatch(html, /<b>/);
});

test('cert cache: written once, reused, never for last-known prices', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-og-'));
  try {
    let calls = 0;
    const deps = { catalog, cacheDir: dir, getWhatif: (tokens) => { calls += 1; return getWhatif(tokens, { quoteImpl, now: NOW }); } };
    const a = await getCert('WHATIF IPHONE8 IPHONE6', deps);
    const b = await getCert('whatif iphone6 iphone8', deps);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
    assert.equal(readdirSync(dir).filter((f) => f.endsWith('.json')).length, 1);
    assert.equal(await getCert('WHATIF IPHONE', deps), null);

    const stale = { ...deps, getWhatif: async (tokens) => ({ ...(await getWhatif(tokens, { quoteImpl, now: NOW })), stale: true }) };
    assert.ok(await getCert('WHATIF PELOTON', stale));
    assert.equal(readdirSync(dir).filter((f) => f.endsWith('.json')).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cert cache: the numbers are kept 10 minutes, then redone; a new number is a new image file and a new ?v=', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-og-'));
  try {
    assert.equal(CERT_TTL_MS, 10 * 60 * 1000);
    let aapl = 250;
    let calls = 0;
    const quote = async (t) => ({ ...(await quoteImpl(t)), last: t === 'AAPL' ? aapl : (await quoteImpl(t)).last });
    const deps = { catalog, cacheDir: dir, getWhatif: (tokens) => { calls += 1; return getWhatif(tokens, { quoteImpl: quote, now: NOW }); } };
    const a = await getCert('WHATIF IPHONE6', deps);
    const cardA = await whatifCard('WHATIF IPHONE6', deps);
    aapl = 260; // the price moves
    assert.deepEqual(await getCert('WHATIF IPHONE6', deps), a, 'inside 10 minutes: the same numbers');
    assert.equal(calls, 1);
    // 11 minutes later (the saved numbers are older than CERT_TTL_MS): redone from the new price.
    const old = new Date(Date.now() - 11 * 60 * 1000);
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) utimesSync(path.join(dir, f), old, old);
    const b = await getCert('WHATIF IPHONE6', deps);
    assert.equal(calls, 2);
    assert.notEqual(b.big, a.big);
    assert.notEqual(b.v, a.v, 'new numbers, new version');
    assert.notEqual(certMeta(b).image, certMeta(a).image, 'new numbers, new image URL');
    const cardB = await whatifCard('WHATIF IPHONE6', deps);
    assert.equal(cardA.real && cardB.real, true);
    assert.notDeepEqual(cardB.png, cardA.png, 'the image is redrawn, never the old picture');
    const pngs = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    assert.deepEqual(pngs, [`cert-${a.v}.png`, `cert-${b.v}.png`].sort(), 'one image per version');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the page\'s result becomes the share numbers: getCert kept P0, /api/whatif runs on P1, getCert gives P1', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-og-'));
  try {
    let aapl = 250;
    const quote = async (t) => ({ ...(await quoteImpl(t)), last: t === 'AAPL' ? aapl : (await quoteImpl(t)).last });
    let calls = 0;
    const deps = { catalog, cacheDir: dir, getWhatif: (tokens) => { calls += 1; return getWhatif(tokens, { quoteImpl: quote, now: NOW }); } };
    const p0 = await getCert('WHATIF IPHONE6', deps);
    aapl = 262.5;
    // server.js /api/whatif: the page's model on the new price, then kept.
    const page = await getWhatif(['IPHONE6'], { quoteImpl: quote, now: NOW, risk: true, chartImpl: async () => null, riskWaitMs: 0 });
    const pageCert = certModel(page, catalog, normalizeWhatif('IPHONE6', catalog).command);
    assert.notEqual(pageCert.big, p0.big);
    await rememberCert(pageCert, { stale: page.stale, cacheDir: dir });
    const after = await getCert('WHATIF IPHONE6', deps);
    assert.equal(calls, 1, 'no new fetch: the page\'s numbers are used');
    assert.equal(after.big, pageCert.big);
    assert.equal(after.multiple, pageCert.multiple);
    assert.equal(after.v, pageCert.v);
    assert.ok(certMeta(after).image.endsWith(`&v=${pageCert.v}`));
    // Last-known prices are never kept.
    aapl = 300;
    const stalePage = certModel({ ...(await getWhatif(['IPHONE6'], { quoteImpl: quote, now: NOW })), stale: true }, catalog, 'WHATIF IPHONE6');
    await rememberCert(stalePage, { stale: true, cacheDir: dir });
    assert.equal((await getCert('WHATIF IPHONE6', deps)).v, pageCert.v, 'a stale page result leaves the kept numbers');
    const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    assert.match(server, /if \(data\.cert\) rememberCert\(data\.cert, \{ stale: data\.stale \}\)/, '/api/whatif keeps its result');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('page and share agree: /api/whatif\'s certificate, the share card, the page meta and the image link have the same numbers', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-og-'));
  try {
    // One fixed quote for everything (a stock, so your own purchase takes it too) and a
    // fixed daily history for MY.
    const quote = async (t) => ({ ...(await quoteImpl(t)), kind: 'stock', name: `${t} Inc.` });
    const dailyImpl = async () => {
      const out = [];
      for (let t = Date.parse('2014-06-02T00:00:00Z'); t <= Date.parse('2026-09-24T00:00:00Z'); t += 86_400_000) {
        const d = new Date(t);
        if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push([d.toISOString().slice(0, 10), 27.33]);
      }
      return out;
    };
    for (const typed of ['IPHONE6', 'LATTE:3Y IPHONE6', 'MY 1200 AAPL 2015']) {
      // The page: server.js /api/whatif (risk on, the tokens as typed), then certModel.
      const tokens = whatifTokens(typed);
      const page = await getWhatif(tokens, { quoteImpl: quote, now: NOW, risk: true, chartImpl: async () => null, riskWaitMs: 0, dailyImpl });
      const norm = normalizeWhatif(tokens.join(' '), catalog);
      const pageCert = certModel(page, catalog, norm.command);
      // The share: lib/og.js getCert (the card, the embed and the page meta all read it).
      const shared = await getCert(`WHATIF ${typed}`, { catalog, cacheDir: dir, getWhatif: (t) => getWhatif(t, { quoteImpl: quote, now: NOW, dailyImpl }) });
      assert.ok(shared, typed);
      assert.equal(shared.big, pageCert.big, `${typed}: the big number`);
      assert.equal(shared.multiple, pageCert.multiple, `${typed}: the multiple`);
      assert.equal(shared.share, pageCert.share, `${typed}: the X post text`);
      assert.equal(shared.v, pageCert.v, `${typed}: the same image version`);
      assert.equal(certVersion(shared), shared.v);
      const meta = whatifItemMeta(`WHATIF ${typed}`, shared, { catalog, now: NOW }) || certMeta(shared);
      assert.ok(meta.image.endsWith(`&v=${pageCert.v}`), `${typed}: ${meta.image}`);
      if (typed === 'IPHONE6') assert.ok(meta.description.includes(`${pageCert.big} today (${pageCert.multiple})`), meta.description);
      else assert.ok(meta.description.includes(`${pageCert.big}, ${pageCert.multiple}`), meta.description);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('share images render at 1200x630', async () => {
  const { m } = await run('WHATIF PELOTON');
  for (const tree of [await certificateTree(m), defaultTree()]) {
    const png = await renderPng(tree);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, W);
    assert.equal(meta.height, H);
  }
});
