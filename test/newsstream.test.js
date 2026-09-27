// /api/news/stream: SSE framing, headers, heartbeat, caps, cleanup, Last-Event-ID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import express from 'express';
import { mountNewsStream, sseFrame, parseTabs, retryDelay, MAX_CONN, MAX_PER_IP, HEARTBEAT_MS, MAX_BUFFER } from '../lib/newsstream.js';

// A hub that records who listens and lets the test push events.
function fakeHub() {
  const subs = new Set();
  return {
    subs,
    subscribe(tabs, client, opts) {
      const s = { tabs, client, opts };
      subs.add(s);
      client.send({ event: 'sync', data: { tab: tabs[0], items: [{ title: 'Old', link: 'https://n.test/o' }] } });
      return () => subs.delete(s);
    },
    push(ev) { for (const s of subs) s.client.send(ev); },
  };
}

async function serve(opts, fn) {
  const hub = fakeHub();
  const app = express();
  const stream = mountNewsStream(app, hub, opts);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    await fn({ base: `http://127.0.0.1:${server.address().port}`, port: server.address().port, hub, stream });
  } finally {
    stream.closeAll();
    server.closeAllConnections?.();
    server.close();
  }
}

// Open a raw stream; resolves with { res, text(), close() } once headers are in.
function openStream(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      resolve({ res, text: () => buf, close: () => req.destroy() });
    });
    req.on('error', reject);
  });
}
const until = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); }
};

test('stream: frames, tabs and caps', () => {
  assert.equal(sseFrame({ event: 'news', id: 'b-1', data: { tab: 'SEC', items: [] } }), 'event: news\nid: b-1\ndata: {"tab":"SEC","items":[]}\n\n');
  assert.equal(sseFrame({ data: { a: 'x\ny' } }), 'data: {"a":"x\\ny"}\n\n', 'a newline stays inside the JSON');
  assert.deepEqual(parseTabs('markets,SEC,sec'), ['MARKETS', 'SEC']);
  assert.equal(parseTabs('MARKETS,NOPE'), null);
  assert.equal(parseTabs(''), null);
  assert.equal(parseTabs(undefined), null);
  assert.equal(MAX_CONN, 2000);
  assert.equal(MAX_PER_IP, 4);
  assert.equal(HEARTBEAT_MS, 25_000);
});

test('stream: SSE headers, the sync, pushed news, heartbeat, cleanup on disconnect', async () => {
  await serve({ heartbeatMs: 50 }, async ({ base, port, hub, stream }) => {
    const s = await openStream(port, '/api/news/stream?tabs=MARKETS', { 'Last-Event-ID': 'abcd-7' });
    assert.equal(s.res.statusCode, 200);
    assert.match(s.res.headers['content-type'], /^text\/event-stream/);
    assert.equal(s.res.headers['cache-control'], 'no-cache, no-transform');
    assert.equal(s.res.headers['x-accel-buffering'], 'no');
    assert.equal(s.res.headers['content-encoding'], undefined, 'never compressed');
    await until(() => s.text().includes('event: sync'));
    const retry = Number(/^retry: (\d+)\n\n/.exec(s.text())?.[1]);
    assert.ok(retry >= 3000 && retry < 10_000, `a spread-out retry: ${retry}`);
    assert.deepEqual([...hub.subs][0].tabs, ['MARKETS']);
    assert.equal([...hub.subs][0].opts.lastEventId, 'abcd-7', 'Last-Event-ID reaches the hub');
    hub.push({ event: 'news', id: 'abcd-8', data: { tab: 'MARKETS', items: [{ title: 'New' }] } });
    await until(() => s.text().includes('id: abcd-8'));
    assert.match(s.text(), /event: news\nid: abcd-8\ndata: \{"tab":"MARKETS","items":\[\{"title":"New"\}\]\}\n\n/);
    await until(() => s.text().includes(': hb\n\n'));
    assert.equal(stream.connections(), 1);
    s.close();
    await until(() => stream.connections() === 0 && hub.subs.size === 0);
    assert.equal(stream.addresses(), 0, 'no address kept once the stream closes');
    const bad = await fetch(`${base}/api/news/stream?tabs=NOPE`);
    assert.equal(bad.status, 400);
    // A page reopening a stream sends the id as ?last=.
    const q = await openStream(port, '/api/news/stream?tabs=SEC&last=abcd-9');
    await until(() => hub.subs.size === 1);
    assert.equal([...hub.subs][0].opts.lastEventId, 'abcd-9');
    q.close();
  });
});

test('stream: at most 4 per address and a total cap; a slot frees on disconnect', async () => {
  await serve({ maxConn: 6, maxPerIp: 4, ipOf: (req) => req.get('x-test-ip') || 'x' }, async ({ port, base, stream }) => {
    const mine = [];
    for (let i = 0; i < 4; i += 1) mine.push(await openStream(port, '/api/news/stream?tabs=MARKETS', { 'x-test-ip': '1.1.1.1' }));
    assert.ok(mine.every((s) => s.res.statusCode === 200));
    const fifth = await fetch(`${base}/api/news/stream?tabs=MARKETS`, { headers: { 'x-test-ip': '1.1.1.1' } });
    assert.equal(fifth.status, 429);
    assert.equal(fifth.headers.get('retry-after'), '60');
    const others = [await openStream(port, '/api/news/stream?tabs=WSB', { 'x-test-ip': '2.2.2.2' }), await openStream(port, '/api/news/stream?tabs=WSB', { 'x-test-ip': '3.3.3.3' })];
    const full = await fetch(`${base}/api/news/stream?tabs=WSB`, { headers: { 'x-test-ip': '4.4.4.4' } });
    assert.equal(full.status, 503, 'the total cap');
    mine[0].close();
    await until(() => stream.connections() === 5);
    const again = await openStream(port, '/api/news/stream?tabs=MARKETS', { 'x-test-ip': '1.1.1.1' });
    assert.equal(again.res.statusCode, 200, 'a closed stream frees its slot');
    for (const s of [...mine.slice(1), ...others, again]) s.close();
    await until(() => stream.connections() === 0 && stream.addresses() === 0);
  });
});

test('stream: the retry delay is spread between 3 and 10 s', () => {
  assert.equal(retryDelay(() => 0), 3000);
  assert.equal(retryDelay(() => 0.999999), 9999);
  assert.equal(MAX_BUFFER, 256 * 1024);
});

test('stream: the per-address cap uses the visitor address (CF-Connecting-IP), IPv6 by /64', async () => {
  await serve({ maxPerIp: 2 }, async ({ port, base, stream }) => {
    // Through the tunnel the socket is loopback and the visitor is in CF-Connecting-IP.
    const a = await openStream(port, '/api/news/stream?tabs=MARKETS', { 'CF-Connecting-IP': '2001:db8:1:2::10' });
    const b = await openStream(port, '/api/news/stream?tabs=MARKETS', { 'CF-Connecting-IP': '2001:db8:1:2:ffff::99' });
    assert.equal(a.res.statusCode, 200);
    assert.equal(b.res.statusCode, 200);
    const third = await fetch(`${base}/api/news/stream?tabs=MARKETS`, { headers: { 'CF-Connecting-IP': '2001:db8:1:2:aaaa::1' } });
    assert.equal(third.status, 429, 'the same /64 is one address');
    const other = await openStream(port, '/api/news/stream?tabs=MARKETS', { 'CF-Connecting-IP': '198.51.100.7' });
    assert.equal(other.res.statusCode, 200, 'another visitor is not held back by the first');
    for (const s of [a, b, other]) s.close();
    await until(() => stream.connections() === 0 && stream.addresses() === 0);
  });
});

// Deterministic: a fake request and response (no socket, no waiting), and fake timers for
// the heartbeat. The response never drains, like a phone that stopped reading.
test('stream: a client that stops reading is dropped, not buffered without end', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const hub = fakeHub();
  let handler = null;
  const stream = mountNewsStream({ get: (path, fn) => { handler = fn; } }, hub, { maxBuffer: 1024, ipOf: () => '192.0.2.1' });
  const req = Object.assign(new EventEmitter(), { query: { tabs: 'MARKETS' }, get: () => null, socket: null });
  const res = Object.assign(new EventEmitter(), {
    writableLength: 0, writableEnded: false, destroyed: false, written: 0,
    writeHead() { return this; },
    write(text) { this.writableLength += Buffer.byteLength(text); this.written += 1; return false; },
    destroy() { this.destroyed = true; this.emit('close'); },
    end() { this.writableEnded = true; this.emit('close'); },
  });
  handler(req, res);
  assert.equal(stream.connections(), 1);
  assert.equal(hub.subs.size, 1);
  const big = { event: 'news', id: 'x-1', data: { tab: 'MARKETS', items: [{ title: 'y'.repeat(2000) }] } };
  hub.push(big); // over the cap now, but under it when written: sent
  assert.equal(res.destroyed, false);
  hub.push(big); // the next write finds more than maxBuffer unsent: dropped
  assert.equal(res.destroyed, true);
  assert.equal(stream.connections(), 0, 'the connection is gone');
  assert.equal(hub.subs.size, 0, 'and so is its hub subscription');
  assert.equal(stream.addresses(), 0);
  const writes = res.written;
  hub.push(big);
  t.mock.timers.tick(HEARTBEAT_MS * 2);
  assert.equal(res.written, writes, 'nothing more is written to it, heartbeat included');
});
