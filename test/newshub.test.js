// The news hub: schedule, backoff, start and stop with listeners, new-story detection
// (the same rule as the browser), sync on connect and Last-Event-ID replay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNewsHub, hubFeeds, fetchFeed, retryAfterMs, HUB_EVERY, MAX_BACKOFF_MS, LINGER_MS, MAX_RETRY_AFTER_MS, PRIME_MARGIN_MS } from '../data/newshub.js';
import { dedupeNews } from '../public/screens/news.js';
import { SEC_UA } from '../data/financials.js';

// A fake clock: setTimeout queues, advance(ms) runs what falls due, in order.
function fakeTimers() {
  let now = 0;
  let id = 0;
  const q = new Map();
  const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };
  return {
    setTimeout(fn, ms) { id += 1; q.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(h) { q.delete(h); },
    pending: () => [...q.values()].map((x) => x.at - now).sort((a, b) => a - b),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush();
        const next = [...q.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        q.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
      await flush();
    },
    get now() { return now; },
  };
}

const rss = (titles) => `<rss><channel>${titles.map((t) => `<item><title>${t}</title><link>https://n.test/${encodeURIComponent(t)}</link><pubDate>Sat, 26 Sep 2026 12:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;

// One tab (WIRES) with one feed whose answers the test sets.
function setup({ answers, every = { ...HUB_EVERY }, feeds = null, secQueue, decorate = {}, seenMax } = {}) {
  const timers = fakeTimers();
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, headers: opts.headers, at: timers.now });
    const a = typeof answers === 'function' ? answers(url, opts, calls.length) : answers.shift();
    if (a instanceof Error) throw a;
    return a;
  };
  const primed = [];
  const f = feeds || {
    WIRES: [{ id: 'w', name: 'Business Wire', url: 'https://w.test/rss', ua: 'UA', sec: false, parse: (xml) => hubFeeds().WIRES[0].parse.call(null, xml), prime: (id, items, ttl) => primed.push([id, items.length, ttl]) }],
  };
  const hub = makeNewsHub({ feeds: f, every, fetchImpl, timers, decorate, log: () => {}, boot: 'b00t', secQueue, ...(seenMax ? { seenMax } : {}) });
  return { hub, timers, calls, primed };
}
const ok = (body, headers = {}) => new Response(body, { status: 200, headers });
const client = () => { const got = []; return { got, send: (ev) => got.push(ev) }; };

test('hub: the schedule per tab', () => {
  assert.deepEqual(HUB_EVERY, { SEC: 30_000, WIRES: 30_000, MARKETS: 30_000, MACRO: 300_000, WSB: 300_000 });
  assert.equal(MAX_BACKOFF_MS, 600_000);
  const f = hubFeeds();
  assert.deepEqual(Object.keys(f).sort(), ['MACRO', 'MARKETS', 'SEC', 'WIRES', 'WSB']);
  assert.equal(f.SEC[0].sec, true);
  assert.equal(f.SEC[0].ua, SEC_UA, 'SEC gets the SEC User-Agent');
  assert.ok(f.WIRES.every((x) => /@/.test(x.ua)), 'a contact in the User-Agent');
});

test('hub: polls only while someone listens; stops after the linger', async () => {
  const { hub, timers, calls } = setup({ answers: () => ok(rss(['A'])) });
  await timers.advance(120_000);
  assert.equal(calls.length, 0, 'nobody listening: no polls');
  const c = client();
  const off = hub.subscribe(['WIRES'], c);
  await timers.advance(0);
  assert.equal(calls.length, 1, 'first poll at once');
  await timers.advance(30_000);
  assert.equal(calls.length, 2, 'then every 30 s');
  await timers.advance(60_000);
  assert.equal(calls.length, 4);
  off();
  assert.deepEqual(hub.running(), ['WIRES'], 'still running during the linger');
  await timers.advance(LINGER_MS);
  assert.deepEqual(hub.running(), []);
  const n = calls.length;
  await timers.advance(300_000);
  assert.ok(calls.length <= n + 1, 'no more polls once stopped');
  // A reader back within the linger keeps it going.
  const off2 = hub.subscribe(['WIRES'], client());
  await timers.advance(10_000);
  off2();
  await timers.advance(LINGER_MS - 5000);
  hub.subscribe(['WIRES'], client());
  await timers.advance(10_000);
  assert.deepEqual(hub.running(), ['WIRES']);
  hub.stopAll();
});

test('hub: conditional GET; a 304 changes nothing', async () => {
  let n = 0;
  const { hub, timers, calls } = setup({
    answers: () => { n += 1; return n === 1 ? ok(rss(['A']), { etag: '"v1"', 'last-modified': 'Sat, 26 Sep 2026 12:00:00 GMT' }) : new Response(null, { status: 304 }); },
  });
  const c = client();
  hub.subscribe(['WIRES'], c);
  await timers.advance(30_000);
  assert.equal(calls[0].headers['If-None-Match'], undefined);
  assert.equal(calls[1].headers['If-None-Match'], '"v1"');
  assert.equal(calls[1].headers['If-Modified-Since'], 'Sat, 26 Sep 2026 12:00:00 GMT');
  assert.equal(calls[1].headers['User-Agent'], 'UA');
  assert.deepEqual(c.got.filter((e) => e.event === 'news'), []);
  hub.stopAll();
});

test('hub: every answer, 304 too, refreshes the /api/news cache for longer than the hub gap', async () => {
  let n = 0;
  const { hub, timers, primed } = setup({
    answers: () => { n += 1; return n === 1 ? ok(rss(['A']), { etag: '"v1"' }) : new Response(null, { status: 304 }); },
  });
  hub.subscribe(['WIRES'], client());
  await timers.advance(60_000);
  assert.equal(primed.length, 3, 'the 200 and both 304s');
  assert.ok(primed.every(([id, count, ttl]) => id === 'w' && count === 1 && ttl === HUB_EVERY.WIRES + PRIME_MARGIN_MS));
  assert.ok(PRIME_MARGIN_MS >= 30_000);
  // The real feeds: a MACRO or WSB entry (5 min hub gap) outlives its gap.
  const real = hubFeeds();
  assert.ok(real.MACRO.every((f) => typeof f.prime === 'function') && real.MARKETS.every((f) => typeof f.prime === 'function'));
  hub.stopAll();
});

test('hub: errors and 429 double the gap up to 10 minutes; a success resets it', async () => {
  let fail = true;
  let n = 0;
  const { hub, timers } = setup({
    answers: () => { n += 1; if (!fail) return ok(rss(['A'])); return n === 3 ? new Response('slow down', { status: 429, headers: { 'retry-after': '400' } }) : new Response('x', { status: 500 }); },
  });
  hub.subscribe(['WIRES'], client());
  await timers.advance(0);
  assert.equal(hub.gapOf('WIRES', 'w'), 60_000, '1st error: 30 s -> 60 s');
  await timers.advance(60_000);
  assert.equal(hub.gapOf('WIRES', 'w'), 120_000);
  await timers.advance(120_000);
  assert.equal(hub.gapOf('WIRES', 'w'), 400_000, '429: Retry-After 400 s wins over 240 s');
  await timers.advance(400_000);
  assert.equal(hub.gapOf('WIRES', 'w'), 600_000, 'capped at 10 minutes');
  await timers.advance(600_000);
  assert.equal(hub.gapOf('WIRES', 'w'), 600_000);
  fail = false;
  await timers.advance(600_000);
  assert.equal(hub.gapOf('WIRES', 'w'), 30_000, 'a success resets the gap');
  assert.equal(MAX_RETRY_AFTER_MS, 3_600_000);
  assert.equal(retryAfterMs('120'), 120_000);
  assert.equal(retryAfterMs('Sat, 26 Sep 2026 12:01:00 GMT', Date.parse('Sat, 26 Sep 2026 12:00:00 GMT')), 60_000);
  hub.stopAll();
});

test('hub: the first answer is a sync; only new stories go out as news, once, by the list rule', async () => {
  const lists = [['A', 'B'], ['A', 'B'], ['C', 'A', 'B'], ['C', 'A', 'B', 'a!'], ['D', 'C']];
  const { hub, timers, primed } = setup({ answers: () => ok(rss(lists.length > 1 ? lists.shift() : lists[0])) });
  const c = client();
  hub.subscribe(['WIRES'], c);
  await timers.advance(0);
  assert.deepEqual(c.got.map((e) => e.event), ['sync']);
  assert.deepEqual(c.got[0].data.items.map((n) => n.title), ['A', 'B']);
  await timers.advance(30_000); // same list
  assert.equal(c.got.length, 1);
  await timers.advance(30_000); // C is new
  assert.deepEqual(c.got[1], { event: 'news', id: 'b00t-1', data: { tab: 'WIRES', items: [c.got[1].data.items[0]] } });
  assert.equal(c.got[1].data.items[0].title, 'C');
  await timers.advance(30_000); // "a!" is A's words on another link: not new
  assert.equal(c.got.length, 2);
  await timers.advance(30_000); // D
  assert.deepEqual(c.got.slice(2).map((e) => [e.event, e.data.items.map((n) => n.title)]), [['news', ['D']]]);
  assert.ok(primed.length >= 4 && primed.every(([id]) => id === 'w'), 'the /api/news cache is refreshed from the hub');
  // The same stories through the browser's rule: nothing the hub sent is a repeat.
  const all = c.got.flatMap((e) => e.data.items);
  assert.equal(dedupeNews(all).length, 4);
  hub.stopAll();
});

test('hub: a new listener gets the list (sync), a reconnect gets what it missed (Last-Event-ID)', async () => {
  const lists = [['A'], ['B', 'A'], ['C', 'B', 'A'], ['D', 'C', 'B', 'A']];
  const { hub, timers } = setup({ answers: () => ok(rss(lists.length > 1 ? lists.shift() : lists[0])) });
  const first = client();
  hub.subscribe(['WIRES'], first);
  await timers.advance(90_000);
  const ids = first.got.filter((e) => e.event === 'news').map((e) => e.id);
  assert.deepEqual(ids, ['b00t-1', 'b00t-2', 'b00t-3']);
  const back = client();
  hub.subscribe(['WIRES'], back, { lastEventId: 'b00t-1' });
  assert.deepEqual(back.got.map((e) => e.id || e.event), ['b00t-2', 'b00t-3', 'sync']);
  assert.deepEqual(back.got.at(-1).data.items.map((n) => n.title), ['D', 'C', 'B', 'A']);
  const other = client();
  hub.subscribe(['WIRES'], other, { lastEventId: 'dead-1' });
  assert.deepEqual(other.got.map((e) => e.event), ['sync'], 'an id from another server run: the sync covers it');
  const macro = client();
  hub.subscribe(['MACRO'], macro, { lastEventId: 'b00t-0' });
  assert.deepEqual(macro.got, [], 'replay is per tab');
  hub.stopAll();
});

test('hub: SEC goes through the SEC queue', async () => {
  let queued = 0;
  const feeds = { SEC: [{ id: 's', name: 'SEC EDGAR', url: 'https://www.sec.gov/x', ua: SEC_UA, sec: true, parse: () => [{ title: 'Acme Inc: Results', link: 'https://www.sec.gov/a', time: '2026-09-26T12:00:00Z', source: 'SEC EDGAR' }] }] };
  const { hub, timers, calls } = setup({ feeds, answers: () => ok('<feed><entry></entry></feed>'), secQueue: (fn) => { queued += 1; return fn(); } });
  hub.subscribe(['SEC'], client());
  await timers.advance(30_000);
  assert.equal(queued, 2);
  assert.equal(calls[0].headers['User-Agent'], SEC_UA);
  hub.stopAll();
});

test('fetchFeed: size cap and errors', async () => {
  await assert.rejects(fetchFeed(async () => new Response('x'.repeat(100)), 'https://x.test', { maxBytes: 10 }), /too large/);
  await assert.rejects(fetchFeed(async () => new Response('no', { status: 503, headers: { 'retry-after': '9' } }), 'https://x.test'), (e) => e.status === 503 && e.retryAfterMs === 9000);
  assert.deepEqual(await fetchFeed(async () => new Response(null, { status: 304 }), 'https://x.test', { etag: '"a"' }), { notModified: true });
});

test('hub: a Retry-After past 10 minutes is honoured, up to an hour', async () => {
  const waits = ['3000', '7200'];
  const { hub, timers } = setup({ answers: () => new Response('no', { status: 429, headers: { 'retry-after': waits.shift() || '1' } }) });
  hub.subscribe(['WIRES'], client());
  await timers.advance(0);
  assert.equal(hub.gapOf('WIRES', 'w'), 3_000_000, '50 minutes, as asked');
  await timers.advance(3_000_000);
  assert.equal(hub.gapOf('WIRES', 'w'), 3_600_000, '2 hours asked: an hour');
  hub.stopAll();
});

test('hub: the poll that resets the seen list still pushes its new stories', async () => {
  const lists = [['A', 'B', 'C'], ['D', 'A', 'B', 'C']];
  const { hub, timers } = setup({ seenMax: 2, answers: () => ok(rss(lists.length > 1 ? lists.shift() : lists[0])) });
  const c = client();
  hub.subscribe(['WIRES'], c);
  await timers.advance(30_000);
  assert.deepEqual(c.got.filter((e) => e.event === 'news').map((e) => e.data.items.map((n) => n.title)), [['D']]);
  await timers.advance(30_000);
  assert.equal(c.got.filter((e) => e.event === 'news').length, 1, 'and nothing twice after the reset');
  hub.stopAll();
});

test('hub: an older, slower result never overwrites a newer list', async () => {
  const feeds = {
    SEC: ['a', 'b'].map((id) => ({ id, name: 'SEC EDGAR', url: `https://www.sec.gov/${id}`, ua: SEC_UA, sec: false, parse: (xml) => JSON.parse(xml) })),
  };
  const bodies = { a: [{ title: 'Old A', link: 'https://www.sec.gov/oa', time: '2026-09-26T10:00:00Z', source: 'SEC EDGAR' }], b: [{ title: 'B', link: 'https://www.sec.gov/b', time: '2026-09-26T11:00:00Z', source: 'SEC EDGAR' }] };
  let slow = true;
  const decorate = { SEC: (items) => new Promise((r) => { const wait = slow && items.length === 1 && items[0].title === 'Old A' ? 50 : 0; setTimeout(() => r(items), wait); }) };
  const { hub, timers } = setup({ feeds, decorate, answers: (url) => ok(JSON.stringify(bodies[url.endsWith('/a') ? 'a' : 'b'])) });
  hub.subscribe(['SEC'], client());
  await timers.advance(300); // a and b both answer; a's lookup is slow
  await new Promise((r) => setTimeout(r, 80));
  const late = client();
  hub.subscribe(['SEC'], late);
  assert.deepEqual(late.got.at(-1).data.items.map((n) => n.title).sort(), ['B', 'Old A'], 'the newer list, with both feeds');
  slow = false;
  hub.stopAll();
});
