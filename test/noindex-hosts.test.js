// Only bloombroke.com is indexed: any other host (the frozen Build Games copy at
// buildgames.bloombroke.com) gets X-Robots-Tag noindex, nofollow on every answer and a
// robots.txt that shuts the whole site (lib/seo.js noindexOtherHosts, mountSiteFiles).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import express from 'express';
import { mountSiteFiles, noindexOtherHosts, isIndexedHost, hostOf, INDEXED_HOSTS, ROBOTS_CLOSED, NOINDEX } from '../lib/seo.js';

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

test('the indexed hosts: bloombroke.com, www, localhost, 127.0.0.1 and ::1 only', () => {
  assert.deepEqual([...INDEXED_HOSTS], ['bloombroke.com', 'www.bloombroke.com', 'localhost', '127.0.0.1', '::1']);
  for (const [raw, want] of [['BloomBroke.com:443', 'bloombroke.com'], ['bloombroke.com.', 'bloombroke.com'], ['[::1]:3029', '::1'], ['[::1]', '::1'], ['localhost:3020', 'localhost'], [' www.bloombroke.com ', 'www.bloombroke.com'], [undefined, '']]) assert.equal(hostOf(raw), want, String(raw));
  for (const h of ['bloombroke.com', 'www.bloombroke.com', 'localhost', '127.0.0.1', '[::1]:3029', 'BloomBroke.com', 'bloombroke.com.', 'bloombroke.com:443']) assert.ok(isIndexedHost(h), h);
  for (const h of ['buildgames.bloombroke.com', 'bloombroke.com.evil.test', 'evil.test', 'bloombroke.pages.dev', '[::2]', '', undefined, null]) assert.ok(!isIndexedHost(h), String(h));
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
    assert.equal(robots.headers['cache-control'], 'no-store', 'the closed robots.txt is never cached');
    // The page keeps its canonical link to bloombroke.com.
    assert.match((await get(port, '/', host)).body, /<link rel="canonical" href="https:\/\/bloombroke\.com\/">/);
    // A port in the Host header is still that host.
    assert.equal((await get(port, '/', { Host: 'buildgames.bloombroke.com:443' })).headers['x-robots-tag'], 'noindex, nofollow');
  });
});

test('bloombroke.com, www and localhost: no tag, the open robots.txt, the embed page its own noindex', async () => {
  await serve(async (port) => {
    for (const Host of ['bloombroke.com', 'www.bloombroke.com', 'localhost:3020', `127.0.0.1:${port}`, '[::1]:3020']) {
      const page = await get(port, '/', { Host });
      assert.equal(page.headers['x-robots-tag'], undefined, Host);
      const robots = await get(port, '/robots.txt', { Host });
      assert.equal(robots.body, OPEN_ROBOTS, Host);
      assert.equal(robots.headers['cache-control'], 'public, max-age=86400', `${Host}: kept a day as before`);
      assert.match(robots.body, /Allow: \/\n/);
      assert.equal((await get(port, '/embed/x', { Host })).headers['x-robots-tag'], 'noindex', `${Host}: the embed page as before`);
    }
  });
});

test('a spoofed X-Forwarded-Host changes nothing: only the Host header counts', async () => {
  await serve(async (port) => {
    // A visitor's own X-Forwarded-Host reaches the server through the tunnel (loopback,
    // a trusted proxy): bloombroke.com must still answer as bloombroke.com.
    for (const spoof of ['x.test', 'buildgames.bloombroke.com', 'x.test, bloombroke.com']) {
      const h = { Host: 'bloombroke.com', 'X-Forwarded-Host': spoof };
      assert.equal((await get(port, '/', h)).headers['x-robots-tag'], undefined, spoof);
      const robots = await get(port, '/robots.txt', h);
      assert.equal(robots.body, OPEN_ROBOTS, spoof);
      assert.equal(robots.headers['cache-control'], 'public, max-age=86400', spoof);
    }
    // And the other way: the Build Games host cannot talk its way into the index.
    const bg = { Host: 'buildgames.bloombroke.com', 'X-Forwarded-Host': 'bloombroke.com' };
    assert.equal((await get(port, '/', bg)).headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal((await get(port, '/robots.txt', bg)).body, ROBOTS_CLOSED);
  });
  assert.doesNotMatch(readFileSync(new URL('../lib/seo.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, ''), /req\.hostname|x-forwarded-host/i, 'the decision never reads the forwarded host');
});

test('server.js mounts it before every route, after trust proxy', () => {
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const at = (s) => { const i = src.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at("app.set('trust proxy', 'loopback');") < at('app.use(noindexOtherHosts());'));
  assert.ok(at('app.use(noindexOtherHosts());') < at("app.use('/api', provenanceJson());"));
  assert.ok(at('app.use(noindexOtherHosts());') < at('mountSiteFiles(app, '));
});
