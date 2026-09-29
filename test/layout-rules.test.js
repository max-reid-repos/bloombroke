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
import { feedbackHtml } from '../public/screens/feedback.js';
import { notProHtml } from '../public/screens/chat.js';
import { meHtml } from '../public/screens/me.js';
import { usageCard, emptyState } from '../public/kit.js';
import { examplePlan } from '../public/app.js';
import { didYouMeanHtml } from '../public/cards.js';
import { affordUsage, NOT_INVESTMENTS } from '../public/screens/buy.js';
import { cpiUsage } from '../public/screens/cpi.js';
import { usage as loanUsage, noRateHtml } from '../public/screens/loan.js';
import { usage as historyUsage } from '../public/screens/history.js';
import { usage as tapeUsage } from '../public/screens/tape.js';
import { tickerUsage, errorHtml, splitDescription, descHtml, DESC_LEAD } from '../public/screens/profile.js';
import { notCompanyHtml } from '../public/screens/why.js';
import { dataUsage } from '../public/screens/data.js';
import { emptyWatchHtml } from '../public/screens/watch.js';
import { emptyPfHtml } from '../public/screens/portfolio.js';
import { emptyAlertsHtml } from '../public/screens/alerts.js';
import { deskEmptyHtml } from '../public/screens/desk.js';
import { emptyHtml as chatEmptyHtml } from '../public/screens/chat.js';
import { noSuchExtra, ipoUsage, TITLE_GONE } from '../public/screens/nosuch.js';
import { stonePageHtml, fitStone, GV_ROW } from '../public/screens/graveyard.js';
import { wageUsage } from '../public/screens/buy.js';
import { usage as earningsUsage } from '../public/screens/earnings.js';
import { usageHtml as compareUsage } from '../public/screens/compare.js';
import { usage as compoundUsage } from '../public/screens/compound.js';
import { usage as exdivUsage } from '../public/screens/exdiv.js';
import { filingsUsage } from '../public/screens/filings.js';
import { economyUsage } from '../public/screens/economy.js';
import { rangeUsage } from '../public/screens/quote.js';
import { optionsUsage } from '../public/screens/options.js';
import { fxUsage } from '../public/screens/fx.js';
import { financialsUsage } from '../public/screens/financials.js';
import { withArt } from '../lib/graveyard.js';
import { buyHtml, buyMaths, affordShare, wageHtml } from '../public/screens/buy.js';
import { cpiResultHtml } from '../public/screens/cpi.js';
import { loanResultHtml } from '../public/screens/loan.js';
import { mcpHtml, MCP_URL, MCP_RULE, MCP_APPS } from '../public/screens/mcp.js';
import { tapeHtml } from '../public/screens/tape.js';
import { linkConfirmHtml, renamedHtml, soonHtml, notLoadedHtml, liveHintHtml } from '../public/cards.js';
import { parseCommand } from '../public/app.js';
import { resultHtml as whatifHtml, shareLinks as whatifLinks, videoHtml as whatifVideo } from '../public/screens/whatif.js';
import { getWhatif, catalog as WHATIF_CATALOG } from '../data/whatif-service.js';
import { certModel } from '../data/whatif-cert.js';

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

// NO SUCH TICKER and a GRAVEYARD stone, with the real data and the art on disk.
const GRAVES = JSON.parse(readFileSync('data/graveyard.json', 'utf8'));
const ART = (e) => ({ stone: '/img/graveyard/stone.webp', doodles: [e.ticker], sites: e.wayback ? [e.ticker] : [] });
const graveOf = (t) => { const e = GRAVES.find((x) => x.ticker === t); return withArt(e, ART(e)); };
// A dead ticker typed on its own keeps the NO SUCH card (its stone); every other word
// gets the NOT A TICKER panel (test/not-found-panel.test.js).
const noSuch = (typed, found, ticker, info, opts = {}) => {
  const word = ticker || typed;
  const extra = noSuchExtra(word, info, opts);
  return didYouMeanHtml(typed, found, ticker, { extra: { ...extra, kicker: extra.kicker || 'Not found' } });
};
export const NOSUCH = [
  ['NO SUCH, a dead ticker (LEH, a quote elsewhere)', noSuch('LEH', {}, 'LEH', { grave: graveOf('LEH'), ipo: false }, { quote: true })],
  ['GRAVEYARD LEH', stonePageHtml(graveOf('LEH'), 12)],
  ['GRAVEYARD GM (a zombie)', stonePageHtml(graveOf('GM'), 0)],
];

// ---- Part B: result screens, TAPE, SPONSOR's terminal, the shell's own small cards -------
const AFF = (a, wage = null) => { const r = buyMaths(a, { wage }); return buyHtml(r, affordShare(r, 'AFFORD 1200 BIKE 2 PER WEEK', 'https://bloombroke.com')); };
const CPI = { result: 135.19, amount: 100, year: 2015, pct: 35.19, perYear: 2.4, base: 237.017, latest: { label: 'Aug 2026', value: 320.4 } };
const RATE_SOURCE = 'Average 30-year fixed mortgage rate, weekly national survey, week of SEP 24, 2026';
// TAPE: the Pro list of tickers is the media (a list, not words), so it is left out of the count.
const TAPE_LIST = /<div class="tape-list">[\s\S]*?<\/ul><\/div>/;
export const CARDS_B = [
  ['AFFORD result, no wage saved', AFF({ price: 1200, times: 2, unit: 'WEEK', years: 3, label: 'Bike' }), 30],
  ['AFFORD result, a wage saved', AFF({ price: 30000, times: 1, unit: 'WEEK', years: 8 }, 35), 30],
  ['CPI result', cpiResultHtml(CPI), 30],
  ['LOAN result, today\'s rate', loanResultHtml({ amount: 400000, years: 30 }, 6.5, RATE_SOURCE), 30],
  ['LOAN result, your rate', loanResultHtml({ amount: 25000, years: 5 }, 7.9, 'Rate you gave'), 30],
  ['WAGE saved', wageHtml(35), 15],
  ['WAGE shown', wageHtml(35, { show: true }), 15],
  ['WAGE, none saved', wageHtml(null), 15],
  ['WAGE cleared', wageHtml(null, { clear: true }), 15],
  ['MCP', mcpHtml(), 30],
  ['A link that wants to change a list', linkConfirmHtml({ title: 'Watchlist', what: 'watchlist', input: 'WATCH ADD AAPL, MSFT', view: 'WATCH' }), 30],
  ['RENAMED', renamedHtml(), 15],
  ['COMING SOON', soonHtml({ name: 'AAPL EARNINGS', hint: 'EARNINGS for one ticker is on the way', ticker: 'AAPL' }), 15],
  ['A screen that did not load', notLoadedHtml(), 15],
  ['GO LIVE outside a chat', liveHintHtml(), 15],
  ['TAPE on', tapeHtml({ on: true }), 20],
  ['TAPE off', tapeHtml({ on: false }), 20],
  ['TAPE, Pro, a note', tapeHtml({ on: true, isPro: true, custom: ['AAPL', 'MSFT', 'GOLD'], note: 'No ticker called XYZQ.', kind: 'warn' }).replace(TAPE_LIST, ''), 20],
];

// ---- WHATIF results: a split card page (kit.js cardPage split), 12 words ------------------
// Fixed prices, so nothing touches the network. The certificate says every amount (it is a
// picture, role="img"); beside it only SHARE, the note, REPLAY and CHANGE PICKS. The list
// of things is in + Details (WI_LIST: a list in view, only when there is no certificate).
const WI_NOW = new Date('2026-09-27T12:00:00Z');
const wiQuote = async () => ({ last: 100, asOf: '2026-09-25T20:00:00Z' });
export async function whatifPage(tokens) {
  const d = await getWhatif(tokens, { quoteImpl: wiQuote, chartImpl: async () => null, risk: true, now: WI_NOW });
  const command = `WHATIF ${tokens.join(' ')}`;
  d.cert = certModel(d, WHATIF_CATALOG, command);
  return whatifHtml(d, { key: command, links: whatifLinks(d.cert, 'https://bloombroke.com'), video: whatifVideo(d, 'webcodecs') });
}
export const WHATIF_WORDS = 12;
const WI_LIST = /<div class="card-media"><div class="wi-receipt">[\s\S]*?<\/table>\s*<\/div><\/div>/;
export const WHATIF = [
  ['WHATIF IPHONE6', await whatifPage(['IPHONE6'])],
  ['WHATIF BEER:10Y (a VICES habit)', await whatifPage(['BEER:10Y'])],
  ['WHATIF IPHONE6 RTX3080 LATTE:3Y (the list in + Details)', (await whatifPage(['IPHONE6', 'RTX3080', 'LATTE:3Y'])).replace(WI_LIST, '')],
];

// [page, html, budget]: the words above + Details, numbers, keys and codes not counted.
export const PAGES = [
  // PRO v5 (Sep 29, "one stage, four keys"): the kicker (1), the promise as the hero (19),
  // the price line's words (a month, a year: 4), SUBSCRIBE (1), "Cancel any time." (3),
  // the stage's title strip (PINGS demo: 2) and its key row (PINGS CHAT EVERY DEVICE
  // SEAT: 5) = 35 in live mode; 42 with the test-mode line ("Test mode: no card is charged
  // yet.": 7). The key-or-code line is in + Details now; words in the stage's view are the
  // picture's (role="img").
  ['PRO visitor (test mode)', shownInTest(mainHtml({ next: 4, has: all })), 42],
  ['PRO visitor', mainHtml({ next: 4, has: all }), 35],
  ['PRO key', mainHtml({ key: KEY, st: ST, has: all }), 25],
  // Just bought or redeemed: the save line (the last chance to save the key); in a browser
  // that saved it, MANAGE PLAN and CANCEL too. 27 (the reviewer's call, Sep 29).
  ['PRO key, just bought', mainHtml({ key: KEY, st: ST, reveal: KEY, has: all }), 27],
  ['BBRK', bbrkHtml(BBRK), 25],
  ['BBRK loading', bbrkHtml(null), 25],
  ['SPONSOR', sponsorHtml({ has: all, bbrk: BBRK, cfg: { lines: [], house: [{ text: 'x', cmd: 'SPONSOR' }] } }), 30],
  ['LOGIN', loginHtml(), 15],
  ['REDEEM', redeemHtml(), 15],
  ['GIFT, logged out', giftLoggedOutHtml(), 15],
  ['GIFT', giftHtml({ gifts: [], left: 3, canGift: true }), 15],
  ['GIFT, a code made', giftHtml({ gifts: [], left: 2, canGift: true }, { shown: 'GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345' }), 15],
  ['FEEDBACK', feedbackHtml(), 19], // 15 + "No IP address stored." (the reviewer's call, Sep 29)
  ['CHAT without Pro', notProHtml(), 15],
  // ME: the hero, the profile editor, the plan, this device, the links; key and data in + Details.
  ['ME', meHtml({ key: KEY, st: { ...ST, seat: 2 }, me: { seat: 2, username: 'Abcdefghijklmno', color: 3, avatar: null }, tape: true, has: all }), 30],
  ['ME, no username yet', meHtml({ key: KEY, st: { ...ST, seat: 2 }, me: null, has: all }), 30],
  ['ME, asking NEW KEY', meHtml({ key: KEY, st: ST, me: null, confirm: 'key', has: all }), 30],
  ['ME without Pro', meHtml({ has: all }), 20],
  ['ME, Pro ended', meHtml({ key: KEY, st: { ...ST, status: 'canceled' }, has: all }), 20],
  ...NOSUCH.map(([name, html]) => [name, html, 30]),
  ...CARDS_B.map(([name, html, budget]) => [name, html, budget]),
  // WHATIF: 12. No sentence (the certificate says it): SHARE (1), the legal note that stays
  // in view (8: "Hindsight. Past returns do not predict future ones."), REPLAY CHANGE PICKS (3).
  ...WHATIF.map(([name, html]) => [name, html, WHATIF_WORDS]),
];

// The usage card (kit.js usageCard) wherever a command is typed wrong: 15 words at most.
export const USAGE = [
  ['AFFORD, words it could not read', affordUsage('AFFORD could not read that.')],
  ['AFFORD, no price', affordUsage('AFFORD needs a price.')],
  ['AFFORD, a price it cannot read', affordUsage('That price does not look right.')],
  ['AFFORD, how often', affordUsage('How often? Use a number from 1 to 1,000.')],
  ['AFFORD, how long', affordUsage('For how long? Use 1 to 100 years, like FOR 3Y.')],
  ['AFFORD, an investment', affordUsage(NOT_INVESTMENTS, { withFormat: false })],
  ['CPI, no year', cpiUsage('CPI needs a year, and maybe an amount.')],
  ['CPI, an amount', cpiUsage('That amount does not look right. Use digits, up to 1,000,000,000,000.')],
  ['CPI, a year out of range', cpiUsage('Pick a year from 1913 to 2025.')],
  ...['usage', 'amount', 'years', 'rate'].map((k) => [`LOAN, ${k}`, loanUsage(k)]),
  ['LOAN, no rate data', noRateHtml({ amount: 400000, years: 30 })],
  ['HISTORY', historyUsage()],
  ['TAPE, a word it does not take', tapeUsage({ error: 'usage', args: {} })],
  ['TAPE, not a ticker', tapeUsage({ error: 'symbol', args: { bad: 'XYZQW' } })],
  ['PROFILE (and the other company screens)', tickerUsage('PROFILE', ['PROFILE AAPL', 'PROFILE KO', 'PROFILE NVDA'])],
  ['INSIDERS', tickerUsage('INSIDERS', ['INSIDERS AAPL', 'INSIDERS TSLA'])],
  ['A company screen, no such ticker', errorHtml({ status: 404, message: 'No company called XYZQW.' }, 'XYZQW')],
  ['WHY, not a company', notCompanyHtml('SPX')],
  ['DATA', dataUsage()],
  ['IPO IT, no word', ipoUsage()],
  ['WAGE, no pay', wageUsage('usage')],
  ['EARNINGS', earningsUsage()],
  ['COMPARE', compareUsage()],
  ...['usage', 'rate', 'years', 'amount'].map((k) => [`COMPOUND, ${k}`, compoundUsage(k)]),
  ['EXDIV', exdivUsage()],
  ['FILINGS', filingsUsage()],
  ['ECONOMY', economyUsage('usage')],
  ['ECONOMY, a range', economyUsage('range')],
  ...['usage', 'date', 'order', 'future'].map((k) => [`A chart range, ${k}`, rangeUsage('AAPL', k)]),
  ...['usage', 'kind', 'expiry'].map((k) => [`OPTIONS, ${k}`, optionsUsage({ error: k, ticker: 'AAPL' })]),
  ['FX, typed wrong', fxUsage('Use three-letter codes, like USD or EUR.')],
  ['FX, an amount', fxUsage('That amount does not look right. Use digits, up to 1,000,000,000,000.')],
  ['FX, a currency it does not know', fxUsage('We do not know the currency XYZ.', 'Supported: <span class="codes">USD EUR</span>', ['FX 100 USD EUR'])],
  ['FINANCIALS', financialsUsage()],
  ['WAGE, a pay it cannot read', wageUsage('amount')],
];

// The empty state (kit.js emptyState) wherever a list is empty: 20 words at most.
export const EMPTY = [
  ['WATCH, empty', emptyWatchHtml()],
  ['PORTFOLIO, empty', emptyPfHtml()],
  ['ALERTS, empty', emptyAlertsHtml()],
  ['DESK, empty', deskEmptyHtml(2).replace(' hidden>', '>')], // shown by desk.js when the desk has no panels
  ['CHAT, no chats yet', chatEmptyHtml(42)],
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
    const order = ['card-alert', 'card-art', 'card-kicker', 'card-hero', 'card-sub', 'card-act', 'card-note', 'card-chart', 'card-facts', 'card-media', 'card-links', 'card-more'];
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
  const style = readFileSync('public/style.css', 'utf8');
  return [
    ['kit.css', kit.slice(kit.indexOf('/* ---- Card pages'))],
    ['bbrk.css', readFileSync('public/screens/bbrk.css', 'utf8')],
    ['sponsor.css', readFileSync('public/screens/sponsor.css', 'utf8')],
    ['pro.css', pro.slice(pro.indexOf('/* ==== PRO, LOGIN, REDEEM, GIFT: card pages'))],
    ['pro-demo.css (the minis on PRO)', readFileSync('public/screens/pro-demo.css', 'utf8')],
    ['style.css FEEDBACK', style.slice(style.indexOf('/* FEEDBACK: a card page'), style.indexOf('.fb-hp'))],
    ['me.css', readFileSync('public/screens/me.css', 'utf8')],
    ['graveyard.css stone card', (() => { const g = readFileSync('public/screens/graveyard.css', 'utf8'); return g.slice(g.indexOf('/* ---- One stone as a card page')); })()],
    ['nosuch.css NOT A TICKER panel', (() => { const n = readFileSync('public/screens/nosuch.css', 'utf8'); return n.slice(n.indexOf('/* NOT A TICKER')); })()],
    ['whatif.css result card', (() => { const w = readFileSync('public/screens/whatif.css', 'utf8'); return w.slice(w.indexOf('/* ---- WHATIF result: a split card page'), w.indexOf('/* Title strip parts')); })()],
    // WELCOME's colours keep their fallbacks (it can paint before style.css): sizes only.
    ['welcome.css', readFileSync('public/screens/welcome.css', 'utf8'), { colours: false }],
  ];
}

test('card CSS: font sizes on the type scale, spaces on the spacing scale, px only', () => {
  assert.deepEqual(TYPE, [11, 12, 13, 14, 16, 18, 24, 32, 44, 60, 96]);
  assert.deepEqual(SPACE, [2, 4, 6, 8, 12, 16, 24, 32, 48]);
  for (const [file, css, { colours = true } = {}] of cardCss()) {
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
    if (colours) assert.doesNotMatch(body.replace(/--globe-[a-z]+: [^;]+;/g, ''), /#[0-9a-f]{3,6}\b|rgb\(|hsl\(/i, `${file}: colours come from style.css`);
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
  for (const f of ['public/kit.js', 'public/kit.css', 'public/screens/bbrk.css', 'public/screens/sponsor.css', 'public/screens/pro.css', 'public/screens/feedback.js', 'public/screens/welcome.css', 'public/screens/me.js', 'public/screens/me.css', 'public/pixel-avatar.js',
    'public/cards.js', 'public/kit-core.js', 'public/screens/buy.js', 'public/screens/cpi.js', 'public/screens/loan.js', 'public/screens/mcp.js', 'public/screens/tape.js', 'public/screens/sponsor.js', 'public/drive.js']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /—/, `${f}: em dash`);
    assert.doesNotMatch(src, brand, `${f}: brand word`);
    assert.doesNotMatch(src, /amber|orange/i, `${f}: amber`);
  }
});

// ---- Part A: the usage card, the empty state, NO SUCH TICKER, GRAVEYARD stones -----------

const between = (html, a, b) => { const i = html.indexOf(a); return i < 0 ? '' : html.slice(i, b ? html.indexOf(b, i) : undefined); };

test('usage card: the problem, the format as code, one example that runs; the rest in + Details; 15 words', () => {
  for (const [name, html] of USAGE) {
    const w = cardWords(html);
    assert.ok(w.length <= 15, `${name}: ${w.length} words (budget 15): ${w.join(' ')}`);
    assert.match(html, /^<section class="card card-usage"/, `${name}: the kit's usage card`);
    assert.equal((html.match(/btn-solid/g) || []).length, 1, `${name}: one example, the primary button`);
    assert.match(html, /<div class="card-act"><a class="btn card-btn btn-solid" href="\?c=[^"]+" data-cmd="[^"]+" data-example>[^<]+<\/a><\/div>/, `${name}: the example is a command link (app.js examplePlan: run or prefill)`);
    assert.match(html, /<h2 class="card-hero card-hero-24 num">/, `${name}: the problem at 24, not a shout`);
    const format = /<p class="card-sub"><span class="card-format">([^<]*)<\/span><\/p>/.exec(html)?.[1] || '';
    assert.ok(format.length <= 48, `${name}: the format in short, one line: ${format}`);
    assert.doesNotMatch(format, /&lt;|&gt;/, `${name}: no <angle brackets> up front: ${format}`);
    // Nothing else above + Details: no kicker, note, chart, facts, media or links.
    assert.doesNotMatch(html.split('<details')[0], /card-kicker|card-note|card-chart|card-facts|card-media|card-links|class="notice"|class="muted/, `${name}: only the three slots`);
    assert.doesNotMatch(html, /style="|Format:|>Try /, `${name}: no inline style, no old "Format:" or "Try" lines`);
  }
  // The kit: a missing format or example is left out, notes and more examples go in + Details.
  const bare = usageCard({ problem: 'X needs a ticker.' });
  assert.doesNotMatch(bare, /card-sub|card-act|card-more/);
  const full = usageCard({ problem: 'X needs a ticker.', format: 'X <ticker>', example: 'X AAPL', more: ['X KO'], notes: ['One note.'] });
  assert.match(full, /<p class="card-sub"><span class="card-format">X &lt;ticker&gt;<\/span><\/p>/);
  assert.match(affordUsage('AFFORD needs a price.'), /<dt class="tag">Format<\/dt><dd><span class="code card-grammar">AFFORD &lt;price&gt; \[&lt;thing&gt;\] \[&lt;n&gt; PER DAY\|WEEK\|MONTH\|YEAR\] \[FOR &lt;n&gt;Y\]<\/span>/, 'the full grammar in + Details');
  assert.match(full, /<details class="how card-more"><summary>Details<\/summary>[\s\S]*data-cmd="X KO"[\s\S]*One note\./);
  // An example that changes something (TAPE ON) is a link like any other: a link opened
  // from outside still goes through linkPlan, which asks first.
  assert.match(tapeUsage({ error: 'usage', args: {} }), /href="\?c=TAPE\+ON" data-cmd="TAPE ON" data-example/);
});

test('empty state: a short title, one hint of 60ch at most, one action; 20 words', () => {
  for (const [name, html] of EMPTY) {
    const w = cardWords(html);
    assert.ok(w.length <= 20, `${name}: ${w.length} words (budget 20): ${w.join(' ')}`);
    assert.match(html, /^<div class="empty[ "]/, `${name}: the kit's empty state`);
    const hint = /<p class="empty-hint">([\s\S]*?)<\/p>/.exec(html)?.[1].replace(/<[^>]+>/g, '') || '';
    assert.ok(hint.length <= 60, `${name}: hint ${hint.length} characters: ${hint}`);
    const title = /<p class="empty-title">([\s\S]*?)<\/p>/.exec(html)?.[1] || '';
    assert.ok(title && title.split(/\s+/).length <= 8, `${name}: a short title: ${title}`);
    const act = between(html, '<div class="empty-act">', '</div>');
    const actions = (act.match(/<(a|button)\b/g) || []).length;
    // DESK keeps its preset buttons (the model the others follow): + PANEL and the presets.
    assert.ok(name.startsWith('DESK') || actions <= 1, `${name}: one action at most (${actions})`);
    assert.doesNotMatch(html, /style="|btn-solid/, `${name}: no inline style, no primary button`);
  }
  assert.match(emptyAlertsHtml(), /data-cmd="ALERTS AAPL &gt; 350"/, 'ALERTS: one example that runs');
  assert.match(emptyAlertsHtml(), /<details[\s\S]*ALERTS &lt;symbol&gt; &gt; &lt;level&gt;[\s\S]*ALERTS &lt;symbol&gt; &lt; &lt;level&gt;/, 'ALERTS: the two forms in + Details');
  assert.match(deskEmptyHtml(2), /class="empty desk-empty" hidden>/, 'DESK: its class and hidden, for its own wiring');
  assert.match(deskEmptyHtml(2), /data-act="add">\+ PANEL<\/button>[\s\S]*data-act="preset" data-preset=/, 'DESK: its buttons');
  assert.match(emptyWatchHtml(), /data-cmd="WATCH RESET" data-example>STARTER LIST<\/a>/);
  // The kit: an action { label, cmd } is a command button; small is a side panel's note.
  assert.match(emptyState({ title: 'T', action: { label: 'GO', cmd: 'HELP' } }), /<a class="btn empty-btn" href="\?c=HELP" data-cmd="HELP" data-example>GO<\/a>/);
  assert.match(emptyState({ title: 'T', small: true }), /^<div class="empty is-small"><p class="empty-title">T<\/p><\/div>$/);
});

test('NO SUCH TICKER and a GRAVEYARD stone: card pages, 30 words; every stone in the graveyard too', () => {
  for (const [name, html] of NOSUCH) {
    assert.match(html, /^<section class="card /, `${name}: a card page`);
    assert.ok(cardWords(html).length <= 30, `${name}: ${cardWords(html).join(' ')}`);
  }
  const [grave, leh] = NOSUCH.map(([, html]) => html);
  // A dead ticker typed on its own: the stone card, "Not anymore.", F PAY RESPECTS, the quote.
  assert.match(grave, new RegExp(`card-kicker">${TITLE_GONE.replace(/\./g, '\\.')}</p><h2 class="card-hero card-hero-44 num">LEH</h2>`));
  assert.match(grave, /data-respect="LEH"><kbd>F<\/kbd> PAY RESPECTS/);
  assert.match(grave, /data-cmd="\$LEH" title="Quote: \$LEH, another listing">\$LEH<\/a>/);
  // The stone page: the facts (founded, died, peak, loss), the stone, the video and the last
  // website as the media, the share links; the name, cause, timeline and sources in + Details.
  const facts = [...leh.matchAll(/<dt class="tag">([^<]+)<\/dt><dd class="num[^"]*">([^<]+)<\/dd>/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(facts, ['Founded 1850', 'FILED 2008', 'Peak $85.80', 'Loss 100%']);
  assert.match(leh, /<div class="card-media"><div class="gv-card-media has-video has-site"><div class="gv-card-stone"><figure class="gv-stone has-art"/);
  assert.match(leh, /class="gv-card-video"><button type="button" class="gv-video"[\s\S]*class="gv-card-site"><a class="gv-site"/);
  assert.match(leh, /<p class="card-links"><a class="card-link" href="https:\/\/x\.com\/intent\/post[^"]*"[^>]*data-share="grave" data-via="x">SHARE ON X<\/a> <button type="button" class="card-link" data-copy="[^"]+" data-share="grave" data-via="link">COPY LINK<\/button>/);
  const more = leh.split('<details class="how card-more">')[1];
  for (const bit of ['Lehman Brothers', 'Real estate losses, Chapter 11', 'class="gv-tl"', 'SOURCES (', 'Esc, then F pays respects.']) assert.ok(more.includes(bit), `+ Details has ${bit}`);
  // The cliff (a picture of the RIP WHATIF line) sits beside the facts, not only in + Details.
  assert.match(leh.split('<details')[0], /<div class="gv-facts-row"><dl class="card-facts n4">[\s\S]*<\/dl><figure class="gv-cliff" title="\$1,000 at the peak \(Feb 2007\) was worth \$0 by Mar 2012"/);
  assert.doesNotMatch(more, /gv-cliff/, 'once, by the facts');
  // Every stone and zombie in data/graveyard.json keeps to the budget, with all its art.
  for (const e of GRAVES) {
    const w = cardWords(stonePageHtml(withArt(e, ART(e)), 1234));
    assert.ok(w.length <= 30, `GRAVEYARD ${e.ticker}: ${w.length} words: ${w.join(' ')}`);
  }
  // Words drawn on a picture (the stone's face, the certificate's stamp) are the picture's.
  assert.deepEqual(cardWords('<figure class="gv-stone" role="img" aria-label="x"><span>R.I.P.</span></figure><p>one</p><span aria-hidden="true">two</span>'), ['one']);
  assert.deepEqual(cardWords('<div role="img"><span>no label</span></div>'), ['no', 'label'], 'role="img" without an aria-label counts');
  // aria-hidden hides words from the count only on the known pictures (the certificate's
  // ticker and stamp): anywhere else it may not wrap more than 3 words.
  const PICTURES = /class="(ns-mini-big|ns-mini-stamp|gv-play)"/;
  for (const [name, html] of [...PAGES, ...USAGE, ...EMPTY].map(([n, h]) => [n, h])) {
    for (const m of html.matchAll(/<([a-z0-9]+)\b[^>]*\saria-hidden="true"[^>]*>([\s\S]*?)<\/\1>/gi)) {
      if (PICTURES.test(m[0])) continue;
      const words = m[2].replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
      assert.ok(words.length <= 3, `${name}: aria-hidden hides ${words.length} words: ${words.join(' ')}`);
    }
  }
});

test('every replaced site uses the kit: usage card, empty state, the NO SUCH card', () => {
  const src = (f) => readFileSync(f, 'utf8');
  for (const f of ['buy', 'cpi', 'loan', 'history', 'tape', 'profile', 'why', 'data', 'nosuch', 'earnings', 'compare', 'compound', 'exdiv', 'filings', 'economy', 'quote', 'options', 'fx', 'financials'].map((n) => `public/screens/${n}.js`)) {
    assert.match(src(f), /usageCard\(/, `${f}: usageCard`);
    // (buy.js keeps WAGE's own lines: not a usage pile of AFFORD's.)
    const own = f.endsWith('buy.js') ? src(f).replace(/function renderWage[\s\S]*?\n}\n/, '') : src(f);
    // (The later ten keep a "Try" link under a data error, which is not a usage pile.)
    assert.doesNotMatch(own, /Format: <span/, `${f}: no "Format:" line`);
    if (/\/(buy|cpi|loan|history|tape|profile|why|data|nosuch)\.js$/.test(f)) assert.doesNotMatch(own, /class="muted examples">Try /, `${f}: no "Try" pile`);
  }
  for (const f of ['watch', 'portfolio', 'alerts', 'desk', 'chat', 'insiders', 'shorts'].map((n) => `public/screens/${n}.js`)) {
    assert.match(src(f), /emptyState\(/, `${f}: emptyState`);
    assert.doesNotMatch(src(f), /class="panel-msg (wl|pf)-empty"|<p class="side-empty">|<div class="desk-empty" hidden>|<div class="chat-empty"><p class="notice">/, `${f}: no hand-made empty line`);
  }
  const app = src('public/app.js');
  assert.doesNotMatch(app, /Unknown command\. Type <a/, 'the unknown-command screen is the NO SUCH card');
  // The NO SUCH card is in cards.js, loaded on first use (not in the startup JS).
  assert.match(app, /drawCard\(view, signal, \(c\) => c\.unknownHtml\(cmd\.input\)/);
  assert.match(app, /\? cards\.didYouMeanHtml\(typed, found, ticker,/);
  assert.doesNotMatch(app, /from '\.\/cards\.js'/, 'cards.js is never a static import of app.js');
  assert.match(src('public/screens/graveyard.js'), /el\.innerHTML = stonePageHtml\(e, n\);/, 'GRAVEYARD LEH is the stone card');
});

test('one-line messages: 60ch at most, centred on a screen of their own; the profile blurb in + Details', () => {
  assert.match(STYLE, /\.panel-solo \.panel-body:not\(:has\(table, ul, ol\)\) > \.notice,\s*\.panel-solo \.panel-body:not\(:has\(table, ul, ol\)\) > \.panel-msg,\s*\.panel-solo \.panel-body:not\(:has\(table, ul, ol\)\) > \.notice ~ \.muted \{ max-width: 60ch; margin-left: auto; margin-right: auto; text-align: center; \}/);
  assert.match(readFileSync('public/commands.css', 'utf8'), /\.profile-desc \{ max-width: 60ch;/);
  const long = 'Apple Inc. designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories worldwide. It also sells a range of related services. The company offers iPhone, a line of smartphones. It was founded in 1976 and is based in Cupertino.';
  const [lead, rest] = splitDescription(long);
  assert.ok(lead.length <= DESC_LEAD && lead.startsWith('Apple Inc. designs'), lead);
  assert.equal(`${lead} ${rest}`, long, 'nothing lost');
  assert.match(descHtml(long), /^<p class="profile-desc">Apple Inc\.[^<]*<\/p><details class="how profile-more"><summary>Details<\/summary><p class="profile-desc">[^<]*Cupertino\.<\/p><\/details>$/);
  assert.equal(descHtml('Short.'), '<p class="profile-desc">Short.</p>');
});

test('examples: one that changes something saved goes into the command bar; one that shows runs', () => {
  // Saving: an alert, the starter list, the tape switch, a wage, a watchlist add.
  for (const c of ['ALERTS AAPL > 350', 'WATCH RESET', 'TAPE ON', 'TAPE ADD AAPL', 'WAGE 35', 'WAGE OFF', 'WATCH ADD AAPL']) assert.equal(examplePlan(c), 'fill', c);
  // Showing: they run on a click as before.
  for (const c of ['AFFORD 1200', 'HISTORY AAPL', 'CPI 100 2015', 'LOAN 400000 30Y', 'PROFILE AAPL', 'WHY AAPL', 'DATA CPI', 'IPO IT QXZV', 'HELP', 'EGGPRICE']) assert.equal(examplePlan(c), 'run', c);
  // Every example the kit draws carries data-example, and app.js decides at the click.
  for (const [name, html] of [...USAGE, ...EMPTY.filter(([n]) => !n.startsWith('DESK') && !n.startsWith('CHAT') && !n.startsWith('PORTFOLIO'))]) {
    const examples = [between(html, '<div class="card-act">', '</div>'), between(html, '<span class="codes">', '</span>'), between(html, '<div class="empty-act">', '</div>')].join('');
    for (const m of examples.matchAll(/<a [^>]*data-cmd="([^"]+)"[^>]*>/g)) assert.match(m[0], /data-example/, `${name}: ${m[1]}`);
  }
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /if \(el\.hasAttribute\('data-example'\) && examplePlan\(el\.dataset\.cmd\) === 'fill'\) \{[\s\S]{0,200}?if \(e\.detail === 0\) setTimeout\(\(\) => fillBar\(el\.dataset\.cmd\), 0\); else fillBar\(el\.dataset\.cmd\);\s*return;\s*\}\n\s*run\(el\.dataset\.cmd\);/, 'the click handler: fill before run; after the key press on a keyboard click');
  // Keys, codes and the Pro doors always wait for Enter, whatever follows them.
  for (const c of ['LOGOUT', 'LOGIN', 'REDEEM X', 'REDEEM', 'GIFT', 'GIFT ABC']) assert.equal(examplePlan(c), 'fill', c);
  // The list screens' own "Try" rows and DESK's: the saving ones wait for Enter too.
  for (const c of ['PF REMOVE AAPL', 'PF SELL AAPL 3', 'PF ADD AAPL 10 @ 150', 'WATCH REMOVE TSLA', 'WATCH IMPORT AAPL,MSFT,GOLD', 'DESK RESET']) assert.equal(examplePlan(c), 'fill', c);
  for (const c of ['PF EXPORT', 'PF IMPORT', 'WATCH EXPORT', 'DESK', 'DESK 2', 'DESK WEIRD']) assert.equal(examplePlan(c), 'run', `${c}: shows (PF IMPORT alone opens the paste box)`);
  for (const f of ['public/screens/portfolio.js', 'public/screens/watch.js']) assert.match(readFileSync(f, 'utf8'), /const code = \(c\) => `<a class="code" href="\$\{esc\(q\(c\)\)\}" data-cmd="\$\{esc\(c\)\}" data-example>/, `${f}: its examples carry data-example`);
  assert.match(readFileSync('public/screens/desk.js', 'utf8'), /\['DESK', 'DESK 2', 'DESK RESET', 'DESK WEIRD'\]\.map\(\(c\) => `<a class="code"[^`]*data-example>/, 'DESK: its examples too');
  assert.match(readFileSync('public/screens/tape.js', 'utf8'), /const link = \(c\) => `<a class="code" href="\$\{esc\(q\(c\)\)\}" data-cmd="\$\{esc\(c\)\}" data-example>/, 'TAPE: its Pro rows (TAPE ADD, TAPE RESET) too');
  for (const c of ['TAPE RESET', 'TAPE ADD AAPL']) assert.equal(examplePlan(c), 'fill', c);
  assert.match(app, /function fillBar\(raw\) \{[\s\S]*?input\.value = clean;[\s\S]*?input\.focus\(\);/);
});

test('GRAVEYARD stone: the media row is sized to the first view, the video the biggest', () => {
  // A fake page: the row starts 300 px down, the dock at 671 (a 1536x730 window).
  const row = {
    isConnected: true, style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } },
    parentElement: { clientWidth: 1430 },
    getBoundingClientRect: () => ({ top: 300 }),
    querySelector: (q) => (['.gv-stone.has-art', '.gv-card-video', '.gv-card-site'].includes(q) ? {} : null),
  };
  const listeners = [];
  const win = { matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ overflowY: 'auto' }), innerHeight: 730, scrollY: 0, addEventListener: (t, f) => listeners.push(f), removeEventListener: () => listeners.pop() };
  const doc = { getElementById: () => ({ scrollTop: 0, getBoundingClientRect: () => ({ bottom: 700 }) }), querySelector: () => ({ getBoundingClientRect: () => ({ top: 671 }) }) };
  const stop = fitStone({ querySelector: () => row }, { win, doc });
  assert.equal(row.style.props['--gv-h'], '363px', 'the room left: 671 - 300 - 8');
  assert.equal(listeners.length, 1, 'again on resize');
  stop();
  assert.equal(listeners.length, 0);
  // A narrow card: the width decides; the floor is 200, the ceiling 480.
  row.parentElement.clientWidth = 800;
  fitStone({ querySelector: () => row }, { win, doc });
  assert.equal(row.style.props['--gv-h'], `${Math.max(GV_ROW.min, Math.floor((800 - 48) / (GV_ROW.stone + GV_ROW.video + GV_ROW.site)))}px`);
  assert.ok(GV_ROW.video > GV_ROW.stone && GV_ROW.video > GV_ROW.site, 'the video is the widest at one height');
  // A phone: no size, the row stacks and scrolls.
  fitStone({ querySelector: () => row }, { win: { ...win, matchMedia: () => ({ matches: true }) }, doc });
  assert.equal(row.style.props['--gv-h'], undefined);
  const css = readFileSync('public/screens/graveyard.css', 'utf8');
  for (const w of ['.gv-card-stone { flex: 0 0 auto; width: calc(var(--gv-h) * 560 / 778); }', '.gv-card-video { flex: 0 0 auto; width: calc(var(--gv-h) * 16 / 9); }', '.gv-card-site { flex: 0 0 auto; width: calc(var(--gv-h) * .9); }']) assert.ok(css.includes(w), w);
  assert.doesNotMatch(css, /gv-page3|gv-a-stone|\.gv-page\b|gv-vcol|gv-respects/, 'the old stone page is gone');
  assert.doesNotMatch(readFileSync('public/screens/nosuch.css', 'utf8') + readFileSync('public/nosuch.css', 'utf8'), /ns-page|ns-grave|\.ns-stone|ns-quote|\.ns-ipo\b/, 'the old NO SUCH page is gone');
});

test('Part B: result screens are card pages; each keeps its facts, the rest in + Details', () => {
  const top = (html) => html.split('<details')[0];
  const more = (html) => html.split('<details class="how card-more">')[1] || '';
  // AFFORD: the cost per use is the hero, what was typed the sub, the verdict stamp the picture
  // (its words are the picture's), the share links, how each number is worked out in + Details.
  const [aff, affWage] = [CARDS_B[0][1], CARDS_B[1][1]];
  assert.match(aff, /<h2 class="card-hero card-hero-60 num">\$3\.85 a use<\/h2><p class="card-sub">Bike: \$1,200, used twice a week for 3 years\.<\/p>/);
  assert.match(aff, /<div class="card-act"><form class="card-form" id="wage-form"[\s\S]*SHOW HOURS<\/button><\/form><\/div>/, 'no wage: the field for it is the action');
  assert.doesNotMatch(affWage, /wage-form/, 'a wage saved: no field');
  for (const label of ['Total uses', 'Hours of work', 'If invested, 8%/yr']) assert.ok(top(aff).includes(`<dt class="tag">${label}</dt>`), label);
  assert.match(aff, /<div class="card-media"><div class="buy-verdict"><p class="stamp stamp-sleep" role="img" aria-label="Verdict: SLEEP ON IT">[\s\S]*<p class="stamp-line">Under \$10 a use\. Think it over\.<\/p>/);
  assert.match(aff, /<p class="card-links"><a class="card-link" href="https:\/\/x\.com\/intent\/post[^"]*" target="_blank" rel="noopener noreferrer">SHARE ON X<\/a> <button type="button" class="card-link" data-copy="[^"]+">COPY LINK<\/button><\/p>/);
  for (const bit of ['Cost per use', 'not a forecast or a promise', 'A rule of thumb for things you buy']) assert.ok(more(aff).includes(bit), bit);
  // CPI and LOAN: hero, sub, note, the facts; their chart and table panels stay as they were.
  const cpi = CARDS_B[2][1];
  assert.match(cpi, /<h2 class="card-hero card-hero-60 num">\$135\.19<\/h2><p class="card-sub">\$100\.00 in 2015 is worth this today\.<\/p><\/div><div class="card-cta"><p class="card-note">Prices are up 35\.2% since 2015\.<\/p>/);
  assert.equal((cpi.match(/class="card-fact"/g) || []).length, 4);
  const loan = CARDS_B[3][1];
  assert.match(loan, /<h2 class="card-hero card-hero-60 num">\$2,528\.27<\/h2><p class="card-sub">A month, for \$400,000 over 30 years at 6\.50%\.<\/p>[\s\S]*<p class="card-note">Average 30-year fixed/);
  assert.match(loan, /<dt class="tag">Total interest<\/dt><dd class="num down">/);
  for (const f of ['cpi', 'loan']) assert.match(readFileSync(`public/screens/${f}.js`, 'utf8'), f === 'cpi' ? /body\.innerHTML = cpiResultHtml\(d\);/ : /panel\('1', 'Loan', loanResultHtml\(a, rate, source, res\)/, f);
  // WAGE: a hero and a note, the next step one button.
  assert.match(CARDS_B[5][1], /<h2 class="card-hero card-hero-44 num">\$35\.00 an hour<\/h2>/);
  assert.match(CARDS_B[7][1], /data-cmd="WAGE 35" data-example>WAGE 35<\/a>/, 'a saving example goes into the bar (examplePlan)');
  // MCP: kicker, the URL as the hero, one COPY, the rule; every app in + Details.
  const mcp = mcpHtml();
  assert.match(mcp, new RegExp(`<p class="tag card-kicker">MCP</p><h2 class="card-hero card-hero-32 num">${MCP_URL.replace(/[./]/g, '\\$&')}</h2>`));
  assert.match(mcp, /<div class="card-act"><button type="button" class="btn card-btn btn-solid" id="mcp-copy">COPY URL<\/button><\/div><p class="card-note">/);
  assert.ok(top(mcp).includes(MCP_RULE));
  for (const [app] of MCP_APPS) assert.ok(more(mcp).includes(`<dt class="tag">${app}</dt>`), app);
});

test('Part B: the shell\'s own small cards (link confirm, RENAMED, COMING SOON, did not load) load after the first screen', () => {
  const link = CARDS_B[10][1];
  assert.match(link, /<h2 class="card-hero card-hero-32 num">This link wants to change your watchlist\.<\/h2>/);
  // RUN IT is the one action: a button (no href, no data-example), so nothing opens or runs it by itself.
  assert.match(link, /<div class="card-act"><button type="button" class="btn card-btn btn-solid" data-cmd="WATCH ADD AAPL, MSFT">RUN IT<\/button><\/div><p class="card-note">Esc: just show <a class="code" href="\?c=WATCH" data-cmd="WATCH">WATCH<\/a>\.<\/p>/);
  const app = readFileSync('public/app.js', 'utf8');
  // Esc just shows the plain screen, never the link; only with the bar empty and nothing else open.
  assert.match(app, /const escShows = \(e\) => \{[\s\S]{0,200}linkAsk \|\| menu\?\.isOpen\(\) \|\| !list\.hidden\) return;[\s\S]{0,200}run\(cmd\.view\);\s*\};\s*document\.addEventListener\('keydown', escShows, true\);\s*cleanups\.push/);
  for (const c of ['renamedHtml(example)', 'soonHtml(s)', 'notLoadedHtml()', 'linkConfirmHtml(']) assert.ok(app.includes(`(c) => c.${c}`), c);
  assert.match(CARDS_B[11][1], /BUY is now AFFORD[\s\S]*data-cmd="AFFORD 1200" data-example>AFFORD 1200</);
  assert.match(CARDS_B[12][1], /card-kicker">Coming soon<\/p><h2 class="card-hero card-hero-44 num">AAPL EARNINGS<\/h2>/);
  assert.match(CARDS_B[13][1], /data-reload>RELOAD<\/button>/);
  // GO LIVE typed outside a chat: the small card that says how, never the GO stock's error.
  assert.deepEqual(parseCommand('GO LIVE'), { name: 'LIVEHINT', input: 'GO LIVE' });
  assert.equal(parseCommand('go live').name, 'LIVEHINT');
  for (const c of ['GO', '$GO', 'GO 1Y']) assert.equal(parseCommand(c).name, 'QUOTE', `${c} stays the stock`);
  assert.notEqual(parseCommand('$GO LIVE').name, 'LIVEHINT', '$GO means the stock');
  assert.match(liveHintHtml(), /card-kicker">GO LIVE<\/p><h2 class="card-hero card-hero-32 num">Open a chat, then type GO LIVE\.<\/h2>[\s\S]*data-cmd="CHAT">CHAT<\/a>/);
  assert.match(app, /cmd\.name === 'LIVEHINT'\) \{\s*drawCard\(view, signal, \(c\) => c\.liveHintHtml\(\)/);
});

test('Part B: TAPE is a small card: ON or OFF, one line, the one switch, the tape as the media; the rest in + Details', () => {
  const [on, off, proNote] = [tapeHtml({ on: true }), tapeHtml({ on: false }), tapeHtml({ on: true, isPro: true, custom: ['AAPL'], note: 'Added AAPL.' })];
  assert.match(on, /<h2 class="card-hero card-hero-60 num">TAPE ON<\/h2><p class="card-sub">It sits above the status line on every screen\.<\/p>/);
  // The switch runs at once (a direct button, not a prefill): it is what TAPE is for.
  assert.match(on, /<div class="card-act"><a class="btn card-btn btn-solid" href="\?c=TAPE\+OFF" data-cmd="TAPE OFF">TURN OFF<\/a><\/div>/);
  assert.match(off, /data-cmd="TAPE ON">TURN ON<\/a>/);
  assert.match(on, /<div class="card-media"><div class="tape tape-panel"><div class="tape-track"><\/div><\/div><\/div>/, 'the moving tape is the media');
  const d = on.split('<details')[1];
  assert.match(d, /DESK panel with the command <span class="code">TAPE<\/span>/);
  assert.match(d, /Your own ticker tape is a Pro feature/);
  assert.match(proNote, /<p class="card-alert" role="status">Added AAPL\.<\/p>/);
  assert.match(proNote, /<div class="card-media">[\s\S]*<div class="tape-list"><p class="fx-from">Your tape: 1 of 40\.<\/p><ul class="pro-list">/, 'a Pro list stays as the media');
  assert.match(proNote.split('<details')[1], /data-cmd="TAPE ADD AAPL" data-example>[\s\S]*data-cmd="TAPE RESET" data-example>/);
  assert.doesNotMatch(on + off, /tape-set|tape-state|class="seg"/, 'the old switch panel is gone');
  // The Pro rows in + Details prefill (they change the saved tape): data-example, and examplePlan says fill.
  for (const c of ['TAPE ADD AAPL', 'TAPE RESET']) {
    assert.match(proNote.split('<details')[1], new RegExp(`<a class="code" href="[^"]+" data-cmd="${c}" data-example>${c}</a>`), c);
    assert.equal(examplePlan(c), 'fill', c);
  }
  // A card hero is text to read: no user-select: all (keys keep it, .pro-key).
  assert.doesNotMatch(readFileSync('public/kit.css', 'utf8'), /user-select/);
});

test('split card: the art beside the other slots from 1100 px, one column below; the same slots in the same order', () => {
  const html = cardPage({ split: true, art: raw('<img alt="">'), sub: 'x', links: [cardLink({ label: 'L', cmd: 'L' })] });
  assert.match(html, /^<section class="card card-split"><div class="card-art"><img alt=""><\/div><div class="card-col"><div class="card-head"><p class="card-sub">x<\/p><\/div><div class="card-foot"><p class="card-links">/);
  assert.doesNotMatch(cardPage({ split: true, sub: 'x' }), /card-split|card-col/, 'no art: the one column');
  assert.doesNotMatch(cardPage({ art: raw('<img alt="">'), sub: 'x' }), /card-split|card-col/, 'not asked: the one column');
  const kit = readFileSync('public/kit.css', 'utf8');
  assert.match(kit, /@media \(min-width: 1100px\) \{\n  \.card\.card-split \{\n    display: grid; grid-template-columns: minmax\(0, 3fr\) minmax\(0, 2fr\); align-items: start; gap: 48px;\n    max-width: calc\(var\(--card-w\) \* 2\); text-align: left;/);
  // The right column keeps the card's gaps (and steps down with them).
  assert.match(kit, /\.card-col \{ display: flex; flex-direction: column; align-items: center; gap: 32px;/);
  assert.match(kit, /@media \(max-width: 1099px\), \(max-height: 800px\) \{\n  \.card, \.card-col \{ gap: 24px; \}/);
});

test('WHATIF: every result keeps to its budget (12 words), the certificate is the picture, one SHARE', async () => {
  for (const [name, html] of WHATIF) {
    assert.match(html, /^<section class="card card-split wi-result"/, `${name}: a split card page`);
    assert.match(html, /<div class="card-art"><figure class="wi-cert[^"]*" role="img" aria-label="A certificate: /, `${name}: the certificate is the art, its words the picture's`);
    assert.equal((html.match(/btn-solid/g) || []).length, 1, `${name}: SHARE, the one primary button`);
    assert.doesNotMatch(html, /card-hero/, `${name}: the certificate is the hero`);
  }
  // Every catalogue item on its own, and a few together, keep to the budget.
  const each = [...WHATIF_CATALOG.products.map((p) => [p.id.toUpperCase()]), ...WHATIF_CATALOG.recurring.map((r) => [`${r.id.toUpperCase()}:10Y`])];
  for (const tokens of [...each, ['IPHONE6', 'IPHONE8'], ['MODELS', 'BIGMAC:5Y', 'BETTING:3Y', 'PS5']]) {
    const w = cardWords((await whatifPage(tokens)).replace(WI_LIST, ''));
    assert.ok(w.length <= WHATIF_WORDS, `WHATIF ${tokens.join(' ')}: ${w.length} words: ${w.join(' ')}`);
  }
});
