// EMBED: which screens can be embedded, and the code for one (the frame and a credit
// line), with COPY as the page's one action and a live preview of the /embed/* page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCommand, screenFor } from '../public/app.js';
import { parseEmbed } from '../public/command-args.js';
import { EMBEDS, embedFor, guessEmbedSnippet, whatifEmbedSnippet } from '../public/embed-snippet.js';
import { listHtml, noteFor, embedHtml } from '../public/screens/embed.js';
import { findCommand, commandGroups } from '../public/registry.js';
import { ownPreview } from '../lib/embed-pages.js';

test('EMBED: the words it takes', () => {
  assert.deepEqual(parseEmbed([]), { target: null });
  assert.deepEqual(parseEmbed(['GUESS']), { target: 'GUESS' });
  assert.deepEqual(parseEmbed(['WHATIF', 'IPHONE6']), { target: 'WHATIF', command: 'WHATIF IPHONE6' });
  assert.deepEqual(parseEmbed(['AAPL']), { target: null, asked: 'AAPL', mine: false });
  assert.equal(parseEmbed(['WHATIF', 'MY', 'CAR']).mine, true, 'your own list has no embed');
  assert.equal(parseEmbed(['WHATIF']).target, null);
  const c = parseCommand('embed whatif iphone6');
  assert.equal(c.name, 'EMBED');
  assert.deepEqual(c.args, { target: 'WHATIF', command: 'WHATIF IPHONE6' });
  assert.equal(c.input, 'EMBED WHATIF IPHONE6');
  assert.equal(screenFor('EMBED').js, 'screens/embed.js', 'lazy');
});

test('EMBED alone lists the two embeds; any other word says it has none', () => {
  const html = listHtml();
  for (const e of EMBEDS) assert.ok(html.includes(`data-cmd="${e.example}"`), e.name);
  assert.deepEqual(EMBEDS.map((e) => e.name), ['GUESS', 'WHATIF <list>'], 'only the routes lib/embed-pages.js serves');
  assert.match(html, /WHATIF &lt;list&gt;/);
  assert.equal(noteFor(parseEmbed(['AAPL'])), 'AAPL has no embed. These two do:');
  assert.match(noteFor(parseEmbed(['<B>'])), /^&lt;B&gt; has no embed/, 'escaped');
  assert.match(noteFor(parseEmbed(['WHATIF', 'MY', 'CAR'])), /has no embed/);
  assert.equal(noteFor({ target: null }), '');
});

test('EMBED GUESS / WHATIF: the frame and a credit line, escaped on the page, COPY the one white button, a preview', () => {
  const g = embedFor({ target: 'GUESS' });
  assert.equal(g.path, '/embed/guess');
  assert.equal(g.code, `${guessEmbedSnippet()}\n<p><a href="https://bloombroke.com/?c=GUESS">GUESS</a> on Bloombroke</p>`);
  const w = embedFor({ target: 'WHATIF', command: 'WHATIF LATTE:3Y' });
  assert.equal(w.path, '/embed/whatif?c=WHATIF+LATTE%3A3Y');
  assert.ok(w.code.startsWith(whatifEmbedSnippet('WHATIF LATTE:3Y')));
  assert.match(w.code, /<p><a href="https:\/\/bloombroke\.com\/\?c=WHATIF\+LATTE%3A3Y">WHATIF LATTE:3Y<\/a> on Bloombroke<\/p>$/);
  // Hostile words: no raw markup in the code, none on the page.
  const bad = embedFor({ target: 'WHATIF', command: 'WHATIF "><script>x</script>' });
  assert.doesNotMatch(bad.code, /<script>/);
  const page = embedHtml(bad);
  assert.doesNotMatch(page, /<script>/);
  const html = embedHtml(g);
  assert.match(html, /<pre class="emb-code"><code id="emb-code">&lt;iframe src=&quot;https:\/\/bloombroke\.com\/embed\/guess&quot;/);
  assert.equal((html.match(/btn-solid/g) || []).length, 1, 'COPY is the one primary');
  assert.match(html, /<button type="button" class="btn card-btn btn-solid" id="emb-copy">COPY<\/button>/);
  assert.match(html, /<iframe class="emb-frame" src="\/embed\/guess" title="Preview: GUESS" loading="lazy"><\/iframe>/);
  assert.doesNotMatch(html, /<input|style="/, 'no second input, no inline style (the page CSP)');
  assert.equal(embedFor({ target: null }), null);
});

test('EMBED: COPY copies the code and says so', async () => {
  const src = readFileSync('public/screens/embed.js', 'utf8');
  assert.match(src, /ctx\.copy\(e\.code\)/);
  // Drive render with a stand-in element.
  const { render } = await import('../public/screens/embed.js');
  let clicked = null;
  const btn = { textContent: 'COPY', addEventListener: (t, fn) => { clicked = fn; } };
  const el = { innerHTML: '', querySelector: (s) => (s === '#emb-copy' ? btn : null) };
  const copied = [];
  const said = [];
  render(el, parseCommand('EMBED GUESS'), { copy: async (t) => { copied.push(t); return true; }, status: (t) => said.push(t) });
  assert.match(el.innerHTML, /1\) EMBED GUESS/);
  await clicked();
  assert.deepEqual(copied, [embedFor({ target: 'GUESS' }).code]);
  assert.equal(btn.textContent, 'COPIED');
  assert.equal(said.at(-1), 'EMBED CODE COPIED');
});

test('EMBED: in the registry, HELP and MENU; its own preview is not counted as an embed load', () => {
  const e = findCommand('EMBED');
  assert.equal(e.category, 'News and info');
  for (const ex of e.examples) assert.notEqual(parseCommand(ex).name, 'UNKNOWN', ex);
  assert.ok(commandGroups().find((g) => g.name === 'News and info').items.some((it) => it.name === 'EMBED'));
  assert.equal(ownPreview({ get: (h) => (h === 'sec-fetch-site' ? 'same-origin' : undefined) }), true);
  assert.equal(ownPreview({ get: (h) => (h === 'sec-fetch-site' ? 'cross-site' : undefined) }), false);
  assert.equal(ownPreview({ get: () => undefined }), false);
});
