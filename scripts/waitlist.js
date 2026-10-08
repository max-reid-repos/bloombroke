#!/usr/bin/env node
// ADMIN ONLY. Print the PRO WAITLIST (pro/waitlist.js) as CSV: email,created_at, oldest
// first. Read-only: the database is opened read-only and nothing is changed.
//
//   node scripts/waitlist.js [--db path] [--source pro-soon|guide]
//
// --source picks the list: pro-soon (the default, PRO's "Pro opens soon.") or guide (the
// BUILD GUIDE page, /guide). One list per run, never the two mixed.
//
// The database is --db, else PRO_DB_PATH (from the environment or the .env next to
// server.js), else var/pro.db. Addresses taken off the list (deleted_at) are left out.
// created_at is UTC, ISO 8601.

import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dbPath } from './feedback-export.js';
import { SOURCE, SOURCES } from '../pro/waitlist.js';

// argv -> { db, source } or { error }.
export function parseArgs(argv) {
  const out = { db: null, source: SOURCE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') {
      const v = argv[++i];
      if (!v) return { error: '--db takes a path' };
      out.db = v;
    } else if (a === '--source') {
      const v = argv[++i];
      if (!SOURCES.includes(v)) return { error: `--source takes ${SOURCES.join(' or ')}` };
      out.source = v;
    } else return { error: `unknown option ${a}` };
  }
  return out;
}

// One CSV field: quoted when it holds a comma, quote or line break. (A stored address
// starts with a letter or digit, pro/waitlist.js, so none reads as a spreadsheet formula.)
export function csvField(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// db -> the CSV text of one list (source), with a header line.
export function toCsv(db, source = SOURCE) {
  const lines = ['email,created_at'];
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'waitlist'").get();
  if (has) {
    const rows = db.prepare('SELECT email, created_at FROM waitlist WHERE deleted_at IS NULL AND source = ? ORDER BY created_at, id').all(source);
    for (const r of rows) lines.push(`${csvField(r.email)},${csvField(new Date(r.created_at).toISOString())}`);
  }
  return `${lines.join('\n')}\n`;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(args.error);
    console.error('Usage: node scripts/waitlist.js [--db path] [--source pro-soon|guide]');
    return 1;
  }
  const file = dbPath(args.db);
  if (!existsSync(file)) { console.error(`No database at ${file}.`); return 1; }
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    process.stdout.write(toCsv(db, args.source));
    return 0;
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (err) {
    console.error('waitlist export failed:', err.message);
    process.exitCode = 1;
  }
}
