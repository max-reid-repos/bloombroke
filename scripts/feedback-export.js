#!/usr/bin/env node
// ADMIN ONLY. Read the FEEDBACK notes on the server, newest first, as plain text.
//
//   node scripts/feedback-export.js [--since YYYY-MM-DD] [--limit N] [--db path]
//   node scripts/feedback-export.js --prune [--db path]    delete notes over 12 months old
//
// The database is --db, else PRO_DB_PATH (from the environment or the .env next to
// server.js), else var/pro.db. Reading opens it read-only. The server also prunes old
// notes at boot and once a day, so --prune is only needed by hand.

import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KEEP_MS } from '../pro/feedback.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 1000;

// argv -> { since (ms), limit, prune, db } or { error }.
export function parseArgs(argv) {
  const out = { since: 0, limit: DEFAULT_LIMIT, prune: false, db: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--prune') out.prune = true;
    else if (a === '--since') {
      const v = val();
      const t = /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? Date.parse(`${v}T00:00:00Z`) : NaN;
      if (!Number.isFinite(t)) return { error: '--since takes a date like 2026-09-01' };
      out.since = t;
    } else if (a === '--limit') {
      const n = Number(val());
      if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return { error: `--limit takes a whole number from 1 to ${MAX_LIMIT}` };
      out.limit = n;
    } else if (a === '--db') {
      const v = val();
      if (!v) return { error: '--db takes a path' };
      out.db = v;
    } else return { error: `unknown option ${a}` };
  }
  return out;
}

// Anything a terminal could act on is shown as a visible escape (\x1b, \u202e), so a
// note can never colour, move or rewrite the owner's terminal. Tab and newline stay.
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
export function safeText(v) {
  return String(v ?? '').replace(UNSAFE, (c) => {
    const n = c.charCodeAt(0);
    return n <= 0xff ? `\\x${n.toString(16).padStart(2, '0')}` : `\\u${n.toString(16).padStart(4, '0')}`;
  });
}

const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

// Rows -> the plain text the owner reads.
export function formatFeedback(rows) {
  if (!rows.length) return 'No feedback.\n';
  return rows.map((r) => {
    const head = [`#${r.id}`, utc(r.created_at), `screen ${safeText(r.screen) || '--'}`, `email ${safeText(r.email) || '--'}`, `legal ${safeText(r.legal_version) || '--'}`].join('  ');
    const body = String(r.message).split(/\r?\n/).map((l) => `    ${safeText(l)}`).join('\n');
    return `${head}\n${body}\n`;
  }).join('\n');
}

// Returns { text } for a read, { pruned } for --prune.
export function run(db, { since = 0, limit = DEFAULT_LIMIT, prune = false, now = Date.now() } = {}) {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'feedback'").get();
  if (!has) return prune ? { pruned: 0 } : { text: 'No feedback table yet: the server has not run migration 008.\n' };
  if (prune) return { pruned: Number(db.prepare('DELETE FROM feedback WHERE created_at < ?').run(now - KEEP_MS).changes) };
  const rows = db.prepare('SELECT * FROM feedback WHERE created_at >= ? ORDER BY created_at DESC, id DESC LIMIT ?').all(since, limit);
  return { text: formatFeedback(rows) };
}

export function dbPath(argDb, env = process.env) {
  if (argDb) return path.resolve(argDb);
  if (!env.PRO_DB_PATH) { try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* optional */ } }
  return path.resolve(env.PRO_DB_PATH || process.env.PRO_DB_PATH || path.join(ROOT, 'var', 'pro.db'));
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(args.error);
    console.error('Usage: node scripts/feedback-export.js [--since YYYY-MM-DD] [--limit N] [--prune] [--db path]');
    return 1;
  }
  const file = dbPath(args.db);
  if (!existsSync(file)) { console.error(`No database at ${file}.`); return 1; }
  const db = new Database(file, { readonly: !args.prune, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const out = run(db, args);
    if (args.prune) console.log(`pruned ${out.pruned} notes over 12 months old`);
    else process.stdout.write(out.text);
    return 0;
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (err) {
    console.error('feedback-export failed:', err.message);
    process.exitCode = 1;
  }
}
