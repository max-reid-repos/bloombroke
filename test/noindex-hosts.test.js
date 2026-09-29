// Only bloombroke.com is indexed: any other host (the frozen Build Games copy at
// buildgames.bloombroke.com) gets X-Robots-Tag noindex, nofollow on every answer and a
// robots.txt that shuts the whole site (lib/seo.js noindexOtherHosts, mountSiteFiles).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import express from 'express';
import { mountSiteFiles, noindexOtherHosts, isIndexedHost, INDEXED_HOSTS, ROBOTS_CLOSED, NOINDEX } from '../lib/seo.js';

const PUBLIC = new URL('../public/', import.meta.url);
const OPEN_ROBOTS = readFileSync(new URL('robots.txt', PUBLIC), 'utf8');

// The server's order: trust proxy loopback, the header middleware, the site files, then
// the pages (one that sets its own X-Robots-Tag, like the embed pages).
async function serve(fn) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(noindexOtherHosts());
  mountSiteFiles(app, PUBLIC.pathname);
  app.get('/embed/x', (req, res) => res.set({ 'X-Robots-Tag': 'noindex' }).type('html').send('<!doctype html>embed'));
  app.get('/api/x', (req, res) => res.json({ ok: true }));
  app.use((req, res) => res.status(200).type('html').send('<!doctype html><link rel="canonical" href="https://bloombroke.com/">'));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    await fn(server.address().port);
  } finally {
    server.close();
  }
}

// A request with its own Host header (fetch cannot set one).
function get(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the indexed hosts: bloombroke.com, www, localhost and 127.0.0.1 only', () => {
  assert.deepEqual([...INDEXED_HOSTS], ['bloombroke.com', 'www.bloombroke.com', 'localhost', '127.0.0.1']);
  for (const h of ['bloombroke.com', 'www.bloombroke.com', 'localhost', '127.0.0.1', 'BloomBroke.com', 'bloombroke.com.']) assert.ok(isIndexedHost(h), h);
  for (const h of ['buildgames.bloombroke.com', 'bloombroke.com.evil.test', 'evil.test', 'bloombroke.pages.dev', '', undefined, null]) assert.ok(!isIndexedHost(h), String(h));
  assert.equal(NOINDEX, 'noindex, nofollow');
  assert.equal(ROBOTS_CLOSED, 'User-agent: *\nDisallow: /\n');
});

test('another host: noindex, nofollow on every answer, and a robots.txt that shuts the site', async () => {
  await serve(async (port) => {
    const host = { Host: 'buildgames.bloombroke.com' };
    for (const p of ['/', '/?c=AAPL', '/api/x', '/favicon.ico', '/sitemap.xml', '/nope', '/embed/x']) {
      const r = await get(port, p, host);
      assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow', p);
    }
    const robots = await get(port, '/robots.txt', host);
    assert.equal(robots.status, 200);
    assert.equal(robots.body, 'User-agent: *\nDisallow: /\n');
    assert.match(robots.headers['content-type'], /^text\/plain/);
    // The page keeps its canonical link to bloombroke.com.
    assert.match((await get(port, '/', host)).body, /<link rel="canonical" href="https:\/\/bloombroke\.com\/">/);
    // A port in the Host header is still that host.
    assert.equal((await get(port, '/', { Host: 'buildgames.bloombroke.com:443' })).headers['x-robots-tag'], 'noindex, nofollow');
  });
});

test('bloombroke.com, www and localhost: no tag, the open robots.txt, the embed page its own noindex', async () => {
  await serve(async (port) => {
    for (const Host of ['bloombroke.com', 'www.bloombroke.com', 'localhost:3020', `127.0.0.1:${port}`]) {
      const page = await get(port, '/', { Host });
      assert.equal(page.headers['x-robots-tag'], undefined, Host);
      const robots = await get(port, '/robots.txt', { Host });
      assert.equal(robots.body, OPEN_ROBOTS, Host);
      assert.match(robots.body, /Allow: \/\n/);
      assert.equal((await get(port, '/embed/x', { Host })).headers['x-robots-tag'], 'noindex', `${Host}: the embed page as before`);
    }
  });
});

test('the host as seen through the proxy: X-Forwarded-Host from loopback counts', async () => {
  await serve(async (port) => {
    const fwd = await get(port, '/', { Host: '127.0.0.1', 'X-Forwarded-Host': 'buildgames.bloombroke.com' });
    assert.equal(fwd.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal((await get(port, '/robots.txt', { Host: '127.0.0.1', 'X-Forwarded-Host': 'buildgames.bloombroke.com' })).body, ROBOTS_CLOSED);
    const main = await get(port, '/', { Host: 'buildgames.bloombroke.com', 'X-Forwarded-Host': 'bloombroke.com' });
    assert.equal(main.headers['x-robots-tag'], undefined, 'the forwarded host wins over the tunnel\'s own');
  });
});

test('server.js mounts it before every route, after trust proxy', () => {
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const at = (s) => { const i = src.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at("app.set('trust proxy', 'loopback');") < at('app.use(noindexOtherHosts());'));
  assert.ok(at('app.use(noindexOtherHosts());') < at("app.use('/api', provenanceJson());"));
  assert.ok(at('app.use(noindexOtherHosts());') < at('mountSiteFiles(app, '));
});
