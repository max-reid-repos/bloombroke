// PRO, LOGIN, LOGOUT, GIFT and REDEEM. PRO is the seat, big: the next seat number (or
// yours), the price, SUBSCRIBE (yearly first, monthly one click away), one live line,
// three perks, and + DETAILS for what is free and what is Pro and the full terms. The key
// after checkout; for a logged in browser the status, MANAGE, SHOW KEY and LOGOUT. GIFT
// makes gift codes; REDEEM uses one.

import { esc, q, panel, LOADING, metaNote } from './markets.js';
import * as pro from '../pro.js';
import { reloadAfterKey, takeShowKeyOnce } from '../goal.js';
import { findCommand } from '../registry.js';
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
  ['Alerts when the tab is closed', COMING, ''],
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
  'Cancel any time: type PRO and press MANAGE. Pro stays on to the end of the month or year you paid for.',
  SHUTDOWN_LINE,
];
export const YEARLY_NOT_YET = 'Yearly is not available yet. Monthly is.';

// Gifts: the rules in one place, for GIFT and REDEEM.
export const GIFT_RULES = 'Each paid Pro licence can make up to 3 gift codes. A code gives a friend Pro for 30 days, free, with no card, and a seat of their own. A code works once and expires 90 days after it was made if nobody uses it. A gift licence cannot make gift codes.';
export const GIFT_SHOWN_ONCE = 'Copy it now and send it to your friend. We keep only a hash, so it is not shown again.';
export const REDEEM_HOW = 'Type REDEEM followed by the code, like REDEEM GIFT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX. The code never goes in the address bar.';

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
    'To manage billing or cancel: type PRO, then press MANAGE.',
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

// The breakdown: FREE and PRO side by side (stacked on a phone), then the price.
export function offerHtml() {
  return `<div class="money">
    <div class="pro-head"><p class="fx-from">${esc(RULE)}</p>
      <p class="hero num pro-price"><span class="hero-value">${esc(pro.PRICE)}</span><span class="hero-unit">A MONTH</span><span class="hero-unit pro-or">OR</span><span class="hero-value">${esc(pro.PRICE_YEAR)}</span><span class="hero-unit">A YEAR</span></p></div>
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

// The full key, big, with COPY and DOWNLOAD.
function showKey(host, key, ctx, { saved = true } = {}) {
  host.innerHTML = `<div class="pro-key-box">
    <p class="pro-key num" id="pro-key">${esc(key)}</p>
    <p class="pro-actions"><button type="button" class="btn" id="pro-copy">COPY</button> <button type="button" class="btn" id="pro-dl">DOWNLOAD</button></p>
    <p class="notice">${esc(SAVE_LINE)}</p>
    ${saved ? '' : '<p class="muted">This browser could not save it, so copy it now.</p>'}
  </div>`;
  host.querySelector('#pro-copy').addEventListener('click', async () => {
    const ok = await copyText(key);
    ctx.status(ok ? 'KEY COPIED' : 'SELECT THE KEY AND COPY IT', ok ? '' : 'warn');
  });
  host.querySelector('#pro-dl').addEventListener('click', () => {
    download('bloombroke-pro-key.txt', keyFileText(key));
    ctx.status('SAVED BLOOMBROKE-PRO-KEY.TXT');
  });
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

// ---- the PRO page: the seat, big ----------------------------------------------------
// One huge seat number (the next one, or yours), the price with a small yearly/monthly
// switch in it, one button, one live line of our own numbers, three perks, one dim line
// of what is coming, one row of small links, and one dim test-mode line. Everything
// else (FREE vs PRO, the full buying terms, gifts, the footnote) is behind + DETAILS.

export const UP_NEXT = 'UP NEXT';
export const PERKS = ['Your seat number, forever.', 'Your setup on every device.', 'No ads. No trackers.'];
export const TEST_LINE = 'Test mode: no card is charged yet.';
export const GIFT_ACTION = 'GIFT A FRIEND A MONTH';
export const DETAILS_OPEN = '+ DETAILS';
export const DETAILS_CLOSE = '- DETAILS';
export const PLAN_PRICE = { year: `${pro.PRICE_YEAR} a year.`, month: `Or ${pro.PRICE} a month.` };
export const planButton = (plan) => (plan === 'month' ? 'MONTHLY' : 'YEARLY');

const isGift = (st) => st?.status === 'gift' || st?.status === 'gift_ended';
const DOT = '<span class="pro3-dot" aria-hidden="true"> · </span>';
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

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

// The seat itself: YOUR SEAT 00012 or SEAT 00043.
export function seatH2(h) {
  const p = seatParts(h.seat);
  const num = p ? `<span class="pro3-zero">${esc(p.lead)}</span>${esc(p.digits)}` : '<span class="pro3-zero">-----</span>';
  const who = h.mine ? '<span class="pro3-who">YOUR </span>' : '';
  return `<h2 class="pro3-seat num" id="pro-seat" aria-label="${esc(`${h.mine ? 'Your ' : ''}${p ? p.label : 'seat'}`)}">${who}<span class="pro3-word">SEAT </span>${num}</h2>`;
}

// UP NEXT over the next seat; your own seat needs no label.
export function heroHtml(h) {
  return `${h.mine ? '' : `<p class="pro3-kicker">${esc(UP_NEXT)}</p>`}${seatH2(h)}`;
}

// 417 -> '7 min', 40 -> '40 s'.
export function visitLen(sec) {
  return sec < 60 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`;
}

// The one live line, from /api/bbrk only (DataFast, our own site): '70 visitors this week
// · 7 min average visit'. Only the parts that are known; '' when neither is. Never a
// seat count (in test mode those are demo checkouts).
export function proofLine(b) {
  const a = b?.audience || {};
  const parts = [];
  const v = a.visitors?.d7;
  if (Number.isInteger(v) && v > 0) parts.push(`${v.toLocaleString('en-US')} ${v === 1 ? 'visitor' : 'visitors'} this week`);
  if (fin(a.avgVisitSec) && a.avgVisitSec > 0) parts.push(`${visitLen(a.avgVisitSec)} average visit`);
  return parts.join(' · ');
}

// The live line as HTML: each part kept whole, so a phone breaks only between them.
export function proofInner(b) {
  const t = proofLine(b);
  return t ? t.split(' · ').map((x) => `<span class="pro3-part">${esc(x)}</span>`).join(DOT) : '';
}

// The price, with the plan switch in it: the picked plan bright, the other one dim.
function priceHtml(plan) {
  const b = (p) => `<button type="button" class="pro3-plan" id="pro-plan-${p}" data-plan="${p}" aria-pressed="${plan === p}">${esc(PLAN_PRICE[p])}</button>`;
  return `<p class="pro3-price">${b('year')} ${b('month')}</p>`;
}

const buyButton = (label, plan) => `<button type="button" class="pro3-buy" id="pro-sub" data-plan="${plan}" data-label="${esc(label)}">${esc(label)} ${planButton(plan)}</button>`;
const smallLink = (c, label = c) => `<a class="pro3-link" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(label)}</a>`;
const smallBtn = (id, label) => `<button type="button" class="pro3-link" id="${id}">${esc(label)}</button>`;

// The main block. key/st: this browser's licence (none: a visitor). next: the next seat.
// bbrk: /api/bbrk for the live line. note: a notice on top (LOGIN, LOGOUT). has: whether
// a command exists (tests).
export function mainHtml({ key = null, st = null, next = null, bbrk = null, note = '', plan = 'year', has } = {}) {
  const exists = has || ((c) => Boolean(findCommand(c)));
  const on = key ? pro.statusActive(st) : false;
  const gift = isGift(st);
  const n = note ? `<p class="notice pro3-note">${esc(note)}</p>` : '';
  let status = '';
  let price = '';
  let action = '';
  let under = '';
  const links = [];
  if (!key) {
    price = priceHtml(plan);
    action = buyButton('SUBSCRIBE', plan);
    links.push(smallLink('LOGIN'), smallLink('REDEEM'));
    if (exists('GIFT')) links.push(smallLink('GIFT'));
  } else {
    status = `<p class="pro3-status ${on ? 'up' : 'down'}">${esc(statusText(st))}</p>`;
    if (on && gift) under = '<p class="pro3-under">When the gift month ends, you can subscribe on this key and keep its seat.</p>';
    else if (on && st?.canGift) action = `<a class="pro3-buy" href="${esc(q('GIFT'))}" data-cmd="GIFT">${esc(GIFT_ACTION)}</a>`;
    else if (on) action = '<button type="button" class="pro3-buy" id="pro-manage">MANAGE</button>';
    else {
      price = priceHtml(plan);
      action = buyButton(gift ? 'SUBSCRIBE' : 'REACTIVATE', plan);
      under = `<p class="pro3-under">${gift ? 'SUBSCRIBE' : 'REACTIVATE'} keeps this key, its seat and your synced lists.</p>`;
    }
    if (!gift && !action.includes('pro-manage')) links.push(smallBtn('pro-manage', 'MANAGE'));
    links.push(smallBtn('pro-show', 'SHOW KEY'), smallLink('LOGOUT'));
  }
  links.push(`<button type="button" class="pro3-link pro3-more" id="pro-more" aria-expanded="false" aria-controls="pro-details">${esc(DETAILS_OPEN)}</button>`);
  // The live line only where there is something to buy.
  const proof = price ? `<p class="pro3-proof" id="pro-proof">${proofInner(bbrk)}</p>` : '';
  const chat = exists('CHAT') ? smallLink('CHAT') : 'CHAT';
  return `${n}<div class="pro3-top">${heroHtml(heroSeat({ key, st, next }))}${status}${price}</div>
    ${action ? `<p class="pro3-act">${action}</p><p class="pro3-year-note" id="pro-year-note" hidden>${esc(YEARLY_NOT_YET)}</p>` : ''}${under}
    ${proof}
    <ul class="pro3-perks">${PERKS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <p class="pro3-soon">${chat} with Pro friends. Coming: closed-tab alerts.</p>
    <p class="pro3-links">${links.join(DOT)}</p>
    <div id="pro-shown"></div>`;
}

// Behind + DETAILS: the breakdown, the full buying terms, gifts, and the footnote.
export function detailsHtml() {
  return `${offerHtml()}
    <p class="pro-demo" id="pro-demo" role="note" hidden>${esc(DEMO_BANNER)}</p>
    <ul class="pro-terms">${BUY_TERMS.map((t) => `<li>${esc(t)}</li>`).join('')}
      <li>Subscribing means you agree to the <a href="/terms">Terms</a>. Bloombroke gives information only, not investment advice.</li>
      <li>${esc(GIFT_RULES)}</li></ul>
    <p class="footnote">Your key is your login. There is no email or password. ${esc(OPERATOR)} Contact <a href="mailto:${CONTACT}">${CONTACT}</a>. Not financial advice.</p>`;
}

// Per screen: the next seat and /api/bbrk once they arrive, the picked plan.
const views = new WeakMap();
const viewOf = (el) => {
  if (!views.has(el)) views.set(el, { next: null, bbrk: null, plan: 'year' });
  return views.get(el);
};

// The page around the main block. second: the key panel after checkout. The test-mode
// line starts hidden and shows once the server says test mode (page below).
export function pageHtml(second = '') {
  return `<section class="pro3" aria-label="Bloombroke Pro">
    ${second ? `<div class="pro3-second">${second}</div>` : ''}
    <div class="pro3-main" id="pro-account"></div>
    <p class="pro3-fine" id="pro-test" hidden>${esc(TEST_LINE)}</p>
    <div class="pro3-details" id="pro-details" hidden>${detailsHtml()}</div>
  </section>`;
}

function page(el, second = '') {
  el.innerHTML = pageHtml(second);
  // Test mode: say so on the page (dim) and in DETAILS (with the test card).
  pro.getConfig().then((c) => {
    if (c.mode !== 'test' || !el.isConnected) return;
    for (const id of ['#pro-test', '#pro-demo']) { const b = el.querySelector(id); if (b) b.hidden = false; }
  });
}

// + DETAILS opens and closes the rest, in place.
function wireDetails(el) {
  const b = el.querySelector('#pro-more');
  const d = el.querySelector('#pro-details');
  if (!b || !d) return;
  const set = (open) => {
    d.hidden = !open;
    b.setAttribute('aria-expanded', String(open));
    b.textContent = open ? DETAILS_CLOSE : DETAILS_OPEN;
    el.querySelector('.pro3')?.classList.toggle('is-open', open);
  };
  set(!d.hidden);
  b.addEventListener('click', () => {
    set(d.hidden);
    if (!d.hidden) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

// The plan switch: the price parts pick the plan the one button buys.
function setPlan(host, plan) {
  const b = host.querySelector('#pro-sub');
  if (!b) return;
  b.dataset.plan = plan;
  b.textContent = `${b.dataset.label} ${planButton(plan)}`;
  for (const p of host.querySelectorAll('.pro3-plan')) p.setAttribute('aria-pressed', String(p.dataset.plan === plan));
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

function renderAccount(el, ctx, note, plan) {
  const v = viewOf(el);
  if (plan) v.plan = plan;
  const host = el.querySelector('#pro-account');
  host.innerHTML = mainHtml({ key: pro.getKey(), st: pro.getStatus(), next: v.next, bbrk: v.bbrk, note, plan: v.plan });
  wireDetails(el);
  for (const p of host.querySelectorAll('.pro3-plan')) {
    p.addEventListener('click', () => { v.plan = p.dataset.plan; setPlan(host, v.plan); });
  }
  wire(host, ctx, '#pro-sub', 'OPENING CHECKOUT...', () => pro.startCheckout(host.querySelector('#pro-sub').dataset.plan));
  yearlyReady(host, v);
  wire(host, ctx, '#pro-manage', 'OPENING BILLING...', () => pro.openPortal());
  const show = host.querySelector('#pro-show');
  const reveal = () => { showKey(host.querySelector('#pro-shown'), pro.getKey(), ctx); show.remove(); };
  if (show) show.addEventListener('click', reveal);
  // Back from a reload after REDEEM (reloadAfterKey): the new key once more, to save.
  if (show && pro.getKey() && takeShowKeyOnce()) reveal();
}

// The next seat (for a visitor) and our own numbers (for the live line), once each. They
// fill in place; a screen that was redrawn since picks them up from the view.
function loadNumbers(el, ctx) {
  const v = viewOf(el);
  if (!ctx?.fetchJSON) return;
  const opts = { signal: ctx.signal };
  if (!pro.getKey()) {
    ctx.fetchJSON('/api/pro/seat', opts).then((d) => {
      if (!Number.isInteger(d?.next) || !el.isConnected) return;
      v.next = d.next;
      const h = el.querySelector('#pro-seat');
      if (h && !pro.getKey()) h.outerHTML = seatH2(heroSeat({ next: v.next }));
    }).catch(() => {});
  }
  ctx.fetchJSON('/api/bbrk', opts).then((d) => {
    if (!el.isConnected) return;
    v.bbrk = d;
    const p = el.querySelector('#pro-proof');
    if (p) p.innerHTML = proofInner(d);
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
    if (d.reactivated) {
      host.innerHTML = '<p class="notice">Pro is on again, on the same key. Your synced lists are still here.</p>';
      renderAccount(el, ctx);
      ctx.status('PRO: ACTIVE AGAIN');
      return;
    }
    showKey(host, d.key, ctx, { saved: d.saved });
    renderAccount(el, ctx, 'Welcome to Pro. You are logged in on this browser.');
    ctx.status('PRO: ACTIVE. SAVE YOUR KEY');
  }).catch((err) => {
    if (!el.isConnected) return;
    if (err.code === 'expired' || err.code === 'not_found' || err.code === 'bad_session') pro.clearPending();
    const retry = err.code === 'not_paid' || err.code === 'unavailable' || err.code === 'network' || err.code === 'rate_limited';
    host.innerHTML = `<p class="notice">${esc(err.message)}</p>${retry ? '<p class="pro-actions"><button type="button" class="btn" id="pro-retry">TRY AGAIN</button></p>' : ''}`;
    const b = host.querySelector('#pro-retry');
    if (b) b.addEventListener('click', () => claimInto(el, ctx, sessionId));
    ctx.status('PRO: KEY NOT READY', 'warn');
  });
}

export function render(el, cmd, ctx) {
  const pending = pro.pendingCheckout();
  if (pending && cmd.name === 'PRO') {
    page(el, panel('2', 'Your key', '<div id="pro-claim"></div>'));
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

// LOGIN <key>
export const loginCommand = {
  parse: parseLogin,
  render(el, cmd, ctx) {
    page(el);
    loadNumbers(el, ctx);
    const host = el.querySelector('#pro-account');
    if (cmd.args?.gift) { redeemInto(el, ctx, cmd.args.gift); return; }
    if (cmd.error || cmd.args?.show) {
      renderAccount(el, ctx, cmd.error ? 'That does not look like a key. A key looks like BB-XXXX-XXXX-XXXX-XXXX.' : 'Type LOGIN followed by your key, like LOGIN BB-XXXX-XXXX-XXXX-XXXX.');
      ctx.status(cmd.error ? 'LOGIN: CHECK THE KEY' : 'LOGIN: TYPE YOUR KEY', cmd.error ? 'warn' : '');
      return;
    }
    host.innerHTML = LOADING;
    ctx.status('CHECKING YOUR KEY...');
    pro.login(cmd.args.key).then((st) => {
      if (!el.isConnected) return;
      renderAccount(el, ctx, st.active ? 'Logged in. Your watchlist, portfolio and tape now sync.' : 'Logged in, but Pro is not active on this key.');
      ctx.status(st.active ? 'PRO: LOGGED IN' : 'PRO: NOT ACTIVE', st.active ? '' : 'warn');
      reloadAfterKey(); // DataFast was running before the key: stop it now
    }).catch((err) => {
      if (!el.isConnected) return;
      renderAccount(el, ctx, err.message);
      ctx.status('LOGIN FAILED', 'warn');
    });
  },
};

// LOGOUT
export const logoutCommand = {
  render(el, cmd, ctx) {
    const had = Boolean(pro.getKey());
    pro.logout();
    page(el);
    loadNumbers(el, ctx);
    renderAccount(el, ctx, had ? 'Logged out on this browser. Your key still works on any device.' : 'You were not logged in.');
    ctx.status('LOGGED OUT');
  },
};

// ---- REDEEM ------------------------------------------------------------------------------

// Use a gift code on this browser: the new key, big, with COPY and DOWNLOAD.
function redeemInto(el, ctx, code) {
  const host = el.querySelector('#pro-account');
  host.innerHTML = LOADING;
  ctx.status('CHECKING THE GIFT CODE...');
  pro.redeem(code).then((d) => {
    if (!el.isConnected) return;
    host.innerHTML = '<div id="pro-gift-key"></div><div id="pro-gift-account"></div>';
    showKey(host.querySelector('#pro-gift-key'), d.key, ctx, { saved: d.saved });
    const until = d.giftUntil ? day(d.giftUntil) : '--';
    host.querySelector('#pro-gift-account').innerHTML = `<p class="notice">Your gift month of Pro runs until ${esc(until)}. You are logged in on this browser.</p>`;
    ctx.status('PRO: GIFT MONTH ACTIVE. SAVE YOUR KEY');
    reloadAfterKey({ showKey: true }); // DataFast was running before the key: stop it now
  }).catch((err) => {
    if (!el.isConnected) return;
    host.innerHTML = `<p class="notice">${esc(err.message)}</p><p class="muted">${esc(REDEEM_HOW)}</p>`;
    ctx.status(err.code === 'has_key' ? 'REDEEM: LOG OUT FIRST' : 'REDEEM FAILED', 'warn');
  });
}

// REDEEM <code>
export const redeemCommand = {
  parse: parseRedeem,
  render(el, cmd, ctx) {
    page(el);
    if (cmd.args?.code) { redeemInto(el, ctx, cmd.args.code); return; }
    const host = el.querySelector('#pro-account');
    const note = cmd.args?.error ? 'That does not look like a gift code.' : 'Got a gift code? Redeem it here.';
    host.innerHTML = `<p class="notice">${esc(note)}</p><p class="muted">${esc(REDEEM_HOW)}</p><p class="muted">${esc(GIFT_RULES)}</p>`;
    ctx.status(cmd.args?.error ? 'REDEEM: CHECK THE CODE' : 'REDEEM: TYPE THE CODE', cmd.args?.error ? 'warn' : '');
  },
};

// ---- GIFT --------------------------------------------------------------------------------

const GIFT_STATE = { unused: 'UNUSED', redeemed: 'REDEEMED', expired: 'EXPIRED' };

// older: redeemed codes whose records were deleted after 12 months, shown as a count.
export function giftRowsHtml(gifts, fmt = dayYear, older = 0) {
  const note = older > 0 ? `<p class="muted">${older === 1 ? '1 older redeemed code is' : `${older} older redeemed codes are`} no longer listed. ${older === 1 ? 'It still counts' : 'They still count'} toward the 3.</p>` : '';
  if (!gifts.length) return note || '<p class="muted">No gift codes yet.</p>';
  return `<ul class="pro-list">${gifts.map((g) => {
    const when = g.state === 'redeemed' ? `on ${fmt(g.redeemedAt)}` : g.state === 'unused' ? `until ${fmt(g.expiresAt)}` : `on ${fmt(g.expiresAt)}`;
    return `<li class="pro-row"><span class="pro-feat num">${esc(pro.maskGift(g.last4))}</span><span class="pro-tag${g.state === 'unused' ? ' is-live' : ''}">${esc(`${GIFT_STATE[g.state] || '--'} ${when}`)}</span></li>`;
  }).join('')}</ul>${note}`;
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
    host.innerHTML = `${shown ? `<div class="pro-key-box"><p class="pro-key num" id="gift-code">${esc(shown)}</p>
        <p class="pro-actions"><button type="button" class="btn" id="gift-copy">COPY</button></p><p class="notice">${esc(GIFT_SHOWN_ONCE)}</p></div>` : ''}
      ${giftRowsHtml(d.gifts, dayYear, d.older || 0)}
      ${canMake ? `<p class="pro-actions"><button type="button" class="btn btn-solid" id="gift-make">MAKE A GIFT CODE</button></p>` : `<p class="muted">${esc(why)}</p>`}`;
    const meta = el.querySelector('#gift-meta');
    if (meta) meta.innerHTML = metaNote(`${d.left} OF 3 LEFT`);
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
    host.innerHTML = `<p class="notice">${esc(err.message)}</p>`;
    ctx.status('GIFT: NOT AVAILABLE', 'warn');
  });
}

// GIFT: your codes and MAKE A GIFT CODE.
export const giftCommand = {
  render(el, cmd, ctx) {
    el.innerHTML = `<div class="stack">${panel('1', 'Gift a month of Pro', '<div id="gift-body"></div>', { metaId: 'gift-meta' })}
      ${panel('2', 'How gifts work', `<p class="muted">${esc(GIFT_RULES)}</p><p class="muted">Your friend types ${link('REDEEM')} and the code.</p>`)}</div>`;
    if (!pro.getKey()) {
      el.querySelector('#gift-body').innerHTML = `<p class="notice">Gift codes come with an active paid Pro subscription.</p><p class="muted">Type ${link('LOGIN')} with your key, or see ${link('PRO')}.</p>`;
      ctx.status('GIFT: LOG IN FIRST');
      return;
    }
    giftPage(el, ctx);
  },
};
