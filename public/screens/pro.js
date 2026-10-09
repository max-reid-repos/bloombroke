// PRO, LOGIN, LOGOUT, GIFT and REDEEM, as card pages (kit.js cardPage). PRO for a
// visitor (v5, "one stage, four keys"): a split card, the words on the left (PRO, the
// promise as the hero, both prices with the picked one bright, SUBSCRIBE, "Cancel any
// time." and, in test mode only, a line that says no card is charged), and on the right
// one stage: one large demo at a time in a terminal panel, with a key row 1 PINGS 2 CHAT
// 3 EVERY DEVICE 4 SEAT (screens/pro-demo.js fills it). + Details for what is free and
// what is Pro, the key-or-gift-code line and the terms as short rows. A browser with
// a key whose Pro is off keeps its seat, big, and REACTIVATE. With a key: YOUR KEY, COPY and DOWNLOAD,
// the seat and the renewal as facts, and small links (GIFT, MANAGE PLAN, CANCEL, SHOW
// KEY, LOGOUT). LOGIN and REDEEM take the key or the code in a box on the page (the
// command forms LOGIN <key> and REDEEM <code> still work); GIFT makes gift codes.

import { esc, q, LOADING } from './markets.js';
import { cardPage, cardButton, cardLink, cardForm, cardFacts, cardRows, raw } from '../kit.js';
import * as pro from '../pro.js';
import { reloadAfterKey, takeShowKeyOnce, goal } from '../goal.js';
import { findCommand } from '../registry.js';
import { blank } from '../pixel-avatar.js';
import { loadModule, loadCss, stylesOf } from '../lazy.js'; // the visitor's stage: screens/pro-demo.js, by name
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
  ['No ad line', LIVE, ''],
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

// A founders seat (pro/routes.js publicStatus: founders: true): paid on charge day, no
// plan of its own until go-live, so nothing to manage or cancel. A five-year seat gets
// its end (termUntil) on go-live day; a founder seat gets a yearly plan then, and from
// that day reads like any yearly plan (founders is no longer set). foundersClass ('ten' or
// 'founder') tells the two apart before go-live, when the server sends it.
export function foundersText(st) {
  if (!st?.founders) return '';
  if (st.termUntil) return `Five-year seat, ends ${dayYear(st.termUntil)}`;
  if (st.foundersClass === 'ten') return 'Five-year seat, starts on go-live day';
  if (st.foundersClass === 'founder') return 'Founder seat, renews one year after go-live';
  return 'Founders seat, dates start on go-live day';
}

export function statusText(st, now = Date.now()) {
  if (!st) return 'NOT LOGGED IN';
  if (st.founders && st.status === 'active') return foundersText(st);
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
    // Every row is live, so it carries no tag; a row that is not says so.
    return `<li class="pro-row"><span class="pro-feat">${what}</span>${status === LIVE ? '' : `<span class="pro-tag">${esc(status)}</span>`}</li>`;
  }).join('');
}

// The breakdown: FREE and PRO side by side (stacked on a phone), under the rule and the
// price (price: false in + Details, where the price is a row of its own). rule: false
// where the page's hero already says the rule (the visitor's PRO).
export function offerHtml({ price = true, rule = true } = {}) {
  return `<div class="money">
    ${rule || price ? `<div class="pro-head">${rule ? `<p class="fx-from">${esc(RULE)}</p>` : ''}
      ${price ? `<p class="hero num pro-price"><span class="hero-value">${esc(pro.PRICE)}</span><span class="hero-unit">A MONTH</span><span class="hero-unit pro-or">OR</span><span class="hero-value">${esc(pro.PRICE_YEAR)}</span><span class="hero-unit">A YEAR</span></p>` : ''}</div>` : ''}
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
// A visitor: the promise, both prices, one button, the note, + Details; the stage
// beside it (visitorHtml below). A key whose Pro is off: its seat, big, the price with the plan
// switch in it, one button, one note line, small links, + Details.
// A key with Pro on: YOUR KEY (masked until SHOW KEY), COPY and DOWNLOAD, the seat and
// the renewal as facts, small links. Everything else (FREE vs PRO, the terms as short
// rows, gifts) is behind + Details.

export const YOUR_KEY = 'YOUR KEY';
// The visitor's view (v5): the kicker, the hero (the promise, in words, not a number), the
// note, the test-mode line, the key-or-code line (in + Details).
export const KICKER = 'PRO';
// The hero, in ONE place. The owner's other line, if it is ever wanted:
// 'Pro is your stuff on every device, pings on your phone, and chat with friends.'
export const HERO = RULE;
export const CANCEL_NOTE = 'Cancel any time.';
export const TEST_LINE = 'Test mode: no card is charged yet.';
export const KEY_Q = 'Key or gift code?';
// The stage: one large demo at a time, keys 1 to 4. label: the title strip and the key;
// meta: the title strip's quiet part (EVERY DEVICE says "your watchlist" when it shows
// the visitor's own list: screens/pro-demo.js); aria: what the picture shows.
export const STAGES = [
  { id: 'pings', label: 'PINGS', meta: 'demo', aria: 'A phone lock screen with two notifications: a chat message with a stock price, and a price alert' },
  { id: 'chat', label: 'CHAT', meta: 'demo', aria: 'A chat between ana and joe: a stock with its price, a GUESS score and a reply' },
  { id: 'dev', label: 'EVERY DEVICE', meta: 'demo', aria: 'The same watchlist on a laptop and on a phone' },
  { id: 'seat', label: 'SEAT', meta: 'yours forever', aria: 'A seat card with the next free seat number, a blank username and an empty avatar, and a ticket for 3 gift months' },
];
export const RENEW_NOTE = 'Renews until cancelled';
export const TEST_NOTE = 'test mode, no charge';
export const KEY_NOTE = 'Your login on any device.';
export const GIFT_ACTION = 'GIFT A FRIEND A MONTH';
export const MANAGE = 'MANAGE PLAN';
export const CANCEL = 'CANCEL';
export const GIFT_AFTER = 'When the gift month ends, you can subscribe on this key and keep its seat.';
export const PLAN_PRICE = { year: `${pro.PRICE_YEAR} a year.`, month: `Or ${pro.PRICE} a month.` };
// The visitor's price line: both prices, each once; the picked one bright and heavy.
export const PLAN_LINE = { month: `${pro.PRICE} a month`, year: `${pro.PRICE_YEAR} a year` };
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
    // A year away or more (a yearly plan, a five-year seat's end): the date with its year.
    const when = st.interval === 'year' || st.termUntil ? dayYear : day;
    if (end) facts.push({ value: when(end), label: 'ENDS, NO RENEWAL' });
    else if (st.currentPeriodEnd) facts.push({ value: when(st.currentPeriodEnd), label: st.interval === 'year' ? 'RENEWS YEARLY' : 'RENEWS MONTHLY' });
  }
  return facts;
}

// A line under YOUR KEY only when something needs saying: a failed payment, a demo key,
// a founders seat (what it is and its dates).
function keySub(st) {
  if (st?.founders && st.status === 'active') return foundersText(st);
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
    // A founders seat has no plan to manage or cancel (the portal would say so).
    const plan = !gift && !st?.founders;
    if (plan && billing) links.push(cardLink({ label: MANAGE, id: 'pro-manage' }));
    if (on && plan && !ending && billing) links.push(cardLink({ label: CANCEL, id: 'pro-cancel' }));
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
  // A visitor: the words and SUBSCRIBE on the left, the stage on the right.
  if (!key) return visitorHtml({ alert, alertWarn, plan, detailsOpen, exists });
  // A key whose Pro is off: something to buy, its own seat big.
  const h = heroSeat({ key, st, next });
  const label = key ? (gift ? 'SUBSCRIBE' : 'REACTIVATE') : 'SUBSCRIBE';
  const links = [gift || st?.founders ? '' : cardLink({ label: MANAGE, id: 'pro-manage' }), reveal ? '' : cardLink({ label: 'SHOW KEY', id: 'pro-show' }), cardLink({ label: 'LOGOUT', cmd: 'LOGOUT' })];
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
    act: raw(buyButton(label, plan) + soonHtml()),
    note: raw(noteHtml(`${RENEW_NOTE} · ${label} keeps this key, its seat and your synced lists.`)),
    // The key itself once SHOW KEY is pressed, in place.
    facts: reveal ? [{ value: raw(`<span class="pro-key" id="pro-key">${esc(reveal)}</span>`), label: YOUR_KEY }] : null,
    links: links.filter(Boolean),
    details,
    detailsOpen,
  });
}

// ---- the visitor's view ----------------------------------------------------------------------
// A split card (kit.js cardPage split): the text column (KICKER PRO, HERO the promise at
// 24, SUB both prices, ACT one SUBSCRIBE, NOTE "Cancel any time." and the test-mode line,
// + Details) and the art column: the STAGE, a terminal panel with a title strip like the
// app's panel heads (PINGS · demo), one large demo, and a key row like the F-key bar.
// pro.css puts the text first on a phone and on the left on a desktop. The view is an
// empty box of a fixed size here; screens/pro-demo.js draws in it. Words in the view are
// the picture's (role="img" with a label).

// The price line: both prices, each once; the picked one bright and heavy. The same
// .pro3-plan buttons (and click handler) as the key view's switch.
export function priceLineHtml(plan) {
  const p = plan === 'month' ? 'month' : 'year';
  const b = (x) => `<button type="button" class="pro3-plan pro5-plan" id="pro-plan-${x}" data-plan="${x}" aria-pressed="${p === x}">${esc(PLAN_LINE[x])}</button>`;
  return `<span class="pro5-price" role="group" aria-label="Plan">${b('month')}${b('year')}</span>`;
}

// The stage's frame: the title strip, the view, the keys 1 to 4 (the first one on).
export function stageHtml() {
  const s = STAGES[0];
  const keys = STAGES.map((x, i) => `<button type="button" role="tab" class="pd-key" data-stage="${i + 1}" aria-selected="${i === 0}" aria-controls="pd-stage"><span class="pd-key-n">${i + 1}</span><span class="pd-key-l">${esc(x.label)}</span></button>`).join('');
  return '<div class="pd-stagebox" id="pd-stagebox" tabindex="-1" data-own-focus>'
    + `<div class="pd-stage-head"><span class="pd-stage-label" id="pd-stage-label">${esc(s.label)}</span><span class="pd-stage-meta" id="pd-stage-meta"><span aria-hidden="true">·</span> ${esc(s.meta)}</span></div>`
    + `<div class="pd-stage" id="pd-stage" role="img" aria-label="${esc(s.aria)}" inert></div>`
    + `<div class="pd-keys" role="tablist" aria-label="What Pro gives">${keys}</div>`
    + '</div>';
}

// The note: "Cancel any time.", then two hidden lines the server may turn on: yearly not
// set up (yearlyReady), and test mode (showTest), a line of its own.
const visitorNote = () => `${esc(CANCEL_NOTE)}<span id="pro-year-note" hidden> ${esc(YEARLY_NOT_YET)}</span><span id="pro-test" hidden>${esc(TEST_LINE)}</span>`;

// The key-or-code line (in + Details): LOGIN and REDEEM behind it (GIFT is for members).
export function keyLineHtml(exists = () => true) {
  const keyLinks = [exists('LOGIN') ? cardLink({ label: 'LOGIN', cmd: 'LOGIN' }) : '', exists('REDEEM') ? cardLink({ label: 'REDEEM', cmd: 'REDEEM' }) : ''].filter(Boolean).join(' ');
  return `<p class="pro-keyline">${cardLink({ label: KEY_Q, id: 'pro-keyq', attrs: 'aria-expanded="false" aria-controls="pro-keylinks"' })}<span class="pro-keylinks" id="pro-keylinks" hidden>${keyLinks}</span></p>`;
}

export function visitorHtml({ alert = '', alertWarn = false, plan = 'year', detailsOpen = false, exists = () => true } = {}) {
  const p = plan === 'month' ? 'month' : 'year';
  return cardPage({
    label: 'Bloombroke Pro',
    cls: 'pro-card pro-v5',
    split: true,
    alert,
    alertWarn,
    art: raw(stageHtml()),
    kicker: KICKER,
    hero: HERO,
    heroSize: 24,
    sub: raw(priceLineHtml(p)),
    act: raw(cardButton({ label: 'SUBSCRIBE', primary: true, id: 'pro-sub', attrs: `data-plan="${p}"` }) + soonHtml()),
    note: raw(visitorNote()),
    noteId: 'pro-note', // hidden while checkout is closed (showSoon)
    details: raw(detailsHtml({ keyLine: keyLineHtml(exists), rule: HERO !== RULE })),
    detailsOpen,
  });
}

// + Details: what is free and what is Pro, then the terms as short rows (the full wording
// is in the Terms), gifts, and the test card in test mode (last). A visitor's has the
// key-or-code line on top, and no rule line while the hero says it.
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
export function detailsHtml({ gift = false, keyLine = '', rule = true } = {}) {
  return `${keyLine}${gift ? cardRows([['After the gift', GIFT_AFTER]]) : ''}${offerHtml({ price: false, rule })}
    ${cardRows([
    ...TERMS_ROWS,
    ['Terms', raw('Subscribing means you agree to the <a href="/terms">Terms</a>.')],
    ['Not advice', 'Bloombroke gives information only, not investment advice.'],
    ['Operator', raw(`${esc(OPERATOR)} Contact <a href="mailto:${CONTACT}">${CONTACT}</a>.`)],
  ])}
    <p class="pro-demo" id="pro-demo" role="note" hidden>${esc(DEMO_BANNER)}</p>`;
}

// Per screen: the next seat once it arrives, the picked plan, a key to show in full.
const views = new WeakMap();
const viewOf = (el) => {
  if (!views.has(el)) views.set(el, { next: null, plan: 'year', reveal: null, demo: null, demoToken: null, want: null, held: false, keysOff: null });
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

// PRO_CHECKOUT=closed on the server: no checkout on this site. The buy button gives way to
// one line and the waitlist under it, and the test-mode lines stay hidden. The visitor's
// note ("Cancel any time.", the yearly line) goes too: there is nothing to buy or cancel.
// Keys already out keep everything else, their own note included.
export const SOON_LINE = 'Pro opens soon.';
// The waitlist's box is empty and hidden until the server says closed (showWait fills it).
// FOUNDERS SEATS: one line under it, only while founders seats are open (showFounders).
const soonHtml = () => `<p class="card-sub" id="pro-soon" hidden>${esc(SOON_LINE)}</p><div class="pro-wait" id="pro-wait" hidden></div><p class="pro-founders" id="pro-founders" hidden></p>`;
function showSoon(el, ctx) {
  el.querySelector('#pro-sub')?.remove();
  const p = el.querySelector('#pro-soon');
  if (p) p.hidden = false;
  const note = el.querySelector('#pro-note');
  if (note) note.hidden = true;
  showWait(el, ctx);
  showFounders(el, ctx);
}

// FOUNDERS SEATS (pro/founders.js): "Founders: $8,400 of $17,640 committed. Type FOUNDERS."
// The numbers from /api/founders/status; nothing at all unless seats can be saved now.
const dollars = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
export function foundersLine(d) {
  if (!d?.open || !Number.isFinite(d.committedUsd) || !Number.isFinite(d.goalUsd)) return '';
  return `Founders: ${esc(dollars(d.committedUsd))} of ${esc(dollars(d.goalUsd))} committed. Type <a href="${esc(q('FOUNDERS'))}" data-cmd="FOUNDERS">FOUNDERS</a>.`;
}
function showFounders(el, ctx) {
  const line = el.querySelector('#pro-founders');
  if (!line || !ctx?.fetchJSON) return;
  ctx.fetchJSON('/api/founders/status', { signal: ctx.signal }).then((d) => {
    const html = foundersLine(d);
    if (!html || !line.isConnected) return;
    line.innerHTML = html;
    line.hidden = false;
  }).catch(() => {});
}

// ---- PRO WAITLIST ------------------------------------------------------------------------
// Only while checkout is closed: one email box and TELL ME under "Pro opens soon.", one
// line under them. POST /api/pro/waitlist (pro/waitlist.js). After it worked, the form
// gives way to one line, for the rest of this page's life. Errors go to the status line
// and, since a phone's status line cuts them, into the line under the form too (warn); the
// next try puts that line back.
// Enter sends (the form's own submit); Esc hands the keyboard back to the command bar.
// Analytics get one goal, waitlist_joined, with nothing else: never the address.
export const WAIT_LABEL = 'Your email';
export const WAIT_BUTTON = 'TELL ME';
export const WAIT_NOTE = 'One email when Pro opens. Nothing else.';
export const WAIT_DONE = 'Done. We will email you once when Pro opens.';
export const WAIT_BAD = 'That email address does not look right.';
const WAIT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What goes in the box (#pro-wait) once checkout is known to be closed.
export function waitHtml() {
  return '<form class="card-form pro-wait-form" id="pro-wait-form" novalidate>'
    + `<input class="card-input pro-wait-input" id="pro-wait-email" name="email" type="email" inputmode="email" maxlength="254" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="${esc(WAIT_LABEL)}" placeholder="${esc(WAIT_LABEL)}">`
    + '<input class="pro-wait-hp" id="pro-wait-hp" name="hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">'
    + `<button type="submit" class="btn card-btn btn-solid" id="pro-wait-send">${esc(WAIT_BUTTON)}</button>`
    + '</form>'
    + `<p class="pro-wait-note" id="pro-wait-note" aria-live="polite">${esc(WAIT_NOTE)}</p>`;
}
const waitDoneHtml = () => `<p class="pro-wait-done" id="pro-wait-done" role="status">${esc(WAIT_DONE)}</p>`;

async function joinWaitlist(email, hp) {
  let res;
  try {
    res = await fetch('/api/pro/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email, hp }), cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new Error('You look offline. Try again in a minute.');
  }
  let d = null;
  try { d = await res.json(); } catch { /* none */ }
  if (!res.ok || !d?.ok) throw new Error(d?.message || 'Could not save that. Try again in a minute.');
  return d;
}

function showWait(el, ctx) {
  const box = el.querySelector('#pro-wait');
  if (!box) return;
  box.hidden = false;
  const v = viewOf(el);
  if (v.waitDone) { box.innerHTML = waitDoneHtml(); return; }
  if (box.querySelector('#pro-wait-form')) return; // filled and wired already
  box.innerHTML = waitHtml();
  const form = box.querySelector('#pro-wait-form');
  const input = form.querySelector('#pro-wait-email');
  const btn = form.querySelector('#pro-wait-send');
  const note = box.querySelector('#pro-wait-note');
  const say = (text, warn = false) => {
    if (!note) return;
    note.textContent = text;
    note.classList.toggle('warn', warn);
  };
  const oops = (msg) => { ctx?.status?.(msg, 'warn'); say(msg, true); };
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    say(WAIT_NOTE); // the next try: the usual line back
    const email = input.value.trim();
    if (!WAIT_RE.test(email) || email.length > 254) {
      oops(WAIT_BAD);
      input.focus();
      return;
    }
    busy = true;
    btn.disabled = true;
    ctx?.status?.('SENDING...');
    try {
      await joinWaitlist(email, form.querySelector('#pro-wait-hp')?.value || '');
      v.waitDone = true;
      if (!box.isConnected) return;
      box.innerHTML = waitDoneHtml();
      ctx?.status?.('ON THE LIST');
      goal('waitlist_joined');
    } catch (err) {
      if (!box.isConnected) return;
      oops(err.message);
      btn.disabled = false;
      busy = false;
    }
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); globalThis.document?.getElementById('cmd')?.focus(); }
  });
}
// ---- end PRO WAITLIST ----------------------------------------------------------------------

// Test mode: say so in the note and, with the test card, in + Details.
function showTest(el, ctx) {
  pro.getConfig().then((c) => {
    if (!el.isConnected) return;
    if (c.closed) { showSoon(el, ctx); return; }
    if (c.mode !== 'test') return;
    for (const id of ['#pro-test', '#pro-demo']) { const b = el.querySelector(id); if (b) b.hidden = false; }
  });
}

// The plan switch: the price parts pick the plan the one button buys.
function setPlan(host, plan) {
  for (const p of host.querySelectorAll('.pro3-plan')) p.setAttribute('aria-pressed', String(p.dataset.plan === plan));
  const b = host.querySelector('#pro-sub');
  if (!b) return; // checkout closed: the prices still pick, there is no button
  b.dataset.plan = plan;
  // The key view's button says its plan (REACTIVATE YEARLY); the visitor's is SUBSCRIBE.
  if (b.dataset.label) b.textContent = `${b.dataset.label} ${planButton(plan)}`;
}

// The visitor's key line in + Details: it gives way to LOGIN and REDEEM (their own handlers).
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

// The visitor's stage (screens/pro-demo.js, loaded by name with its stylesheets): started
// once the card is drawn, stopped on a redraw and when the screen is left.
export const DEMO_JS = 'screens/pro-demo.js';
function startStage(el, host, ctx) {
  const v = viewOf(el);
  v.demo?.stop();
  v.demo = null;
  v.demoToken = null;
  v.want = null;
  v.held = false;
  // In an embed or a DESK panel: the first stage, still (no quotes call, no timers).
  if (ctx?.embed && host.querySelector('#pd-stage')) {
    host.querySelector('.pd-keys')?.setAttribute('hidden', ''); // not wired here
    Promise.all([loadModule(DEMO_JS, { recover: false }), ...stylesOf(DEMO_JS).map(loadCss)])
      .then(([m]) => { if (host.isConnected && host.querySelector('#pd-stage')) m.drawStill(host, ctx); }).catch(() => {});
  }
  if (ctx?.embed || !host.querySelector('#pd-stage') || !ctx?.signal) return;
  const token = {};
  v.demoToken = token;
  Promise.all([loadModule(DEMO_JS, { recover: false }), ...stylesOf(DEMO_JS).map(loadCss)]).then(([m]) => {
    if (v.demoToken !== token || ctx.signal.aborted || !host.isConnected || !host.querySelector('#pd-stage')) return;
    v.demo = m.startDemo(host, ctx, { seat: () => v.next, first: v.want ?? 0, hold: v.held || v.want !== null });
  }).catch(() => { /* the page works without its stage */ });
}

// The stage's keys: 1 to 4 pick a stage, only while the focus is on the stage or its key
// row (after a click there). Anywhere else a key is typing: it goes on to the command
// bar untouched (MSFT after a click on a price, 3988.HK). The prices are picked by a
// click. A hover on the stage keeps it where it is. Stopped when the screen is left or
// redrawn. focus: the element with the focus (document.activeElement).
export function stageKeyFor(e, focus = e?.target) {
  if (!e || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return null;
  if (!/^[1-4]$/.test(e.key)) return null;
  if (!focus?.closest?.('#pd-stagebox')) return null;
  return { stage: Number(e.key) - 1 };
}
function wireStage(el, host, ctx, { doc = globalThis.document } = {}) {
  const v = viewOf(el);
  v.keysOff?.();
  v.keysOff = null;
  const box = host.querySelector('#pd-stagebox');
  if (!box || ctx?.embed) return;
  const pick = (i) => {
    if (v.demo) { v.demo.pick(i); return; }
    // Before the stage module is in: remember it, and mark the key.
    v.want = i;
    for (const t of host.querySelectorAll('[data-stage]')) t.setAttribute('aria-selected', String(Number(t.dataset.stage) === i + 1));
  };
  for (const t of host.querySelectorAll('[data-stage]')) t.addEventListener('click', () => pick(Number(t.dataset.stage) - 1));
  box.addEventListener('pointerenter', () => { if (v.demo) v.demo.hold(); else v.held = true; });
  // A click on the stage or a key takes the focus there, so 1 to 4 work at once (a
  // browser that does not focus a clicked button still lands inside the stage).
  box.addEventListener('pointerdown', (e) => { if (!e.target?.closest?.('button')) box.focus?.({ preventScroll: true }); });
  for (const t of host.querySelectorAll('[data-stage]')) t.addEventListener('pointerdown', () => { t.focus?.({ preventScroll: true }); });
  if (!doc?.addEventListener) return;
  const onKey = (e) => {
    if (!host.isConnected || ctx?.signal?.aborted) { off(); return; }
    const k = stageKeyFor(e, doc.activeElement || e.target);
    if (!k) return; // not ours: typing, on its way to the command bar
    pick(k.stage);
    e.preventDefault();
    e.stopPropagation();
  };
  const off = () => { doc.removeEventListener('keydown', onKey, true); if (v.keysOff === off) v.keysOff = null; };
  doc.addEventListener('keydown', onKey, true);
  ctx?.signal?.addEventListener?.('abort', off, { once: true });
  v.keysOff = off;
}

// The prices off while checkout opens; back on (yearly stays off when it is not set up).
function lockPlans(host, v, on) {
  for (const p of host.querySelectorAll('.pro3-plan')) p.disabled = on || (p.id === 'pro-plan-year' && v.noYear === true);
}

// Yearly not set up on the server: monthly only, the yearly price dim and off, and say so.
function yearlyReady(host, v) {
  pro.getConfig().then((c) => {
    if (c.yearly || !host.isConnected) return;
    const y = host.querySelector('#pro-plan-year');
    if (!y) return;
    v.plan = 'month';
    v.noYear = true;
    setPlan(host, 'month');
    y.disabled = true;
    y.title = YEARLY_NOT_YET;
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
  showTest(el, ctx);
  for (const p of host.querySelectorAll('.pro3-plan')) {
    p.addEventListener('click', () => { v.plan = p.dataset.plan; setPlan(host, v.plan); });
  }
  // While checkout opens, the plan cannot change: the prices are off until it fails.
  wire(host, ctx, '#pro-sub', 'OPENING CHECKOUT...', () => {
    lockPlans(host, v, true);
    return pro.startCheckout(host.querySelector('#pro-sub').dataset.plan).catch((err) => { lockPlans(host, v, false); throw err; });
  });
  yearlyReady(host, v);
  // MANAGE PLAN and CANCEL: the same Stripe billing portal, where cancel lives.
  wire(host, ctx, '#pro-manage', 'OPENING BILLING...', () => pro.openPortal());
  wire(host, ctx, '#pro-cancel', 'OPENING BILLING. CANCEL IS THERE...', () => pro.openPortal());
  if (key) wireKey(host, ctx, key);
  wireKeyLine(host);
  wireStage(el, host, ctx);
  startStage(el, host, ctx);
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
    // The visitor's SEAT stage draws it (in place, when it is on show).
    v.demo?.refresh();
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
  // Not the price: the page says it once (the review, Sep 29).
  ctx.status(pro.isPro() ? 'PRO: ACTIVE' : '');
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
