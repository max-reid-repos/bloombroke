// Asset URLs.
//
// Per-file content hashes (buildAssets): every JS, CSS and font file in public/ gets a
// URL with a hash of its own bytes in the name, /screens/whatif.3f2a1b9c0d.js, served
// with a year-long immutable cache. A deploy that leaves a file alone leaves its URL
// alone, so browsers keep it. Relative imports inside a module (import x from './kit.js')
// and url(...) in a stylesheet are rewritten to their targets' hashed names, and the hash
// covers the rewritten text, so a module's URL also changes when anything it imports
// changes. Modules loaded by name at run time (dynamic screens, their stylesheets) find
// their hashed URL in the manifest the page carries (hashIndex: a JSON data block, not a
// script, so the strict CSP still holds).
//
// A hashed URL whose hash is not today's (a page opened before a deploy asking for a
// screen it has not loaded yet) is a 404, never cached: today's file under an old name
// could mix two builds in one page (two copies of app.js). public/lazy.js then reloads
// the page once, and the fresh page has today's names.
//
// The old scheme stays for the legal and embed pages: /v/<build>/app.js, where <build>
// is a hash of everything in public/ (buildId, versionIndex).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

function listFiles(dir, base = dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(full, base));
    else if (ent.isFile()) out.push(path.relative(base, full));
  }
  return out.sort();
}

export function buildId(publicDir) {
  const h = createHash('sha256');
  for (const rel of listFiles(publicDir)) {
    h.update(rel.split(path.sep).join('/'));
    h.update('\0');
    h.update(readFileSync(path.join(publicDir, rel)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

// Point every local top-level script and stylesheet (/app.js, /style.css, /commands.css)
// at the versioned path. External URLs and data: icons are left alone.
export function versionIndex(html, build) {
  return String(html).replace(/(src|href)="\/([\w-]+(?:\.[\w-]+)*\.(?:js|css))"/g, `$1="/v/${build}/$2"`);
}

// ---- per-file hashes ----------------------------------------------------------------

export const HASH_LEN = 10;
// Files that get a hashed URL. JS and CSS are rewritten; fonts are only renamed.
const TEXT = new Set(['.js', '.css']);
const HASHED = new Set(['.js', '.css', '.woff2', '.woff']);
// Relative specifiers in a module: import ... from './x.js', export ... from './x.js',
// import './x.js', import('./x.js'). Only literal relative paths to files that exist.
const JS_REFS = [
  /(\bfrom\s*)(['"])(\.{1,2}\/[^'"\n]+)\2/g,
  /(\bimport\s*)(['"])(\.{1,2}\/[^'"\n]+)\2/g,
  /(\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]+)\2(?=\s*\))/g,
];
// url(...) in a stylesheet, quoted or not, local paths only.
const CSS_REF = /(url\(\s*)(['"]?)((?:\/|\.{1,2}\/)?[\w./-]+\.(?:woff2?|css))\2(?=\s*\))/g;

const posix = path.posix;
const sha = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) { h.update(p); h.update('\0'); }
  return h.digest('hex').slice(0, HASH_LEN);
};

// rel ('screens/whatif.js') + hash -> the hashed rel ('screens/whatif.3f2a1b9c0d.js').
export function hashedName(rel, hash) {
  const ext = posix.extname(rel);
  return `${rel.slice(0, rel.length - ext.length)}.${hash}${ext}`;
}

// The file a reference points at, as a rel path from public/, or null.
function target(fromRel, spec, known) {
  const clean = spec.split(/[?#]/)[0];
  const rel = clean.startsWith('/') ? clean.slice(1) : posix.normalize(posix.join(posix.dirname(fromRel), clean));
  return known.has(rel) ? rel : null;
}

function refsOf(rel, text, known) {
  const res = posix.extname(rel) === '.css' ? [CSS_REF] : JS_REFS;
  const out = new Set();
  for (const re of res) for (const m of text.matchAll(re)) { const t = target(rel, m[3], known); if (t) out.add(t); }
  return [...out];
}

// The reference rewritten to the target's hashed name, in the same form (relative stays
// relative, absolute stays absolute).
function rewrite(rel, text, urlOf, known) {
  const res = posix.extname(rel) === '.css' ? [CSS_REF] : JS_REFS;
  let out = text;
  for (const re of res) {
    out = out.replace(re, (all, pre, quote, spec) => {
      const t = target(rel, spec, known);
      if (!t) return all;
      const hashed = urlOf(t).slice(1);
      let next;
      if (spec.startsWith('/')) next = `/${hashed}`;
      else {
        next = posix.relative(posix.dirname(rel), hashed);
        if (!next.startsWith('.')) next = `./${next}`;
      }
      return `${pre}${quote}${next}${quote}`;
    });
  }
  return out;
}

// Strongly connected groups of files (import cycles), dependencies first (Tarjan).
function groups(nodes, deps) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const stack = [];
  const on = new Set();
  const out = [];
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index += 1;
    stack.push(v); on.add(v);
    for (const w of deps.get(v) || []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const g = [];
      let w;
      do { w = stack.pop(); on.delete(w); g.push(w); } while (w !== v);
      out.push(g.sort());
    }
  };
  for (const v of nodes) if (!idx.has(v)) visit(v);
  return out;
}

// Every hashed file in publicDir: { files: Map(rel -> entry), url(rel), manifest(),
// closure(rel), lazyDeps(entry), stylesOf(rel, entry), lookup(pathname) }. entry: { rel,
// abs, hash, url, body (JS and CSS), deps }.
// bundles: { name: [rel, ...] } adds a file made of those stylesheets one after another
// (base.css: every stylesheet public/index.html links, so the page has one).
export function buildAssets(publicDir, { bundles = {} } = {}) {
  const rels = listFiles(publicDir).map((r) => r.split(path.sep).join('/')).filter((r) => HASHED.has(posix.extname(r)));
  const known = new Set(rels);
  const raw = new Map();
  const deps = new Map();
  for (const rel of rels) {
    const abs = path.join(publicDir, rel);
    const buf = readFileSync(abs);
    raw.set(rel, buf);
    deps.set(rel, TEXT.has(posix.extname(rel)) ? refsOf(rel, buf.toString('utf8'), known) : []);
  }
  const files = new Map();
  const urlOf = (rel) => files.get(rel).url;
  for (const g of groups(rels, deps)) {
    const text = TEXT.has(posix.extname(g[0]));
    if (g.length === 1 && !deps.get(g[0]).includes(g[0])) {
      const rel = g[0];
      const body = text ? Buffer.from(rewrite(rel, raw.get(rel).toString('utf8'), urlOf, known)) : null;
      const hash = sha(body || raw.get(rel));
      files.set(rel, { rel, abs: path.join(publicDir, rel), hash, url: `/${hashedName(rel, hash)}`, body, deps: deps.get(rel) });
      continue;
    }
    // A cycle: one hash for the whole group, from its files and what they import outside it.
    const inGroup = new Set(g);
    const outside = [...new Set(g.flatMap((r) => deps.get(r)).filter((d) => !inGroup.has(d)))].sort();
    const hash = sha(...g.flatMap((r) => [r, raw.get(r)]), ...outside.map((d) => files.get(d).hash));
    for (const rel of g) files.set(rel, { rel, abs: path.join(publicDir, rel), hash, url: `/${hashedName(rel, hash)}`, body: null, deps: deps.get(rel) });
    for (const rel of g) files.get(rel).body = Buffer.from(rewrite(rel, raw.get(rel).toString('utf8'), urlOf, known));
  }

  for (const [name, list] of Object.entries(bundles)) {
    const body = Buffer.from(list.map((r) => `/* ${r} */\n${files.get(r).body.toString('utf8')}`).join('\n'));
    const hash = sha(body);
    files.set(name, { rel: name, abs: null, hash, url: `/${hashedName(name, hash)}`, body, deps: list, bundle: true });
  }

  // rel -> hash for the JS and CSS files: what public/lazy.js reads to load by name.
  const manifest = () => Object.fromEntries([...files.values()].filter((f) => f.body).map((f) => [f.rel, f.hash]));

  // A module and everything it imports statically (not its dynamic imports).
  const staticDeps = new Map();
  for (const rel of rels) {
    if (posix.extname(rel) !== '.js') continue;
    const text = raw.get(rel).toString('utf8');
    const out = new Set();
    for (const re of JS_REFS.slice(0, 2)) for (const m of text.matchAll(re)) { const t = target(rel, m[3], known); if (t) out.add(t); }
    staticDeps.set(rel, [...out]);
  }
  function closure(rel) {
    const seen = new Set();
    const walk = (r) => { if (seen.has(r) || !files.has(r)) return; seen.add(r); for (const d of staticDeps.get(r) || []) walk(d); };
    walk(rel);
    return [...seen];
  }

  // A request path -> { entry, current } for a hashed URL of a known file, or null.
  const HASHED_PATH = new RegExp(`^/(.+)\\.([0-9a-f]{${HASH_LEN}})(\\.[a-z0-9]+)$`);
  function lookup(pathname) {
    const m = HASHED_PATH.exec(String(pathname || ''));
    if (!m) return null;
    const entry = files.get(`${m[1]}${m[3]}`);
    return entry ? { entry, current: entry.hash === m[2] } : null;
  }

  // For each module the page may load by name: what it imports beyond the page's own
  // modules (the closure of entry), so a prefetch can fetch those too.
  function lazyDeps(entry) {
    const shell = new Set(closure(entry));
    const out = {};
    for (const rel of staticDeps.keys()) {
      if (shell.has(rel)) continue;
      const more = closure(rel).filter((r) => r !== rel && !shell.has(r));
      if (more.length) out[rel] = more;
    }
    return out;
  }

  // A module's stylesheets: the sheet beside each module it loads (screens/whatif.js ->
  // screens/whatif.css), except the page's own modules (closure of entry), whose styles
  // are always on the page, and a sheet already in a bundle (kit.css beside kit.js, in
  // base.css): loaded again, it would sit last and change the cascade.
  const bundled = new Set(Object.values(bundles).flat());
  function stylesOf(rel, entry) {
    const shell = new Set(closure(entry));
    return closure(rel).filter((r) => !shell.has(r)).map((r) => r.replace(/\.js$/, '.css')).filter((c) => files.has(c) && !bundled.has(c));
  }
  function lazyStyles(entry) {
    const out = {};
    for (const rel of staticDeps.keys()) {
      const list = stylesOf(rel, entry);
      if (list.length) out[rel] = list;
    }
    return out;
  }

  return { files, url: (rel) => files.get(rel)?.url || null, manifest, closure, lazyDeps, stylesOf, lazyStyles, lookup };
}

// The page with hashed URLs: top-level local scripts and stylesheets point at their
// hashed names, and the manifest goes in the head as a JSON data block (never run, so
// CSP 'self' still holds): { files: { rel: hash }, deps: { rel: [rel] }, css: { rel: [rel] } }.
// bundle: a stylesheet bundle (buildAssets) that takes the place of the page's local
// stylesheet links, so one stylesheet blocks the first paint instead of nine. preload: extra rel paths to hint as modulepreload (a module's
// static imports, so the browser fetches them in parallel instead of one level at a time).
export function hashIndex(html, assets, { preload = [], bundle = null } = {}) {
  let out = String(html);
  if (bundle && assets.url(bundle)) {
    let first = true;
    out = out.replace(/[ \t]*<link rel="stylesheet" href="\/[\w./-]+\.css">\n?/g, (tag) => {
      if (!first) return '';
      first = false;
      return tag.replace(/href="[^"]+"/, `href="${assets.url(bundle)}"`);
    });
  }
  out = out.replace(/(src|href)="\/([\w-]+(?:\/[\w-]+)*(?:\.[\w-]+)*\.(?:js|css))"/g, (all, attr, rel) => {
    const url = assets.url(rel);
    return url ? `${attr}="${url}"` : all;
  });
  const json = JSON.stringify({ files: assets.manifest(), deps: assets.lazyDeps('app.js'), css: assets.lazyStyles('app.js') }).replace(/</g, '\\u003c');
  const hints = preload.map((rel) => assets.url(rel)).filter(Boolean).map((u) => `<link rel="modulepreload" href="${u}">`).join('');
  out = out.replace(/(\s*)<script type="module"/, `$1<script type="application/json" id="bb-assets">${json}</script>${hints ? `$1${hints}` : ''}$1<script type="module"`);
  return out;
}

// Link tags that start a screen's files early (a deep link): modulepreload for each module,
// preload for each stylesheet. Goes in the head, before the app's own script.
export function preloadTags(assets, { modules = [], styles = [] } = {}) {
  const js = modules.map((rel) => assets.url(rel)).filter(Boolean).map((u) => `<link rel="modulepreload" href="${u}">`);
  const css = styles.map((rel) => assets.url(rel)).filter(Boolean).map((u) => `<link rel="preload" as="style" href="${u}">`);
  return [...css, ...js].join('');
}

// Express middleware for hashed URLs. Today's hash: immutable for a year. An old hash
// (a page from before a deploy): 404, not cached, and the page reloads (public/lazy.js).
// shell: the page's own entry files (app.js, lazy.js, base.css). An old hash of one of
// those means an old HTML page (Back/Forward can restore one) that has not started yet,
// so it goes to / instead (302, not cached), and never stays blank.
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export function serveAssets(assets, { shell = [] } = {}) {
  const entries = new Set(shell);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const hit = assets.lookup(req.path);
    if (!hit) return next();
    const { entry, current } = hit;
    if (!current && entries.has(entry.rel)) return res.status(302).set({ 'Cache-Control': 'no-store', Location: '/' }).end();
    if (!current) return res.status(404).set('Cache-Control', 'no-store').type('text/plain').send('Not this build. Reload the page.');
    res.set('Cache-Control', IMMUTABLE);
    res.set('ETag', `"${entry.hash}"`);
    res.type(posix.extname(entry.rel));
    if (entry.body) return res.send(entry.body);
    return res.sendFile(entry.abs, { headers: { 'Cache-Control': IMMUTABLE }, etag: false, lastModified: false, cacheControl: false });
  };
}
