// Versioned asset URLs. The page references /v/<build>/app.js and /v/<build>/style.css,
// where <build> is a hash of everything in public/. A deploy changes the hash, so no
// browser or edge cache can mix an old app.js with new screens (or keep an old app.js
// that does not know a new command). The HTML itself is served with no-cache.

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

// Point the page's own script and stylesheet at the versioned path.
export function versionIndex(html, build) {
  return String(html).replace(/(src|href)="\/(app\.js|style\.css)"/g, `$1="/v/${build}/$2"`);
}
