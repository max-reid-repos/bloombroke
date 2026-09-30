// PRO WAITLIST, the server (pro/waitlist.js, migrations/019_waitlist.sql) and the owner's
// export (scripts/waitlist.js): validation, the honeypot, one row per address with the
// same answer every time, the rate limits, closed vs open checkout, masked logs, the
// migration on a fresh and on an existing database, and the CSV.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../pro/db.js';
import { createLimiter } from '../pro/ratelimit.js';
import { createWaitlistStore, mountWaitlist, normalizeEmail, WaitlistError, PER_IP, PER_DAY, MAX_EMAIL } from '../pro/waitlist.js';
import { toCsv, csvField, parseArgs } from '../scripts/waitlist.js';

const T0 = Date.UTC(2026, 8, 30, 23);
const HOUR = 60 * 60 * 1000;

async function server({ closed = true, max = PER_IP, perDay = PER_DAY } = {}) {
  let t = T0;
  const now = () => t;
  const db = openDb(':memory:');
  const store = createWaitlistStore(db, { now });
  const lines = [];
  const log = { log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) };
  const app = express();
  mountWaitlist(app, {
    store, checkoutClosed: closed, now, log,
    limiter: createLimiter({ max, windowMs: HOUR, now }),
    daily: createLimiter({ max: perDay, windowMs: 24 * HOUR, now, maxKeys: 1 }),
  });
  const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const post = async (body, { origin = base, headers = {} } = {}) => {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (origin) h.Origin = origin;
    const res = await fetch(`${base}/api/pro/waitlist`, { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, body: json, cache: res.headers.get('cache-control'), retry: res.headers.get('retry-after') };
  };
  const rows = () => db.prepare('SELECT * FROM waitlist ORDER BY id').all();
  return { db, store, post, rows, lines, advance(ms) { t += ms; }, close: () => new Promise((r) => s.close(r)) };
}

test('waitlist: an address is trimmed, lower-cased and checked', () => {
  assert.equal(normalizeEmail('  Ann.Lee+pro@Example.COM '), 'ann.lee+pro@example.com');
  assert.equal(normalizeEmail('a@b.co'), 'a@b.co');
  assert.equal(normalizeEmail('x_y-z@mail.sub-domain.example.org'), 'x_y-z@mail.sub-domain.example.org');
  const long = `${'a'.repeat(64)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.com`;
  assert.equal(long.length <= MAX_EMAIL, true);
  assert.equal(normalizeEmail(long), long);
  for (const bad of [
    '', '   ', 'nope', 'a@b', '@b.co', 'a@', 'a@@b.co', 'a@b@c.co', 'a b@c.co', 'a@b .co', 'a@b.c', 'a@b.123', 'a@-b.co', 'a@b-.co',
    '.a@b.co', 'a.@b.co', 'a..b@c.co', 'a@b..co', '"a"@b.co', 'a@[1.2.3.4]', 'a(b)@c.co', 'a<b>@c.co', 'ä@b.co', 'a@bü.co',
    'a\n@b.co', 'a@b.co‮', '=cmd@b.co', '+a@b.co', '-a@b.co', `${'a'.repeat(65)}@b.co`, `a@${'b'.repeat(250)}.co`,
    5, null, undefined, {}, ['a@b.co'],
  ]) assert.throws(() => normalizeEmail(bad), (e) => e instanceof WaitlistError && e.code === 'bad_email', JSON.stringify(bad));
});

test('waitlist: joins once; a repeat gets the very same answer; no-store', async () => {
  const s = await server();
  try {
    const a = await s.post({ email: '  Ann@Example.com ', hp: '' });
    assert.equal(a.status, 200);
    assert.deepEqual(a.body, { ok: true });
    assert.equal(a.cache, 'no-store');
    const b = await s.post({ email: 'ann@example.com', hp: '' });
    assert.equal(b.status, a.status);
    assert.equal(b.text, a.text, 'the same bytes: the answer never says the address was on the list');
    const rows = s.rows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, 'ann@example.com');
    assert.equal(rows[0].created_at, T0);
    assert.equal(rows[0].source, 'pro-soon');
    assert.equal(rows[0].notified_at, null);
    assert.equal(rows[0].deleted_at, null);
    // Without hp at all is fine too.
    assert.equal((await s.post({ email: 'bo@example.com' })).status, 200);
    assert.equal(s.rows().length, 2);
  } finally { await s.close(); }
});

test('waitlist: a repeat keeps the first time; one taken off and given again is back on', async () => {
  const s = await server({ max: 50 });
  try {
    await s.post({ email: 'ann@example.com' });
    s.advance(60_000);
    await s.post({ email: 'ann@example.com' });
    assert.equal(s.rows()[0].created_at, T0, 'the first time stays');
    s.db.prepare('UPDATE waitlist SET deleted_at = ? WHERE email = ?').run(T0 + 1, 'ann@example.com');
    assert.equal(s.store.count(), 0);
    s.advance(60_000);
    assert.equal((await s.post({ email: 'ann@example.com' })).status, 200);
    const r = s.rows()[0];
    assert.equal(r.deleted_at, null);
    assert.equal(r.created_at, T0 + 120_000, 'a new sign-up');
    assert.equal(s.rows().length, 1);
  } finally { await s.close(); }
});

test('waitlist: bad addresses and bodies are refused, nothing stored', async () => {
  const s = await server({ max: 50 });
  try {
    for (const body of [{ email: 'nope' }, { email: '' }, {}, { email: 5 }, { email: `${'a'.repeat(250)}@b.co` }]) {
      const r = await s.post(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.error, 'bad_email');
      assert.equal(r.body.message, 'That email address does not look right.');
    }
    assert.equal((await s.post([1])).body.error, 'bad_request');
    assert.equal((await s.post('null')).status, 400);
    assert.equal((await s.post('{"email":')).body.error, 'bad_json');
    const big = await s.post({ email: 'a@b.co', hp: 'x'.repeat(1100) });
    assert.equal(big.status, 413, 'the body is capped at 1 kb');
    assert.equal(big.cache, 'no-store');
    assert.equal(s.rows().length, 0);
  } finally { await s.close(); }
});

test('waitlist: the honeypot gets the same answer and nothing is stored', async () => {
  const s = await server();
  try {
    const real = await s.post({ email: 'ann@example.com', hp: '' });
    const bot = await s.post({ email: 'bot@example.com', hp: 'https://spam.example' });
    assert.equal(bot.status, 200);
    assert.equal(bot.text, real.text);
    assert.deepEqual(s.rows().map((r) => r.email), ['ann@example.com']);
    assert.equal((await s.post({ email: 'bot2@example.com', hp: 0 })).status, 200);
    assert.deepEqual(s.rows().map((r) => r.email), ['ann@example.com'], 'any value that is not empty');
  } finally { await s.close(); }
});

test('waitlist: 5 tries an hour per IP, right or wrong; then again after the hour', async () => {
  const s = await server();
  try {
    assert.equal(PER_IP, 5);
    for (let i = 0; i < 4; i++) assert.equal((await s.post({ email: 'nope' })).status, 400);
    assert.equal((await s.post({ email: 'ann@example.com' })).status, 200);
    const r = await s.post({ email: 'bo@example.com' });
    assert.equal(r.status, 429);
    assert.equal(r.body.error, 'rate_limited');
    assert.ok(Number(r.retry) > 0);
    assert.equal(s.rows().length, 1);
    s.advance(HOUR + 1);
    assert.equal((await s.post({ email: 'bo@example.com' })).status, 200);
    assert.equal(s.rows().length, 2);
  } finally { await s.close(); }
});

test('waitlist: a cap for the whole site per day', async () => {
  const s = await server({ max: 100, perDay: 3 });
  try {
    assert.equal(PER_DAY, 500);
    for (const e of ['a@x.co', 'b@x.co', 'c@x.co']) assert.equal((await s.post({ email: e })).status, 200);
    const r = await s.post({ email: 'd@x.co' });
    assert.equal(r.status, 429);
    assert.equal(r.body.error, 'busy');
    assert.equal(s.rows().length, 3);
    s.advance(24 * HOUR + 1);
    assert.equal((await s.post({ email: 'd@x.co' })).status, 200);
  } finally { await s.close(); }
});

test('waitlist: only while checkout is closed; 404 with checkout open', async () => {
  const s = await server({ closed: false });
  try {
    const r = await s.post({ email: 'ann@example.com' });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'not_found');
    assert.equal(r.cache, 'no-store');
    assert.equal(s.rows().length, 0);
  } finally { await s.close(); }
});

test('waitlist: same origin only', async () => {
  const s = await server({ max: 50 });
  try {
    assert.equal((await s.post({ email: 'a@x.co' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await s.post({ email: 'a@x.co' }, { origin: null })).status, 403, 'no Origin');
    assert.equal((await s.post({ email: 'a@x.co' }, { origin: 'https://bloombroke.com' })).status, 200, 'the public site');
  } finally { await s.close(); }
});

test('waitlist: a sign-up is never logged; the address is never in the logs', async () => {
  const s = await server({ max: 50 });
  try {
    await s.post({ email: 'secret.person@private-domain.example' });
    await s.post({ email: 'secret.person@private-domain.example' });
    await s.post({ email: 'nope' });
    assert.deepEqual(s.lines, [], 'nothing logged for a sign-up, a repeat or a bad address');
    s.store.add = () => { throw new Error('SQLITE_BUSY: database is locked'); }; // a database error: logged without the address
    assert.equal((await s.post({ email: 'secret.person@private-domain.example' })).status, 503);
    assert.equal(s.lines.length, 1);
    for (const l of s.lines) {
      assert.doesNotMatch(l, /secret\.person/);
      assert.doesNotMatch(l, /private-domain/);
    }
  } finally { await s.close(); }
  const src = readFileSync('pro/waitlist.js', 'utf8');
  assert.equal((src.match(/log\.(log|error|warn|info)\?*\.?\(/g) || []).length, 2, 'two log calls, reviewed: error messages only');
  assert.doesNotMatch(src, /log\.log/, 'no sign-up log line');
  assert.doesNotMatch(src, /log\.\w+\??\.?\([^)]*\bemail\b(?!\))/, 'no log call takes the address itself');
});

test('migration 019: on a fresh database, and on one that already has 001 to 016', () => {
  const fresh = openDb(':memory:');
  const cols = fresh.prepare('PRAGMA table_info(waitlist)').all().map((c) => c.name);
  assert.deepEqual(cols, ['id', 'email', 'created_at', 'source', 'notified_at', 'deleted_at']);
  assert.ok(fresh.prepare("SELECT 1 FROM schema_migrations WHERE name = '019_waitlist.sql'").get());
  fresh.prepare('INSERT INTO waitlist (email, created_at) VALUES (?, ?)').run('a@b.co', 1);
  assert.throws(() => fresh.prepare('INSERT INTO waitlist (email, created_at) VALUES (?, ?)').run('a@b.co', 2), /UNIQUE/);
  assert.throws(() => fresh.prepare("INSERT INTO waitlist (email, created_at, source) VALUES ('c@d.co', 1, 'other')").run(), /CHECK/);
  fresh.close();

  const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-waitlist-'));
  try {
    const before = path.join(dir, 'before');
    const all = path.join(dir, 'all');
    mkdirSync(before);
    mkdirSync(all);
    for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql'))) {
      copyFileSync(path.join('migrations', f), path.join(all, f));
      if (f < '017') copyFileSync(path.join('migrations', f), path.join(before, f));
    }
    const file = path.join(dir, 'pro.db');
    const old = openDb(file, { migrationsDir: before, log: { error() {} } });
    const had = old.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
    assert.equal(old.prepare("SELECT 1 FROM sqlite_master WHERE name = 'waitlist'").get(), undefined);
    old.close();
    const db = openDb(file, { migrationsDir: all, log: { error() {} } });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, had + 1);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'waitlist'").get());
    db.prepare('INSERT INTO waitlist (email, created_at) VALUES (?, ?)').run('a@b.co', 1);
    db.close();
    // A branch's 017 and 018 landing after 019 was applied still run (the runner goes by
    // name, not by the highest number), and 019 is not run twice.
    writeFileSync(path.join(all, '017_later.sql'), 'CREATE TABLE later17 (x INTEGER);');
    writeFileSync(path.join(all, '018_later.sql'), 'CREATE TABLE later18 (x INTEGER);');
    const again = openDb(file, { migrationsDir: all, log: { error() {} } });
    assert.ok(again.prepare("SELECT 1 FROM sqlite_master WHERE name = 'later17'").get());
    assert.ok(again.prepare("SELECT 1 FROM sqlite_master WHERE name = 'later18'").get());
    assert.equal(again.prepare('SELECT COUNT(*) AS n FROM waitlist').get().n, 1, 'the list is kept');
    assert.equal(again.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE name = '019_waitlist.sql'").get().n, 1);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scripts/waitlist.js: email,created_at as CSV, oldest first, read-only, without removed rows', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-waitlist-csv-'));
  try {
    const file = path.join(dir, 'pro.db');
    const db = openDb(file, { log: { error() {} } });
    const store = createWaitlistStore(db, { now: () => Date.UTC(2026, 9, 1, 12) });
    store.add('late@x.co');
    db.prepare('INSERT INTO waitlist (email, created_at) VALUES (?, ?)').run('early@x.co', Date.UTC(2026, 8, 30, 23, 5));
    db.prepare('INSERT INTO waitlist (email, created_at, deleted_at) VALUES (?, ?, ?)').run('gone@x.co', Date.UTC(2026, 8, 30), 1);
    db.close();
    const ro = new Database(file, { readonly: true, fileMustExist: true });
    assert.equal(toCsv(ro), 'email,created_at\nearly@x.co,2026-09-30T23:05:00.000Z\nlate@x.co,2026-10-01T12:00:00.000Z\n');
    ro.close();
    assert.equal(toCsv(new Database(':memory:')), 'email,created_at\n', 'no table yet: the header only');
    assert.equal(csvField('a,b'), '"a,b"');
    assert.equal(csvField('a"b'), '"a""b"');
    assert.deepEqual(parseArgs(['--db', '/x/pro.db']), { db: '/x/pro.db' });
    assert.ok(parseArgs(['--db']).error);
    assert.ok(parseArgs(['--delete']).error);
    const src = readFileSync('scripts/waitlist.js', 'utf8');
    assert.match(src, /new Database\(file, \{ readonly: true, fileMustExist: true \}\)/);
    assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('startPro: the route is there with PRO_CHECKOUT=closed, and 404 without it', async () => {
  const { startPro } = await import('../pro/index.js');
  const quiet = { log() {}, error() {}, warn() {} };
  for (const [flag, want] of [['closed', 200], ['', 404]]) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bb-waitlist-start-'));
    const app = express();
    const pro = startPro(app, { dir, env: { PRO_CHECKOUT: flag, PRO_DB_PATH: path.join(dir, 'pro.db') }, log: quiet });
    assert.ok(pro, 'Pro started');
    const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
    const base = `http://127.0.0.1:${s.address().port}`;
    try {
      const res = await fetch(`${base}/api/pro/waitlist`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ email: 'ann@example.com', hp: '' }) });
      assert.equal(res.status, want, `PRO_CHECKOUT=${flag || '(unset)'}`);
      assert.equal(pro.db.prepare('SELECT COUNT(*) AS n FROM waitlist').get().n, want === 200 ? 1 : 0);
    } finally {
      await new Promise((r) => s.close(r));
      pro.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
