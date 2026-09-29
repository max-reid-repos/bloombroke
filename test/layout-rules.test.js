// The layout rules for the card pages (kit.js cardPage, kit.css "Card pages"), so they
// stick: a word budget per page above + Details, no inline sizes in card markup, the
// kit's CSS only on the type and spacing scales of style.css, the slots in one order,
// one primary button, and the copy rules. The browser half (overflow, a cut-off globe,
// sizes as drawn, line length) is scripts/layout-audit.cjs, run by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardPage, cardButton, cardLink, cardFacts, cardRows, cardWords, raw, HERO_SIZES } from '../public/kit.js';
import { bbrkHtml } from '../public/screens/bbrk.js';
import { sponsorHtml } from '../public/screens/sponsor.js';
import { mainHtml, loginHtml, redeemHtml, giftHtml, giftLoggedOutHtml } from '../public/screens/pro.js';

const all = () => true;
const KEY = 'BB-7KQ2-M9XD-HT4P-WZ3C';
const BBRK = {
  mrr: 'MRR $0 (test mode)',
  audience: {
    visitors: { today: 15, yesterdaySoFar: 12, d7: 83, d30: 83 }, pageviews: { d7: 270 }, spark30: [0, 0, 18, 37, 19, 15],
    avgVisitSec: 390, returningPct: 3.6, desktopPct: 51.5, live: 3,
    countries: [{ name: 'United States', pct: 71 }, { name: 'Japan', pct: 11 }], referrers: [{ name: 'Direct/None', pct: 100 }],
    globe: { window: '7d', countries: [{ cc: 'US', visitors: 59 }], other: 9 },
  },
  inventory: { stripShown: { today: 491, d7: 750 }, stripClicks: { today: 7, d7: 9 }, embedLoads: { today: 0, d7: 1 }, mcpCalls: { today: 0, d7: 0 } },
};
const ST = { status: 'active', seat: 12, canGift: true, interval: 'year', currentPeriodEnd: new Date(Date.UTC(2027, 8, 27, 12)).toISOString() };
const shownInTest = (html) => html.replace('<span id="pro-test" hidden>', '<span id="pro-test">');

// [page, html, budget]: the words above + Details, numbers, keys and codes not counted.
export const PAGES = [
  ['PRO visitor (test mode)', shownInTest(mainHtml({ next: 4, has: all })), 30],
  ['PRO key', mainHtml({ key: KEY, st: ST, has: all }), 25],
  ['PRO key, just bought', mainHtml({ key: KEY, st: ST, reveal: KEY, has: all }), 25],
  ['BBRK', bbrkHtml(BBRK), 25],
  ['BBRK loading', bbrkHtml(null), 25],
  ['SPONSOR', sponsorHtml({ has: all, bbrk: BBRK, cfg: { lines: [], house: [{ text: 'x', cmd: 'SPONSOR' }] } }), 30],
  ['LOGIN', loginHtml(), 15],
  ['REDEEM', redeemHtml(), 15],
  ['GIFT, logged out', giftLoggedOutHtml(), 15],
  ['GIFT', giftHtml({ gifts: [], left: 3, canGift: true }), 15],
  ['GIFT, a code made', giftHtml({ gifts: [], left: 2, canGift: true }, { shown: 'GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345' }), 15],
];

test('word budget: each card page says what it must above + Details, and no more', () => {
  for (const [name, html, budget] of PAGES) {
    const w = cardWords(html);
    assert.ok(w.length <= budget, `${name}: ${w.length} words (budget ${budget}): ${w.join(' ')}`);
  }
});

test('word count: numbers, prices, keys and codes are not words; hidden parts and + Details are left out', () => {
  assert.deepEqual(cardWords('<p>SEAT 00004</p><p>$420 a year.</p>'), ['SEAT', 'a', 'year.']);
  assert.deepEqual(cardWords(`<p>${KEY} GIFT-XXXX-... 6m 30s +12 ±0</p>`), []);
  assert.deepEqual(cardWords('<p>one<span hidden> two</span></p><details class="how card-more"><summary>Details</summary>three</details>'), ['one']);
});

test('card markup: token classes only, no inline sizes; the slots in one order; one primary button', () => {
  for (const [name, html] of PAGES) {
    assert.doesNotMatch(html, /style="/, `${name}: no inline style`);
    assert.doesNotMatch(html, /font-size|\d+px/, `${name}: no sizes in the markup`);
    assert.ok((html.match(/btn-solid/g) || []).length <= 1, `${name}: one primary button at most`);
    const sizes = [...html.matchAll(/card-hero-(\d+)/g)].map((m) => Number(m[1]));
    assert.ok(sizes.every((n) => HERO_SIZES.includes(n)), `${name}: hero ${sizes}`);
    // The slots, in the kit's order, each at most once.
    const order = ['card-alert', 'card-kicker', 'card-hero', 'card-sub', 'card-act', 'card-note', 'card-chart', 'card-facts', 'card-media', 'card-links', 'card-more'];
    const at = order.map((c) => html.indexOf(`class="${c}`) >= 0 ? html.indexOf(`class="${c}`) : html.indexOf(` ${c}`)).filter((i) => i >= 0);
    assert.deepEqual(at, [...at].sort((a, b) => a - b), `${name}: slots in order`);
  }
  // The kit itself: text is escaped, raw() passes markup, a missing slot is not drawn.
  const html = cardPage({ kicker: '<b>', hero: raw('<i>x</i>'), facts: [{ value: '1', label: 'A' }], links: [cardLink({ label: 'L', cmd: 'L' })], details: raw(cardRows([['K', 'v']])) });
  assert.match(html, /<p class="tag card-kicker">&lt;b&gt;<\/p>/);
  assert.match(html, /<h2 class="card-hero card-hero-60 num"><i>x<\/i><\/h2>/);
  assert.doesNotMatch(html, /card-sub|card-act|card-note|card-chart|card-media|card-alert/);
  assert.match(html, /<details class="how card-more"><summary>Details<\/summary>/, 'WHATIF\'s + Details toggle, closed');
  assert.equal(cardPage({ heroSize: 17, hero: 'x' }).includes('card-hero-60'), true, 'a size off the scale falls back to 60');
  assert.match(cardButton({ label: 'GO', primary: true }), /^<button type="button" class="btn card-btn btn-solid">GO<\/button>$/);
  assert.match(cardButton({ label: 'GO', cmd: 'PRO' }), /^<a class="btn card-btn" href="\?c=PRO" data-cmd="PRO">GO<\/a>$/);
  assert.match(cardFacts([{ value: '1', label: 'A' }, { value: '2', label: 'B' }]), /^<dl class="card-facts n2"><div class="card-fact"><dt class="tag">A<\/dt><dd class="num">1<\/dd><\/div>/);
});

// The scales, read from style.css's header, so there is one place to change them.
const STYLE = readFileSync('public/style.css', 'utf8');
const scale = (name) => (new RegExp(`${name} scale: ([\\d ]+)`).exec(STYLE)?.[1] || '').trim().split(/\s+/).map(Number);
const TYPE = scale('Type');
const SPACE = scale('Spacing');

// The CSS that card pages are drawn with: kit.css's card section, and each card screen's
// own sheet (or its card section).
function cardCss() {
  const kit = readFileSync('public/kit.css', 'utf8');
  const pro = readFileSync('public/screens/pro.css', 'utf8');
  return [
    ['kit.css', kit.slice(kit.indexOf('/* ---- Card pages'))],
    ['bbrk.css', readFileSync('public/screens/bbrk.css', 'utf8')],
    ['sponsor.css', readFileSync('public/screens/sponsor.css', 'utf8')],
    ['pro.css', pro.slice(pro.indexOf('/* ==== PRO, LOGIN, REDEEM, GIFT: card pages'))],
  ];
}

test('card CSS: font sizes on the type scale, spaces on the spacing scale, px only', () => {
  assert.deepEqual(TYPE, [11, 12, 13, 14, 16, 18, 24, 32, 44, 60, 96]);
  assert.deepEqual(SPACE, [2, 4, 6, 8, 12, 16, 24, 32, 48]);
  for (const [file, css] of cardCss()) {
    assert.ok(css.length > 200, `${file}: its card section is there`);
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of body.matchAll(/font-size:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      assert.match(v, /^\d+px$/, `${file}: font-size ${v} is px`);
      assert.ok(TYPE.includes(parseInt(v, 10)), `${file}: font-size ${v} is on the type scale`);
    }
    for (const m of body.matchAll(/(?:^|[\s;{])((?:margin|padding)(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap):\s*([^;}]+)/g)) {
      for (const part of m[2].trim().split(/\s+/)) {
        if (part === '0' || part === 'auto') continue;
        assert.match(part, /^\d+px$/, `${file}: ${m[1]} ${m[2]} uses px`);
        assert.ok(SPACE.includes(parseInt(part, 10)), `${file}: ${m[1]} ${part} is on the spacing scale`);
      }
    }
    // Weights: 400 and 700 in the kit (600 is the older label weight of .tag).
    for (const m of body.matchAll(/font-weight:\s*(\d+)/g)) assert.ok(['400', '600', '700'].includes(m[1]), `${file}: weight ${m[1]}`);
    // Colours: the palette's own levels, never a new one.
    assert.doesNotMatch(body.replace(/--globe-[a-z]+: [^;]+;/g, ''), /#[0-9a-f]{3,6}\b|rgb\(|hsl\(/i, `${file}: colours come from style.css`);
  }
  // The group gap is at least twice the gap inside a group (Refactoring UI: more space
  // around a group than within it).
  const kit = cardCss()[0][1];
  const group = Number(/\.card \{[^}]*gap: (\d+)px/.exec(kit)[1]);
  const inside = Number(/\.card-head, \.card-cta, \.card-foot \{[^}]*gap: (\d+)px/.exec(kit)[1]);
  assert.ok(group >= 2 * inside, `${group} >= 2 x ${inside}`);
  // The layout widths are variables of style.css, with the other layout sizes.
  for (const v of ['--card-w: 640px', '--card-w-wide: 880px', '--globe-w: min(340px, 40vh)']) assert.ok(STYLE.includes(v), v);
});

test('copy rules on the card pages: no em dash, no emoji, no brand word, no amber, no advice up front, no data vendor', () => {
  const brand = new RegExp(['bloom', 'berg'].join(''), 'i');
  for (const [name, html] of PAGES) {
    assert.doesNotMatch(html, /—/, `${name}: em dash`);
    assert.doesNotMatch(html, /\p{Extended_Pictographic}/u, `${name}: emoji`);
    assert.doesNotMatch(html, brand, `${name}: brand word`);
    assert.doesNotMatch(html, /amber/i, name);
    assert.doesNotMatch(html.split('<details')[0], /\b(advice|advise|you should|we recommend|buy now|invest in)\b/i, `${name}: advice words above Details`);
    assert.doesNotMatch(html, /DataFast|Yahoo|Polygon|Finnhub|Alpha Vantage|Twelve Data|Nasdaq Data/i, `${name}: a data vendor on screen`);
  }
  for (const f of ['public/kit.js', 'public/kit.css', 'public/screens/bbrk.css', 'public/screens/sponsor.css', 'public/screens/pro.css']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /—/, `${f}: em dash`);
    assert.doesNotMatch(src, brand, `${f}: brand word`);
    assert.doesNotMatch(src, /amber|orange/i, `${f}: amber`);
  }
});
