// PRO, LOGIN, LOGOUT, GIFT and REDEEM, as card pages (kit.js cardPage). PRO for a
// visitor: what Pro gives, shown, not listed: a live CHAT window on top (the art), the
// price, big, with the plan switch under it, SUBSCRIBE, one note line; three small live
// minis (every device, pings when closed, no ads: screens/pro-demo.js fills them), the
// seat and the 3 gift codes as a bonus row; one quiet line that opens LOGIN and REDEEM;
// + Details for what is free and what is Pro and the terms as short rows. A browser with
// a key whose Pro is off keeps its seat, big, and REACTIVATE. With a key: YOUR KEY, COPY and DOWNLOAD,
// the seat and the renewal as facts, and small links (GIFT, MANAGE PLAN, CANCEL, SHOW
// KEY, LOGOUT). LOGIN and REDEEM take the key or the code in a box on the page (the
// command forms LOGIN <key> and REDEEM <code> still work); GIFT makes gift codes.

import { esc, q, LOADING } from './markets.js';
import { cardPage, cardButton, cardLink, cardForm, cardFacts, cardRows, raw } from '../kit.js';
import * as pro from '../pro.js';
import { reloadAfterKey, takeShowKeyOnce } from '../goal.js';
import { findCommand } from '../registry.js';
import { avatarSvg, blank } from '../pixel-avatar.js';
import { loadModule, loadCss, stylesOf } from '../lazy.js'; // the visitor's minis: screens/pro-demo.js, by name
import { parsePro as parse, parseRedeem, parseLogin } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { parse, parseRedeem, parseLogin };

// The rule, and the breakdown under it. A row is [what, status, command to open or ''].
export const RULE = 'Free is everything you look at. Pro is your own stuff, plus things that work while you are away.';
export const LIVE = 'LIVE';
export const COMING = 'COMING WHEN PRO LAUNCHES';
export const FREE_ROWS = [
  ['Every screen and chart', LIVE, 'HELP'],
  ['NEWS', LIVE, 'NEWS'],
  ['WEIRD', LIVE, 'WEIRD'],
  ['The WHATIF catalogue', LIVE, 'WHATIF'],
  ['WHATIF with your own purchase', LIVE, 'WHATIF'],
  ['GUESS', LIVE, 'GUESS'],
  ['Alerts while the tab is open', LIVE, 'ALERTS'],
  ['DESK and GRID, saved on this device', LIVE, 'GRID'],
];
export const PRO_ROWS = [
  ['Watchlist, portfolio, DESK and GRID on every device', LIVE, 'DESK'],
  ['Your own ticker tape', LIVE, 'TAPE'],
  ['A seat number', LIVE, ''],
  ['No sponsor line', LIVE, 'SPONSOR'],
  ['CHAT with friends who have Pro', LIVE, 'CHAT'],
  ['Alerts and CHAT pings when the tab is closed', LIVE, 'ME'],
];
// A row for a command that is not on this site (yet) is left out, never shown as live.
export const shownRows = (rows) => rows.filter(([, , cmd]) => !cmd || findCommand(cmd));

export const SAVE_LINE = 'Save this key. It is your login on any device.';
export const OPERATOR = 'Run by Bloombroke.';
export const CONTACT = 'hello@bloombroke.com';
export const SHUTDOWN_LINE = 'If we ever shut Bloombroke down, we cancel all subscriptions and refund the unused part of the current month or year.';

export const EXPERIMENTAL_LINE = 'Bloombroke is an experimental project and may be discontinued at short notice. If it is, we cancel your subscription and refund the unused days.';
export const DEMO_BANNER = 'Demo checkout. No real money. Use card 4242 4242 4242 4242, any future date, any CVC.';

// Shown before every SUBSCRIBE button: price, renewal, how to cancel, the shutdown promise.
export const BUY_TERMS = [
  EXPERIMENTAL_LINE,
  `${pro.PRICE} USD a month or ${pro.PRICE_YEAR} USD a year, charged by Stripe. It renews automatically every month or every year, as you picked, until you cancel.`,
  'Cancel any time: type PRO and press MANAGE PLAN or CANCEL. Pro stays on to the end of the month or year you paid for.',
  SHUTDOWN_LINE,
];
export const YEARLY_NOT_YET = 'Yearly is not available yet. Monthly is.';

// Gifts: the rules in one place, for GIFT and REDEEM.
export const GIFT_RULES = 'Each paid Pro licence can make up to 3 gift codes. A code gives a friend Pro for 30 days, free, with no card, and a seat of their own. A code works once and expires 90 days after it was made if nobody uses it. A gift licence cannot make gift codes.';

const link = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;

export function maskKey(last4) {
  return `BB-XXXX-XXXX-XXXX-${String(last4 || '????').slice(-4)}`;
}

export function keyFileText(key) {
  return [
    'Bloombroke Pro key',
    '',
    key,
    '',
    SAVE_LINE,
    'To log in: open https://bloombroke.com and type LOGIN followed by the key.',
    'To manage billing or cancel: type PRO, then press MANAGE PLAN or CANCEL.',
    '',
    `${OPERATOR} Contact ${CONTACT}.`,
    '',
  ].join('\n');
}

const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dayYear = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function statusText(st, now = Date.now()) {
  if (!st) return 'NOT LOGGED IN';
  if (st.status === 'gift') return st.giftUntil && pro.statusActive(st, now) ? `Gift month, until ${day(st.giftUntil)}` : 'Gift month ended';
  if (st.status === 'gift_ended') return 'Gift month ended';
  if (st.status === 'active' || st.status === 'trialing') {
    const end = st.cancelAt || (st.cancelAtPeriodEnd ? st.currentPeriodEnd : null);
    const when = st.interval === 'year' ? dayYear : day;
    if (end) return `Active until ${when(end)} (cancelled, will not renew)`;
    if (st.currentPeriodEnd) return st.interval === 'year' ? `Renews ${when(st.currentPeriodEnd)}, yearly` : `Renews ${when(st.currentPeriodEnd)}`;
    return 'ACTIVE';
  }
  if (st.status === 'past_due') {
    if (!pro.statusActive(st, now)) return 'PAYMENT FAILED. PRO IS OFF';
    const d = st.graceUntil ? new Date(st.graceUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : '';
    return `PAYMENT FAILED. PRO STAYS ON UNTIL ${d}`;
  }
  if (st.status === 'canceled') return 'CANCELED';
  if (st.status === 'demo') return 'Demo licence. Pro features work only in demo mode.';
  return String(st.status || 'UNKNOWN').toUpperCase().replace(/_/g, ' ');
}

function rowsHtml(rows) {
  return shownRows(rows).map(([name, status, cmd]) => {
    const at = cmd && findCommand(cmd) ? name.indexOf(cmd) : -1;
    const what = at >= 0 ? `${esc(name.slice(0, at))}${link(cmd)}${esc(name.slice(at + cmd.length))}` : esc(name);
    return `<li class="pro-row"><span class="pro-feat">${what}</span><span class="pro-tag${status === LIVE ? ' is-live' : ''}">${esc(status)}</span></li>`;
  }).join('');
}

// The breakdown: FREE and PRO side by side (stacked on a phone), under the rule and the
// price (price: false in + Details, where the price is a row of its own).
export function offerHtml({ price = true } = {}) {
  return `<div class="money">
    <div class="pro-head"><p class="fx-from">${esc(RULE)}</p>
      ${price ? `<p class="hero num pro-price"><span class="hero-value">${esc(pro.PRICE)}</span><span class="hero-unit">A MONTH</span><span class="hero-unit pro-or">OR</span><span class="hero-value">${esc(pro.PRICE_YEAR)}</span><span class="hero-unit">A YEAR</span></p>` : ''}</div>
    <div class="pro-cols">
      <section class="pro-col" aria-label="Free"><h3 class="pro-col-h">FREE</h3><ul class="pro-list">${rowsHtml(FREE_ROWS)}</ul></section>
      <section class="pro-col" aria-label="Pro"><h3 class="pro-col-h">PRO</h3><ul class="pro-list">${rowsHtml(PRO_ROWS)}</ul></section>
    </div>
  </div>`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.className = 'offscreen';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


function wire(el, ctx, sel, label, fn) {
  const b = el.querySelector(sel);
  if (!b) return;
  b.addEventListener('click', async () => {
    b.disabled = true;
    ctx.status(label);
    try { await fn(); } catch (err) {
      ctx.status(err.message, 'warn');
      b.disabled = false;
    }
  });
}

// ---- the PRO page --------------------------------------------------------------------
// A visitor (or a key whose Pro is off): the seat, big, the price with the plan switch in
// it, one button, one note line, what Pro gives as four facts, small links, + Details.
// A key with Pro on: YOUR KEY (masked until SHOW KEY), COPY and DOWNLOAD, the seat and
// the renewal as facts, small links. Everything else (FREE vs PRO, the terms as short
// rows, gifts) is behind + Details.

export const YOUR_KEY = 'YOUR KEY';
// The visitor's view: the kicker, the captions under the minis, the key-or-code line.
export const KICKER = 'PRO';
export const CAPTIONS = {
  chat: 'Chat with friends',
  dev: 'Every device',
  pings: 'Pings when closed',
  ads: 'No ads',
  seat: 'Yours forever',
  gifts: '3 friends get a month',
};
export const KEY_Q = 'Have a key or gift code?';
// What each mini is, for a screen reader (the words on a mini are the picture's).
export const MINI_LABELS = {
  chat: 'A chat between ana and joe: a stock with its price, a screen, a GUESS score and a reply',
  dev: 'The same watchlist on a laptop and on a phone',
  pings: 'A phone lock screen: a price alert, then a chat message',
  ads: 'A terminal whose sponsor line slides away',
  gifts: '3 gift codes, 30 days of Pro each',
};
export const RENEW_NOTE = 'Renews until cancelled';
export const TEST_NOTE = 'test mode, no charge';
export const KEY_NOTE = 'Your login on any device.';
export const GIFT_ACTION = 'GIFT A FRIEND A MONTH';
export const MANAGE = 'MANAGE PLAN';
export const CANCEL = 'CANCEL';
export const GIFT_AFTER = 'When the gift month ends, you can subscribe on this key and keep its seat.';
export const PLAN_PRICE = { year: `${pro.PRICE_YEAR} a year.`, month: `Or ${pro.PRICE} a month.` };
// The visitor's hero: the picked plan's price, the one big number.
export const HERO_PRICE = { year: pro.PRICE_YEAR, month: pro.PRICE };
export const HERO_LABEL = { year: `${pro.PRICE_YEAR} a year`, month: `${pro.PRICE} a month` };
export const planButton = (plan) => (plan === 'month' ? 'MONTHLY' : 'YEARLY');

const isGift = (st) => st?.status === 'gift' || st?.status === 'gift_ended';

// SEAT 00043 as parts: the zeros in front dim, so a low number stands out. null: unknown.
export function seatParts(n) {
  if (!Number.isInteger(n) || n < 1) return null;
  const s = String(n).padStart(5, '0');
  const lead = s.match(/^0*/)[0];
  return { lead, digits: s.slice(lead.length), label: `SEAT ${s}` };
}

// The hero: a browser with a key shows its own seat, everyone else the next free one
// (GET /api/pro/seat). { mine, seat }.
export function heroSeat({ key = null, st = null, next = null } = {}) {
  if (key) return { mine: true, seat: Number.isInteger(st?.seat) ? st.seat : null };
  return { mine: false, seat: Number.isInteger(next) ? next : null };
}

// 00043 with the zeros dim; ----- when unknown.
export function seatNum(n) {
  const p = seatParts(n);
  return p ? `<span class="pro3-zero">${esc(p.lead)}</span>${esc(p.digits)}` : '<span class="pro3-zero">-----</span>';
}

// The seat itself, inside the hero: YOUR SEAT 00012 or SEAT 00043.
export function seatInner(h) {
  return `${h.mine ? '<span class="pro3-who">YOUR </span>' : ''}<span class="pro3-word">SEAT </span>${seatNum(h.seat)}`;
}
export function seatLabel(h) {
  const p = seatParts(h.seat);
  return `${h.mine ? 'Your ' : ''}${p ? p.label : 'seat'}`;
}

// A pixel avatar grown from a seed (a seat number or a name): the same seed, the same
// face. Left half random, mirrored; the edge row and column stay off. 64 booleans.
export function seedBits(seed) {
  let x = 2166136261;
  for (const ch of String(seed ?? '')) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  const bits = blank();
  for (let r = 1; r < 7; r++) {
    for (let c = 1; c < 4; c++) {
      const on = next() % 5 < 3;
      bits[r * 8 + c] = on;
      bits[r * 8 + 7 - c] = on;
    }
  }
  return bits;
}

// The seat card of the bonus row: a seeded avatar and SEAT 00043 (blank before it comes).
export function seatCardInner(n) {
  const seat = Number.isInteger(n) && n > 0 ? n : null;
  const av = avatarSvg({ seat }, { size: 32, cls: 'pd-seat-av', bits: seat ? seedBits(seat) : blank() });
  return `${av}<span class="pd-seat-num num">${seatInner({ mine: false, seat })}</span>`;
}

// The price, with the plan switch in it: the picked plan bright, the other one dim.
function priceHtml(plan) {
  const b = (p) => `<button type="button" class="pro3-plan" id="pro-plan-${p}" data-plan="${p}" aria-pressed="${plan === p}">${esc(PLAN_PRICE[p])}</button>`;
  return `${b('year')} ${b('month')}`;
}

const buyButton = (label, plan) => cardButton({ label: `${label} ${planButton(plan)}`, primary: true, id: 'pro-sub', attrs: `data-plan="${plan}" data-label="${esc(label)}"` });
// The note line: what it says, then the test-mode part and the yearly note, both hidden
// until the server says so (showTest, yearlyReady).
const noteHtml = (text) => `${esc(text)}<span id="pro-test" hidden> · ${esc(TEST_NOTE)}</span><span id="pro-year-note" hidden> · ${esc(YEARLY_NOT_YET)}</span>`;

// A key's facts: the seat, and when it renews or ends.
export function keyFacts(st, now = Date.now()) {
  const facts = [{ value: raw(seatNum(Number.isInteger(st?.seat) ? st.seat : null)), label: 'SEAT' }];
  if (st?.status === 'gift' && st.giftUntil && pro.statusActive(st, now)) facts.push({ value: day(st.giftUntil), label: 'GIFT MONTH UNTIL' });
  else if (st?.status === 'active' || st?.status === 'trialing') {
    const end = st.cancelAt || (st.cancelAtPeriodEnd ? st.currentPeriodEnd : null);
    const when = st.interval === 'year' ? dayYear : day;
    if (end) facts.push({ value: when(end), label: 'ENDS, NO RENEWAL' });
    else if (st.currentPeriodEnd) facts.push({ value: when(st.currentPeriodEnd), label: st.interval === 'year' ? 'RENEWS YEARLY' : 'RENEWS MONTHLY' });
  }
  return facts;
}

// A line under YOUR KEY only when something needs saying: a failed payment, a demo key.
function keySub(st) {
  if (st?.status === 'past_due' || st?.status === 'demo') return raw(`<span class="${st.status === 'past_due' ? 'down' : ''}">${esc(statusText(st))}</span>`);
  return '';
}

// The main block. key/st: this browser's licence (none: a visitor). next: the next seat.
// plan: the picked plan. alert: a line on top (after LOGIN, LOGOUT, checkout).
// reveal: the full key to show (just bought or redeemed, or SHOW KEY); else it is masked.
// has: whether a command exists (tests). detailsOpen: keep + Details open on a redraw.
export function mainHtml({ key = null, st = null, next = null, alert = '', alertWarn = false, plan = 'year', reveal = null, has, detailsOpen = false } = {}) {
  const exists = has || ((c) => Boolean(findCommand(c)));
  const on = key ? pro.statusActive(st) : false;
  const gift = isGift(st);
  const details = raw(detailsHtml({ gift: st?.status === 'gift' }));
  // A key whose status is known and off keeps the buy view (SHOW KEY shows the key in it).
  const off = Boolean(key && st && !on);
  // Billing needs the key saved in this browser (a key just bought that could not be
  // saved is shown, but MANAGE PLAN and CANCEL would have nothing to send).
  const billing = !reveal || Boolean(pro.getKey());
  if (key && !off && (on || reveal)) {
    const ending = Boolean(st?.cancelAt || st?.cancelAtPeriodEnd);
    const links = [];
    if (on && !gift && st?.canGift && exists('GIFT')) links.push(cardLink({ label: GIFT_ACTION, cmd: 'GIFT' }));
    if (!gift && billing) links.push(cardLink({ label: MANAGE, id: 'pro-manage' }));
    if (on && !gift && !ending && billing) links.push(cardLink({ label: CANCEL, id: 'pro-cancel' }));
    if (!reveal) links.push(cardLink({ label: 'SHOW KEY', id: 'pro-show' }));
    links.push(cardLink({ label: 'LOGOUT', cmd: 'LOGOUT' }));
    // ME: your username, avatar and settings, and CANCEL there too.
    if (on && exists('ME')) links.push(cardLink({ label: 'ME', cmd: 'ME' }));
    return cardPage({
      label: 'Your Pro key',
      cls: 'pro-card',
      alert,
      alertWarn,
      kicker: YOUR_KEY,
      hero: raw(`<span class="pro-key" id="pro-key">${esc(reveal || maskKey(key.slice(-4)))}</span>`),
      heroSize: 32,
      sub: keySub(st),
      act: raw(cardButton({ label: 'COPY', primary: true, id: 'pro-copy' }) + cardButton({ label: 'DOWNLOAD', id: 'pro-dl' })),
      note: reveal ? SAVE_LINE : KEY_NOTE, // just bought or redeemed: the last chance to save it
      facts: keyFacts(st),
      links,
      details,
      detailsOpen,
    });
  }
  // A visitor: the minis, the price and SUBSCRIBE.
  if (!key) return visitorHtml({ next, alert, alertWarn, plan, details, detailsOpen, exists });
  // A key whose Pro is off: something to buy, its own seat big.
  const h = heroSeat({ key, st, next });
  const label = key ? (gift ? 'SUBSCRIBE' : 'REACTIVATE') : 'SUBSCRIBE';
  const links = [gift ? '' : cardLink({ label: MANAGE, id: 'pro-manage' }), reveal ? '' : cardLink({ label: 'SHOW KEY', id: 'pro-show' }), cardLink({ label: 'LOGOUT', cmd: 'LOGOUT' })];
  return cardPage({
    label: 'Bloombroke Pro',
    cls: 'pro-card',
    alert,
    alertWarn,
    kicker: statusText(st).toUpperCase(),
    hero: raw(seatInner(h)),
    heroId: 'pro-seat',
    heroLabel: seatLabel(h),
    heroSize: 96,
    sub: raw(priceHtml(plan)),
    act: raw(buyButton(label, plan)),
    note: raw(noteHtml(`${RENEW_NOTE} · ${label} keeps this key, its seat and your synced lists.`)),
    // The key itself once SHOW KEY is pressed, in place.
    facts: reveal ? [{ value: raw(`<span class="pro-key" id="pro-key">${esc(reveal)}</span>`), label: YOUR_KEY }] : null,
    links: links.filter(Boolean),
    details,
    detailsOpen,
  });
}

// ---- the visitor's view ----------------------------------------------------------------------
// ART: the CHAT window (a live mini) and its caption. KICKER PRO, HERO the picked plan's
// price, SUB the plan switch, ACT SUBSCRIBE, NOTE the renewal line. MEDIA: three minis in a
// row (every device, pings when closed, no ads), then the bonus row: the next seat and the
// 3 gift codes. LINKS: one quiet line that opens LOGIN and REDEEM. The minis are empty
// boxes of a fixed size here; screens/pro-demo.js draws them in the browser. Words on a
// mini are the picture's (role="img" with a label); the captions are words.

const figure = (cls, inner, caption) => `<figure class="pd-fig ${cls}">${inner}<figcaption class="pd-cap">${esc(caption)}</figcaption></figure>`;
const mini = (id, kind) => `<div class="pd-mini pd-mini-${kind}" id="${id}" role="img" aria-label="${esc(MINI_LABELS[kind])}" inert></div>`;

export function giftTicketsHtml() {
  const ticket = '<span class="pd-ticket"><span class="pd-ticket-n num">30</span><span class="pd-ticket-u">DAYS</span></span>';
  return `<div class="pd-gifts" role="img" aria-label="${esc(MINI_LABELS.gifts)}">${ticket.repeat(3)}</div>`;
}

export function visitorHtml({ next = null, alert = '', alertWarn = false, plan = 'year', details = '', detailsOpen = false, exists = () => true } = {}) {
  const p = plan === 'month' ? 'month' : 'year';
  const seat = Number.isInteger(next) && next > 0 ? next : null;
  const seatAria = seatLabel({ mine: false, seat });
  const tiles = `<div class="pd-tiles">${figure('pd-tile', mini('pd-dev', 'dev'), CAPTIONS.dev)}${figure('pd-tile', mini('pd-pings', 'pings'), CAPTIONS.pings)}${figure('pd-tile', mini('pd-ads', 'ads'), CAPTIONS.ads)}</div>`;
  const bonus = `<div class="pd-bonus">${figure('pd-tile-seat', `<div class="pd-seat" id="pro-seat" role="img" aria-label="${esc(seatAria)}">${seatCardInner(seat)}</div>`, CAPTIONS.seat)}${figure('pd-tile-gifts', giftTicketsHtml(), CAPTIONS.gifts)}</div>`;
  // One quiet line; LOGIN and REDEEM behind it (GIFT is for members).
  const keyLinks = [exists('LOGIN') ? cardLink({ label: 'LOGIN', cmd: 'LOGIN' }) : '', exists('REDEEM') ? cardLink({ label: 'REDEEM', cmd: 'REDEEM' }) : ''].filter(Boolean).join(' ');
  return cardPage({
    label: 'Bloombroke Pro',
    cls: 'pro-card pro-v4',
    wide: true,
    alert,
    alertWarn,
    art: raw(figure('pd-chat-fig', mini('pd-chat', 'chat'), CAPTIONS.chat)),
    kicker: KICKER,
    hero: raw(`<span id="pro-price">${esc(HERO_PRICE[p])}</span>`),
    heroLabel: HERO_LABEL[p],
    heroId: 'pro-hero',
    heroSize: 60,
    sub: raw(priceHtml(p)),
    act: raw(buyButton('SUBSCRIBE', p)),
    note: raw(noteHtml(RENEW_NOTE)),
    media: raw(tiles + bonus),
    links: [
      cardLink({ label: KEY_Q, id: 'pro-keyq', attrs: 'aria-expanded="false" aria-controls="pro-keylinks"' }),
      `<span class="pro-keylinks" id="pro-keylinks" hidden>${keyLinks}</span>`,
    ],
    details,
    detailsOpen,
  });
}

// + Details: what is free and what is Pro, then the terms as short rows (the full wording
// is in the Terms), gifts, and the test card in test mode.
export const TERMS_ROWS = [
  ['Price', `${pro.PRICE} a month or ${pro.PRICE_YEAR} a year, in USD, charged by Stripe.`],
  ['Renewal', 'Every month or every year, as you picked, until you cancel.'],
  ['Cancel', 'Any time: type PRO and press MANAGE PLAN or CANCEL.'],
  ['After cancel', 'Pro stays on to the end of the month or year you paid for.'],
  ['Experiment', 'Bloombroke is an experiment and may close at short notice.'],
  ['Shutdown', 'We cancel all subscriptions and refund the unused days of the month or year.'],
  ['Gifts', 'Each paid licence makes up to 3 codes: 30 days of Pro each.'],
  ['Gift codes', 'Free, no card, their own seat. Work once. Expire unused after 90 days.'],
  ['Gift licences', 'Cannot make gift codes.'],
  ['Login', 'Your key is your login. There is no email or password.'],
];
export function detailsHtml({ gift = false } = {}) {
  return `${gift ? cardRows([['After the gift', GIFT_AFTER]]) : ''}${offerHtml({ price: false })}
    <p class="pro-demo" id="pro-demo" role="note" hidden>${esc(DEMO_BANNER)}</p>
    ${cardRows([
    ...TERMS_ROWS,
    ['Terms', raw('Subscribing means you agree to the <a href="/terms">Terms</a>.')],
    ['Not advice', 'Bloombroke gives information only, not investment advice.'],
    ['Operator', raw(`${esc(OPERATOR)} Contact <a href="mailto:${CONTACT}">${CONTACT}</a>.`)],
  ])}`;
}

// Per screen: the next seat once it arrives, the picked plan, a key to show in full.
const views = new WeakMap();
const viewOf = (el) => {
  if (!views.has(el)) views.set(el, { next: null, plan: 'year', reveal: null, demo: null, demoToken: null });
  return views.get(el);
};

// The page: a line for checkout news on top, then the card.
export function pageHtml() {
  return '<div class="pro-page"><div id="pro-claim"></div><div id="pro-account"></div></div>';
}

function page(el) {
  el.innerHTML = pageHtml();
  const v = viewOf(el);
  v.reveal = null;
}

// Test mode: say so in the note and, with the test card, in + Details.
function showTest(el) {
  pro.getConfig().then((c) => {
    if (c.mode !== 'test' || !el.isConnected) return;
    for (const id of ['#pro-test', '#pro-demo']) { const b = el.querySelector(id); if (b) b.hidden = false; }
  });
}

// The plan switch: the price parts pick the plan the one button buys.
function setPlan(host, plan) {
  const b = host.querySelector('#pro-sub');
  if (!b) return;
  b.dataset.plan = plan;
  b.textContent = `${b.dataset.label} ${planButton(plan)}`;
  for (const p of host.querySelectorAll('.pro3-plan')) p.setAttribute('aria-pressed', String(p.dataset.plan === plan));
  // The visitor's hero is the picked plan's price.
  const price = host.querySelector('#pro-price');
  if (price && HERO_PRICE[plan]) {
    price.textContent = HERO_PRICE[plan];
    host.querySelector('#pro-hero')?.setAttribute('aria-label', HERO_LABEL[plan]);
  }
}

// The visitor's quiet line: it gives way to LOGIN and REDEEM (their own handlers).
function wireKeyLine(host) {
  const q = host.querySelector('#pro-keyq');
  const links = host.querySelector('#pro-keylinks');
  if (!q || !links) return;
  q.addEventListener('click', () => {
    links.hidden = false;
    q.setAttribute('aria-expanded', 'true');
    q.hidden = true;
    links.querySelector('a')?.focus();
  });
}

// The visitor's minis (screens/pro-demo.js, loaded by name with its stylesheets): started
// once the card is drawn, stopped on a redraw and when the screen is left.
export const DEMO_JS = 'screens/pro-demo.js';
function startMinis(el, host, ctx) {
  const v = viewOf(el);
  v.demo?.stop();
  v.demo = null;
  v.demoToken = null;
  if (!host.querySelector('#pd-chat') || !ctx?.signal) return;
  const token = {};
  v.demoToken = token;
  Promise.all([loadModule(DEMO_JS, { recover: false }), ...stylesOf(DEMO_JS).map(loadCss)]).then(([m]) => {
    if (v.demoToken !== token || ctx.signal.aborted || !host.isConnected || !host.querySelector('#pd-chat')) return;
    v.demo = m.startDemo(host, ctx);
  }).catch(() => { /* the page works without its minis */ });
}

// Yearly not set up on the server: monthly only, and say so.
function yearlyReady(host, v) {
  pro.getConfig().then((c) => {
    if (c.yearly || !host.isConnected) return;
    const y = host.querySelector('#pro-plan-year');
    if (!y) return;
    y.disabled = true;
    y.title = YEARLY_NOT_YET;
    v.plan = 'month';
    setPlan(host, 'month');
    const n = host.querySelector('#pro-year-note');
    if (n) n.hidden = false;
  });
}

// COPY and DOWNLOAD take the whole key, even while it shows masked.
function wireKey(host, ctx, key) {
  host.querySelector('#pro-copy')?.addEventListener('click', async () => {
    const ok = await copyText(key);
    ctx.status(ok ? 'KEY COPIED' : 'SELECT THE KEY AND COPY IT', ok ? '' : 'warn');
  });
  host.querySelector('#pro-dl')?.addEventListener('click', () => {
    download('bloombroke-pro-key.txt', keyFileText(key));
    ctx.status('SAVED BLOOMBROKE-PRO-KEY.TXT');
  });
}

function renderAccount(el, ctx, alert = '', plan = null, { warn = false } = {}) {
  const v = viewOf(el);
  if (plan) v.plan = plan;
  const host = el.querySelector('#pro-account');
  if (!host) return;
  const key = v.reveal || pro.getKey();
  const detailsOpen = Boolean(host.querySelector('.card-more')?.open);
  host.innerHTML = mainHtml({ key, st: pro.getStatus(), next: v.next, alert, alertWarn: warn, plan: v.plan, reveal: v.reveal, detailsOpen });
  showTest(el);
  for (const p of host.querySelectorAll('.pro3-plan')) {
    p.addEventListener('click', () => { v.plan = p.dataset.plan; setPlan(host, v.plan); });
  }
  wire(host, ctx, '#pro-sub', 'OPENING CHECKOUT...', () => pro.startCheckout(host.querySelector('#pro-sub').dataset.plan));
  yearlyReady(host, v);
  // MANAGE PLAN and CANCEL: the same Stripe billing portal, where cancel lives.
  wire(host, ctx, '#pro-manage', 'OPENING BILLING...', () => pro.openPortal());
  wire(host, ctx, '#pro-cancel', 'OPENING BILLING. CANCEL IS THERE...', () => pro.openPortal());
  if (key) wireKey(host, ctx, key);
  wireKeyLine(host);
  startMinis(el, host, ctx);
  const show = host.querySelector('#pro-show');
  const reveal = () => {
    v.reveal = pro.getKey();
    if (!v.reveal) return;
    const k = host.querySelector('#pro-key');
    if (k) k.textContent = v.reveal;
    show?.remove();
    // A key with Pro off: its key goes into the same view (the price and REACTIVATE stay).
    if (!k) renderAccount(el, ctx);
  };
  if (show) show.addEventListener('click', reveal);
  // Back from a reload after REDEEM (reloadAfterKey): the new key once more, to save.
  if (show && pro.getKey() && takeShowKeyOnce()) reveal();
}

// ME: NEW KEY and SHOW KEY open this screen's key view in ME's place: the key in full,
// COPY and DOWNLOAD, the save line, and the same links as PRO.
export function keyView(el, ctx, key, alert = '', { warn = false } = {}) {
  page(el);
  viewOf(el).reveal = key;
  renderAccount(el, ctx, alert, null, { warn });
}

// The next seat (for a visitor), once. It fills in place; a screen that was redrawn since
// picks it up from the view.
function loadNumbers(el, ctx) {
  const v = viewOf(el);
  if (!ctx?.fetchJSON || pro.getKey()) return;
  ctx.fetchJSON('/api/pro/seat', { signal: ctx.signal }).then((d) => {
    if (!Number.isInteger(d?.next) || !el.isConnected) return;
    v.next = d.next;
    const h = el.querySelector('#pro-seat');
    if (h && !pro.getKey()) {
      const seat = heroSeat({ next: v.next });
      // The visitor's bonus row: the seat card, with its avatar.
      h.innerHTML = h.classList.contains('pd-seat') ? seatCardInner(seat.seat) : seatInner(seat);
      h.setAttribute('aria-label', seatLabel(seat));
    }
  }).catch(() => {});
}

// After checkout: fetch the key once the payment is confirmed.
function claimInto(el, ctx, sessionId) {
  const host = el.querySelector('#pro-claim');
  host.innerHTML = LOADING;
  ctx.status('CONFIRMING YOUR PAYMENT...');
  pro.claim(sessionId).then((d) => {
    if (!el.isConnected) return;
    pro.clearPending();
    host.innerHTML = '';
    if (d.reactivated) {
      renderAccount(el, ctx, 'Pro is on again, on the same key. Your synced lists are still here.');
      ctx.status('PRO: ACTIVE AGAIN');
      return;
    }
    viewOf(el).reveal = d.key;
    renderAccount(el, ctx, d.saved ? 'Welcome to Pro. You are logged in on this browser.' : 'This browser could not save your key, so copy it now.', null, { warn: !d.saved });
    ctx.status('PRO: ACTIVE. SAVE YOUR KEY');
  }).catch((err) => {
    if (!el.isConnected) return;
    if (err.code === 'expired' || err.code === 'not_found' || err.code === 'bad_session') pro.clearPending();
    const retry = err.code === 'not_paid' || err.code === 'unavailable' || err.code === 'network' || err.code === 'rate_limited';
    host.innerHTML = `<p class="card-alert warn">${esc(err.message)}</p>${retry ? `<p class="card-act">${cardButton({ label: 'TRY AGAIN', primary: true, id: 'pro-retry' })}</p>` : ''}`;
    const b = host.querySelector('#pro-retry');
    if (b) b.addEventListener('click', () => claimInto(el, ctx, sessionId));
    ctx.status('PRO: KEY NOT READY', 'warn');
  });
}

export function render(el, cmd, ctx) {
  const pending = pro.pendingCheckout();
  if (pending && cmd.name === 'PRO') {
    page(el);
    renderAccount(el, ctx);
    loadNumbers(el, ctx);
    claimInto(el, ctx, pending);
    // A REACTIVATE checkout: the browser already has a key, so show its fresh status too.
    if (pro.getKey()) pro.refreshStatus().then(() => { if (el.isConnected && !pro.pendingCheckout()) renderAccount(el, ctx); }).catch(() => {});
    return;
  }
  // Yearly first; PRO MONTHLY starts on monthly.
  const plan = cmd.args?.plan === 'month' ? 'month' : 'year';
  page(el);
  renderAccount(el, ctx, '', plan);
  loadNumbers(el, ctx);
  ctx.status(pro.isPro() ? 'PRO: ACTIVE' : `PRO: ${pro.PRICE_BOTH.toUpperCase()}`);
  if (pro.getKey()) {
    pro.refreshStatus().then(() => {
      if (!el.isConnected) return;
      renderAccount(el, ctx, '');
      ctx.status(pro.isPro() ? 'PRO: ACTIVE' : 'PRO: NOT ACTIVE. REACTIVATE KEEPS YOUR KEY', pro.isPro() ? '' : 'warn');
    }).catch(() => {});
  }
}

// ---- a box for the key or the code -------------------------------------------------------
// The value is read from the box and handed to the same calls as LOGIN <key> and
// REDEEM <code>: it never goes into the address bar or the command history.
function wireForm(el, formId, fn) {
  const form = el.querySelector(`#${formId}`);
  const input = form?.querySelector('input');
  if (!form || !input) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) { input.focus(); return; }
    input.value = '';
    fn(value);
  });
  // Esc hands the keyboard back to the command bar.
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); document.getElementById('cmd')?.focus(); }
  });
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (!coarse) setTimeout(() => { if (input.isConnected) input.focus(); }, 0);
}

// ---- LOGIN ---------------------------------------------------------------------------------

export const LOGIN_NOTE = 'Your key is your login. No email, no password.';
export const LOGIN_BAD = 'That does not look like a key. A key looks like BB-XXXX-XXXX-XXXX-XXXX.';

export function loginHtml({ alert = '', warn = false } = {}) {
  return cardPage({
    label: 'Log in with your key',
    cls: 'pro-card',
    alert,
    alertWarn: warn,
    kicker: 'PRO',
    hero: 'Log in',
    heroSize: 44,
    act: raw(cardForm({ id: 'login-form', inputId: 'login-key', label: 'Your key', placeholder: 'BB-XXXX-XXXX-XXXX-XXXX', button: 'LOGIN', maxlength: 80 })),
    note: LOGIN_NOTE,
    links: [cardLink({ label: 'PRO', cmd: 'PRO' }), cardLink({ label: 'REDEEM', cmd: 'REDEEM' })],
  });
}

function loginForm(el, ctx, alert = '', warn = false) {
  const host = el.querySelector('#pro-account');
  host.innerHTML = loginHtml({ alert, warn });
  // A gift code in the box redeems it, as LOGIN <code> does.
  wireForm(host, 'login-form', (value) => (pro.normalizeGiftCode(value) && !pro.normalizeKey(value) ? redeemInto(el, ctx, value) : loginInto(el, ctx, value)));
}

// PINGS: LOGIN with another key on a browser that has pings (public/push.js switchKey).
// At most 3 seconds, and before the reload that stops DataFast.
export async function pingsFollowKey(oldKey, newKey = pro.getKey(), { nav = globalThis.navigator, load = () => import('../push.js'), waitMs = 3000 } = {}) {
  if (!oldKey || !newKey || oldKey === newKey || !nav?.serviceWorker) return false;
  let timer;
  try {
    const m = await load();
    return await Promise.race([m.switchKey(oldKey, newKey), new Promise((r) => { timer = setTimeout(r, waitMs, false); })]);
  } catch { return false; } finally { clearTimeout(timer); }
}

function loginInto(el, ctx, key) {
  const host = el.querySelector('#pro-account');
  host.innerHTML = LOADING;
  ctx.status('CHECKING YOUR KEY...');
  const old = pro.getKey(); // PINGS: the key this browser had
  pro.login(key).then(async (st) => {
    await pingsFollowKey(old);
    if (!el.isConnected) return;
    renderAccount(el, ctx, st.active ? 'Logged in. Your watchlist, portfolio and tape now sync.' : 'Logged in, but Pro is not active on this key.');
    ctx.status(st.active ? 'PRO: LOGGED IN' : 'PRO: NOT ACTIVE', st.active ? '' : 'warn');
    reloadAfterKey(); // DataFast was running before the key: stop it now
  }).catch((err) => {
    if (!el.isConnected) return;
    loginForm(el, ctx, err.message, true);
    ctx.status('LOGIN FAILED', 'warn');
  });
}

// LOGIN <key>
export const loginCommand = {
  parse: parseLogin,
  render(el, cmd, ctx) {
    page(el);
    if (cmd.args?.gift) { redeemInto(el, ctx, cmd.args.gift); return; }
    if (cmd.error || cmd.args?.show) {
      loginForm(el, ctx, cmd.error ? LOGIN_BAD : '', Boolean(cmd.error));
      ctx.status(cmd.error ? 'LOGIN: CHECK THE KEY' : 'LOGIN: PASTE YOUR KEY', cmd.error ? 'warn' : '');
      return;
    }
    loginInto(el, ctx, cmd.args.key);
  },
};

// LOGOUT
export const logoutCommand = {
  render(el, cmd, ctx) {
    const had = Boolean(pro.getKey());
    // PINGS: this browser stops getting this key's pings (public/push.js).
    if (had && typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const key = pro.getKey();
      import('../push.js').then((m) => m.forgetDevice(key)).catch(() => {});
    }
    pro.logout();
    page(el);
    loadNumbers(el, ctx);
    renderAccount(el, ctx, had ? 'Logged out on this browser. Your key still works on any device.' : 'You were not logged in.');
    ctx.status('LOGGED OUT');
  },
};

// ---- REDEEM ------------------------------------------------------------------------------

export const REDEEM_NOTE = '30 days of Pro. Free, no card.';
export const GIFT_ROWS = [
  ['Codes', 'Each paid Pro licence can make up to 3 gift codes.'],
  ['A code gives', 'Pro for 30 days, free, with no card, and a seat of their own.'],
  ['Once', 'A code works once.'],
  ['Expiry', '90 days after it was made, if nobody uses it.'],
  ['Gift licences', 'A gift licence cannot make gift codes.'],
];

export function redeemHtml({ alert = '', warn = false } = {}) {
  return cardPage({
    label: 'Redeem a gift code',
    cls: 'pro-card',
    alert,
    alertWarn: warn,
    kicker: 'REDEEM',
    hero: 'Got a gift code?',
    heroSize: 44,
    act: raw(cardForm({ id: 'redeem-form', inputId: 'redeem-code', label: 'Gift code', placeholder: 'GIFT-XXXX-XXXX-...', button: 'REDEEM', maxlength: 60 })),
    note: REDEEM_NOTE,
    details: raw(cardRows([...GIFT_ROWS, ['Command', 'REDEEM and the code works too. The code never goes in the address bar.']])),
  });
}

function redeemForm(el, ctx, alert = '', warn = false) {
  const host = el.querySelector('#pro-account');
  host.innerHTML = redeemHtml({ alert, warn });
  wireForm(host, 'redeem-form', (code) => redeemInto(el, ctx, code));
}

// Use a gift code on this browser: the new key, in full, with COPY and DOWNLOAD.
function redeemInto(el, ctx, code) {
  const host = el.querySelector('#pro-account');
  host.innerHTML = LOADING;
  ctx.status('CHECKING THE GIFT CODE...');
  pro.redeem(code).then((d) => {
    if (!el.isConnected) return;
    const until = d.giftUntil ? day(d.giftUntil) : '--';
    viewOf(el).reveal = d.key;
    renderAccount(el, ctx, `Your gift month of Pro runs until ${until}. You are logged in on this browser.${d.saved ? '' : ' This browser could not save your key, so copy it now.'}`);
    ctx.status('PRO: GIFT MONTH ACTIVE. SAVE YOUR KEY');
    reloadAfterKey({ showKey: true }); // DataFast was running before the key: stop it now
  }).catch((err) => {
    if (!el.isConnected) return;
    redeemForm(el, ctx, err.message, true);
    ctx.status(err.code === 'has_key' ? 'REDEEM: LOG OUT FIRST' : 'REDEEM FAILED', 'warn');
  });
}

// REDEEM <code>
export const redeemCommand = {
  parse: parseRedeem,
  render(el, cmd, ctx) {
    page(el);
    if (cmd.args?.code) { redeemInto(el, ctx, cmd.args.code); return; }
    redeemForm(el, ctx, cmd.args?.error ? 'That does not look like a gift code.' : '', Boolean(cmd.args?.error));
    ctx.status(cmd.args?.error ? 'REDEEM: CHECK THE CODE' : 'REDEEM: PASTE THE CODE', cmd.args?.error ? 'warn' : '');
  },
};

// ---- GIFT --------------------------------------------------------------------------------

const GIFT_STATE = { unused: 'UNUSED', redeemed: 'REDEEMED', expired: 'EXPIRED' };
export const GIFT_NOTE = 'Friends use it with REDEEM.';
export const GIFT_ONCE_NOTE = 'Shown once. Copy it and send it to your friend.';

// older: redeemed codes whose records were deleted after 12 months, shown as a count.
export function giftRowsHtml(gifts, fmt = dayYear, older = 0) {
  const note = older > 0 ? `<p class="muted">${older === 1 ? '1 older redeemed code is' : `${older} older redeemed codes are`} no longer listed. ${older === 1 ? 'It still counts' : 'They still count'} toward the 3.</p>` : '';
  if (!gifts.length) return note || '<p class="muted">No gift codes yet.</p>';
  return `<ul class="pro-list">${gifts.map((g) => {
    const when = g.state === 'redeemed' ? `on ${fmt(g.redeemedAt)}` : g.state === 'unused' ? `until ${fmt(g.expiresAt)}` : `on ${fmt(g.expiresAt)}`;
    return `<li class="pro-row"><span class="pro-feat num">${esc(pro.maskGift(g.last4))}</span><span class="pro-tag${g.state === 'unused' ? ' is-live' : ''}">${esc(`${GIFT_STATE[g.state] || '--'} ${when}`)}</span></li>`;
  }).join('')}</ul>${note}`;
}

const giftDetails = () => raw(cardRows([...GIFT_ROWS, ['Why once', 'We keep only a hash of a code, so it is not shown again.']]));

// d: /api/pro/gifts ({ gifts, left, canGift, older }). shown: a code just made, in full.
export function giftHtml(d, { shown = null, why = '' } = {}) {
  const canMake = d.canGift && d.left > 0;
  const list = d.gifts.length || d.older ? raw(`<div class="pro-gifts">${giftRowsHtml(d.gifts, dayYear, d.older || 0)}</div>`) : '';
  if (shown) {
    return cardPage({
      label: 'Your gift code', cls: 'pro-card', kicker: 'YOUR GIFT CODE',
      hero: raw(`<span class="pro-key" id="gift-code">${esc(shown)}</span>`), heroSize: 32,
      act: raw(cardButton({ label: 'COPY', primary: true, id: 'gift-copy' })),
      note: GIFT_ONCE_NOTE, media: list, details: giftDetails(),
    });
  }
  return cardPage({
    label: 'Gift a month of Pro', cls: 'pro-card', kicker: 'GIFT',
    hero: `${d.left} OF 3`, heroSize: 60, sub: 'gift codes left',
    act: canMake ? raw(cardButton({ label: 'MAKE A GIFT CODE', primary: true, id: 'gift-make' })) : '',
    note: canMake ? GIFT_NOTE : why,
    media: list, details: giftDetails(),
  });
}

export function giftLoggedOutHtml() {
  return cardPage({
    label: 'Gift a month of Pro', cls: 'pro-card', kicker: 'GIFT',
    hero: 'Gift a month', heroSize: 44, sub: 'Gift codes come with paid Pro.',
    act: raw(cardButton({ label: 'LOGIN', primary: true, cmd: 'LOGIN' }) + cardButton({ label: 'PRO', cmd: 'PRO' })),
    details: giftDetails(),
  });
}

function giftPage(el, ctx, shown = null) {
  const host = el.querySelector('#gift-body');
  host.innerHTML = LOADING;
  pro.listGifts().then((d) => {
    if (!el.isConnected) return;
    const canMake = d.canGift && d.left > 0;
    let why = '';
    if (!d.canGift) why = pro.getStatus()?.status === 'gift' || pro.getStatus()?.status === 'gift_ended' ? 'A gift licence cannot make gift codes.' : 'Gift codes come with an active paid Pro subscription.';
    else if (!d.left) why = 'You have made 3 gift codes. A code that expires unused frees its place.';
    host.innerHTML = giftHtml(d, { shown, why });
    const copy = host.querySelector('#gift-copy');
    if (copy) copy.addEventListener('click', async () => { const ok = await copyText(shown); ctx.status(ok ? 'GIFT CODE COPIED' : 'SELECT THE CODE AND COPY IT', ok ? '' : 'warn'); });
    wire(host, ctx, '#gift-make', 'MAKING A GIFT CODE...', async () => {
      const made = await pro.createGift();
      if (!el.isConnected) return;
      giftPage(el, ctx, made.code);
      ctx.status('GIFT CODE MADE. COPY IT NOW');
    });
    if (!shown) ctx.status(canMake ? `GIFT: ${d.left} OF 3 LEFT` : 'GIFT: NONE TO MAKE');
  }).catch((err) => {
    if (!el.isConnected) return;
    host.innerHTML = cardPage({ cls: 'pro-card', kicker: 'GIFT', alert: err.message, alertWarn: true });
    ctx.status('GIFT: NOT AVAILABLE', 'warn');
  });
}

// GIFT: your codes and MAKE A GIFT CODE.
export const giftCommand = {
  render(el, cmd, ctx) {
    el.innerHTML = '<div class="pro-page" id="gift-body"></div>';
    if (!pro.getKey()) {
      el.querySelector('#gift-body').innerHTML = giftLoggedOutHtml();
      ctx.status('GIFT: LOG IN FIRST');
      return;
    }
    giftPage(el, ctx);
  },
};
