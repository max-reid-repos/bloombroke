// AFFORD: "Can I afford it?" For things people buy (a bike, a laptop), never investments.
// Cost per use, hours of work, what the money would grow to at an assumed rate, and a
// verdict stamp. WAGE saves an hourly wage in this browser so AFFORD can show hours.
// (The command was called BUY until September 2026.)

import { esc, q, fmtNum, panel } from './markets.js';
import { AFFORD_EXAMPLE } from '../afford.js';
import { usageCard } from '../kit.js';

export const INVEST_RATE = 0.08;
export const TITLE = 'Can I afford it?';
export const NOT_INVESTMENTS = 'AFFORD is for things you buy, like a bike or a laptop. It does not assess investments.';
export const UNIT_PER_YEAR = { DAY: 365, WEEK: 52, MONTH: 12, YEAR: 1 };
export const VERDICTS = [
  { max: 2, key: 'worth', verdict: 'WORTH IT', line: 'Under $2 a use. Go on.' },
  { max: 10, key: 'sleep', verdict: 'SLEEP ON IT', line: 'Under $10 a use. Think it over.' },
  { max: Infinity, key: 'skip', verdict: 'SKIP IT', line: '$10 or more a use. Walk away.' },
];
const WAGE_KEY = 'bb.wage';

export function verdictFor(costPerUse) {
  return VERDICTS.find((v) => costPerUse < v.max);
}

// Pure maths. You use a thing at least once, so uses never drop below 1.
export function buyMaths({ price, times, unit, years, label }, { wage = null, rate = INVEST_RATE } = {}) {
  const perYear = times * UNIT_PER_YEAR[unit];
  const uses = Math.max(1, perYear * years);
  const costPerUse = price / uses;
  const hours = Number.isFinite(wage) && wage > 0 ? price / wage : null;
  const invested = price * (1 + rate) ** years;
  const v = verdictFor(costPerUse);
  return { ...(label ? { label } : {}), price, times, unit, years, wage: hours === null ? null : wage, perYear, uses, costPerUse, hours, invested, rate, verdict: v.verdict, verdictKey: v.key, line: v.line };
}

// $7.69, $1,512, $0.0312: cents for small sums, whole dollars from $1,000.
export function fmtMoney(n) {
  if (!Number.isFinite(n)) return '--';
  const a = Math.abs(n);
  const d = a >= 1000 ? 0 : a >= 0.1 || a === 0 ? 2 : 4;
  return (n < 0 ? '−' : '') + '$' + a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const plain = (n) => Number(n.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 });
const unitWord = (u) => u.toLowerCase();
export function howOften(times, unit) {
  if (times === 1) return `once a ${unitWord(unit)}`;
  if (times === 2) return `twice a ${unitWord(unit)}`;
  return `${plain(times)} times a ${unitWord(unit)}`;
}
export function yearsWord(years) {
  return years === 1 ? '1 year' : `${plain(years)} years`;
}

const tokensOf = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

export function readWage(store) {
  const w = Number(store?.get(WAGE_KEY, null));
  return Number.isFinite(w) && w > 0 ? w : null;
}

const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;
const EXAMPLES = ['AFFORD 1200', 'AFFORD 1200 BIKE 2 PER WEEK', 'AFFORD 90 3 TIMES A MONTH FOR 2Y', 'AFFORD 4.50 1 PER DAY FOR 1Y', 'AFFORD 30000 FOR 8Y'];

// A command typed wrong: the kit's usage card. The first sentence of the message is the
// problem; the rest, the other examples and the default go in + Details. withFormat:
// false when the words were fine but the thing is not (an investment).
export const AFFORD_FORMAT = 'AFFORD price [thing] [n PER DAY] [FOR nY]';
export const AFFORD_GRAMMAR = 'AFFORD <price> [<thing>] [<n> PER DAY|WEEK|MONTH|YEAR] [FOR <n>Y]';
export function affordUsage(message, { withFormat = true } = {}) {
  const [problem, ...rest] = String(message).split(/(?<=[.?]) /);
  return usageCard({
    problem,
    format: withFormat ? AFFORD_FORMAT : '',
    grammar: AFFORD_GRAMMAR,
    example: EXAMPLES[0],
    more: [AFFORD_EXAMPLE, ...EXAMPLES.slice(1)],
    notes: [rest.join(' '), 'Starts at once a week for 3 years.'],
  });
}

function errorView(el, message, opts) {
  el.innerHTML = panel('1', TITLE, affordUsage(message, opts), { cls: 'panel-solo' });
}

// The hourly pay typed in AFFORD's own field: "35", "$35", "1,200.50". Same limits as
// WAGE <per hour>. Returns the number, or null.
export function readWageInput(text) {
  const s = String(text ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null;
}

// The share row: a link to this exact AFFORD, on X or copied.
export function affordShare(r, input, origin) {
  const url = `${origin}/${q(input)}`;
  const text = `${r.label ? `${r.label}, ` : ''}${fmtMoney(r.price)}, used ${howOften(r.times, r.unit)} for ${yearsWord(r.years)}: ${fmtMoney(r.costPerUse)} per use. Verdict: ${r.verdict}.`;
  return `<div class="wi-share buy-share">
      <a class="wi-btn" href="${esc(`https://x.com/intent/post?${new URLSearchParams({ text, url })}`)}" target="_blank" rel="noopener noreferrer">SHARE ON X</a>
      <button type="button" class="wi-btn" data-copy="${esc(url)}">COPY LINK</button>
    </div>`;
}

export function buyHtml(r, share = '') {
  const size = fmtMoney(r.costPerUse).length > 12 ? ' is-long' : '';
  // No wage saved: a field for it right here, not a command to go and type.
  const hours = r.hours === null
    ? `<dd><form class="add-form wage-form" data-own-focus autocomplete="off"><input class="add-in add-num" name="wage" type="text" inputmode="decimal" maxlength="12" placeholder="Hourly pay" aria-label="Your hourly pay, USD, to see hours of work"><button type="submit" class="chip add-btn">SHOW HOURS</button></form></dd>`
    : `<dd class="num">${esc(fmtNum(r.hours, r.hours < 10 ? 1 : 0))} h</dd>`;
  const how = [
    `Uses: ${howOften(r.times, r.unit)} for ${yearsWord(r.years)} is ${plain(r.uses)} uses.`,
    `Cost per use: ${fmtMoney(r.price)} divided by ${plain(r.uses)} uses is ${fmtMoney(r.costPerUse)}.`,
    r.hours === null
      ? 'Hours of work: save your hourly pay with WAGE and AFFORD divides the price by it.'
      : `Hours of work: ${fmtMoney(r.price)} divided by ${fmtMoney(r.wage)} an hour is ${fmtNum(r.hours, 1)} hours, before tax.`,
    `Invested instead: ${fmtMoney(r.price)} growing ${Math.round(r.rate * 100)}% a year, compounded, for ${yearsWord(r.years)} is ${fmtMoney(r.invested)}. The ${Math.round(r.rate * 100)}% is an assumption, not a forecast or a promise. Real returns go up and down.`,
    'Verdict: WORTH IT under $2 a use, SLEEP ON IT under $10 a use, SKIP IT at $10 or more. A rule of thumb for things you buy, not investments.',
  ];
  return `<div class="buy">
    <div class="buy-main">
      <p class="fx-from">${r.label ? `${esc(r.label)}: ` : ''}<span class="num">${esc(fmtMoney(r.price))}</span>, used ${esc(howOften(r.times, r.unit))} for ${esc(yearsWord(r.years))}, costs</p>
      <p class="hero num${size}"><span class="hero-value">${esc(fmtMoney(r.costPerUse))}</span><span class="hero-unit">PER USE</span></p>
      <dl class="stats buy-stats">
        <div class="stat"><dt>Total uses</dt><dd class="num">${esc(fmtNum(r.uses, Number.isInteger(r.uses) ? 0 : 1))}</dd></div>
        <div class="stat"><dt>Hours of work</dt>${hours}</div>
        <div class="stat"><dt>If invested instead</dt><dd class="num"><span>${esc(fmtMoney(r.invested))} in ${esc(yearsWord(r.years))} at ${Math.round(r.rate * 100)}%/yr</span></dd></div>
      </dl>
    </div>
    <div class="buy-side">
      <p class="stamp stamp-${r.verdictKey}" role="img" aria-label="Verdict: ${r.verdict}"><span class="stamp-k">VERDICT</span><span class="stamp-v">${r.verdict}</span></p>
      <p class="stamp-line">${esc(r.line)}</p>
      <details class="how">
        <summary>How is this calculated?</summary>
        <ul class="how-list">${how.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      </details>
    </div>
  </div>
  ${share}`;
}

// WAGE typed wrong: the kit's usage card. WAGE 35 saves a wage, so a click puts it in the
// command bar (kit.js data-example); WAGE OFF, in + Details, too.
export function wageUsage(error) {
  return usageCard({
    problem: error === 'amount' ? 'That wage does not look right.' : 'WAGE needs your hourly pay.',
    format: 'WAGE hourly-pay', grammar: 'WAGE <per hour>', example: 'WAGE 35', more: ['WAGE OFF'],
    notes: ['WAGE OFF forgets it. It stays in this browser only.'],
  });
}

function renderWage(el, cmd, ctx) {
  const { wage, show, clear } = cmd.args;
  if (cmd.error) {
    el.innerHTML = panel('1', 'Wage', wageUsage(cmd.error), { cls: 'panel-solo' });
    ctx.status('WAGE: CHECK THE FORMAT', 'warn');
    return;
  }
  if (clear) ctx.store.set(WAGE_KEY, null);
  else if (!show) ctx.store.set(WAGE_KEY, wage);
  const now = readWage(ctx.store);
  const msg = now === null
    ? (clear ? 'Wage cleared.' : 'No wage saved yet.')
    : `${show ? 'Your wage' : 'Saved'}: ${fmtMoney(now)} an hour.`;
  el.innerHTML = panel('1', 'Wage', `
    <p class="notice">${esc(msg)}</p>
    <p class="muted">${now === null ? `Type ${code('WAGE 35')} to save one.` : `AFFORD now shows the hours of work. Try ${code('AFFORD 1200')}.`} It stays in this browser only.</p>`, { cls: 'panel-solo' });
  ctx.status(now === null ? 'WAGE: NONE SAVED' : `WAGE: ${fmtMoney(now)}/HR`);
}

export function render(el, cmd, ctx) {
  if (cmd.name === 'WAGE') return renderWage(el, cmd, ctx);
  if (cmd.error) {
    const bare = tokensOf(cmd.input).length <= 1;
    const msg = {
      usage: bare ? 'AFFORD needs a price.' : 'AFFORD could not read that.',
      investment: NOT_INVESTMENTS,
      amount: 'That price does not look right.',
      times: 'How often? Use a number from 1 to 1,000.',
      years: 'For how long? Use 1 to 100 years, like FOR 3Y.',
    }[cmd.error] || 'Check the format.';
    errorView(el, msg, { withFormat: cmd.error !== 'investment' });
    ctx.status(cmd.error === 'investment' ? 'AFFORD: THINGS YOU BUY, NOT INVESTMENTS' : 'AFFORD: CHECK THE FORMAT', 'warn');
    return;
  }
  const r = buyMaths(cmd.args, { wage: readWage(ctx.store) });
  const origin = typeof location !== 'undefined' ? location.origin : '';
  el.innerHTML = panel('1', TITLE, buyHtml(r, affordShare(r, cmd.input, origin)), {
    cls: 'panel-solo',
    meta: esc(`${r.label ? `${r.label.toUpperCase()}  ` : ''}${fmtMoney(r.price)}  ${plain(r.times)} PER ${r.unit}  ${yearsWord(r.years).toUpperCase()}`),
  });
  el.querySelector('.wage-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const wage = readWageInput(e.currentTarget.elements.wage.value);
    if (wage === null) { ctx.status('TYPE YOUR HOURLY PAY, LIKE 35', 'warn'); return; }
    ctx.store.set(WAGE_KEY, wage);
    render(el, cmd, ctx);
    ctx.status(`WAGE SAVED: ${fmtMoney(wage)}/HR. WAGE OFF FORGETS IT`);
  });
  el.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
    const ok = await ctx.copy(e.currentTarget.dataset.copy);
    ctx.status(ok ? 'LINK COPIED' : 'COPY THE LINK FROM THE ADDRESS BAR', ok ? '' : 'warn');
  });
  ctx.status(`AFFORD: ${r.verdict}`);
}
