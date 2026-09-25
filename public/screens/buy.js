// BUY: "Should I buy it?" Cost per use, hours of work, what the money would grow to,
// and a verdict stamp. WAGE saves an hourly wage in this browser so BUY can show hours.

import { esc, q, fmtNum, panel } from './markets.js';

export const INVEST_RATE = 0.08;
export const UNIT_PER_YEAR = { DAY: 365, WEEK: 52, MONTH: 12, YEAR: 1 };
export const VERDICTS = [
  { max: 2, verdict: 'BUY', line: 'Under $2 a use. Go on.' },
  { max: 10, verdict: 'THINK', line: 'Under $10 a use. Sleep on it.' },
  { max: Infinity, verdict: 'SKIP', line: '$10 or more a use. Walk away.' },
];
const WAGE_KEY = 'bb.wage';

export function verdictFor(costPerUse) {
  return VERDICTS.find((v) => costPerUse < v.max);
}

// Pure maths. You use a thing at least once, so uses never drop below 1.
export function buyMaths({ price, times, unit, years }, { wage = null, rate = INVEST_RATE } = {}) {
  const perYear = times * UNIT_PER_YEAR[unit];
  const uses = Math.max(1, perYear * years);
  const costPerUse = price / uses;
  const hours = Number.isFinite(wage) && wage > 0 ? price / wage : null;
  const invested = price * (1 + rate) ** years;
  const v = verdictFor(costPerUse);
  return { price, times, unit, years, wage: hours === null ? null : wage, perYear, uses, costPerUse, hours, invested, rate, verdict: v.verdict, line: v.line };
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

export function readWage(store) {
  const w = Number(store?.get(WAGE_KEY, null));
  return Number.isFinite(w) && w > 0 ? w : null;
}

const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;
const EXAMPLES = ['BUY 1200', 'BUY 90 3 PER WEEK FOR 2Y', 'BUY 4.50 1 PER DAY FOR 1Y', 'BUY 30000 FOR 8Y'];

function errorView(el, message) {
  el.innerHTML = panel('1', 'Should I buy it?', `
    <p class="notice">${esc(message)}</p>
    <p class="muted">Format: <span class="code">BUY &lt;price&gt; [&lt;n&gt; PER DAY|WEEK|MONTH|YEAR] [FOR &lt;n&gt;Y]</span>. Starts at once a week for 3 years.</p>
    <p class="muted examples">Try ${EXAMPLES.map(code).join(' ')}</p>`, { cls: 'panel-solo' });
}

export function buyHtml(r) {
  const size = fmtMoney(r.costPerUse).length > 12 ? ' is-long' : '';
  const hours = r.hours === null
    ? `<dd class="dim"><span>Type ${code('WAGE 35')} to see hours of work</span></dd>`
    : `<dd class="num">${esc(fmtNum(r.hours, r.hours < 10 ? 1 : 0))} h</dd>`;
  const how = [
    `Uses: ${howOften(r.times, r.unit)} for ${yearsWord(r.years)} is ${plain(r.uses)} uses.`,
    `Cost per use: ${fmtMoney(r.price)} divided by ${plain(r.uses)} uses is ${fmtMoney(r.costPerUse)}.`,
    r.hours === null
      ? 'Hours of work: save your hourly pay with WAGE and BUY divides the price by it.'
      : `Hours of work: ${fmtMoney(r.price)} divided by ${fmtMoney(r.wage)} an hour is ${fmtNum(r.hours, 1)} hours, before tax.`,
    `Invested instead: ${fmtMoney(r.price)} growing ${Math.round(r.rate * 100)}% a year, compounded, for ${yearsWord(r.years)} is ${fmtMoney(r.invested)}. The ${Math.round(r.rate * 100)}% is an assumption, not a promise. Real returns go up and down.`,
    'Verdict: BUY under $2 a use, THINK under $10 a use, SKIP at $10 or more.',
  ];
  return `<div class="buy">
    <div class="buy-main">
      <p class="fx-from"><span class="num">${esc(fmtMoney(r.price))}</span>, used ${esc(howOften(r.times, r.unit))} for ${esc(yearsWord(r.years))}, costs</p>
      <p class="hero num${size}"><span class="hero-value">${esc(fmtMoney(r.costPerUse))}</span><span class="hero-unit">PER USE</span></p>
      <dl class="stats buy-stats">
        <div class="stat"><dt>Total uses</dt><dd class="num">${esc(fmtNum(r.uses, Number.isInteger(r.uses) ? 0 : 1))}</dd></div>
        <div class="stat"><dt>Hours of work</dt>${hours}</div>
        <div class="stat"><dt>If invested instead</dt><dd class="num"><span>${esc(fmtMoney(r.invested))} in ${esc(yearsWord(r.years))} at ${Math.round(r.rate * 100)}%/yr</span></dd></div>
      </dl>
    </div>
    <div class="buy-side">
      <p class="stamp stamp-${r.verdict.toLowerCase()}" role="img" aria-label="Verdict: ${r.verdict}"><span class="stamp-k">VERDICT</span><span class="stamp-v">${r.verdict}</span></p>
      <p class="stamp-line">${esc(r.line)}</p>
      <details class="how">
        <summary>How is this calculated?</summary>
        <ul class="how-list">${how.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      </details>
    </div>
  </div>`;
}

function renderWage(el, cmd, ctx) {
  const { wage, show, clear } = cmd.args;
  if (cmd.error) {
    el.innerHTML = panel('1', 'Wage', `
      <p class="notice">${cmd.error === 'amount' ? 'That wage does not look right.' : 'WAGE needs your hourly pay.'}</p>
      <p class="muted">Format: <span class="code">WAGE &lt;per hour&gt;</span>, like ${code('WAGE 35')}. ${code('WAGE OFF')} forgets it.</p>`, { cls: 'panel-solo' });
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
    <p class="muted">${now === null ? `Type ${code('WAGE 35')} to save one.` : `BUY now shows the hours of work. Try ${code('BUY 1200')}.`} It stays in this browser only.</p>`, { cls: 'panel-solo' });
  ctx.status(now === null ? 'WAGE: NONE SAVED' : `WAGE: ${fmtMoney(now)}/HR`);
}

export function render(el, cmd, ctx) {
  if (cmd.name === 'WAGE') return renderWage(el, cmd, ctx);
  if (cmd.error) {
    const msg = {
      usage: 'BUY needs a price.',
      amount: 'That price does not look right.',
      times: 'How often? Use a number from 1 to 1,000.',
      years: 'For how long? Use 1 to 100 years, like FOR 3Y.',
    }[cmd.error] || 'Check the format.';
    errorView(el, msg);
    ctx.status('BUY: CHECK THE FORMAT', 'warn');
    return;
  }
  const r = buyMaths(cmd.args, { wage: readWage(ctx.store) });
  el.innerHTML = panel('1', 'Should I buy it?', buyHtml(r), {
    cls: 'panel-solo',
    meta: esc(`${fmtMoney(r.price)}  ${plain(r.times)} PER ${r.unit}  ${yearsWord(r.years).toUpperCase()}`),
  }) + '<p class="footnote">A rule of thumb, not financial advice.</p>';
  ctx.status(`BUY: ${r.verdict}`);
}
