// Google Analytics 4 (public/goal.js loadGa4, public/ga4.js): the gates, the clean page
// addresses, the events, the share count and the CSP. The core promise: nothing secret or
// personal ever reaches gtag's dataLayer, whatever the page's address, referrer or screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanCommand, cleanUrl, cleanPath, cleanReferrer, cleanUtm, pageFor, startGa4, shareMethod, contentType, SITE } from '../public/ga4.js';
import { loadGa4, goal, GA4, GA_EVENTS, GA_SHARE_GOALS, GOALS, reloadAfterKey, analyticsBlocked } from '../public/goal.js';
import { securityHeaders } from '../lib/embed.js';
import { buildAssets } from '../lib/assets.js';

// ---- clean addresses ----------------------------------------------------------------------

test('page_location: the command word, a ticker or item and range words, nothing else', () => {
  const cases = [
    ['/?c=LOGIN%20abc', `${SITE}/?c=LOGIN`],
    ['/?c=AAPL%201Y', `${SITE}/?c=AAPL+1Y`],
    ['/?c=PRO&session_id=cs_live_a1B2c3D4e5', `${SITE}/?c=PRO`],
    ['/?c=CHAT+%40alice+meet+me+at+noon', `${SITE}/?c=CHAT`],
    ['/?c=WHATIF+IPHONE6+LATTE%3A3Y+MY+5000+AAPL+2019-01-01', `${SITE}/?c=WHATIF+IPHONE6+LATTE%3A3Y`],
    ['/?c=GRAVEYARD+LEH', `${SITE}/?c=GRAVEYARD+LEH`],
    ['/?c=CHART+NVDA+5Y&utm_source=x&fbclid=abc&gclid=def', `${SITE}/?c=CHART+NVDA+5Y`],
    ['/?c=AAPL+CHART+MAX', `${SITE}/?c=CHART+AAPL+MAX`],
    ['/?c=COMPARE+AAPL+MSFT+NVDA+GOOG+AMZN+1Y', `${SITE}/?c=COMPARE+AAPL+MSFT+NVDA+GOOG+1Y`],
    ['/?c=GUESS', `${SITE}/?c=GUESS`],
    ['/?c=m', `${SITE}/?c=MARKETS`],
    ['/?c=$GOLD', `${SITE}/?c=$GOLD`],
    ['/?c=HOME', `${SITE}/`],
    ['/', `${SITE}/`],
    ['/?c=REDEEM+GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345', `${SITE}/?c=REDEEM`],
    ['/?c=BB-7K2M-9QXR-4TYP-ABCD', `${SITE}/?c=UNKNOWN`],
    ['/?c=GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345', `${SITE}/?c=UNKNOWN`],
    ['/?c=someone%40example.com', `${SITE}/?c=UNKNOWN`],
    ['/?c=ALERTS+AAPL+%3E+350.25', `${SITE}/?c=ALERTS`],
    ['/?c=AFFORD+1234+LATTE+3+PER+WEEK', `${SITE}/?c=AFFORD`],
    ['/?c=WAGE+55', `${SITE}/?c=WAGE`],
    ['/?c=PF+ADD+AAPL+10+%40+150', `${SITE}/?c=PORTFOLIO`],
    ['/?c=FEEDBACK+my+private+idea', `${SITE}/?c=FEEDBACK`],
    ['/?c=ME', `${SITE}/?c=ME`],
    ['/?c=WEIRD+5Y', `${SITE}/?c=WEIRD+5Y`],
    ['/?c=NEWS+WSB', `${SITE}/?c=NEWS+WSB`],
    ['/terms?c=LOGIN+BB-7K2M-9QXR-4TYP-ABCD', `${SITE}/terms`],
    ['/privacy/', `${SITE}/privacy`],
    ['/index.html?c=GUESS', `${SITE}/?c=GUESS`],
    ['/someone@example.com/profile?c=GUESS', `${SITE}/not-found`],
    ['https://evil.test:8080/?c=AAPL#frag', `${SITE}/?c=AAPL`],
  ];
  for (const [input, want] of cases) assert.equal(cleanUrl(input), want, input);
  assert.equal(cleanPath('/embed/guess'), '/not-found');
  assert.equal(cleanCommand(null), '');
  assert.equal(cleanCommand('NEW KEY'), 'NEW', 'a word, never a key');
  assert.deepEqual(pageFor({ path: '/', command: 'CHART AAPL 1Y' }), { location: `${SITE}/?c=CHART+AAPL+1Y`, title: 'CHART AAPL 1Y | Bloombroke' });
  assert.deepEqual(pageFor({ path: '/privacy' }), { location: `${SITE}/privacy`, title: 'PRIVACY | Bloombroke' });
});

test('page_referrer: this site cleaned, another site as its origin only, anything else empty', () => {
  assert.equal(cleanReferrer('https://bloombroke.com/?c=LOGIN%20BB-7K2M-9QXR-4TYP-ABCD&session_id=cs_live_x'), `${SITE}/?c=LOGIN`);
  assert.equal(cleanReferrer('https://www.google.com/search?q=my+name+is+alice'), 'https://www.google.com/');
  assert.equal(cleanReferrer('https://user:pass@x.com/i/status/1?s=20'), 'https://x.com/');
  assert.equal(cleanReferrer('android-app://com.slack/'), '');
  assert.equal(cleanReferrer('not a url'), '');
  assert.equal(cleanReferrer(''), '');
});

// ---- gtag: nothing secret ever reaches the dataLayer --------------------------------------

const SECRET_COMMANDS = [
  'LOGIN BB-7K2M-9QXR-4TYP-ABCD', 'BB-7K2M-9QXR-4TYP-ABCD', 'BB 7K2M 9QXR 4TYP ABCD', 'REDEEM GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345',
  'GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345', 'GIFT', 'CHAT @alice hello there', 'CHAT secretroom', 'someone@example.com',
  'ALERTS AAPL > 350.25', 'ALERT TSLA < 199.77', 'AFFORD 12345', 'WAGE 87.65', 'LOAN 350000 30 6.5%', 'WHATIF MY 5000 AAPL 2019-01-01',
  'PF ADD AAPL 10 @ 150.5', 'FEEDBACK please call me', 'ME', 'NEW KEY', 'WATCH ADD ZZZZ',
];
const MARKERS = ['7K2M', '9QXR', '4TYP', 'GIFT-', 'EFGH', '@', 'alice', 'ALICE', 'HELLO', 'SECRETROOM', 'example', 'EXAMPLE', '350.25', '199.77', '12345',
  '87.65', '350000', '5000', '150.5', 'PLEASE', 'CALL', 'session_id', 'cs_live', 'utm_', 'ZZZZ', 'KEY', 'search?q', 'pass'];

function fakePage({ href = 'https://bloombroke.com/', referrer = '' } = {}) {
  const u = new URL(href);
  const listeners = [];
  const win = { location: { hostname: u.hostname, pathname: u.pathname, search: u.search, href } };
  const doc = { referrer, addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }) };
  return { win, doc, listeners };
}
// Every gtag call but 'js' (its Date), as plain arrays.
const calls = (win) => win.dataLayer.map((a) => Array.from(a)).filter((a) => a[0] !== 'js');
const leaks = (win) => { const text = JSON.stringify(calls(win)); return MARKERS.filter((m) => text.includes(m)); };

test('startGa4: set before config, no automatic page view, Signals and ad personalisation off', () => {
  const { win, doc } = fakePage({ href: 'https://bloombroke.com/?c=AAPL+1Y&utm_source=x', referrer: 'https://www.google.com/search?q=alice' });
  const run = startGa4({ win, doc, id: GA4.id, state: { page: 'AAPL 1Y', early: [] } });
  assert.ok(run);
  assert.equal(typeof win.gtag, 'function');
  const c = calls(win);
  assert.equal(win.dataLayer[0][0], 'js');
  // The landing link's campaign tag rides on the first page view (and the set before it).
  assert.deepEqual(c[0], ['set', { page_location: `${SITE}/?c=AAPL+1Y&utm_source=x`, page_referrer: 'https://www.google.com/', page_title: 'AAPL 1Y | Bloombroke' }]);
  assert.deepEqual(c[1], ['config', 'G-N4VN8PCJXK', { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false }]);
  assert.deepEqual(c[3], ['event', 'page_view', { page_location: `${SITE}/?c=AAPL+1Y&utm_source=x`, page_referrer: 'https://www.google.com/', page_title: 'AAPL 1Y | Bloombroke' }]);
  // gtag.js reads arguments objects, not arrays.
  assert.equal(Object.prototype.toString.call(win.dataLayer[1]), '[object Arguments]');
  // The next screen: its referrer is the last clean page. The same screen again: no second view.
  assert.equal(run.page('CHART AAPL 5Y'), true);
  assert.equal(run.page('CHART AAPL 5Y'), false);
  const views = calls(win).filter((a) => a[1] === 'page_view');
  assert.deepEqual(views[1][2], { page_location: `${SITE}/?c=CHART+AAPL+5Y`, page_referrer: `${SITE}/?c=AAPL+1Y`, page_title: 'CHART AAPL 5Y | Bloombroke' });
});

test('startGa4: no key, code, amount, chat text, username, email, alert price or checkout id ever reaches gtag', () => {
  const secretHref = 'https://bloombroke.com/?c=LOGIN+BB-7K2M-9QXR-4TYP-ABCD&session_id=cs_live_a1B2&utm_source=alice%40example.com&utm_content=BB-7K2M-9QXR-4TYP-ABCD';
  const { win, doc, listeners } = fakePage({ href: secretHref, referrer: 'https://bloombroke.com/?c=CHAT+%40alice+hello&session_id=cs_live_b' });
  const run = startGa4({ win, doc, id: GA4.id, state: { page: null, early: [['guess_played', { result: 'someone@example.com' }], ['whatif_run', { note: 'alice' }]] } });
  for (const c of SECRET_COMMANDS) run.page(c);
  // Events: only snake_case names, only short lower-case words as values.
  run.event('share', { method: 'x', text: 'hello alice', content_type: 'CHAT @alice' });
  run.event('Bad Name', { a: 'b' });
  run.event('pro_checkout_start', { plan: 'cs_live_a1B2c3D4e5F6g7' });
  // A share click, on the CHAT screen.
  const click = listeners.find((l) => l.type === 'click' && l.capture === true);
  click.fn({ target: { closest: (sel) => (sel.includes('#share') ? {} : null) } });
  assert.deepEqual(leaks(win), []);
  const views = calls(win).filter((a) => a[1] === 'page_view').map((a) => a[2].page_location);
  assert.ok(views.includes(`${SITE}/?c=LOGIN`) && views.includes(`${SITE}/?c=REDEEM`) && views.includes(`${SITE}/?c=CHAT`) && views.includes(`${SITE}/?c=UNKNOWN`));
  for (const v of views) assert.match(v, /^https:\/\/bloombroke\.com\/(\?c=[A-Z0-9$+%]+)?$/, v);
  assert.deepEqual(calls(win).find((a) => a[1] === 'share'), ['event', 'share', { method: 'x' }], 'the bad params are dropped');
});

test('startGa4: the terminal waits for its first screen; a legal page is counted at once; blocked means nothing', () => {
  const t = fakePage({ href: 'https://bloombroke.com/?c=GUESS' });
  const run = startGa4({ win: t.win, doc: t.doc, id: GA4.id, state: { page: null, early: [] } });
  assert.equal(calls(t.win).filter((a) => a[1] === 'page_view').length, 0, 'the screen is not drawn yet');
  run.page('GUESS');
  assert.equal(calls(t.win).filter((a) => a[1] === 'page_view').length, 1);
  const l = fakePage({ href: 'https://bloombroke.com/privacy' });
  startGa4({ win: l.win, doc: l.doc, id: GA4.id });
  assert.deepEqual(calls(l.win).find((a) => a[1] === 'page_view')[2].page_location, `${SITE}/privacy`);
  const b = fakePage();
  assert.equal(startGa4({ win: b.win, doc: b.doc, id: GA4.id, blocked: () => true }), null);
  assert.equal(b.win.dataLayer, undefined);
  // A key lands later: nothing more is sent.
  let pro = false;
  const k = fakePage();
  const run2 = startGa4({ win: k.win, doc: k.doc, id: GA4.id, state: { page: 'HOME', early: [] }, blocked: () => pro });
  const before = k.win.dataLayer.length;
  pro = true;
  assert.equal(run2.page('MARKETS'), false);
  assert.equal(run2.event('whatif_run'), false);
  assert.equal(k.win.dataLayer.length, before);
});

test('share: one event for SHARE, COPY LINK, SAVE VIDEO, DOWNLOAD IMAGE, EMBED, COPY RESULT and SHARE ON X', () => {
  const el = (matches) => ({ closest: (sel) => (sel.split(', ').some((s) => matches.includes(s)) ? {} : null) });
  assert.equal(shareMethod(el(['a[href^="https://x.com/intent/"]'])), 'x');
  assert.equal(shareMethod(el(['a[download][href^="/og/"]'])), 'image');
  assert.equal(shareMethod(el(['[data-video]'])), 'video');
  assert.equal(shareMethod(el(['[data-embed]'])), 'embed');
  assert.equal(shareMethod(el(['.gs-embed'])), 'embed');
  assert.equal(shareMethod(el(['.gs-copy'])), 'copy');
  assert.equal(shareMethod(el(['#share'])), 'link');
  assert.equal(shareMethod(el(['[data-copy]'])), 'link');
  assert.equal(shareMethod(el([])), null);
  assert.equal(shareMethod(null), null);
  assert.equal(shareMethod({ closest() { throw new Error('x'); } }), null);
  assert.equal(contentType('WHATIF IPHONE6'), 'whatif');
  assert.equal(contentType('AAPL 1Y'), 'quote');
  assert.equal(contentType(''), 'home');
  assert.equal(contentType('UNKNOWN'), 'unknown');
  const p = fakePage();
  const run = startGa4({ win: p.win, doc: p.doc, id: GA4.id, state: { page: 'WHATIF IPHONE6', early: [] } });
  assert.ok(run);
  p.listeners.find((l) => l.type === 'click').fn({ target: el(['a[download][href^="/og/"]']) });
  p.listeners.find((l) => l.type === 'click').fn({ target: el([]) });
  assert.deepEqual(calls(p.win).filter((a) => a[1] === 'share'), [['event', 'share', { method: 'image', content_type: 'whatif' }]]);
});

// ---- campaign tags: the first page view of a visit only --------------------------------------

test('utm: the four campaign tags, lower-cased and short, in order; anything else dropped', () => {
  assert.equal(cleanUtm('?utm_campaign=Oct-Launch&utm_source=X&utm_medium=social&utm_content=v1.2_a&utm_term=secret&gclid=abc&fbclid=def&c=AAPL'),
    'utm_source=x&utm_medium=social&utm_campaign=oct-launch&utm_content=v1.2_a');
  assert.equal(cleanUtm('?utm_source=newsletter&utm_campaign=launch2026'), 'utm_source=newsletter&utm_campaign=launch2026');
  for (const bad of [
    'utm_source=two%20words', 'utm_source=a%40b', 'utm_medium=someone%40example.com', `utm_campaign=${'a'.repeat(41)}`, 'utm_source=',
    'utm_content=BB-7K2M-9QXR-4TYP-ABCD', 'utm_content=bb_7k2m_9qxr_4typ_abcd', 'utm_content=promo.bb.7k2m.9qxr.4typ.abcd', 'utm_content=7k2m-9qxr-4typ-abcd',
    'utm_content=bb7k2m9qxr4typabcd', 'utm_content=GIFT-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345', 'utm_content=gift-abcd-efgh', 'utm_content=cs_live_a1b2c3',
    'utm_content=x_sk_test_abc', 'utm_source=whsec_abc', 'utm_source=%2Fetc%2Fpasswd', 'utm_source=a%26c%3DLOGIN', 'utm_source=%C3%A9t%C3%A9',
    'gclid=abc', 'fbclid=def', 'utm_id=1', 'utm_term=word',
  ]) assert.equal(cleanUtm(`?${bad}`), '', bad);
  assert.equal(cleanUtm('?utm_source=ok&utm_content=BB-7K2M-9QXR-4TYP-ABCD'), 'utm_source=ok', 'one bad tag drops only itself');
  assert.equal(cleanUtm(null), '');
  // Where they go: after ?c=, or on their own.
  assert.equal(pageFor({ path: '/', command: 'AAPL 1Y', utm: '?utm_source=x&utm_medium=social' }).location, `${SITE}/?c=AAPL+1Y&utm_source=x&utm_medium=social`);
  assert.equal(pageFor({ path: '/', command: 'HOME', utm: '?utm_source=x' }).location, `${SITE}/?utm_source=x`);
  assert.equal(pageFor({ path: '/privacy', utm: '?utm_campaign=oct' }).location, `${SITE}/privacy?utm_campaign=oct`);
  assert.equal(cleanUrl('/?c=AAPL&utm_source=x'), `${SITE}/?c=AAPL`, 'a referrer or an address alone never keeps them');
});

test('utm: on the first page view of a visit only; later views and the referrer are tag-free', () => {
  const href = 'https://bloombroke.com/?c=GUESS&utm_source=x.com&utm_medium=social&utm_campaign=oct-launch&utm_content=BB-7K2M-9QXR-4TYP-ABCD&gclid=abc&fbclid=def';
  const { win, doc } = fakePage({ href });
  // The terminal rewrote the address before GA4 ran; goal.js kept the landing search.
  win.location.search = '?c=GUESS';
  const run = startGa4({ win, doc, id: GA4.id, state: { page: null, early: [], search: new URL(href).search } });
  assert.equal(calls(win)[0][1].page_location, `${SITE}/?c=GUESS&utm_source=x.com&utm_medium=social&utm_campaign=oct-launch`, 'the set before config');
  run.page('GUESS');
  run.page('GUESS'); // the same screen again: no second view
  run.page('WHATIF IPHONE6');
  run.page('GUESS');
  const views = calls(win).filter((a) => a[1] === 'page_view').map((a) => a[2]);
  assert.deepEqual(views.map((v) => v.page_location), [
    `${SITE}/?c=GUESS&utm_source=x.com&utm_medium=social&utm_campaign=oct-launch`, `${SITE}/?c=WHATIF+IPHONE6`, `${SITE}/?c=GUESS`,
  ]);
  assert.equal(views[1].page_referrer, `${SITE}/?c=GUESS`, 'the referrer is the clean page, without tags');
  const sets = calls(win).filter((a) => a[0] === 'set').slice(2);
  assert.ok(sets.every((a) => !a[1].page_location.includes('utm_')), 'later sets carry no tags');
  const text = JSON.stringify(calls(win));
  for (const m of ['gclid', 'fbclid', '7K2M', '7k2m']) assert.ok(!text.includes(m), m);
  // A legal page: the tags on its one page view.
  const l = fakePage({ href: 'https://bloombroke.com/privacy?utm_source=mail&gclid=x' });
  startGa4({ win: l.win, doc: l.doc, id: GA4.id });
  assert.equal(calls(l.win).find((a) => a[1] === 'page_view')[2].page_location, `${SITE}/privacy?utm_source=mail`);
});

test('utm: goal.js keeps the landing search when it arms GA4, before the terminal rewrites the address', async () => {
  const { doc, win } = loaderPage();
  win.location.search = '?c=AAPL&utm_source=launch';
  const state = freshState();
  let later = null;
  assert.equal(loadGa4({ doc, nav: {}, win, pro: () => false, state, later: (fn) => { later = fn; }, start: ga4Module }), true);
  assert.equal(state.search, '?c=AAPL&utm_source=launch');
  win.location.search = '?c=AAPL';
  win.fire('bb:page', 'AAPL');
  later();
  await new Promise((r) => { setTimeout(r, 50); });
  win.fire('bb:page', 'MARKETS');
  assert.deepEqual(calls(win).filter((a) => a[1] === 'page_view').map((a) => a[2].page_location), [`${SITE}/?c=AAPL&utm_source=launch`, `${SITE}/?c=MARKETS`]);
});

// ---- the loader: the same gates as DataFast and Ahrefs --------------------------------------

function loaderPage({ hostname = 'bloombroke.com', pathname = '/', embed = false, present = false } = {}) {
  const events = {};
  const kids = [];
  const doc = {
    referrer: '',
    head: { appendChild: (n) => kids.push(n) },
    documentElement: { classList: { contains: (c) => embed && c === 'is-embed' } },
    querySelector: (sel) => (present && sel.includes('googletagmanager') ? {} : kids.find((k) => sel.includes('googletagmanager') && k.src.startsWith('https://www.googletagmanager.com/')) || null),
    createElement: (tag) => ({ tag }),
    addEventListener() {},
  };
  const win = {
    location: { hostname, pathname, search: '', href: `https://${hostname}${pathname}` },
    addEventListener: (type, fn) => { (events[type] ||= []).push(fn); },
    fire: (type, detail) => (events[type] || []).forEach((fn) => fn({ detail })),
  };
  return { doc, win, kids };
}
const freshState = () => ({ on: false, page: null, early: [], run: null });
const ga4Module = () => import('../public/ga4.js');

test('loadGa4: on bloombroke.com for a free visitor, after the first screen; the first page view is the screen shown', async () => {
  const { doc, win, kids } = loaderPage();
  const state = freshState();
  let later = null;
  assert.equal(loadGa4({ doc, nav: {}, win, pro: () => false, state, later: (fn) => { later = fn; }, start: ga4Module }), true);
  assert.equal(kids.length, 0, 'nothing loads before the first screen');
  win.fire('bb:page', 'CHART AAPL 1Y');
  assert.equal(state.page, 'CHART AAPL 1Y');
  assert.equal(goal('whatif_run', undefined, { win: {}, nav: {}, fetchImpl: null, pro: () => false }).datafast, false);
  assert.deepEqual(state.early.length, 0, 'goal() uses the page\'s own GA4 state, not this test\'s');
  state.early.push(['whatif_run', {}]);
  later();
  await new Promise((r) => { setTimeout(r, 50); });
  assert.ok(state.run, 'ga4.js started');
  assert.equal(kids.length, 1);
  assert.equal(kids[0].src, GA4.src);
  assert.equal(kids[0].async, true);
  assert.equal(GA4.src, 'https://www.googletagmanager.com/gtag/js?id=G-N4VN8PCJXK');
  const views = calls(win).filter((a) => a[1] === 'page_view');
  assert.equal(views.length, 1);
  assert.equal(views[0][2].page_location, `${SITE}/?c=CHART+AAPL+1Y`);
  assert.ok(calls(win).some((a) => a[0] === 'event' && a[1] === 'whatif_run'), 'a goal sent before GA4 ran is sent now');
  win.fire('bb:page', 'LOGIN BB-7K2M-9QXR-4TYP-ABCD');
  assert.equal(calls(win).filter((a) => a[1] === 'page_view').at(-1)[2].page_location, `${SITE}/?c=LOGIN`);
  assert.deepEqual(leaks(win), []);
  assert.equal(loadGa4({ doc, nav: {}, win, pro: () => false, state, later() {}, start: ga4Module }), false, 'never twice');
});

test('loadGa4: never with GPC, for Pro, in a DESK panel, off bloombroke.com, on /embed/*, or when a key lands before it runs', async () => {
  const cases = [
    ['GPC', { nav: { globalPrivacyControl: true } }],
    ['Pro', { pro: () => true }],
    ['a DESK panel', { page: { embed: true } }],
    ['localhost', { page: { hostname: 'localhost' } }],
    ['a look-alike host', { page: { hostname: 'www.bloombroke.com.evil.test' } }],
    ['an /embed/ page', { page: { pathname: '/embed/guess' } }],
    ['already loaded', { page: { present: true } }],
  ];
  for (const [name, c] of cases) {
    const { doc, win, kids } = loaderPage(c.page);
    let later = null;
    assert.equal(loadGa4({ doc, nav: c.nav || {}, win, pro: c.pro || (() => false), state: freshState(), later: (fn) => { later = fn; }, start: ga4Module }), false, name);
    assert.equal(later, null, `${name}: nothing scheduled`);
    assert.equal(kids.length, 0, `${name}: no script`);
  }
  assert.equal(loadGa4({ doc: undefined, win: undefined }), false);
  // A key lands between the page load and the idle moment: GA4 never starts.
  let pro = false;
  const { doc, win, kids } = loaderPage();
  const state = freshState();
  let later = null;
  assert.equal(loadGa4({ doc, nav: {}, win, pro: () => pro, state, later: (fn) => { later = fn; }, start: ga4Module }), true);
  pro = true;
  later();
  await new Promise((r) => { setTimeout(r, 20); });
  assert.equal(state.run, null);
  assert.equal(state.on, false);
  assert.equal(kids.length, 0);
  assert.equal(win.dataLayer, undefined);
  // The gates are DataFast's own.
  assert.equal(analyticsBlocked({ doc, nav: {}, win, pro: () => true }), true);
});

test('reloadAfterKey: a key that lands while GA4 runs reloads the page, so it stops for Pro', () => {
  const loc = { replaced: null, replace(u) { this.replaced = u; } };
  assert.equal(reloadAfterKey({ doc: { querySelector: (q) => (q.includes('www.googletagmanager.com') ? {} : null) }, loc, session: null }), true);
  assert.equal(loc.replaced, '/?c=PRO');
});

// ---- goals -> GA4 events --------------------------------------------------------------------

test('goals: GA4 events in snake_case, 40 characters or fewer, only the cleaned props, same gates as DataFast', () => {
  for (const g of GOALS) assert.ok(GA_EVENTS[g] || GA_SHARE_GOALS.includes(g), `${g} is sent to GA4 or counted as a share`);
  for (const e of Object.values(GA_EVENTS)) assert.match(e, /^[a-z][a-z0-9_]{0,39}$/);
  assert.equal(GA_EVENTS.guess_played, 'guess_played');
  assert.equal(GA_EVENTS.whatif_run, 'whatif_run');
  assert.equal(GA_EVENTS.pro_checkout_started, 'pro_checkout_start');
  const sent = [];
  const ga = (event, params) => { sent.push([event, params]); return true; };
  const opts = { win: {}, nav: {}, fetchImpl: null, pro: () => false, ga, store: null };
  goal('guess_played', { result: 'solved', email: 'someone@example.com' }, opts);
  goal('whatif_run', { licence: ['BB', '7K2M', '9QXR', '4TYP', 'ABCD'].join('-') }, opts); // a made-up key
  goal('pro_checkout_started', { plan: 'year' }, opts);
  goal('whatif_share', { via: 'x' }, opts); // the share listener counts it
  assert.deepEqual(sent, [['guess_played', { result: 'solved' }], ['whatif_run', {}], ['pro_checkout_start', { plan: 'year' }]]);
  sent.length = 0;
  goal('guess_played', { result: 'solved' }, { ...opts, nav: { globalPrivacyControl: true } });
  goal('guess_played', { result: 'solved' }, { ...opts, pro: () => true });
  assert.deepEqual(sent, [], 'never with GPC, never for Pro');
  assert.deepEqual(goal('whatif_run', undefined, { ...opts, ga() { throw new Error('x'); } }), { datafast: false, counted: false }, 'a broken GA4 never throws');
});

// ---- where it hooks in -----------------------------------------------------------------------

test('the terminal: a page view per screen from the address-bar form, never the raw words; GA4 not at startup', () => {
  const app = readFileSync('public/app.js', 'utf8');
  assert.match(app, /if \(!embed\) window\.dispatchEvent\(new CustomEvent\('bb:page', \{ detail: cmd\.name === 'QUOTE' \? cmd\.input : urlFor\(raw\)\.url \}\)\);/);
  assert.match(app, /if \(!embed\) window\.dispatchEvent\(new CustomEvent\('bb:page', \{ detail: info\.grave\?\.ticker \|\| 'UNKNOWN' \}\)\);/);
  assert.equal((app.match(/'bb:page'/g) || []).length, 2);
  const goalSrc = readFileSync('public/goal.js', 'utf8');
  assert.match(goalSrc, /\{ loadDataFast\(\); loadAhrefs\(\); loadGa4\(\); \}/);
  assert.match(goalSrc, /start = \(\) => import\('\.\/ga4\.js'\)/);
  const a = buildAssets('public');
  const shell = a.closure('app.js');
  assert.ok(!shell.includes('ga4.js'), 'ga4.js loads after the first screen, not with the shell');
  assert.ok(!readFileSync('public/index.html', 'utf8').includes('googletagmanager'), 'no inline or static tag');
});

test('CSP: GA4\'s script, hits and pixel hosts on the site; nothing added to /embed/*', () => {
  const dirs = securityHeaders()['Content-Security-Policy'].split('; ');
  const dir = (name) => dirs.find((d) => d.startsWith(`${name} `));
  assert.ok(dir('script-src').endsWith(' https://www.googletagmanager.com'));
  assert.ok(dir('connect-src').endsWith(' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com'));
  assert.equal(dir('img-src'), "img-src 'self' data: https://*.google-analytics.com https://www.googletagmanager.com");
  assert.ok(!dir('script-src').includes("'unsafe-inline'"), 'no inline scripts');
  assert.ok(!dirs.join(' ').includes('doubleclick'), 'no Google Signals hosts');
  assert.doesNotMatch(readFileSync('lib/embed-pages.js', 'utf8'), /google-analytics|googletagmanager/);
});
