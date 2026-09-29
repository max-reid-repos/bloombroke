import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { mountSiteFiles, SITE_FILES, sitemapUrls, sitemapXml, commandMeta } from '../lib/seo.js';
import { withMeta, withCanonical } from '../lib/og.js';
import { parseCommand } from '../public/app.js';
import { WEIRD_GAUGES } from '../public/screens/weird-gauges.js';

const PUBLIC = new URL('../public/', import.meta.url);

async function serve(fn) {
  const app = express();
  mountSiteFiles(app, PUBLIC.pathname);
  app.use((req, res) => res.status(404).type('html').send('<!doctype html>404'));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('site files: icons, manifest, robots and sitemap are 200 with their own types, kept a day', async () => {
  await serve(async (base) => {
    const want = { ...SITE_FILES, '/apple-touch-icon-precomposed.png': 'image/png', '/sitemap.xml': 'application/xml' };
    for (const [p, type] of Object.entries(want)) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
      assert.ok(res.headers.get('content-type').startsWith(type.split(';')[0]), `${p}: ${res.headers.get('content-type')}`);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=86400', p);
      const body = Buffer.from(await res.arrayBuffer());
      assert.ok(body.length > 0, p);
      assert.doesNotMatch(body.toString('latin1'), /<!doctype html/i, `${p} is not the HTML page`);
    }
    const ico = Buffer.from(await (await fetch(`${base}/favicon.ico`)).arrayBuffer());
    assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 3], 'an ICO with 16, 32 and 48');
    const png = Buffer.from(await (await fetch(`${base}/apple-touch-icon.png`)).arrayBuffer());
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [180, 180]);
    const robots = await (await fetch(`${base}/robots.txt`)).text();
    assert.match(robots, /^Sitemap: https:\/\/bloombroke\.com\/sitemap\.xml$/m);
    const manifest = await (await fetch(`${base}/site.webmanifest`)).json();
    assert.equal(manifest.name, 'Bloombroke');
    assert.equal(manifest.theme_color, '#05080C');
    assert.equal(manifest.background_color, '#05080C');
    assert.deepEqual(manifest.icons.map((i) => i.sizes), ['192x192', '512x512']);
    assert.equal((await fetch(`${base}/favicon.ico/`)).status, 404, 'a near miss is not the icon');
  });
});

test('sitemap: home, key commands, every WEIRD gauge, legal pages; escaped, no dates', () => {
  const urls = sitemapUrls();
  assert.equal(urls[0], 'https://bloombroke.com/');
  for (const c of ['MARKETS', 'WEIRD', 'FISHTANK', 'WORLDMAP', 'NEWS', 'AAPL', ...WEIRD_GAUGES.map((g) => g.command)]) {
    assert.ok(urls.includes(`https://bloombroke.com/?c=${c}`), c);
  }
  for (const p of ['terms', 'privacy', 'disclaimer']) assert.ok(urls.includes(`https://bloombroke.com/${p}`), p);
  assert.equal(new Set(urls).size, urls.length, 'no duplicates');
  const xml = sitemapXml(['https://bloombroke.com/?c=A&b=1']);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.ok(xml.includes('<loc>https://bloombroke.com/?c=A&amp;b=1</loc>'));
  assert.doesNotMatch(sitemapXml(), /lastmod/);
  assert.equal(sitemapXml(), sitemapXml(), 'the same every time');
});

test('page meta: the About group\'s commands are ?c= pages; only the three legal pages have paths', () => {
  for (const c of ['FEEDBACK', 'DATA', 'STATUS', 'CHANGES', 'SPONSOR', 'BBRK']) {
    assert.equal(commandMeta(c, parseCommand)?.url, `https://bloombroke.com/?c=${c}`, c);
  }
  for (const c of ['TERMS', 'PRIVACY', 'DISCLAIMER']) assert.equal(commandMeta(c, parseCommand).url, `https://bloombroke.com/${c.toLowerCase()}`, c);
});

test('page meta: a bare command gets its own title, description and canonical', () => {
  const page = '<head>\n  <title>Site</title>\n  <meta name="description" content="Site.">\n</head>';
  const meta = commandMeta('markets', parseCommand);
  assert.equal(meta.url, 'https://bloombroke.com/?c=MARKETS');
  const html = withMeta(page, meta);
  assert.match(html, /<title>MARKETS \| World markets at a glance[^<]*\| Bloombroke<\/title>/);
  assert.match(html, /<meta name="description" content="World markets at a glance[^"]*">/);
  assert.equal(html.match(/rel="canonical"/g).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/bloombroke\.com\/\?c=MARKETS">/);
  assert.equal(commandMeta('TERMS', parseCommand).url, 'https://bloombroke.com/terms');
  for (const c of ['AAPL', 'FX', 'HOME', 'MARKETS 1D', '', 'NOPE123']) assert.equal(commandMeta(c, parseCommand), null, c);
  // The site card (no url) leaves the page's own title and description alone.
  assert.equal(withMeta(page, { title: 'X', description: 'Y' }).includes('<title>Site</title>'), true);
  assert.equal(withCanonical(withCanonical(page, 'https://bloombroke.com/'), 'https://bloombroke.com/').match(/rel="canonical"/g).length, 1);
});

test('the page heads point at the icon files, not a data: icon', () => {
  const index = readFileSync(new URL('index.html', PUBLIC), 'utf8');
  const legal = readFileSync(new URL('../lib/legal.js', import.meta.url), 'utf8');
  for (const src of [index, legal]) {
    assert.ok(src.includes('<link rel="icon" href="/favicon.ico" sizes="any">'));
    assert.ok(src.includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg">'));
    assert.ok(src.includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png">'));
    assert.ok(src.includes('<link rel="manifest" href="/site.webmanifest">'));
    assert.doesNotMatch(src, /rel="icon"[^>]*data:/);
  }
});
