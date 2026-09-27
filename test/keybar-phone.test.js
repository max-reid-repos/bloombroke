import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FKEYS, keybarHtml } from '../public/app.js';

test('phone key bar: short labels where the full word does not fit, the long one for screen readers', () => {
  const html = keybarHtml();
  assert.deepEqual(FKEYS.filter((k) => k.short).map((k) => [k.label, k.short]), [['MARKETS', 'MKTS'], ['PORTFOLIO', 'PF']]);
  for (const k of FKEYS.filter((x) => x.mobile)) assert.ok((k.short || k.label).length <= 5, `${k.label} fits a phone`);
  assert.match(html, /aria-label="PORTFOLIO"><span class="fkey-n">F8<\/span><span class="fkey-l">PORTFOLIO<\/span><span class="fkey-short">PF<\/span>/);
  assert.doesNotMatch(html, /aria-label="HOME"/, 'a key without a short label keeps its own text');
  const css = readFileSync('public/style.css', 'utf8');
  assert.match(css, /\.fkeys \.fkey-l:has\(\+ \.fkey-short\) \{ display: none; \}/);
});
