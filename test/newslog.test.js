// The per-ticker news log: capped, one copy per story, on disk under data/.cache/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeNewsLog, mergeLog, logRow, LOG_CAP, LOG_DIR, MAX_FILES } from '../data/newslog.js';
import { utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { makeTickerNews } from '../data/tickernews.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'bb-newslog-'));
const row = (i, extra = {}) => ({ title: `Story ${i}`, link: `https://n.test/${i}`, time: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(), source: 'Nasdaq', ...extra });

test('news log: kept in a gitignored folder under data/.cache', () => {
  assert.match(LOG_DIR, /data[\\/]\.cache[\\/]newslog$/);
  const gi = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(gi.includes('data/.cache/'), '.gitignore covers data/.cache/');
});

test('news log: a row is time, source, title and url; bad rows drop', () => {
  assert.deepEqual(logRow(row(1)), { time: row(1).time, source: 'Nasdaq', title: 'Story 1', url: 'https://n.test/1' });
  assert.equal(logRow({ ...row(1), time: 'nope' }), null);
  assert.equal(logRow({ ...row(1), link: 'javascript:alert(1)' }), null);
  assert.equal(logRow({ ...row(1), title: '  ' }), null);
});

test('news log: merge keeps one copy per story, newest first, and caps', () => {
  const { rows, added } = mergeLog([row(1), row(2)], [row(2, { link: 'https://other.test/2' }), row(3)]);
  assert.equal(added, 1);
  assert.deepEqual(rows.map((r) => r.title), ['Story 3', 'Story 2', 'Story 1']);
  assert.equal(rows[1].url, 'https://n.test/2', 'the first copy stays');
  const many = Array.from({ length: 450 }, (_, i) => row(i));
  const capped = mergeLog([], many);
  assert.equal(LOG_CAP, 400);
  assert.equal(capped.rows.length, 400);
  assert.equal(capped.rows[0].title, 'Story 449', 'the newest are kept');
  assert.equal(capped.rows.at(-1).title, 'Story 50');
});

test('news log: record writes the file, read reads it back in a new process', async () => {
  const dir = tmp();
  try {
    const log = makeNewsLog({ dir, cap: 5 });
    assert.equal(await log.record('AAPL', [row(1), row(2)]), 2);
    assert.equal(await log.record('AAPL', [row(2)]), 0, 'nothing new: no write');
    await Promise.all([log.record('AAPL', [row(3)]), log.record('AAPL', [row(4), row(5), row(6)])]);
    const again = makeNewsLog({ dir, cap: 5 });
    const rows = await again.read('AAPL');
    assert.deepEqual(rows.map((r) => r.title), ['Story 6', 'Story 5', 'Story 4', 'Story 3', 'Story 2']);
    assert.deepEqual(readdirSync(dir), ['AAPL.json'], 'no temp files left');
    assert.deepEqual(await again.read('MSFT'), []);
    assert.equal(await log.record('../etc', [row(1)]), 0, 'odd names never reach the disk');
    assert.deepEqual(await log.read('../etc'), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('news log: NEWS <ticker> saves the headlines about the company, not the filings', async () => {
  const dir = tmp();
  try {
    const log = makeNewsLog({ dir });
    const rss = (items) => `<rss><channel>${items.map((t, i) => `<item><title>${t}</title><link>https://www.nasdaq.com/articles/${i}</link><pubDate>Fri, 25 Sep 2026 1${i}:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
    const fetchImpl = async (url) => {
      if (url.includes('nasdaq.com')) return new Response(rss(['Apple unveils a phone', 'Stocks mixed as oil slips', 'AAPL options busy']));
      if (url.includes('seekingalpha')) return new Response('<rss></rss>');
      return new Response('{}', { status: 404 });
    };
    const secTickers = async () => ({ value: { byTicker: new Map([['AAPL', { cik: 320193, title: 'Apple Inc.' }]]) } });
    const tn = makeTickerNews({ fetchImpl, secTickers, log });
    await tn.getTickerNews('AAPL');
    await new Promise((r) => setTimeout(r, 50));
    const rows = await log.read('AAPL');
    assert.deepEqual(rows.map((r) => r.title).sort(), ['AAPL options busy', 'Apple unveils a phone']);
    assert.ok(existsSync(path.join(dir, 'AAPL.json')));
    const heads = await makeTickerNews({ fetchImpl, secTickers, log, now: () => Date.parse('2026-09-27T00:00:00Z') }).getTickerHeadlines('AAPL');
    assert.equal(heads.items.length, 2);
    assert.deepEqual(Object.keys(heads.items[0]).sort(), ['source', 'time', 'title', 'url']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('news log: at most MAX_FILES tickers; the least recently written go first', async () => {
  const dir = tmp();
  try {
    assert.equal(MAX_FILES, 2000);
    // Files left by an earlier run: OLD is the oldest on disk.
    mkdirSync(dir, { recursive: true });
    for (const [t, age] of [['OLD', 300], ['MID', 200]]) {
      writeFileSync(path.join(dir, `${t}.json`), JSON.stringify({ ticker: t, rows: [logRow(row(1))] }));
      const when = new Date(Date.now() - age * 1000);
      utimesSync(path.join(dir, `${t}.json`), when, when);
    }
    const log = makeNewsLog({ dir, maxFiles: 3 });
    await log.record('AAA', [row(1)]);
    assert.deepEqual(readdirSync(dir).sort(), ['AAA.json', 'MID.json', 'OLD.json']);
    await log.record('BBB', [row(1)]);
    assert.deepEqual(readdirSync(dir).sort(), ['AAA.json', 'BBB.json', 'MID.json'], 'OLD went first');
    await log.record('MID', [row(2)]); // MID is written again: now the newest
    await log.record('CCC', [row(1)]);
    assert.deepEqual(readdirSync(dir).sort(), ['BBB.json', 'CCC.json', 'MID.json']);
    assert.deepEqual(await log.read('AAA'), [], 'an evicted ticker reads as empty');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('news log: only company stocks the SEC map knows get a file', async () => {
  const dir = tmp();
  try {
    const log = makeNewsLog({ dir });
    const rss = '<rss><channel><item><title>Bitcoin and Apple rally</title><link>https://www.nasdaq.com/articles/1</link><pubDate>Fri, 25 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>';
    const fetchImpl = async (url) => (url.includes('nasdaq.com') ? new Response(rss) : new Response('<rss></rss>'));
    const secTickers = async () => ({ value: { byTicker: new Map([['AAPL', { cik: 320193, title: 'Apple Inc.' }]]) } });
    const tn = makeTickerNews({ fetchImpl, secTickers, log, now: () => Date.parse('2026-09-27T00:00:00Z') });
    for (const t of ['BTC', 'SPX', 'ZZZZ']) await tn.getTickerNews(t).catch(() => {});
    assert.deepEqual(await tn.getTickerHeadlines('BTC'), { ticker: 'BTC', items: [] }, 'no N flags for a coin');
    await tn.getTickerNews('AAPL');
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], ['AAPL.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
