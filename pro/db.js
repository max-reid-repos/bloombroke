// SQLite for Pro (better-sqlite3, WAL; works on Node 20). Migrations are the .sql files in migrations/,
// applied once each, in name order, inside a transaction.

import Database from 'better-sqlite3';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

// The Pro database holds licence keys. Its folder is 0700 and the database, WAL and SHM
// files 0600: made that way, and put back that way on every start (a restore or a copy
// can leave them readable). A folder shared with other things (the project, home, tmp)
// keeps its mode; only the files are locked down there. Failures are logged, not fatal.
export const DB_DIR_MODE = 0o700;
export const DB_FILE_MODE = 0o600;
export function lockDown(file, { root = ROOT, log = console } = {}) {
  const dir = path.dirname(path.resolve(file));
  const quiet = (fn) => { try { fn(); } catch (err) { log.error?.('[pro] permissions:', err.message); } };
  mkdirSync(dir, { recursive: true, mode: DB_DIR_MODE });
  const shared = [root, os.homedir(), os.tmpdir(), path.parse(dir).root].map((p) => path.resolve(p));
  if (!shared.includes(dir)) quiet(() => chmodSync(dir, DB_DIR_MODE));
  if (!existsSync(file)) quiet(() => closeSync(openSync(file, 'a', DB_FILE_MODE)));
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    if (existsSync(f)) quiet(() => chmodSync(f, DB_FILE_MODE));
  }
}

export function openDb(file, { migrationsDir = MIGRATIONS_DIR, log = console } = {}) {
  const onDisk = Boolean(file) && file !== ':memory:' && !String(file).startsWith('file:');
  if (onDisk) lockDown(file, { log });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  // WAL and SHM appear with the first WAL open: lock those down too.
  if (onDisk) lockDown(file, { log });
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  migrate(db, migrationsDir);
  return db;
}

export function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = readdirSync(dir).filter((f) => /^\d+_[\w-]+\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(path.join(dir, f), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${f} failed: ${err.message}`);
    }
  }
}

// Run fn inside BEGIN IMMEDIATE ... COMMIT. fn must be synchronous.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
