// PRO, LOGIN, LOGOUT, GIFT and REDEEM: what is free and what is Pro, the price,
// SUBSCRIBE (monthly or yearly), the key after checkout, and for a logged in browser the
// status, the seat, MANAGE and LOGOUT. GIFT makes gift codes; REDEEM uses one.

import { esc, q, panel, LOADING, metaNote } from './markets.js';
import * as pro from '../pro.js';
import { findCommand } from '../registry.js';

// The rule, and the breakdown under it. A row is [what, status, command to open or ''].
export const RULE = 'Free is everything you look at. Pro is your own stuff, plus things that work while you are away.';
export const LIVE = 'LIVE';
export const COMING = 'COMING WHEN PRO LAUNCHES';
export const FREE_ROWS = [
  ['Every screen and chart', LIVE, 'HELP'],
  ['NEWS', LIVE, 'NEWS'],
  ['WEIRD', LIVE, 'WEIRD'],
  ['The WHATIF catalogue', LIVE, 'WHATIF'],
  ['GUESS', LIVE, 'GUESS'],
  ['Alerts while the tab is open', LIVE, 'ALERTS'],
];
export const PRO_ROWS = [
  ['Sync across devices', LIVE, ''],
  ['Saved DESK layouts', LIVE, 'DESK'],
  ['Your own ticker tape', LIVE, 'TAPE'],
  ['A seat number', LIVE, ''],
  ['No sponsor line', LIVE, 'SPONSOR'],
  ['CHAT', COMING, 'CHAT'],
  ['Alerts when the tab is closed', COMING, ''],
  ['WHATIF with your own purchase', COMING, ''],
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

// PRO [YEARLY|MONTHLY]: which plan the buy buttons lead with.
export function parse(args) {
  const w = args[0];
  if (w === 'YEARLY' || w === 'YEAR' || w === 'ANNUAL') return { plan: 'year' };
  if (w === 'MONTHLY' || w === 'MONTH') return { plan: 'month' };
  return {};
}

// REDEEM [code]
export function parseRedeem(args) {
  if (!args.length) return { show: true };
  const code = pro.normalizeGiftCode(args.join(''));
  return code ? { code } : { error: 'format' };
}

const link = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;

// LOGIN [key]. The key may be typed with or without dashes. A gift code pasted here
// redeems it.
export function parseLogin(args) {
  if (!args.length) return { show: true };
  const key = pro.normalizeKey(args.join(''));
  if (key) return { key };
  const gift = pro.normalizeGiftCode(args.join(''));
  return gift ? { gift } : { error: 'format' };
}

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

// Two buttons, monthly and yearly. plan: the one to lead with (PRO YEARLY). The yearly
// button waits for the server config and says so if yearly is not set up.
function buyHtml(label = 'SUBSCRIBE', plan = 'month') {
  const month = `<button type="button" class="btn${plan === 'year' ? '' : ' btn-solid'}" id="pro-sub" data-plan="month">${label} ${esc(pro.PRICE)}/MONTH</button>`;
  const year = `<button type="button" class="btn${plan === 'year' ? ' btn-solid' : ''}" id="pro-sub-year" data-plan="year">${label} ${esc(pro.PRICE_YEAR)}/YEAR</button>`;
  return `<ul class="pro-terms">${BUY_TERMS.map((t) => `<li>${esc(t)}</li>`).join('')}
      <li>Subscribing means you agree to the <a href="/terms">Terms</a>. Bloombroke gives information only, not investment advice.</li></ul>
    <p class="pro-actions">${plan === 'year' ? year + month : month + year}<span class="muted" id="pro-year-note" hidden>${esc(YEARLY_NOT_YET)}</span></p>`;
}

const isGift = (st) => st?.status === 'gift' || st?.status === 'gift_ended';

// The account panel: logged out, or status + seat + MANAGE + LOGOUT.
function accountHtml(note, plan = 'month') {
  const key = pro.getKey();
  const st = pro.getStatus();
  const n = note ? `<p class="notice">${esc(note)}</p>` : '';
  if (!key) {
    return `${n}${buyHtml('SUBSCRIBE', plan)}
      <p class="muted">Already subscribed? Type ${link('LOGIN')} and your key. Got a gift code? Type ${link('REDEEM')} and the code.</p>`;
  }
  const on = pro.statusActive(st);
  const gift = isGift(st);
  const seat = pro.seatLabel(st?.seat);
  let buy = '';
  if (gift && on) buy = '<p class="muted">When the gift month ends, you can subscribe on this key and keep its seat.</p>';
  else if (!on) buy = `${buyHtml(gift ? 'SUBSCRIBE' : 'REACTIVATE', plan)}<p class="muted">${gift ? 'SUBSCRIBE keeps this key, its seat and your synced lists.' : 'REACTIVATE keeps this key, its seat and your synced lists.'}</p>`;
  return `${n}<dl class="stats stats-row pro-stats">
      <div class="stat"><dt>Status</dt><dd class="${on ? 'up' : 'down'}">${esc(statusText(st))}</dd></div>
      <div class="stat"><dt>Key</dt><dd class="num">${esc(maskKey(st?.last4 || key.slice(-4)))}</dd></div>
      <div class="stat"><dt>Seat</dt><dd class="num" id="pro-seat">${esc(seat ? seat.slice(5) : '--')}</dd></div>
    </dl>
    ${buy}
    <p class="pro-actions">
      ${gift ? '' : '<button type="button" class="btn" id="pro-manage">MANAGE</button>'}
      <button type="button" class="btn" id="pro-show">SHOW KEY</button>
      ${st?.canGift ? `<a class="btn" href="${esc(q('GIFT'))}" data-cmd="GIFT">GIFT</a>` : ''}
      <a class="btn" href="${esc(q('LOGOUT'))}" data-cmd="LOGOUT">LOGOUT</a>
    </p>
    <div id="pro-shown"></div>
    ${gift ? '' : '<p class="muted">MANAGE opens Stripe: change your card, get invoices, or cancel.</p>'}`;
}

function page(el, second = '') {
  el.innerHTML = `<p class="pro-demo" id="pro-demo" role="note" hidden>${esc(DEMO_BANNER)}</p><div class="stack">
    ${panel('1', 'Bloombroke Pro', offerHtml(), { meta: metaNote(`${pro.PRICE} A MONTH OR ${pro.PRICE_YEAR} A YEAR`) })}
    ${second}
    ${panel(second ? '3' : '2', 'Your account', '<div id="pro-account"></div>')}
  </div>
  <p class="footnote">Your key is your login. There is no email or password. ${esc(OPERATOR)} Contact <a href="mailto:${CONTACT}">${CONTACT}</a>. Not financial advice.</p>`;
}

// Test mode: say so above everything, so nobody thinks a demo is a real purchase.
function demoBanner(el) {
  pro.getConfig().then((c) => {
    const b = el.querySelector('#pro-demo');
    if (b && c.mode === 'test') b.hidden = false;
  });
}

// The yearly button once the server says whether yearly is set up.
function yearlyReady(host) {
  pro.getConfig().then((c) => {
    const b = host.querySelector('#pro-sub-year');
    if (!b || c.yearly) return;
    b.disabled = true;
    b.title = YEARLY_NOT_YET;
    const n = host.querySelector('#pro-year-note');
    if (n) n.hidden = false;
  });
}

function renderAccount(el, ctx, note, plan = 'month') {
  demoBanner(el);
  const host = el.querySelector('#pro-account');
  host.innerHTML = accountHtml(note, plan);
  wire(host, ctx, '#pro-sub', 'OPENING CHECKOUT...', () => pro.startCheckout('month'));
  wire(host, ctx, '#pro-sub-year', 'OPENING CHECKOUT...', () => pro.startCheckout('year'));
  yearlyReady(host);
  wire(host, ctx, '#pro-manage', 'OPENING BILLING...', () => pro.openPortal());
  const show = host.querySelector('#pro-show');
  if (show) show.addEventListener('click', () => { showKey(host.querySelector('#pro-shown'), pro.getKey(), ctx); show.remove(); });
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
    claimInto(el, ctx, pending);
    // A REACTIVATE checkout: the browser already has a key, so show its fresh status too.
    if (pro.getKey()) pro.refreshStatus().then(() => { if (el.isConnected && !pro.pendingCheckout()) renderAccount(el, ctx); }).catch(() => {});
    return;
  }
  const plan = cmd.args?.plan === 'year' ? 'year' : 'month';
  page(el);
  renderAccount(el, ctx, '', plan);
  ctx.status(pro.isPro() ? 'PRO: ACTIVE' : `PRO: ${pro.PRICE_BOTH.toUpperCase()}`);
  if (pro.getKey()) {
    pro.refreshStatus().then(() => {
      if (!el.isConnected) return;
      renderAccount(el, ctx, '', plan);
      ctx.status(pro.isPro() ? 'PRO: ACTIVE' : 'PRO: NOT ACTIVE. REACTIVATE KEEPS YOUR KEY', pro.isPro() ? '' : 'warn');
    }).catch(() => {});
  }
}

// LOGIN <key>
export const loginCommand = {
  parse: parseLogin,
  render(el, cmd, ctx) {
    page(el);
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

export function giftRowsHtml(gifts, fmt = dayYear) {
  if (!gifts.length) return '<p class="muted">No gift codes yet.</p>';
  return `<ul class="pro-list">${gifts.map((g) => {
    const when = g.state === 'redeemed' ? `on ${fmt(g.redeemedAt)}` : g.state === 'unused' ? `until ${fmt(g.expiresAt)}` : `on ${fmt(g.expiresAt)}`;
    return `<li class="pro-row"><span class="pro-feat num">${esc(pro.maskGift(g.last4))}</span><span class="pro-tag${g.state === 'unused' ? ' is-live' : ''}">${esc(`${GIFT_STATE[g.state] || '--'} ${when}`)}</span></li>`;
  }).join('')}</ul>`;
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
      ${giftRowsHtml(d.gifts)}
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
