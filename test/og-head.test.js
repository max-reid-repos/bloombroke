// The page head and the disk cache's temp names (security test, 30 Sep 2026): $&, $` and
// $' in a visitor's words must never expand into copies of the page (function replacers
// in lib/og.js withCanonical and shareMeta), and two writes never share a temp file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withMeta, affordModel, affordMeta, escAttr } from '../lib/og.js';

test('S3 the page head: $&, $` and $\' in the visitor\'s words stay words (one doctype, one </head>)', () => {
  const html = readFileSync('public/index.html', 'utf8');
  for (const c of ['AFFORD 500 X$` 2 PER WEEK', 'AFFORD 500 X$& 2 PER WEEK', 'AFFORD 500 X$\' 2 PER WEEK']) {
    const m = affordModel(c);
    assert.ok(m, c);
    const out = withMeta(html, affordMeta(m));
    assert.equal((out.match(/<!doctype html>/gi) || []).length, 1, c);
    assert.equal((out.match(/<\/head>/g) || []).length, 1, c);
    assert.equal((out.match(/<head>/g) || []).length, (html.match(/<head>/g) || []).length, c);
    assert.ok(out.includes(`content="${escAttr(m.label)}, `), `${c}: the label is there, as typed`);
  }
  const src = readFileSync('lib/og.js', 'utf8');
  assert.doesNotMatch(src, /\.replace\('<\/head>', `/, 'every </head> insert uses a function');
  assert.equal((src.match(/\.replace\('<\/head>', \(\) => `/g) || []).length, 2);
});

test('S4 temp files: pid, time and random bytes', () => {
  const src = readFileSync('lib/og.js', 'utf8');
  assert.match(src, /const tmp = `\$\{file\}\.\$\{process\.pid\}\.\$\{Date\.now\(\)\}\.\$\{randomBytes\(6\)\.toString\('hex'\)\}\.tmp`;/);
});
