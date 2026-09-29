// Terminal fixes 2 (Sep 29): the adopted rules A to C, the ticker screen (a range on
// every change, WHY second, the E / D / N key, quiet dates), NEWS (sources once, hour
// rules, "Before your last visit") and what a filled button means.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { FUNCTION_BAR, tickerStripHtml } from '../public/app.js';
import { changeTag, flagKeyHtml } from '../public/screens/chart.js';
import { quoteHtml, changeWhen, sessionTz } from '../public/screens/quote.js';
import { newsList, TAB_SOURCES } from '../public/screens/news.js';
import {
  newsPageList, sourceToggles, hourOf, readSeen, writeSeen, newestTime, VISIT_LINE, SEEN_KEY,
} from '../public/screens/news-page.js';
import { mainHtml } from '../public/screens/pro.js';
import { feedbackHtml } from '../public/screens/feedback.js';
import { ownFormHtml } from '../public/screens/whatif.js';

const src = (f) => readFileSync(f, 'utf8');
const STYLE = src('public/style.css');
const KIT = src('public/kit.css');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
// [selector, body] for every plain rule (those inside @media too).
const rules = (css) => [...noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim().replace(/\s+/g, ' '), m[2]]);
const ruleOf = (css, sel) => rules(css).find(([s]) => s === sel)?.[1] || '';

// ---- Rule A: every change says its range -------------------------------------------------

test('rule A: the quote\'s change says "today" (or the day it is from)', () => {
  const now = new Date('2026-09-29T14:40:00Z');
  assert.equal(changeWhen({ asOf: '2026-09-29T14:39:28Z' }, now), 'today');
  assert.equal(changeWhen({ asOf: '2026-09-25T20:00:00Z' }, now), 'on Fri', 'a day that is over says which');
  assert.equal(changeWhen({ asOf: '2026-09-28' }, now), 'on Mon', 'a date-only quote');
  assert.equal(changeWhen({ asOf: '2026-09-01T20:00:00Z' }, now), 'on Sep 1', 'older than a week: the date');
  assert.equal(changeWhen({ asOf: null }, now), '', 'no time, no label');
  // Crypto has no day: its change is a rolling 24 hours.
  assert.equal(changeWhen({ ticker: 'BTC', kind: 'crypto', asOf: '2026-09-29T14:39:00Z' }, now), '24h');
  assert.equal(changeWhen({ ticker: 'ETH', kind: 'crypto', asOf: '2026-09-27T03:00:00Z' }, now), '24h', 'on a Sunday too');
  // FX: New York's day, like US stocks.
  assert.equal(sessionTz({ ticker: 'EURUSD', kind: 'fx' }), 'America/New_York');
  assert.equal(changeWhen({ ticker: 'EURUSD', kind: 'fx', asOf: '2026-09-29T14:38:00Z' }, now), 'today');
  assert.equal(changeWhen({ ticker: 'USDJPY', kind: 'fx', asOf: '2026-09-25T20:59:00Z' }, new Date('2026-09-27T15:00:00Z')), 'on Fri', 'a Sunday: Friday\'s move');
  // A non-US index: its own exchange's day. The Nikkei closed at 15:00 Tokyo on Tue Sep 29
  // (06:00 UTC); at 01:00 Tokyo on Wed Sep 30 (still Tue in New York) that is not today.
  assert.equal(sessionTz({ ticker: 'N225', kind: 'index' }), 'Asia/Tokyo');
  const nikkei = { ticker: 'N225', kind: 'index', asOf: '2026-09-29T06:00:00Z' };
  assert.equal(changeWhen(nikkei, new Date('2026-09-29T12:00:00Z')), 'today', '21:00 in Tokyo, the same day');
  assert.equal(changeWhen(nikkei, new Date('2026-09-29T16:00:00Z')), 'on Tue', 'past midnight in Tokyo');
  assert.equal(changeWhen({ ticker: 'FTSE', kind: 'index', asOf: '2026-09-29T15:35:00Z' }, new Date('2026-09-29T23:30:00Z')), 'on Tue', '00:30 in London is the next day');
  assert.equal(changeWhen({ ticker: '7203.T', kind: 'stock', asOf: '2026-09-29T06:00:00Z' }, new Date('2026-09-29T16:00:00Z')), 'on Tue', 'a Tokyo listing by its suffix');
  assert.equal(changeWhen({ ticker: 'SPX', kind: 'index', asOf: '2026-09-29T20:00:00Z' }, new Date('2026-09-30T02:00:00Z')), 'today', '22:00 in New York');
  const html = quoteHtml({ ticker: 'AAPL', name: 'Apple Inc.', kind: 'stock', last: 333.06, change: -5.34, changePct: -1.58, currency: 'USD', asOf: new Date().toISOString() });
  assert.match(html, /<p class="q-chg num down">[−-]5\.34 [−-]1\.58%<span class="q-chg-when dim">today<\/span><\/p>/);
});

test('rule A: the chart\'s change says its range: 1Y, TODAY, IN VIEW', () => {
  assert.equal(changeTag({ range: { range: '1Y' } }), '1Y');
  assert.equal(changeTag({ range: { range: 'MAX' } }), 'MAX');
  assert.equal(changeTag({ range: { range: '1D' }, today: true }), 'TODAY');
  assert.equal(changeTag({ range: { range: '1D' }, today: false }), '1D', 'a 1D chart of a day that is over');
  assert.equal(changeTag({ range: { range: '1D' }, today: true, rolling: true }), '1D', 'crypto: a rolling window, not today');
  assert.equal(changeTag({ range: { range: '1Y' }, zoomed: true }), 'IN VIEW');
  assert.equal(changeTag({ range: { from: '2020-01-01', to: '2024-12-31' } }), 'IN VIEW');
  assert.equal(changeTag({ range: { range: '1Y' }, fetchWin: { from: '2026-01-01', to: '2026-03-01' } }), 'IN VIEW');
  // The header line puts the tag right before the change; the screen's own quote shows
  // the price, so the chart line drops LAST when its window ends now.
  const chart = src('public/screens/chart.js');
  assert.match(chart, /<span class="ch-k ch-tag">\$\{esc\(tag\)\}<\/span>\$\{c\.parts\.map/);
  assert.match(chart, /opts\.quote === 'external' && atLatest \? '' :/);
  // "Today" is asked at each render, never kept from when the chart was made.
  assert.match(chart, /const today = \(\) => nyToday\(\);/);
  assert.doesNotMatch(chart, /const today = nyToday\(\);|const todayDate = new Date\(\);/);
  assert.match(chart, /rolling: inst\?\.kind === 'crypto', today: model\.info\[model\.info\.length - 1\]\?\.day === today\(\)/);
});

// ---- The ticker screen ---------------------------------------------------------------------

test('WHY is the second tab on a stock, right after the chart', () => {
  assert.deepEqual(FUNCTION_BAR.slice(0, 3), ['CHART', 'WHY', 'NEWS']);
  const strip = tickerStripHtml('AAPL', 'CHART');
  const second = [...strip.matchAll(/<a class="fn[^"]*" href="[^"]*" data-cmd="([^"]+)" data-key="(\d)"/g)][1];
  assert.deepEqual([second[1], second[2]], ['AAPL WHY', '2']);
});

test('the E / D / N key: one dim line under the chart, the kinds on it only', () => {
  const all = flagKeyHtml([{ kind: 'E' }, { kind: 'D' }, { kind: 'N' }, { kind: 'E' }]);
  assert.match(all, /^<span class="ch-key-m is-E">E<\/span> earnings .*<span class="ch-key-m is-D">D<\/span> ex-dividend .*<span class="ch-key-m is-N">N<\/span> company filing$/);
  assert.match(flagKeyHtml([{ kind: 'N' }], { intraday: true }), /N<\/span> headline$/, 'N on intraday bars is a headline');
  assert.doesNotMatch(flagKeyHtml([{ kind: 'E' }]), /ex-dividend|filing/);
  assert.equal(flagKeyHtml([]), '');
  assert.match(src('public/screens/chart.js'), /<div class="chart-host [^`]*<\/div><p class="ch-key" aria-label="Chart markers" hidden><\/p>/);
  assert.match(ruleOf(STYLE, '.ch-key'), /color: var\(--dim\)/);
});

test('the dates: plain text that becomes an input box on click or focus, never filled', () => {
  const rest = ruleOf(STYLE, '.ch-dates input');
  assert.match(rest, /border: 1px solid transparent; background: transparent;/);
  assert.match(rest, /cursor: text;/);
  const focus = ruleOf(STYLE, '.ch-dates input:focus');
  assert.match(focus, /border-color: var\(--accent\)/, 'a box to type in on focus (a click focuses it)');
  assert.doesNotMatch(focus, /background: var\(--(accent|text|text-2|here|primary)\)/);
  for (const sel of ['.ch-dates.is-active input', '.ch-dates input.is-bad']) assert.doesNotMatch(ruleOf(STYLE, sel), /background/, sel);
  // The selected range chip outranks them: filled ice blue.
  assert.match(ruleOf(STYLE, '.tab.is-active'), /background: var\(--here\)/);
  // Still inputs: Tab reaches them and Enter applies (chart.js).
  assert.match(src('public/screens/chart.js'), /<input class="ch-date" name="from"/);
});

// ---- NEWS ---------------------------------------------------------------------------------

const NOW = new Date('2026-09-29T14:40:00Z'); // 10:40 in New York
const story = (title, time, source = 'CNBC') => ({ title, link: `https://x.test/${encodeURIComponent(title)}`, time, source });
const LIST = [
  story('A', '2026-09-29T14:37:00Z'), story('B', '2026-09-29T14:15:00Z', 'MarketWatch'),
  story('C', '2026-09-29T13:50:00Z'), story('D', '2026-09-29T13:05:00Z'), story('E', '2026-09-29T12:55:00Z'),
  story('F', '2026-09-28T19:00:00Z'),
];

test('NEWS: the sources once, as toggles in the title strip; each row\'s source dim', () => {
  const strip = sourceToggles(['CNBC', 'MKTW', 'YHOO'], 'ALL', 'MARKETS');
  for (const s of ['ALL', 'CNBC', 'MKTW', 'YHOO']) assert.equal((strip.match(new RegExp(`>${s}<`, 'g')) || []).length, 1, s);
  assert.match(strip, /class="seg-item is-active" data-value="ALL" aria-pressed="true"/);
  // A phone: one button that steps to the next source.
  assert.match(strip, /<button type="button" class="news-src-one" data-value="CNBC" aria-label="Source ALL, press for CNBC">SOURCE ALL<\/button>/);
  assert.match(sourceToggles(['CNBC', 'MKTW'], 'MKTW', 'MARKETS'), /class="news-src-one" data-value="ALL"/, 'the last one steps back to ALL');
  assert.equal(sourceToggles(['SEC EDGAR'], 'ALL', 'SEC'), `<span class="news-srcs-t">${TAB_SOURCES.SEC}</span>`, 'one source: its name, no toggles');
  // The filter row under the strip has the tabs only; the strip's meta the toggles.
  const news = src('public/screens/news-page.js');
  assert.match(news, /bar\.innerHTML = toolbar\(\{ left: tabs, label: 'News' \}\);/);
  assert.doesNotMatch(news, /toolbar\(\{[^)]*right:/);
  assert.match(news, /metaHtml: \(\) => sourceToggles\(sources, src, tab\)/);
  // Each row: the source in the third colour, never the bright blue.
  assert.match(newsList(LIST), /<span class="news-src dim" title="CNBC">CNBC<\/span>/);
  assert.match(ruleOf(STYLE, '.news-src'), /color: var\(--dim\)/);
  // Phones: the tabs wrap (never scroll sideways), the sources are one button.
  assert.match(STYLE, /\.news-bar \.seg \{ flex-wrap: wrap; height: auto; \}/);
  assert.match(STYLE, /\.news-srcs \{ display: none; \}\n {2}\.news-src-one \{ display: inline-flex;/);
});

test('NEWS: the screen is its own lazy module; HOME\'s startup keeps only the list', () => {
  assert.match(src('public/app.js'), /NEWS: lazy\('screens\/news-page\.js'\)/);
  assert.match(src('public/commands.js'), /\{ name: 'NEWS', screen: lazy\('screens\/news-page\.js'\), parse: parseNewsTab \}/);
  const news = src('public/screens/news.js');
  for (const x of ['export function render', 'sourceToggles', 'hourOf', 'readSeen', SEEN_KEY]) assert.ok(!news.includes(x), `${x} is not in the startup file`);
});

test('NEWS: a thin rule at each hour, the hour a small dim label; the day for older ones', () => {
  assert.deepEqual(hourOf('2026-09-29T14:37:00Z', NOW), { key: 'h:10', label: '10:00' });
  assert.deepEqual(hourOf('2026-09-28T19:00:00Z', NOW), { key: 'd:2026-09-28', label: 'SEP 28' });
  assert.equal(hourOf(null, NOW), null);
  const html = newsPageList(LIST, { hours: true, now: NOW });
  const hours = [...html.matchAll(/<li class="news-hour" aria-hidden="true"><span class="news-hour-l num">([^<]+)<\/span><\/li>/g)].map((m) => m[1]);
  assert.deepEqual(hours, ['09:00', '08:00', 'SEP 28'], 'between rows only, never above the first');
  assert.ok(html.indexOf('>09:00<') < html.indexOf('>C<') && html.indexOf('>09:00<') > html.indexOf('>B<'));
  assert.doesNotMatch(newsList(LIST, { now: NOW }), /news-hour|news-since/, 'the HOME box stays plain');
  assert.doesNotMatch(newsPageList(LIST, { now: NOW }), /news-hour/, 'no hours unless asked');
  assert.match(ruleOf(STYLE, '.news-hour-l'), /color: var\(--dim\)/);
});

test('NEWS: "Before your last visit": one line above the older stories', () => {
  const at = (since) => newsPageList(LIST, { hours: true, since, now: NOW });
  const html = at('2026-09-29T14:00:00Z');
  assert.equal((html.match(/class="news-since"/g) || []).length, 1);
  assert.match(html, new RegExp(`>B<[\\s\\S]*<li class="news-since" role="separator"><span class="news-since-l">${VISIT_LINE}</span></li>\\s*<li class="news-row"[^>]*>[\\s\\S]*>C<`));
  assert.doesNotMatch(html, /news-hour-l num">09:00</, 'the line takes the place of the hour rule it falls on');
  assert.doesNotMatch(at('2026-09-29T15:00:00Z'), /news-since/, 'nothing new: no line');
  assert.doesNotMatch(at('2026-09-20T00:00:00Z'), /news-since/, 'all new: no line');
  assert.doesNotMatch(at(null), /news-since/, 'a first visit: no line');
  assert.equal(VISIT_LINE, 'Before your last visit');
});

test('NEWS: the newest time seen, kept per tab; storage that fails is no line, never an error', () => {
  const mem = () => { const m = new Map(); return { get: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), set: (k, v) => m.set(k, JSON.stringify(v)), m }; };
  const s = mem();
  assert.equal(readSeen(s, 'MARKETS'), null);
  writeSeen(s, 'MARKETS', '2026-09-29T14:37:00Z');
  writeSeen(s, 'SEC', '2026-09-29T12:00:00Z');
  assert.equal(readSeen(s, 'MARKETS'), '2026-09-29T14:37:00Z');
  writeSeen(s, 'MARKETS', '2026-09-29T10:00:00Z');
  assert.equal(readSeen(s, 'MARKETS'), '2026-09-29T14:37:00Z', 'never moves back');
  assert.deepEqual(Object.keys(JSON.parse(s.m.get(SEEN_KEY))), ['MARKETS', 'SEC']);
  const broken = { get() { throw new Error('SecurityError'); }, set() { throw new Error('QuotaExceeded'); } };
  assert.equal(readSeen(broken, 'MARKETS'), null);
  assert.doesNotThrow(() => writeSeen(broken, 'MARKETS', '2026-09-29T14:37:00Z'));
  assert.equal(readSeen({ get: () => ({ MARKETS: 'not a date' }) }, 'MARKETS'), null);
  assert.equal(readSeen(undefined, 'MARKETS'), null);
  assert.equal(newestTime(LIST), '2026-09-29T14:37:00Z');
  assert.equal(newestTime([]), '');
  // Kept when the reader leaves NEWS, hides the page, or has seen the list a while.
  const news = src('public/screens/news-page.js');
  assert.match(news, /const since = readSeen\(ctx\.store, tab\);/);
  assert.match(news, /ctx\.onCleanup\?\.\(\(\) => \{\n\s+clearTimeout\(seenTimer\);\n\s+remember\(\);/);
  assert.match(news, /seenTimer = setTimeout\(remember, SEEN_MS\)/);
});

// ---- Rule C: what a fill means --------------------------------------------------------------

const cssFiles = () => {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) { if (!['vendor', 'fonts', 'img', 'geo'].includes(f)) walk(p); } else if (p.endsWith('.css')) out.push(p);
    }
  };
  walk('public');
  return out;
};
// "You are here": an active, on, pressed, selected, current or open state, or a panel
// strip's label. A focus is not exempt as such: the one focus fill is named below.
// Anything else filled ice blue must be on the list: none of them is a button.
const HERE = /is-active|is-on|aria-(pressed|selected|expanded)="true"|aria-current|panel-label|stage-label|desk-label/;
const NOT_BUTTONS = new Set([
  '.ft-sr:focus-within a:focus', // FISHTANK: the search result the keys are on (where you are)
  '.fresh-dot', '.cursor', '.boot-cursor', // the data dot and the command bar's cursor
  '.cl-n', '.news-new', '.chat-badge', '.al-state.is-fired', // counts and states, not buttons
  '.news-since::after', // the "Before your last visit" rule
  '.gv-play', '.spon-point', // a video's play mark; the label pointing at the strip
  '.dp-link[data-link="blue"]::after', '.desk[data-editing="true"] .dp-resize', // DESK: a colour swatch, the resize grip
]);
// An ice blue fill however it is written: the token (--accent, --here, with a fallback or
// in a gradient), the hex, or the hsl at more than a tint (--accent-tint is .1).
const ICE = /var\(--(accent|here)\s*[,)]|#6ccbff\b|hsla?\(\s*201\s*,\s*100%\s*,\s*71%\s*(\)|,\s*(0?\.[3-9]\d*|1(\.0+)?)\s*\))/i;
const iceFill = (body) => [...body.matchAll(/(?:^|;)\s*background(?:-color|-image)?\s*:\s*([^;]+)/g)].some((m) => ICE.test(m[1]));

test('rule C: a primary button is white (--primary), ice blue fills only where you are', () => {
  assert.match(STYLE, /--primary: var\(--text\);/);
  assert.match(STYLE, /--here: var\(--accent\);/);
  assert.match(ruleOf(KIT, '.btn-solid, .btn.btn-solid, .chip.btn-solid'), /background: var\(--primary\); border-color: var\(--primary\); color: var\(--ink\);/);
  assert.match(KIT, /WHITE fill \(--primary[\s\S]*ICE-BLUE fill \(--here\)[\s\S]*OUTLINE = a key or a chip/);
  const bad = [];
  for (const f of cssFiles()) {
    for (const [sel, body] of rules(src(f))) {
      if (!iceFill(body)) continue;
      for (const one of sel.split(',').map((x) => x.trim())) if (!HERE.test(one) && !NOT_BUTTONS.has(one)) bad.push(`${f}: ${one}`);
    }
  }
  assert.deepEqual(bad, [], 'blue fill is for "you are here" only');
  // The scan sees every way of writing it.
  for (const body of ['background: var(--accent)', 'background: var(--accent, #6CCBFF)', 'color: x; background-color: #6ccbff', 'background: hsl(201, 100%, 71%)', 'background: hsla(201, 100%, 71%, .8)', 'background: linear-gradient(90deg, var(--accent), transparent)', 'background-image: linear-gradient(var(--here) 50%, transparent 50%)']) assert.ok(iceFill(body), body);
  for (const body of ['background: var(--accent-tint)', 'background: hsla(201, 100%, 71%, .1)', 'color: var(--accent)', 'border-color: var(--accent)']) assert.ok(!iceFill(body), body);
  // Buttons that were blue: the ALERTS flag is an outline, DESK's keys tint on hover.
  assert.match(ruleOf(STYLE, '.status-alerts'), /border: 1px solid var\(--accent\); background: var\(--accent-tint\); color: var\(--accent\);/);
  assert.match(ruleOf(STYLE, '.desk-btn:hover'), /background: var\(--accent-tint\)/);
  assert.match(ruleOf(src('public/screens/desk.css'), '.dp-btn:hover'), /background: var\(--accent-tint\)/);
  // No button makes its own primary fill: the one-off ones use the token.
  for (const [f, sel] of [['public/style.css', '.wi-run'], ['public/style.css', '.wi-btn:first-child'], ['public/legal.css', '.consent-accept']]) {
    assert.match(ruleOf(src(f), sel), /background: var\(--primary[,)]/, `${f} ${sel}`);
  }
  // .pf-btn is an outline unless the page makes it its one action with .btn-solid.
  assert.match(ruleOf(STYLE, '.pf-btn'), /background: transparent;/);
  const pf = src('public/screens/portfolio.js');
  assert.match(pf, /<a class="pf-btn btn-solid" download="bloombroke-portfolio\.csv"/, 'DOWNLOAD CSV: the PF EXPORT page\'s one action');
  assert.match(pf, /<button type="submit" class="pf-btn btn-solid">REPLACE HOLDINGS<\/button>/, 'PF IMPORT\'s one action');
  assert.match(src('public/screens/guess.js'), /class="pf-btn btn-solid gs-copy">COPY RESULT</);
  // An outline tints on hover, never fills blue.
  assert.match(ruleOf(src('public/commands.css'), '.btn:hover'), /background: var\(--accent-tint\)/);
  // The chart's dates and every input: never a filled look.
  for (const [sel, body] of rules(STYLE)) if (/input|textarea/.test(sel) && !/::|range/.test(sel)) assert.doesNotMatch(body, /background: var\(--(accent|here|primary|text|text-2)\)/, sel);
});

test('rule C: the one action on each page carries .btn-solid (white), one at most', () => {
  const one = (html, name) => assert.equal((html.match(/btn-solid/g) || []).length, 1, name);
  one(mainHtml({ next: 4, has: () => true }), 'PRO SUBSCRIBE');
  one(feedbackHtml(), 'FEEDBACK SEND');
  assert.match(src('public/screens/whatif.js'), /<button type="button" class="wi-run btn-solid" id="wi-run">RUN<\/button>/);
  assert.doesNotMatch(ownFormHtml(), /btn-solid/, 'WHATIF\'s ADD is a key, RUN is the action');
  assert.match(src('public/screens/guess.js'), /class="chip gs-go btn-solid">GUESS</);
  assert.match(src('public/howto.js'), /class="btn card-btn btn-solid howto-go"/, 'PLAY');
  assert.match(src('public/consent.js'), /class="consent-accept btn-solid">START</);
  assert.match(src('public/screens/screen.js'), /class="wi-run btn-solid" type="submit">RUN SCREEN</);
  // Focus on the white fill: an ice blue ring, not a white one on white.
  assert.match(ruleOf(KIT, '.btn-solid:focus-visible'), /outline: 2px solid var\(--accent\)/);
  assert.match(ruleOf(src('public/howto.css'), '.howto-go:focus-visible'), /outline: 2px solid var\(--accent\)/);
});

test('rule C: contrast of ink on the white and the ice blue fills (WCAG AA)', () => {
  const hsl = (h, s, l) => {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
  };
  const lum = (rgb) => rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((t, c, i) => t + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const tok = (name) => hsl(...new RegExp(`--${name}: hsl\\((\\d+), (\\d+)%, (\\d+)%\\)`).exec(STYLE).slice(1).map(Number));
  const ink = tok('ink');
  assert.ok(ratio(tok('text'), ink) >= 4.5, 'ink on the white fill');
  assert.ok(ratio(tok('accent'), ink) >= 4.5, 'ink on the ice blue fill');
  assert.ok(ratio(tok('accent'), tok('bg')) >= 3, 'the focus ring against the page');
});
