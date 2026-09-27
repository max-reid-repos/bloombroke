// The browser side of NEWS push: the EventSource wrapper, its fallback, the merge and
// the LIVE marker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newsStream, mergePushed, liveMarker, streamUrl, dedupeNews } from '../public/screens/news.js';

// A stand-in EventSource the test drives.
function fakeES() {
  const made = [];
  class ES {
    constructor(url) { this.url = url; this.readyState = 0; this.l = {}; this.closed = false; made.push(this); }
    addEventListener(t, fn) { (this.l[t] ||= []).push(fn); }
    emit(t, e = {}) { for (const fn of this.l[t] || []) fn({ type: t, ...e }); }
    close() { this.closed = true; this.readyState = 2; }
  }
  return { ES, made };
}
function fakeDoc() {
  const l = new Set();
  return { hidden: false, addEventListener: (t, fn) => l.add(fn), removeEventListener: (t, fn) => l.delete(fn), fire() { for (const fn of l) fn(); }, get n() { return l.size; } };
}

test('push client: live on open, stories to onItems, cleanup closes it', () => {
  const { ES, made } = fakeES();
  const doc = fakeDoc();
  const cleanups = [];
  const got = [];
  const states = [];
  const s = newsStream({ tabs: ['SEC'], ES, doc, ctx: { onCleanup: (fn) => cleanups.push(fn) }, onItems: (tab, items, type) => got.push([tab, items.length, type]), onState: (v) => states.push(v) });
  assert.equal(made.length, 1);
  assert.equal(made[0].url, '/api/news/stream?tabs=SEC');
  assert.equal(s.live, false);
  made[0].emit('open');
  assert.equal(s.live, true);
  made[0].emit('sync', { data: JSON.stringify({ tab: 'SEC', items: [{ title: 'a' }, { title: 'b' }] }) });
  made[0].emit('news', { data: JSON.stringify({ tab: 'SEC', items: [{ title: 'c' }] }), lastEventId: 'b00t-4' });
  made[0].emit('news', { data: 'not json' });
  assert.deepEqual(got, [['SEC', 2, 'sync'], ['SEC', 1, 'news']]);
  // A dropped connection: the browser reconnects by itself (CONNECTING): no new one.
  made[0].readyState = 0;
  made[0].emit('error');
  assert.equal(s.live, false, 'polling until it is back');
  assert.equal(made.length, 1);
  made[0].emit('open');
  assert.deepEqual(states, [true, false, true]);
  // Hidden: closed. Shown: a new one, with the last event id, so nothing is missed.
  doc.hidden = true; doc.fire();
  assert.equal(made[0].closed, true);
  assert.equal(s.live, false);
  doc.hidden = false; doc.fire();
  assert.equal(made.length, 2);
  assert.equal(made[1].url, '/api/news/stream?tabs=SEC&last=b00t-4');
  for (const fn of cleanups) fn();
  assert.equal(made[1].closed, true);
  assert.equal(doc.n, 0, 'the visibility listener is gone');
});

test('push client: a refused stream falls back to the minute poll and gives up after 3', async () => {
  const { ES, made } = fakeES();
  const s = newsStream({ tabs: ['MARKETS'], ES, doc: fakeDoc(), onItems() {}, retryMs: 5 });
  for (let i = 0; i < 3; i += 1) {
    made.at(-1).readyState = 2; // a 429 or 503: the browser does not retry
    made.at(-1).emit('error');
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.equal(made.length, 3);
  assert.equal(s.gaveUp, true);
  assert.equal(s.live, false);
  // No EventSource at all (an old browser): polling only.
  const none = newsStream({ tabs: ['MARKETS'], ES: undefined, doc: fakeDoc(), onItems() {} });
  assert.equal(none.live, false);
  assert.equal(none.gaveUp, true);
});

test('push client: pushed stories merge newest first, once each, capped', () => {
  const n = (t, time, link = `https://n.test/${t}`) => ({ title: t, time, link, source: 'CNBC' });
  const list = [n('B', '2026-09-26T11:00:00Z'), n('A', '2026-09-26T10:00:00Z')];
  const out = mergePushed(list, [n('C', '2026-09-26T12:00:00Z'), n('A', '2026-09-26T10:00:00Z')]);
  assert.deepEqual(out.map((x) => x.title), ['C', 'B', 'A']);
  assert.equal(dedupeNews(out).length, out.length);
  assert.equal(mergePushed(list, [n('C', '2026-09-26T12:00:00Z')], 2).length, 2);
  assert.equal(streamUrl(['MARKETS', 'SEC']), '/api/news/stream?tabs=MARKETS%2CSEC');
});

test('push client: the LIVE marker, filled when streaming, hollow when polling, no amber', () => {
  assert.match(liveMarker(true), /class="news-live is-on"[^>]*>LIVE</);
  assert.match(liveMarker(false), /class="news-live"[^>]*>LIVE</);
  assert.doesNotMatch(liveMarker(true) + liveMarker(false), /amber|orange|\u2014/i);
});
