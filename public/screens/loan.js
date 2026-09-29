// LOAN: monthly payment and total interest on a fixed-rate loan.
// Without a rate it uses this week's average 30-year fixed mortgage rate (Freddie Mac, via RATES).

import { esc, fmtNum, panel, metaNote, LOADING } from './markets.js';
import { mountLines, legend } from './lines.js';
import { usageCard } from '../kit.js';
import { MAX_LOAN, parseMoney, takeYears, parseLoan as parse } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { MAX_LOAN, parseMoney, takeYears, parse };

// The standard fixed-rate payment: P r / (1 - (1 + r)^-n), monthly.
export function monthlyPayment(principal, annualRate, years) {
  const n = Math.round(years * 12);
  const r = annualRate / 100 / 12;
  if (n <= 0) return NaN;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - (1 + r) ** -n);
}

// Month by month. Returns the payment, totals and one row per year.
export function amortize(principal, annualRate, years) {
  const pay = monthlyPayment(principal, annualRate, years);
  const r = annualRate / 100 / 12;
  const n = Math.round(years * 12);
  let balance = principal;
  let totalInterest = 0;
  let yi = 0;
  let yp = 0;
  const rows = [];
  for (let m = 1; m <= n; m++) {
    const interest = balance * r;
    let princ = pay - interest;
    if (m === n || princ > balance) princ = balance; // last payment clears rounding dust
    balance -= princ;
    totalInterest += interest;
    yi += interest;
    yp += princ;
    if (m % 12 === 0 || m === n) {
      rows.push({ year: Math.ceil(m / 12), principal: yp, interest: yi, balance: Math.max(0, balance), interestToDate: totalInterest });
      yi = 0;
      yp = 0;
    }
  }
  return { payment: pay, totalInterest, totalPaid: principal + totalInterest, rows };
}

const usd = (n, d = 0) => `$${fmtNum(n, d)}`;

// A command typed wrong: the kit's usage card.
export function usage(kind) {
  const ex = ['LOAN 400000 30Y', 'LOAN 400000 30Y 6.5%', 'LOAN 25000 5Y 7.9%'];
  const title = kind === 'amount' ? 'That amount does not look right.' : kind === 'years' ? 'Pick a term from 1 to 50 years.' : kind === 'rate' ? 'Pick a rate from 0% to 30%.' : 'LOAN needs an amount.';
  return usageCard({
    problem: title,
    format: 'LOAN <amount> [<years>Y] [<rate>%]',
    example: ex[0],
    more: ex.slice(1),
    notes: ["No rate: today's average 30-year mortgage rate."],
  });
}

// Today's rate did not load: the same card, with your amount and term and a rate of your own.
export function noRateHtml(a) {
  const base = `LOAN ${a.amount} ${a.years}Y`;
  return usageCard({ problem: "Today's mortgage rate did not load.", format: `${base} <rate>%`, example: `${base} 6.5%`, notes: ['Add your own rate at the end.'] });
}

function show(el, ctx, a, rate, source) {
  const res = amortize(a.amount, rate, a.years);
  const payText = usd(res.payment, 2);
  el.innerHTML = `<div class="stack">
    ${panel('1', 'Loan', `<div class="money">
      <p class="fx-from"><span class="num">${esc(usd(a.amount))}</span> over ${esc(fmtNum(a.years, a.years % 1 ? 1 : 0))} years at <span class="num">${esc(fmtNum(rate, 2))}%</span></p>
      <p class="hero num${payText.length > 13 ? ' is-long' : ''}"><span class="hero-value">${esc(payText)}</span><span class="hero-unit">A MONTH</span></p>
      <p class="fx-to dim">${esc(source)}</p>
      <dl class="stats stats-row">
        <div class="stat"><dt>Total interest</dt><dd class="num down">${esc(usd(res.totalInterest))}</dd></div>
        <div class="stat"><dt>Total paid</dt><dd class="num">${esc(usd(res.totalPaid))}</dd></div>
        <div class="stat"><dt>Interest share</dt><dd class="num">${esc(fmtNum((res.totalInterest / res.totalPaid) * 100, 1))}%</dd></div>
        <div class="stat"><dt>Payments</dt><dd class="num">${Math.round(a.years * 12)}</dd></div>
      </dl>
    </div>`, { meta: `FIXED RATE, MONTHLY · ${metaNote('PRINCIPAL AND INTEREST ONLY, NO TAX, INSURANCE OR FEES')}` })}
    <div class="chart-by-year">
    ${panel('2', 'Balance and interest paid', `<div class="chart-host" id="ln-chart"></div><div id="ln-legend"></div>`, { metaId: 'ln-meta', bodyCls: 'flush' })}
    ${panel('3', 'By year', `<table class="grid-table loan-table">
      <thead><tr><th scope="col">Year</th><th scope="col" class="num">Principal</th><th scope="col" class="num">Interest</th><th scope="col" class="num">Balance</th></tr></thead>
      <tbody>${res.rows.map((r) => `<tr><th scope="row" class="name">${r.year}</th><td class="num">${esc(usd(r.principal))}</td><td class="num dim">${esc(usd(r.interest))}</td><td class="num last">${esc(usd(r.balance))}</td></tr>`).join('')}</tbody>
    </table>`, { cls: 'by-year', bodyCls: 'flush' })}
    </div>
  </div>`;
  const series = [
    { id: 'bal', cls: 'ln-0', label: 'Balance left', points: [{ x: 0, y: a.amount }, ...res.rows.map((r) => ({ x: r.year, y: r.balance }))] },
    { id: 'int', cls: 'ln-2', label: 'Interest paid so far', points: [{ x: 0, y: 0 }, ...res.rows.map((r) => ({ x: r.year, y: r.interestToDate }))] },
  ];
  el.querySelector('#ln-legend').innerHTML = legend(series);
  const meta = el.querySelector('#ln-meta');
  const cleanup = mountLines(el.querySelector('#ln-chart'), series, {
    fmtY: (v) => `$${compactUsd(v)}`, fmtX: (x) => `Y${x}`, label: 'Loan balance and interest by year',
    onHover(h) { meta.innerHTML = h ? `<span class="num">YEAR ${h.x}: ${h.values.map((v) => esc(usd(v.y))).join(' / ')}</span>` : ''; },
  });
  ctx.onCleanup(cleanup);
}

export function compactUsd(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${fmtNum(v / 1e6, a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${fmtNum(v / 1e3, 0)}K`;
  return fmtNum(v, 0);
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Loan', usage(cmd.error), { cls: 'panel-solo' });
    ctx.status('LOAN: CHECK THE FORMAT', 'warn');
    return;
  }
  const a = cmd.args;
  if (a.rate !== null) {
    show(el, ctx, a, a.rate, 'Rate you gave');
    ctx.status('LOAN: YOUR RATE');
    return;
  }
  el.innerHTML = panel('1', 'Loan', LOADING, { cls: 'panel-solo' });
  ctx.fetchJSON('/api/rates', { signal: ctx.signal }).then((d) => {
    const m = d.mortgage;
    if (!m || !Number.isFinite(m.rate30)) throw new Error('no mortgage rate');
    const day = new Date(`${m.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
    show(el, ctx, a, m.rate30, `Average 30-year fixed mortgage rate, weekly national survey, week of ${day}`);
    ctx.updated(d.mortgageUpdated || d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    el.innerHTML = panel('1', 'Loan', noRateHtml(a), { cls: 'panel-solo' });
    ctx.status('LOAN: NO RATE DATA', 'warn');
  });
}
