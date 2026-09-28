#!/usr/bin/env node
// ADMIN ONLY. Read the CHAT reports on the server, newest first, as plain text: who
// reported, the reported seats, the reason and the copy of the last 20 messages.
//
//   node scripts/chat-reports.js [--since YYYY-MM-DD] [--limit N] [--db path]
//
// The database is --db, else PRO_DB_PATH (from the environment or the .env next to
// server.js), else var/pro.db, opened read-only. The server deletes reports after 12
// months (pro/chat-store.js purge).

import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, safeText, dbPath } from './feedback-export.js';

const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const seatOf = (s) => (s === null || s === undefined ? 'SEAT --' : `SEAT ${s}`);
const json = (v, fb) => { try { return JSON.parse(v); } catch { return fb; } };

// Rows -> the plain text the owner reads. Anything a terminal could act on is escaped.
export function formatReports(rows) {
  if (!rows.length) return 'No chat reports.\n';
  return rows.map((r) => {
    const reported = json(r.reported, []).map((x) => seatOf(x.seat)).join(', ') || '--';
    const head = [`#${r.id}`, utc(r.created_at), `by ${seatOf(r.reporter_seat)}`, `reported ${reported}`, `room ${r.room_id ?? '--'}`].join('  ');
    const reason = `  reason: ${safeText(r.reason) || '--'}`;
    const msgs = json(r.snapshot_json, []).map((m) => {
      const who = m.name ? `${safeText(m.name)} ${m.seat ?? '--'}` : seatOf(m.seat);
      const card = m.card ? `  [card ${safeText(m.card)}]` : '';
      const text = String(m.text ?? '').split(/\r?\n/).map(safeText).join('\n      ');
      return `    ${utc(m.at)}  ${who}: ${text}${card}`;
    });
    return [head, reason, ...(msgs.length ? msgs : ['    (no messages)'])].join('\n') + '\n';
  }).join('\n');
}

export function run(db, { since = 0, limit = 50 } = {}) {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_reports'").get();
  if (!has) return { text: 'No chat_reports table yet: the server has not run migration 013.\n' };
  const rows = db.prepare('SELECT * FROM chat_reports WHERE created_at >= ? ORDER BY created_at DESC, id DESC LIMIT ?').all(since, limit);
  return { text: formatReports(rows) };
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error || args.prune) {
    console.error(args.error || '--prune is not for reports: the server deletes them after 12 months');
    console.error('Usage: node scripts/chat-reports.js [--since YYYY-MM-DD] [--limit N] [--db path]');
    return 1;
  }
  const file = dbPath(args.db);
  if (!existsSync(file)) { console.error(`No database at ${file}.`); return 1; }
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    process.stdout.write(run(db, args).text);
    return 0;
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (err) {
    console.error('chat-reports failed:', err.message);
    process.exitCode = 1;
  }
}
