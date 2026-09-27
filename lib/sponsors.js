// Sponsors: lines that rotate in the status strip, and a "SPONSORED BY" note on a WEIRD
// gauge. Read once at boot, so a change needs a restart.
//
//   data/sponsors.json
//     lines    [{ "name": "Acme", "text": "Plain words", "url": "https://acme.example" }]
//              paid lines, marked SPONSOR, up to MAX_LINES. The old single "line" key is
//              still read, as the first line.
//     house    [{ "text": "Plain words", "cmd": "SPONSOR" }] our own lines, marked AD,
//              shown only while there is no paid line. cmd must be a command.
//     gauges   { "<gauge id>": { "name": "Acme" } }, e.g. { "pizza": { "name": "Acme" } }
//
//   GET /api/sponsors -> the cleaned config, for the browser
//
// What gets through is plain text and one https link with no query string or fragment,
// so no tracking code can ride along. The page draws it (public/screens/sponsor.js):
// no pixels, no third-party scripts, and never for Pro users.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCommand } from './registry.js'; // whole entries, HELP's long text too
import { MAX_SPONSOR_LINES } from '../public/sponsor-strip.js';

export const SPONSORS_FILE = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'data', 'sponsors.json');
export const MAX_LINES = MAX_SPONSOR_LINES;
export const MAX_HOUSE = 5;
const NAME_MAX = 40;
const TEXT_MAX = 100;
const HOUSE_MAX = 60;
const empty = () => ({ lines: [], house: [], gauges: {}, line: null });
const GAUGE_ID = /^[a-z][a-z0-9-]{0,31}$/;

// Plain text only: no control characters, no emoji or pictographs, no em dash.
function plain(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s || s.length > max) return null;
  if (/[\u0000-\u001f\u007f\u2014]/.test(s) || /\p{Extended_Pictographic}/u.test(s)) return null;
  return s;
}

// An https link with the query string and fragment taken off (they are where tracking
// codes go). Anything else: no link.
export function cleanUrl(v) {
  if (typeof v !== 'string' || v.length > 200) return null;
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  u.search = '';
  u.hash = '';
  return u.toString();
}

function paidLine(v) {
  if (!v || typeof v !== 'object') return null;
  const name = plain(v.name, NAME_MAX);
  const text = plain(v.text, TEXT_MAX);
  return name && text ? { name, text, url: cleanUrl(v.url) } : null;
}

// A house line runs a command of this site when clicked, never a link out.
function houseLine(v) {
  if (!v || typeof v !== 'object') return null;
  const text = plain(v.text, HOUSE_MAX);
  const cmd = typeof v.cmd === 'string' ? v.cmd.trim().toUpperCase() : 'SPONSOR';
  const entry = /^[A-Z0-9][A-Z0-9 ]{0,31}$/.test(cmd) ? findCommand(cmd.split(' ')[0]) : null;
  return text && entry && !entry.hidden ? { text, cmd } : null;
}

// Anything read from the file -> { lines, house, gauges, line } that is safe to show.
// line (the first paid line) is kept for pages loaded before lines existed.
export function cleanSponsors(raw) {
  if (!raw || typeof raw !== 'object') return empty();
  const paid = [...(raw.line ? [raw.line] : []), ...(Array.isArray(raw.lines) ? raw.lines : [])];
  const lines = paid.map(paidLine).filter(Boolean).slice(0, MAX_LINES);
  const house = (Array.isArray(raw.house) ? raw.house : []).map(houseLine).filter(Boolean).slice(0, MAX_HOUSE);
  const gauges = {};
  if (raw.gauges && typeof raw.gauges === 'object' && !Array.isArray(raw.gauges)) {
    for (const [id, g] of Object.entries(raw.gauges)) {
      const name = GAUGE_ID.test(id) && g && typeof g === 'object' ? plain(g.name, NAME_MAX) : null;
      if (name) gauges[id] = { name };
    }
  }
  return { lines, house, gauges, line: lines[0] || null };
}

let current = null;

export function loadSponsors(file = SPONSORS_FILE, log = console) {
  try {
    current = cleanSponsors(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    if (err?.code !== 'ENOENT') log.error('[sponsors]', err.message);
    current = empty();
  }
  return current;
}

export const sponsors = () => current || loadSponsors();

// The sponsor name for a WEIRD gauge id, or null. Used by the gauge share card.
export function gaugeSponsor(id, cfg = sponsors()) {
  return cfg.gauges[id]?.name || null;
}

export function mountSponsors(app, { file = SPONSORS_FILE, log = console } = {}) {
  const cfg = loadSponsors(file, log);
  app.get('/api/sponsors', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(cfg);
  });
  return cfg;
}
