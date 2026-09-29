// WHATIS: market words in plain English. Definitions only (a conservative stance: no
// advice, no opinions, no predictions), short, and every link lands on a real term.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TERMS, findTerm, closestTerms, suggestTerms, COMMON, linksIn, plainText, wordCount, termKey } from '../public/whatis-terms.js';
import { render, termHtml, listHtml, unknownHtml, whatisView, definitionHtml, sortedTerms, FEEDBACK_PREFILL } from '../public/screens/whatis.js';
import { statRows, statLabel } from '../public/screens/quote.js';
import { cardWords } from '../public/kit.js';
import { parseCommand, screenFor } from '../public/app.js';
import { findCommand, commandGroups, START_HERE, REGISTRY } from '../public/registry.js';
import { DETAIL } from '../public/registry-detail.js';
import { buildAssets } from '../lib/assets.js';

// Words a definition never uses: advice, judgement, prediction, and the copy rules.
const BANNED = [/\bshould\b/i, /\bbuy\b/i, /\bsell\b/i, /\brecommend/i, /\bbest\b/i, /good investment/i, /will rise/i, /will fall/i,
  /\byou must\b/i, /\bworth buying\b/i, /—/, /–/, /bloomberg/i, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u];

test('WHATIS: about 40+ terms, each 45 words at most, one-line example, no banned words', () => {
  assert.ok(TERMS.length >= 40, `${TERMS.length} terms`);
  for (const t of TERMS) {
    assert.ok(t.term && t.text && Array.isArray(t.aliases) && Array.isArray(t.see), `${t.term}: whole entry`);
    const n = wordCount(t.text);
    assert.ok(n <= 45, `${t.term}: ${n} words`);
    const sentences = plainText(t.text).split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length;
    assert.ok(sentences >= 1 && sentences <= 3, `${t.term}: ${sentences} sentences`);
    for (const s of [t.term, t.text, t.example || '', ...t.aliases]) {
      for (const re of BANNED) assert.doesNotMatch(s, re, `${t.term}: "${s}" has ${re}`);
    }
    if (t.example) {
      assert.ok(wordCount(t.example) <= 25 && !/\n/.test(t.example), `${t.term}: example is one short line`);
      assert.match(t.example, /\d/, `${t.term}: example has numbers`);
    }
  }
});

test('WHATIS: the file itself keeps the copy rules', () => {
  for (const f of ['public/whatis-terms.js', 'public/screens/whatis.js', 'public/screens/whatis.css']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /—|–|bloomberg/i, f);
  }
});

test('WHATIS: every name and alias is one term only, and finds it', () => {
  const seen = new Map();
  for (const t of TERMS) {
    for (const w of [t.term, ...t.aliases]) {
      const k = termKey(w);
      assert.ok(k, `${t.term}: "${w}" has letters`);
      assert.ok(!seen.has(k) || seen.get(k) === t.term, `"${w}" is both ${seen.get(k)} and ${t.term}`);
      seen.set(k, t.term);
      assert.equal(findTerm(w)?.term, t.term, `"${w}" finds ${t.term}`);
    }
  }
});

test('WHATIS: aliases resolve the ways people type them', () => {
  const P_E = ['PE', 'P/E', 'pe ratio', 'P/E RATIO', 'price to earnings', 'Price-to-earnings ratio', 'what is P/E?', 'the P/E ratio'];
  for (const w of P_E) assert.equal(findTerm(w)?.term, 'P/E ratio', w);
  const cases = {
    yield: 'Yield', YIELDS: 'Yield', 'a bond': 'Bond', bonds: 'Bond', 'the VIX': 'VIX', ETFs: 'ETF', bp: 'Basis point',
    'CHAPTER 11': 'Bankruptcy', '13F': '13F filing', OWNERS: '13F filing', '8-K': '8-K filing', '2s10s': '2s10s spread', 'MKT CAP': 'Market cap',
    'DIV YIELD': 'Dividend yield', '52W RANGE': '52-week range', 'PREV CLOSE': 'Closing price', RT: 'Real time and delayed', DLY: 'Real time and delayed',
    'AFTER HOURS': 'Pre-market and after hours', PREMARKET: 'Pre-market and after hours', FX: 'Exchange rate', 'short interest': 'Short interest',
    'days to cover': 'Short interest', treasuries: 'Treasury', 'T-bill': 'Treasury', candles: 'Candlestick', 'reverse split': 'Stock split',
    'move index': 'MOVE index', 'fed funds': 'Fed funds rate', 'market holidays': 'Market holiday', 'spot price': 'Spot price', IPOs: 'IPO',
  };
  for (const [w, term] of Object.entries(cases)) assert.equal(findTerm(w)?.term, term, w);
  for (const w of ['', '   ', 'xyz', 'banana bread', '?']) assert.equal(findTerm(w), null, `"${w}" is not a term`);
});

test('WHATIS: an unknown word gets the 3 closest terms', () => {
  assert.deepEqual(closestTerms('dividnd').map((t) => t.term).slice(0, 1), ['Dividend']);
  assert.equal(closestTerms('volatilty')[0].term, 'Volatility');
  assert.equal(closestTerms('treasry')[0].term, 'Treasury');
  assert.equal(closestTerms('insiderz')[0].term, 'Insider');
  assert.equal(closestTerms('xyz').length, 3, 'always three');
  assert.equal(new Set(closestTerms('bnd').map((t) => t.term)).size, 3, 'three different terms');
  assert.ok(closestTerms('bnd').some((t) => t.term === 'Bond'));
  // Close ones first, topped up with common terms; nothing close: the common ones.
  const d = suggestTerms('dividnd');
  assert.equal(d.close, true);
  assert.deepEqual(d.terms.slice(0, 2).map((t) => t.term), ['Dividend', 'Ex-dividend date']);
  assert.equal(d.terms.length, 3);
  assert.deepEqual(suggestTerms('ratio').terms[0].term, 'P/E ratio', 'a later word of a name');
  assert.deepEqual(suggestTerms('spread').terms.slice(0, 2).map((t) => t.term), ['2s10s spread', 'Bid and ask']);
  for (const w of ['xyz', 'liquidity', 'beta']) {
    const s = suggestTerms(w);
    assert.equal(s.close, false, w);
    assert.deepEqual(s.terms.map((t) => t.term), COMMON, w);
  }
  for (const c of COMMON) assert.ok(findTerm(c), c);
});

test('WHATIS: every "see also" and every link in a definition lands on a real term, never itself', () => {
  for (const t of TERMS) {
    assert.ok(t.see.length >= 1 && t.see.length <= 3, `${t.term}: 1 to 3 see also`);
    for (const s of t.see) {
      const f = findTerm(s);
      assert.ok(f, `${t.term}: see "${s}" exists`);
      assert.notEqual(f.term, t.term, `${t.term}: not itself`);
    }
    for (const l of linksIn(t.text)) {
      const f = findTerm(l.target);
      assert.ok(f, `${t.term}: link "${l.target}" exists`);
      assert.notEqual(f.term, t.term, `${t.term}: links not to itself`);
    }
    assert.doesNotMatch(plainText(t.text), /[[\]|]/, `${t.term}: no link marks left`);
  }
});

test('WHATIS <term>: a card with the term, the definition (links), the example dim, see also', () => {
  const pe = findTerm('P/E');
  const html = termHtml(pe);
  assert.match(html, /<p class="tag card-kicker">WHATIS<\/p>/);
  assert.match(html, /<h2 class="card-hero card-hero-44 num">P\/E ratio<\/h2>/);
  assert.match(html, /<p class="card-sub">The P\/E ratio is a share&#39;s price divided by its <a class="wi-def" href="\?c=WHATIS\+EPS" data-cmd="WHATIS EPS"[^>]*>earnings per share<\/a>/);
  assert.match(html, /<p class="card-note">Example: A \$50 share with \$2 of earnings per share has a P\/E of 25\.<\/p>/);
  assert.match(html, /<span class="tag">See also<\/span><a class="chip wi-chip" href="\?c=WHATIS\+EPS" data-cmd="WHATIS EPS" data-key="1">EPS<\/a>/);
  assert.match(html, /data-cmd="WHATIS Earnings" data-key="2"/);
  assert.match(html, /data-cmd="WHATIS" >?[^<]*ALL TERMS|data-cmd="WHATIS">ALL TERMS/);
  // Every see-also runs and finds its term.
  for (const m of html.matchAll(/data-cmd="(WHATIS [^"]+)"/g)) {
    const cmd = parseCommand(m[1].replace(/&#39;/g, "'"));
    assert.equal(cmd.name, 'WHATIS');
    assert.ok(findTerm(cmd.args.words), m[1]);
  }
  // The words above + Details: the definition, the example and see also, never more than 80.
  for (const t of TERMS) assert.ok(cardWords(termHtml(t)).length <= 80, `${t.term}: ${cardWords(termHtml(t)).length} words`);
  // Short terms big, long ones smaller.
  assert.match(termHtml(findTerm('VIX')), /card-hero-60/);
  assert.match(termHtml(findTerm('after hours')), /card-hero-32/);
  assert.equal(definitionHtml('A <b> [bond] & [no such term|zzz].'), 'A &lt;b&gt; <a class="wi-def" href="?c=WHATIS+Bond" data-cmd="WHATIS Bond" title="WHATIS Bond">bond</a> &amp; no such term.');
});

test('WHATIS alone: one numbered panel, every term A to Z, each a link with its number', () => {
  const html = listHtml();
  assert.match(html, /<h2 class="panel-label">1\) WHATIS: MARKET WORDS IN PLAIN ENGLISH<\/h2>/);
  assert.match(html, new RegExp(`${TERMS.length} TERMS`));
  const items = [...html.matchAll(/<a class="wi-item" href="[^"]+" data-cmd="([^"]+)" data-num="(\d+)" title="[^"]+"><span class="wi-n num" aria-hidden="true">\d+<\/span>([^<]+)<\/a>/g)];
  assert.equal(items.length, TERMS.length);
  assert.deepEqual(items.map((m) => Number(m[2])), TERMS.map((_, i) => i + 1));
  const names = items.map((m) => m[3].replace(/&amp;/g, '&'));
  assert.deepEqual(names, sortedTerms().map((t) => t.term));
  assert.equal(names[0], '2s10s spread', 'numbers first, in number order');
  assert.ok(names.indexOf('Bond') < names.indexOf('Yield'));
  for (const m of items) assert.equal(findTerm(parseCommand(m[1]).args.words)?.term, m[3].replace(/&amp;/g, '&'));
  assert.match(html, /Definitions only, not advice\./);
});

test('WHATIS xyz: no definition yet, the 3 closest (keys 1 to 3), TELL US prefilled', () => {
  const html = unknownHtml('XYZ');
  assert.match(html, /<h2 class="card-hero card-hero-24 num">No definition for XYZ yet\.<\/h2>/);
  assert.match(html, /<p class="card-sub">Some common terms:<\/p>/, 'nothing close to XYZ');
  assert.match(unknownHtml('DIVIDND'), /<p class="card-sub">The closest terms:<\/p>[\s\S]*data-cmd="WHATIS Dividend" data-key="1"/);
  assert.equal((html.match(/class="btn card-btn[^"]*" href="\?c=WHATIS\+[^"]+" data-cmd="WHATIS [^"]+" data-key="[123]"/g) || []).length, 3);
  assert.equal((html.match(/btn-solid/g) || []).length, 1, 'one primary');
  assert.match(html, /<a class="card-link" href="\?c=FEEDBACK" data-cmd="FEEDBACK" data-prefill="Please add to WHATIS: XYZ">TELL US<\/a>/);
  assert.equal(FEEDBACK_PREFILL('XYZ'), 'Please add to WHATIS: XYZ');
  assert.ok(cardWords(html).length <= 20, `${cardWords(html).length} words`);
  assert.match(unknownHtml('<b>'), /No definition for &lt;b&gt; yet\./, 'escaped');
});

test('WHATIS: the screen renders each view and wires TELL US', () => {
  const listeners = {};
  const el = { innerHTML: '', addEventListener: (k, fn) => { listeners[k] = fn; }, removeEventListener: (k) => { delete listeners[k]; } };
  const said = [];
  const ctx = { status: (s) => said.push(s) };
  let stop = render(el, parseCommand('WHATIS P/E'), ctx);
  assert.match(el.innerHTML, /card-hero[^>]*>P\/E ratio</);
  assert.equal(said.at(-1), 'WHATIS: DEFINITIONS ONLY, NOT ADVICE');
  stop();
  assert.equal(listeners.click, undefined, 'cleanup removes the click handler');
  render(el, parseCommand('WHATIS'), ctx);
  assert.match(el.innerHTML, /wi-panel/);
  assert.match(said.at(-1), /^\d+ TERMS\. DEFINITIONS ONLY, NOT ADVICE$/);
  stop = render(el, parseCommand('whatis xyz'), ctx);
  assert.match(el.innerHTML, /No definition for XYZ yet/);
  assert.equal(said.at(-1), 'NO DEFINITION FOR XYZ YET');
  assert.equal(typeof listeners.click, 'function');
  stop();
  assert.equal(whatisView('yield').found.term, 'Yield');
  assert.match(whatisView('pe ratio').html, /P\/E ratio/);
});

test('WHATIS: a free command in the registry, HELP and MENU, lazy, START HERE unchanged', () => {
  for (const [typed, words] of [['WHATIS', ''], ['whatis pe ratio', 'PE RATIO'], ['WHATIS P/E', 'P/E'], ['whatis price to earnings', 'PRICE TO EARNINGS']]) {
    const c = parseCommand(typed);
    assert.equal(c.name, 'WHATIS', typed);
    assert.equal(c.args.words, words, typed);
    assert.ok(!c.error);
  }
  assert.equal(parseCommand('WHATIF').name, 'WHATIF', 'WHATIF is still WHATIF');
  const e = findCommand('WHATIS');
  assert.equal(e.category, 'News and info');
  assert.ok(e.summary.length <= 60 && !/—/.test(e.summary));
  assert.deepEqual(e.examples, ['WHATIS', 'WHATIS P/E', 'WHATIS YIELD']);
  assert.ok(DETAIL.WHATIS, 'HELP detail');
  assert.ok(commandGroups().find((g) => g.name === 'News and info').items.some((it) => it.name === 'WHATIS'));
  assert.deepEqual(START_HERE.map(([c]) => c), ['AAPL', 'MARKETS', 'NEWS', 'WHATIF IPHONE6', 'GUESS']);
  assert.equal(screenFor('WHATIS').js, 'screens/whatis.js');
  assert.equal(REGISTRY.filter((c) => c.name === 'WHATIS').length, 1);
  // Lazy: the definitions and the screen are never in the startup JS; the registry holds
  // only the name and one line.
  const a = buildAssets('public');
  const shell = a.closure('app.js');
  assert.ok(!shell.includes('whatis-terms.js') && !shell.includes('screens/whatis.js'));
  assert.doesNotMatch(readFileSync('public/registry.js', 'utf8'), /earnings per share|basis point is/i);
});

test('QUOTE: the stats labels link to their WHATIS card', () => {
  const d = { kind: 'stock', ticker: 'XYZQ', last: 100, marketCap: '1.00B', pe: 20, eps: 5, divYield: '2.00%', volume: '1.2M', low52: 80, high52: 120, prevClose: 99 };
  const labels = statRows(d).map(([k]) => k);
  for (const k of labels) {
    const html = statLabel(k);
    const m = /data-cmd="([^"]+)"/.exec(html);
    assert.ok(m, `${k} links`);
    const cmd = parseCommand(m[1]);
    assert.equal(cmd.name, 'WHATIS');
    assert.ok(findTerm(cmd.args.words), `${k}: ${cmd.args.words} is a term`);
  }
  assert.equal(statLabel('Open'), 'Open', 'no card: the plain label');
  assert.match(statLabel('P/E'), /^<a class="stat-what" href="\?c=WHATIS\+P%2FE" data-cmd="WHATIS P\/E" title="WHATIS P\/E: what it means">P\/E<\/a>$/);
});
