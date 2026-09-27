// Sponsors: one plain line in the status strip, and a "SPONSORED BY" note on a WEIRD
// gauge. Empty by default: data/sponsors.json is {"line": null, "gauges": {}} until a
// sponsor runs. Read once at boot, so a change needs a restart.
//
//   data/sponsors.json
//     line     null, or { "name": "Acme", "text": "Plain words", "url": "https://acme.example" }
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

export const SPONSORS_FILE = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'data', 'sponsors.json');
export const EMPTY = Object.freeze({ line: null, gauges: Object.freeze({}) });
const NAME_MAX = 40;
const TEXT_MAX = 100;
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

// Anything read from the file -> { line, gauges } that is safe to show.
export function cleanSponsors(raw) {
  if (!raw || typeof raw !== 'object') return { line: null, gauges: {} };
  let line = null;
  if (raw.line && typeof raw.line === 'object') {
    const name = plain(raw.line.name, NAME_MAX);
    const text = plain(raw.line.text, TEXT_MAX);
    if (name && text) line = { name, text, url: cleanUrl(raw.line.url) };
  }
  const gauges = {};
  if (raw.gauges && typeof raw.gauges === 'object' && !Array.isArray(raw.gauges)) {
    for (const [id, g] of Object.entries(raw.gauges)) {
      const name = GAUGE_ID.test(id) && g && typeof g === 'object' ? plain(g.name, NAME_MAX) : null;
      if (name) gauges[id] = { name };
    }
  }
  return { line, gauges };
}

let current = null;

export function loadSponsors(file = SPONSORS_FILE, log = console) {
  try {
    current = cleanSponsors(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    if (err?.code !== 'ENOENT') log.error('[sponsors]', err.message);
    current = { line: null, gauges: {} };
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
