// COMPOUND: what regular saving grows to at a steady yearly return, compounded monthly.

import { esc, q, fmtNum, panel, metaNote } from './markets.js';
import { mountLines, legend } from './lines.js';
import { parseMoney, takeYears, compactUsd } from './loan.js';

// COMPOUND [<start>] [<amount>/MO | <amount>/YR] <rate>% <years>Y
export function parse(args) {
  const toks = args.filter((t) => !['AT', 'FOR', 'A', 'AND', 'PLUS', 'INVEST', 'SAVE'].includes(t));
  let start = 0;
  let monthly = 0;
  let yearly = 0;
  let rate = null;
  let years = null;
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    const per = /^(\$?[\d,.]+[KM]?)\/(MO|MON|MONTH|M|YR|YEAR|Y)$/.exec(t);
    const pct = /^(\d+(?:\.\d+)?)%$/.exec(t);
    const y = takeYears(toks, i);
    if (per) {
      const n = parseMoney(per[1]);
      if (!(n > 0)) return { error: 'amount' };
      if (/^(YR|YEAR|Y)$/.test(per[2])) yearly = n; else monthly = n;
      i += 1;
    } else if (pct) {
      rate = Number(pct[1]);
      i += 1;
    } else if (y) {
      years = y.years;
      i += y.used;
    } else if (Number.isFinite(parseMoney(t))) {
      const n = parseMoney(t);
      const next = toks[i + 1];
      if (next === 'MONTHLY' || (next === 'PER' && /^(MONTH|MO)$/.test(toks[i + 2] || ''))) { monthly = n; i += next === 'PER' ? 3 : 2; }
      else if (next === 'YEARLY' || (next === 'PER' && /^(YEAR|YR)$/.test(toks[i + 2] || ''))) { yearly = n; i += next === 'PER' ? 3 : 2; }
      else { if (start) return { error: 'usage' }; start = n; i += 1; }
    } else {
      return { error: 'usage' };
    }
  }
  if (!(start > 0 || monthly > 0 || yearly > 0) || rate === null || years === null) return { error: 'usage' };
  if (!(rate >= 0 && rate <= 50)) return { error: 'rate' };
  if (!(years >= 1 && years <= 80) || years % 1) return { error: 'years' };
  if ([start, monthly, yearly].some((n) => n > 1e10)) return { error: 'amount' };
  return { start, monthly, yearly, rate, years };
}

// Month by month: growth first, then that month's deposit (end of month). Yearly deposits
// land at the end of each 12th month. Returns one row per year, row 0 = the start.
export function growth({ start = 0, monthly = 0, yearly = 0, rate, years }) {
  const r = rate / 100 / 12;
  let balance = start;
  let paid = start;
  const rows = [{ year: 0, balance, paid }];
  for (let m = 1; m <= years * 12; m++) {
    balance = balance * (1 + r) + monthly;
    paid += monthly;
    if (m % 12 === 0) {
      balance += yearly;
      paid += yearly;
      rows.push({ year: m / 12, balance, paid });
    }
  }
  return { final: balance, paid, growth: balance - paid, rows };
}

const usd = (n) => `$${fmtNum(n, 0)}`;

function usage(kind) {
  const ex = ['COMPOUND 500/MO 8% 30Y', 'COMPOUND 10000 7% 20Y', 'COMPOUND 5000 200/MO 6% 10Y'];
  const title = kind === 'rate' ? 'Pick a yearly return from 0% to 50%.' : kind === 'years' ? 'Pick a whole number of years, 1 to 80.' : kind === 'amount' ? 'That amount does not look right.' : 'COMPOUND needs money, a yearly return and years.';
  return `<p class="notice">${esc(title)}</p>
    <p class="muted">Format: <span class="code">COMPOUND [start] [&lt;amount&gt;/MO] &lt;rate&gt;% &lt;years&gt;Y</span></p>
    <p class="muted examples">Try ${ex.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ')}</p>`;
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Compound', usage(cmd.error), { cls: 'panel-solo' });
    ctx.status('COMPOUND: CHECK THE FORMAT', 'warn');
    return;
  }
  const a = cmd.args;
  const res = growth(a);
  const heroText = usd(res.final);
  const what = [
    a.start ? `${usd(a.start)} now` : '',
    a.monthly ? `${usd(a.monthly)} a month` : '',
    a.yearly ? `${usd(a.yearly)} a year` : '',
  ].filter(Boolean).join(' plus ');
  const step = a.years > 40 ? 10 : 5;
  const tableRows = res.rows.filter((r) => r.year > 0 && (r.year % step === 0 || r.year === a.years));
  el.innerHTML = `<div class="stack">
    ${panel('1', 'Compound', `<div class="money">
      <p class="fx-from">${esc(what)} for ${a.years} years at <span class="num">${esc(fmtNum(a.rate, a.rate % 1 ? 2 : 0))}%</span> a year grows to</p>
      <p class="hero num${heroText.length > 18 ? ' is-xlong' : heroText.length > 13 ? ' is-long' : ''}"><span class="hero-value up">${esc(heroText)}</span></p>
      <dl class="stats stats-row">
        <div class="stat"><dt>You put in</dt><dd class="num">${esc(usd(res.paid))}</dd></div>
        <div class="stat"><dt>Growth</dt><dd class="num up">${esc(usd(res.growth))}</dd></div>
        <div class="stat"><dt>Growth share</dt><dd class="num">${res.final > 0 ? esc(fmtNum((res.growth / res.final) * 100, 1)) : '0.0'}%</dd></div>
        <div class="stat"><dt>Multiple</dt><dd class="num">${res.paid > 0 ? esc(fmtNum(res.final / res.paid, 2)) : '--'}x</dd></div>
      </dl>
    </div>`, { meta: `COMPOUNDED MONTHLY · ${metaNote('YOUR RATE, NOT A FORECAST · BEFORE TAX, FEES AND INFLATION', 'The return is your assumption, not a forecast. Real markets go up and down and there are no guarantees.')}` })}
    <div class="chart-by-year">
    ${panel('2', 'Growth', `<div class="chart-host" id="cp-g-chart"></div><div id="cp-g-legend"></div>`, { metaId: 'cp-g-meta', bodyCls: 'flush' })}
    ${panel('3', 'By year', `<table class="grid-table">
      <thead><tr><th scope="col">Year</th><th scope="col" class="num">Put in</th><th scope="col" class="num">Growth</th><th scope="col" class="num">Balance</th></tr></thead>
      <tbody>${tableRows.map((r) => `<tr><th scope="row" class="name">${r.year}</th><td class="num dim">${esc(usd(r.paid))}</td><td class="num up">${esc(usd(r.balance - r.paid))}</td><td class="num last">${esc(usd(r.balance))}</td></tr>`).join('')}</tbody>
    </table>`, { cls: 'by-year', bodyCls: 'flush' })}
    </div>
  </div>`;
  const series = [
    { id: 'bal', cls: 'ln-0', label: 'Balance', points: res.rows.map((r) => ({ x: r.year, y: r.balance })) },
    { id: 'paid', cls: 'ln-4', label: 'Money put in', points: res.rows.map((r) => ({ x: r.year, y: r.paid })) },
  ];
  el.querySelector('#cp-g-legend').innerHTML = legend(series);
  const meta = el.querySelector('#cp-g-meta');
  ctx.onCleanup(mountLines(el.querySelector('#cp-g-chart'), series, {
    fmtY: (v) => `$${compactUsd(v)}`, fmtX: (x) => `Y${x}`, label: 'Balance and money put in by year',
    onHover(h) { meta.innerHTML = h ? `<span class="num">YEAR ${h.x}: ${h.values.map((v) => esc(usd(v.y))).join(' / ')}</span>` : ''; },
  }));
  ctx.status(`COMPOUND: ${heroText} AFTER ${a.years} YEARS`);
}
