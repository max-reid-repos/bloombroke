// /founders and /guide: plain server-rendered pages, like the legal pages (lib/legal.js),
// built from the card kit (public/kit.js cardPage, kit.css "Card pages"): one centred
// column, the kit's slots in the kit's order, one solid button at most. Every number on
// them is real: the bar and the seats come from the founders table (pro/founders.js),
// the tips line from the tips table (pro/tips.js). The pages read without JavaScript; a
// small script (public/founders.js, outside the terminal's startup code) picks a seat,
// opens Stripe Checkout, sends a tip and joins the guide list.
//
//   GET /founders            the seats, the bar, how it works, tips when TIPS=open
//   GET /founders?s=cs_...   the same, after checkout: "Seat 7 is yours." on top
//   GET /founders?paid=7&s=  back from a pay-link checkout: the key card alone (the script
//                            asks POST /api/founders/paid for the key)
//   /founders#claim=<token>  charge day, the claim link: the script swaps the page for the
//   /founders#pay=<token>    key card or the pay card (both in <template>s on the page;
//                            the server never sees a fragment)
//   GET /guide               HOW BLOOMBROKE WAS BUILT: one email when it ships
// Every /founders answer says Referrer-Policy: no-referrer.

import { cardPage, cardFacts, cardButton, raw } from '../public/kit.js';
import { CLASSES, SEATS_TOTAL, DATA_COST_USD, DEFAULT_GOAL_USD, fmtUsd, fmtDay, foundersEnv, CONTACT, FROZEN_MESSAGE } from '../pro/founders.js';
import { TIP_AMOUNTS, TIP_MIN, TIP_MAX } from '../pro/tips.js';
import { clientIp } from '../pro/ratelimit.js';

const SITE = 'https://bloombroke.com';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = (c) => `/?${new URLSearchParams({ c })}`;

export const FOUNDERS_META = {
  title: 'Founders seats | Bloombroke',
  description: 'Licensed live prices cost $15,300 a year. Save a card for one of 42 founders seats; nobody pays until founders commit $17,640, then Pro goes live.',
};
export const GUIDE_META = {
  title: 'How Bloombroke was built | Bloombroke',
  description: 'A guide from first commit to launch: how Bloombroke, a free market terminal, was built. $149 when it ships. Leave your email for one email when it is ready.',
};

// The copy, in one place (the tests read it).
export const COPY = {
  h1: 'Founders seats',
  sub: (goal) => `Licensed live prices cost ${fmtUsd(DATA_COST_USD)} a year. When founders commit ${fmtUsd(goal)}, Pro goes live.`,
  open: 'You save a card today. Nobody pays until the goal is reached.',
  soon: 'Seats open soon. Nobody pays until the goal is reached.',
  // Charge day (founders_state.frozen_at): no seat can be saved any more.
  frozen: FROZEN_MESSAGE,
  ended: (day) => `Seats closed on ${day}.`,
  mine: (seat) => `Seat ${seat} is yours. Nobody pays until the goal is reached.`,
  pending: 'Saving your seat. Reload this page in a minute.',
  // A checkout that ended without a seat, by reason. The card is never kept.
  failed: {
    duplicate: 'You already have a seat. One seat per person. This card was not kept.',
    full: (cls) => `${cls === 'ten' ? 'All five-year seats are taken.' : 'All founder seats are taken.'} This card was not kept.`,
    ended: (day) => `Seats closed on ${day}. This card was not kept.`,
    gone: 'This checkout did not save a seat. This card was not kept.',
  },
  released: 'Checkout cancelled. The seat is free again.',
  team: 'Team seats for newsletters and communities: $25 a seat a month, from 10 seats.',
  tipHead: 'Fuel the feed',
  tipSub: 'A tip is a gift, not a seat. It names a fish in the FISHTANK.',
  tipThanks: 'Thank you. Your fish joins the FISHTANK once its name is checked.',
  how: [
    'You save a card with Stripe. We never see the card number.',
    'When committed seats reach {goal}, we charge every seat on the same day.',
    'If your card fails on the charge day, we email you a link to pay within 3 days. If you do not pay, we give the seat back.',
    'Pro goes live within 30 days of that charge. If it is not live within 45 days, you get a full refund.',
    'If the goal is not reached by {deadline}, we delete every saved card and nobody pays.',
    `You can give up your seat any time before the charge. Email ${CONTACT}.`,
    'One seat per person. Seats cannot be passed on.',
  ],
};

export const CLASS_COPY = {
  ten: { name: 'Five-year seat', price: `${fmtUsd(CLASSES.ten.usd)}`, per: 'once', line: 'Seats 1 to 10. Five years of Pro.', button: 'Save a five-year seat' },
  founder: { name: 'Founder seat', price: `${fmtUsd(CLASSES.founder.usd)}`, per: 'a year', line: 'Seats 11 to 42. Your price stays while you keep the seat.', button: 'Save a founder seat' },
};

// The page's state when the Pro database is not there: the config, no seat numbers.
export function emptyState(env = process.env) {
  const cfg = foundersEnv(env);
  return { open: false, testMode: false, ended: Date.now() > cfg.deadlineAt, goalUsd: cfg.goalUsd, committedUsd: null, seatsTaken: null, seatsTotal: SEATS_TOTAL, deadline: cfg.deadline, seats: [], log: [] };
}

const deadlineMs = (deadline) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 12) : Date.now();
};

// ---- the cards ----------------------------------------------------------------------

// The hero of a standalone page is its h1 (the kit draws an h2).
const asH1 = (html) => html.replace(/<h2 class="card-hero([^"]*)"([^>]*)>([\s\S]*?)<\/h2>/, '<h1 class="card-hero$1"$2>$3</h1>');

// Card 1: what it is and how far along. The bar is a native <progress> (no inline width).
export function mainCardHtml(st, { alert = '', alertWarn = false } = {}) {
  const goal = st.goalUsd || DEFAULT_GOAL_USD;
  const day = fmtDay(deadlineMs(st.deadline));
  const known = Number.isFinite(st.committedUsd);
  const done = known ? Math.min(st.committedUsd, goal) : 0;
  const bar = known
    ? `<progress class="fd-bar" max="${goal}" value="${done}" aria-label="${esc(`${fmtUsd(st.committedUsd)} of ${fmtUsd(goal)} committed`)}"></progress>`
    : '';
  const kicker = raw(`Founders${st.testMode ? ' <span class="fd-badge">TEST MODE</span>' : ''}`);
  return asH1(cardPage({
    id: 'fd-main', label: 'Founders seats', cls: 'fd-card fd-main',
    alert, alertWarn,
    kicker,
    hero: COPY.h1, heroSize: 44,
    sub: COPY.sub(goal),
    chart: bar ? raw(bar) : '',
    facts: known ? cardFacts([
      { value: fmtUsd(st.committedUsd), label: `of ${fmtUsd(goal)} committed` },
      { value: String(st.seatsTaken), label: `of ${st.seatsTotal || SEATS_TOTAL} seats` },
      { value: day, label: st.ended ? 'Closed' : 'Closes' },
    ], { id: 'fd-facts' }) : null,
  }));
}

// The two kinds of seat, each with its button. Founder seats are the main thing (32 of
// 42), so theirs is the page's one solid button, while it can be pressed. Closed, or a
// class with no seat left: the button is disabled and an outline (a disabled white fill
// looks pressable). After the deadline: no buttons.
function classesHtml(st) {
  const left = (cls) => st.seats.filter((s) => s.class === cls && s.status === 'open').length;
  const box = (cls, solid) => {
    const c = CLASS_COPY[cls];
    const full = st.seats.length > 0 && left(cls) === 0;
    const off = !st.open || full;
    return `<div class="fd-class" data-class="${cls}">`
      + `<h2 class="tag fd-class-name">${esc(c.name)}</h2>`
      + `<p class="fd-price"><span class="num">${esc(c.price)}</span> ${esc(c.per)}</p>`
      + `<p class="fd-class-line">${esc(c.line)}</p>`
      // After the deadline there is nothing to press: no button at all.
      + (st.ended ? '' : cardButton({ label: full ? 'All taken' : c.button, primary: solid && !off, attrs: `data-class="${cls}" data-label="${esc(c.button)}"${off ? ' disabled' : ''}` }))
      + '</div>';
  };
  return `<div class="fd-classes">${box('ten', false)}${box('founder', true)}</div><p class="fd-msg" id="fd-msg" role="status" aria-live="polite"></p>`;
}

// The 42 seats. Taken: the number and the handle (plain text, never a link). Open: the
// number, dim, a button while seats can be saved. Held: a checkout is open for it.
export function gridHtml(st) {
  const cells = st.seats.map((s) => {
    const cls = `fd-seat is-${s.status} is-${s.class}`;
    if (s.status === 'committed') {
      const h = s.handle ? `<span class="fd-handle">@${esc(s.handle)}</span>` : '';
      const name = s.handle ? `Seat ${s.seat}, @${s.handle}` : `Seat ${s.seat}, taken`;
      return `<li class="${cls}" title="${esc(name)}" aria-label="${esc(name)}"><span class="num">${s.seat}</span>${h}</li>`;
    }
    if (s.status === 'held') return `<li class="${cls}" title="Someone is checking out"><span class="num">${s.seat}</span></li>`;
    if (st.open) return `<li class="${cls}"><button type="button" class="fd-pick" data-seat="${s.seat}" data-class="${s.class}" aria-pressed="false" aria-label="Seat ${s.seat}, open"><span class="num">${s.seat}</span></button></li>`;
    return `<li class="${cls}"><span class="num">${s.seat}</span></li>`;
  }).join('');
  return `<ul class="fd-grid" id="fd-grid" aria-label="The 42 seats">${cells}</ul>`;
}

function logHtml(st) {
  const rows = (st.log || []).slice(0, 20);
  return rows.length ? `<ul class="fd-log" aria-label="Released seats">${rows.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul>` : '';
}

function howHtml(st) {
  const goal = fmtUsd(st.goalUsd || DEFAULT_GOAL_USD);
  const day = fmtDay(deadlineMs(st.deadline));
  return `<ol class="fd-how">${COPY.how.map((t) => `<li>${esc(t.replace('{goal}', goal).replace('{deadline}', day))}</li>`).join('')}</ol>`;
}

// Card 2: pick a seat. The classes and their buttons, the line, the grid, the team line,
// How it works (closed).
export function seatsCardHtml(st) {
  const day = fmtDay(deadlineMs(st.deadline));
  const note = st.ended ? COPY.ended(day) : st.frozen ? COPY.frozen : st.open ? COPY.open : COPY.soon;
  const mail = `mailto:${CONTACT}?subject=${encodeURIComponent('Team seats')}`;
  return cardPage({
    id: 'fd-seats', label: 'Pick a seat', cls: 'fd-card fd-seats',
    act: raw(classesHtml(st)),
    note,
    media: st.seats.length ? raw(gridHtml(st) + logHtml(st)) : '',
    links: [`<span class="fd-team">${esc(COPY.team)} <a href="${esc(mail)}">Email ${esc(CONTACT)}</a>.</span>`],
    details: raw(howHtml(st)),
  }).replace('<summary>Details</summary>', '<summary>How it works</summary>');
}

// Card 3 (TIPS=open only): a gift that names a fish. Not counted in the founders bar.
export function tipsCardHtml({ monthUsd = 0, thanks = false } = {}) {
  const amounts = TIP_AMOUNTS.map((n) => `<button type="button" class="chip fd-amt" data-usd="${n}" aria-pressed="${n === 10 ? 'true' : 'false'}">$${n}</button>`).join('');
  const form = '<form class="fd-tip-form" id="fd-tip-form" novalidate>'
    + `<div class="fd-amounts" role="group" aria-label="Amount">${amounts}`
    + `<input class="card-input fd-amt-other" id="fd-tip-usd" type="text" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="Other" aria-label="Other amount, ${TIP_MIN} to ${TIP_MAX} dollars"></div>`
    + `${cardButton({ label: 'Tip $10', type: 'submit', id: 'fd-tip-send' })}</form>`
    + '<p class="fd-msg" id="fd-tip-msg" role="status" aria-live="polite"></p>';
  const tank = `<a href="${esc(q('FISHTANK'))}">FISHTANK</a>`;
  return cardPage({
    id: 'fuel', label: COPY.tipHead, cls: 'fd-card fd-tips',
    alert: thanks ? COPY.tipThanks : '',
    hero: COPY.tipHead, heroSize: 32,
    sub: raw(esc(COPY.tipSub).replace('FISHTANK', tank)),
    act: raw(form),
    note: `Tips this month: ${fmtUsd(monthUsd)}.`,
  });
}

// The guide card: one email box and its button, the one line under it.
export const GUIDE_COPY = {
  h1: 'How Bloombroke was built',
  sub: 'A guide from first commit to launch. $149 when it ships.',
  note: 'One email when it is ready. Nothing else.',
  done: 'Done. We will email you once when it is ready.',
  button: 'TELL ME',
};
export function guideCardHtml() {
  const form = '<form class="card-form fd-guide-form" id="fd-guide-form" novalidate>'
    + '<input class="card-input fd-email" id="fd-guide-email" name="email" type="email" inputmode="email" maxlength="254" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Your email" placeholder="Your email">'
    + '<input class="fd-hp" id="fd-guide-hp" name="hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">'
    + `${cardButton({ label: GUIDE_COPY.button, primary: true, type: 'submit', id: 'fd-guide-send' })}</form>`;
  return asH1(cardPage({
    id: 'fd-guide', label: GUIDE_COPY.h1, cls: 'fd-card fd-guide',
    kicker: 'Guide',
    hero: GUIDE_COPY.h1, heroSize: 44,
    sub: GUIDE_COPY.sub,
    act: raw(form),
    note: raw(`<span id="fd-guide-note">${esc(GUIDE_COPY.note)}</span>`),
  }));
}

// ---- charge day: the key card, the pay card ---------------------------------------
// The claim link (#claim=), the pay link (#pay=) and the pay-link return (?paid=) each
// show ONE card. The server draws them empty; public/founders.js fills them from the
// API (claim, pay with peek, paid) and swaps them in. The key looks like PRO's key view
// (screens/pro.js mainHtml): the key as the hero at 32, COPY solid, the other an outline.
// The buttons start disabled, so as outlines (a disabled white fill looks pressable, like
// the seats when closed); the script makes the one action solid when it can be pressed.
export const KEY_MASK = 'BB-XXXX-XXXX-XXXX-XXXX';
export const CHARGE_COPY = {
  keyKicker: 'Your Pro key',
  keyWait: 'Getting your key...',
  // claim: the email link can be opened again; paid: the email has that link too.
  again: {
    claim: 'Opening the link again makes a new key, and this one stops working.',
    paid: 'The link in your email makes a new key, and this one stops working.',
  },
  copy: 'Copy key',
  saved: 'I saved it',
  payHero: 'Your seat',
  payWait: 'Checking this link...',
  pay: 'Pay',
};

// kind: 'claim' (from the email link) or 'paid' (back from a pay-link checkout).
export function keyCardHtml(kind = 'claim') {
  return asH1(cardPage({
    id: 'fd-key-card', label: CHARGE_COPY.keyKicker, cls: 'fd-card fd-key-card',
    kicker: CHARGE_COPY.keyKicker,
    hero: raw(`<span class="pro-key is-wait" id="fd-key">${esc(KEY_MASK)}</span>`), heroSize: 32,
    sub: raw(`<span id="fd-key-sub" role="status" aria-live="polite">${esc(CHARGE_COPY.keyWait)}</span>`),
    act: raw(cardButton({ label: CHARGE_COPY.copy, id: 'fd-copy', attrs: 'disabled' })
      + cardButton({ label: CHARGE_COPY.saved, id: 'fd-saved', attrs: 'disabled' })),
    note: raw(`<span id="fd-key-note">${esc(CHARGE_COPY.again[kind === 'paid' ? 'paid' : 'claim'])}</span>`),
  }));
}

// The pay link: the seat and its class (hero, no kicker: it would say founder twice), what
// happened (sub), "Pay $420" (the one solid button), when the link stops (note).
export function payCardHtml() {
  return asH1(cardPage({
    id: 'fd-pay-card', label: 'Pay for your seat', cls: 'fd-card fd-pay-card',
    hero: raw(`<span id="fd-pay-hero">${esc(CHARGE_COPY.payHero)}</span>`), heroSize: 32,
    sub: raw(`<span id="fd-pay-sub" role="status" aria-live="polite">${esc(CHARGE_COPY.payWait)}</span>`),
    act: raw(cardButton({ label: CHARGE_COPY.pay, id: 'fd-pay', attrs: 'disabled' })),
    note: raw('<span id="fd-pay-note"></span>'),
  }));
}

// The cards for the fragment links, inert until the script uses one.
export const chargeTemplates = () => `<template id="fd-tpl-claim">${keyCardHtml('claim')}</template><template id="fd-tpl-pay">${payCardHtml()}</template>`;

// ---- the page -----------------------------------------------------------------------

function shell({ path, meta, body, build = '', analytics = true, page }) {
  const asset = (f) => (build ? `/v/${build}/${f}` : `/${f}`);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(meta.title)}</title>
  <meta name="description" content="${esc(meta.description)}">
  <meta name="theme-color" content="#05080C">
  <meta name="color-scheme" content="dark">
  <link rel="canonical" href="${SITE}${path}">
  <meta property="og:title" content="${esc(meta.title)}">
  <meta property="og:description" content="${esc(meta.description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE}${path}">
  <meta property="og:image" content="${SITE}/og/default.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="stylesheet" href="${asset('fonts.css')}">
  <link rel="stylesheet" href="${asset('legal.css')}">
  <link rel="stylesheet" href="${asset('kit.css')}">
  <link rel="stylesheet" href="${asset('founders.css')}">
  <script type="module" src="${asset('founders.js')}"></script>
${analytics ? `  <script type="module" src="${asset('goal.js')}"></script>\n` : ''}</head>
<body class="legal-body fd-body" data-page="${esc(page)}">
  <header class="legal-top">
    <a class="legal-mark" href="/">BLOOMBROKE</a>
    <nav class="legal-nav" aria-label="Pages"><a href="${esc(q('PRO'))}">Pro</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav>
  </header>
  <main class="fd" id="fd">
${body}
  </main>
  <footer class="legal-foot fd-foot">
    <p>Not financial advice. <a href="/terms">Terms</a></p>
    <p><a href="/">Back to the terminal</a></p>
  </footer>
</body>
</html>
`;
}

// The whole /founders page. confirm: pro/founders.js confirm() (after checkout).
// tips: { open, monthUsd } or null. analytics: false on the checkout return (?s=), so
// no analytics tool sees the session id in the address. paid: the pay-link return
// (?paid=<seat>): the key card alone, never analytics.
export const KEY_META = { title: 'Your Pro key | Bloombroke', description: FOUNDERS_META.description };
export function foundersPage(st, { build = '', confirm = null, tips = null, tipThanks = false, analytics = true, paid = false } = {}) {
  if (paid) return shell({ path: '/founders', meta: KEY_META, body: keyCardHtml('paid'), build, analytics: false, page: 'founders' });
  let alert = '';
  let warn = false;
  if (confirm?.seat) alert = COPY.mine(confirm.seat);
  else if (confirm?.pending) alert = COPY.pending;
  else if (confirm?.failed) {
    const day = fmtDay(deadlineMs(st.deadline));
    alert = confirm.failed === 'full' ? COPY.failed.full(confirm.cls) : confirm.failed === 'ended' ? COPY.failed.ended(day)
      : confirm.failed === 'gone' ? COPY.failed.gone : COPY.failed.duplicate;
    warn = true;
  } else if (confirm?.released) alert = COPY.released;
  const body = [
    mainCardHtml(st, { alert, alertWarn: warn }),
    seatsCardHtml(st),
    tips?.open ? tipsCardHtml({ monthUsd: tips.monthUsd, thanks: tipThanks }) : '',
    chargeTemplates(),
  ].filter(Boolean).join('\n');
  return shell({ path: '/founders', meta: FOUNDERS_META, body, build, analytics, page: 'founders' });
}

export function guidePage({ build = '' } = {}) {
  return shell({ path: '/guide', meta: GUIDE_META, body: guideCardHtml(), build, page: 'guide' });
}

// GET /founders and /guide (a trailing slash works too). founders, tips: the runtime
// objects from pro/index.js startPro (null when Pro could not start: the page then shows
// the seats closed, without numbers).
export function mountFoundersPages(app, { build = '', founders = null, tips = null, log = console } = {}) {
  const send = (res, html, cache = 'no-cache') => res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache }).send(html);
  // The public state, plus the charge-day freeze (founders_state.frozen_at).
  const state = () => {
    const st = founders.status();
    let frozen = false;
    try { frozen = Boolean(founders.store?.frozen?.()); } catch { frozen = false; }
    return { ...st, frozen };
  };
  app.get(['/founders', '/founders/'], async (req, res) => {
    // No page here ever sends its address on (a session id, a seat) to another site.
    res.set('Referrer-Policy', 'no-referrer');
    // Back from a pay-link checkout: the key card alone; its script asks for the key. Its
    // session id is a payment, never a seat checkout: never confirmed here.
    const paidQ = typeof req.query.paid === 'string' ? req.query.paid : null;
    if (paidQ !== null && /^[1-9]\d?$/.test(paidQ) && Number(paidQ) <= SEATS_TOTAL) return send(res, foundersPage(null, { build, paid: true }), 'no-store');
    const s = paidQ === null && typeof req.query.s === 'string' ? req.query.s.slice(0, 300) : '';
    // The cancel link from Stripe (pro/founders.js cancel): the seat opens at once.
    const release = typeof req.query.release === 'string' ? req.query.release.slice(0, 40) : '';
    let st;
    try { st = founders ? state() : emptyState(); } catch (err) {
      log.error('[founders] page', err.message);
      st = emptyState();
    }
    let confirm = null;
    if (s && founders) {
      try { confirm = await founders.confirm(s, clientIp(req)); } catch (err) { log.error('[founders] confirm', err.message); confirm = { pending: true }; }
      if (confirm?.seat) st = state();
    } else if (release && founders) {
      let done = false;
      try { done = await founders.cancel(release, clientIp(req)); } catch (err) { log.error('[founders] cancel', err.message); }
      if (done) { confirm = { released: true }; st = state(); }
    }
    const tipState = tips?.isOpen() ? { open: true, monthUsd: tips.store.monthUsd() } : null;
    send(res, foundersPage(st, { build, confirm, tips: tipState, tipThanks: req.query.tip === 'thanks', analytics: !s && !release && paidQ === null }), s || release || paidQ !== null ? 'no-store' : 'no-cache');
  });
  const guide = guidePage({ build });
  app.get(['/guide', '/guide/'], (req, res) => send(res, guide, 'public, max-age=300'));
}
