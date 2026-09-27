// /api/news/stream: SSE framing, headers, heartbeat, caps, cleanup, Last-Event-ID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { mountNewsStream, sseFrame, parseTabs, MAX_CONN, MAX_PER_IP, HEARTBEAT_MS } from '../lib/newsstream.js';

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
    assert.ok(s.text().startsWith('retry: 5000\n\n'));
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
