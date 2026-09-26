// PRO, LOGIN and LOGOUT: what Pro gives, the price, SUBSCRIBE, the key after checkout,
// and for a logged in browser the status, MANAGE and LOGOUT.

import { esc, q, panel, LOADING } from './markets.js';
import * as pro from '../pro.js';

export const FEATURES = [
  ['Your own ticker tape', 'Put any ticker on the tape at the bottom: TAPE ADD AAPL.'],
  ['Sync across devices', 'Your watchlist, portfolio and tape follow your key to any browser.'],
];
export const COMING_NEXT = 'Coming next: price alerts. Not part of Pro yet.';

export const SAVE_LINE = 'Save this key. It is your login on any device.';
export const OPERATOR = 'Run by Bloombroke.';
export const CONTACT = 'hello@bloombroke.com';
export const SHUTDOWN_LINE = 'If we ever shut Bloombroke down, we cancel all subscriptions and refund the unused part of the current month.';

export const EXPERIMENTAL_LINE = 'Bloombroke is an experimental project and may be discontinued at short notice. If it is, we cancel your subscription and refund the unused days.';
export const DEMO_BANNER = 'Demo checkout. No real money. Use card 4242 4242 4242 4242, any future date, any CVC.';

// Shown before every SUBSCRIBE button: price, renewal, how to cancel, the shutdown promise.
export const BUY_TERMS = [
  EXPERIMENTAL_LINE,
  `${pro.PRICE} USD a month, charged by Stripe. It renews automatically every month until you cancel.`,
  'Cancel any time: type PRO and press MANAGE. Pro stays on to the end of the month you paid for.',
  SHUTDOWN_LINE,
];

const link = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;

// LOGIN [key]. The key may be typed with or without dashes.
export function parseLogin(args) {
  if (!args.length) return { show: true };
  const key = pro.normalizeKey(args.join(''));
  return key ? { key } : { error: 'format' };
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

export function statusText(st, now = Date.now()) {
  if (!st) return 'NOT LOGGED IN';
  if (st.status === 'active' || st.status === 'trialing') {
    const end = st.cancelAt || (st.cancelAtPeriodEnd ? st.currentPeriodEnd : null);
    if (end) return `Active until ${day(end)} (cancelled, will not renew)`;
    if (st.currentPeriodEnd) return `Renews ${day(st.currentPeriodEnd)}`;
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

function offerHtml() {
  const rows = FEATURES.map(([name, text]) => `<li class="pro-row"><span class="pro-feat">${esc(name)}</span><span class="pro-text">${esc(text)}</span></li>`).join('');
  return `<div class="money">
    <p class="fx-from">The terminal stays free. Pro adds:</p>
    <ul class="pro-list">${rows}</ul>
    <p class="muted">${esc(COMING_NEXT)}</p>
    <p class="hero num"><span class="hero-value">${esc(pro.PRICE)}</span><span class="hero-unit">A MONTH</span></p>
    <p class="fx-to dim">Billed monthly in US dollars. Renews automatically. Cancel any time.</p>
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

function buyHtml(label = 'SUBSCRIBE') {
  return `<ul class="pro-terms">${BUY_TERMS.map((t) => `<li>${esc(t)}</li>`).join('')}
      <li>Subscribing means you agree to the <a href="/terms">Terms</a>. Bloombroke gives information only, not investment advice.</li></ul>
    <p class="pro-actions"><button type="button" class="btn btn-solid" id="pro-sub">${label} ${esc(pro.PRICE)}/MONTH</button></p>`;
}

// The account panel: logged out, or status + MANAGE + LOGOUT.
function accountHtml(note) {
  const key = pro.getKey();
  const st = pro.getStatus();
  const n = note ? `<p class="notice">${esc(note)}</p>` : '';
  if (!key) {
    return `${n}${buyHtml()}
      <p class="muted">Already subscribed? Type ${link('LOGIN')} and your key.</p>`;
  }
  const on = pro.statusActive(st);
  return `${n}<dl class="stats stats-row pro-stats">
      <div class="stat"><dt>Status</dt><dd class="${on ? 'up' : 'down'}">${esc(statusText(st))}</dd></div>
      <div class="stat"><dt>Key</dt><dd class="num">${esc(maskKey(st?.last4 || key.slice(-4)))}</dd></div>
    </dl>
    ${on ? '' : `${buyHtml('REACTIVATE')}<p class="muted">REACTIVATE keeps this key and your synced lists.</p>`}
    <p class="pro-actions">
      <button type="button" class="btn" id="pro-manage">MANAGE</button>
      <button type="button" class="btn" id="pro-show">SHOW KEY</button>
      <a class="btn" href="${esc(q('LOGOUT'))}" data-cmd="LOGOUT">LOGOUT</a>
    </p>
    <div id="pro-shown"></div>
    <p class="muted">MANAGE opens Stripe: change your card, get invoices, or cancel.</p>`;
}

function page(el, second = '') {
  el.innerHTML = `<p class="pro-demo" id="pro-demo" role="note" hidden>${esc(DEMO_BANNER)}</p><div class="stack">
    ${panel('1', 'Bloombroke Pro', offerHtml(), { meta: `${esc(pro.PRICE)} / MONTH` })}
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

function renderAccount(el, ctx, note) {
  demoBanner(el);
  const host = el.querySelector('#pro-account');
  host.innerHTML = accountHtml(note);
  wire(host, ctx, '#pro-sub', 'OPENING CHECKOUT...', () => pro.startCheckout());
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
  page(el);
  renderAccount(el, ctx);
  ctx.status(pro.isPro() ? 'PRO: ACTIVE' : `PRO: ${pro.PRICE_LINE.toUpperCase()}`);
  if (pro.getKey()) {
    pro.refreshStatus().then(() => {
      if (!el.isConnected) return;
      renderAccount(el, ctx);
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
