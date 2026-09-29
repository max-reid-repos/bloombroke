// CPI: what money from a past year is worth today, from the US consumer price index.
// The answer is a card page (kit.js cardPage) in the first panel: the value today big,
// one line of what was asked, how much prices moved, and the index numbers as facts.

import { esc, fmtNum, panel, LOADING } from './markets.js';
import { mountChart } from './quote.js';
import { toolbar, usageCard, cardPage } from '../kit.js';
import { flipAmount } from './fx.js';

const EXAMPLES = ['CPI 100 2015', 'CPI 1000 1990', 'CPI 20 1970'];

export function fmtUsd(n) {
  if (!Number.isFinite(n)) return '--';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The row under the title: an amount and a year, so a new question needs no retyping.
export function cpiForm({ amount, year }) {
  return `<form class="fx-form cpi-form" autocomplete="off">
    <span class="dim">$</span><input class="field-input fx-amt num" name="amount" value="${esc(flipAmount(amount))}" inputmode="decimal" maxlength="16" spellcheck="false" aria-label="Amount in dollars">
    <span class="dim">IN</span><input class="field-input fx-year num" name="year" value="${esc(year)}" inputmode="numeric" maxlength="4" size="4" spellcheck="false" aria-label="Year">
    <button type="submit" class="chip">GO</button>
  </form>`;
}

// The CPI command for the form, or null when a field is not right.
export function cpiFormCommand(amount, year, thisYear = new Date().getUTCFullYear()) {
  const n = Number(String(amount ?? '').replace(/[$,\s]/g, ''));
  const y = Number(String(year ?? '').trim());
  if (!(n > 0) || n > 1e12 || !Number.isInteger(y) || y < 1913 || y > thisYear) return null;
  return `CPI ${flipAmount(n)} ${y}`;
}

// A command typed wrong, or a year with no data: the kit's usage card. The first
// sentence is the problem; the rest goes in + Details.
export function cpiUsage(message) {
  const [problem, ...rest] = String(message).split(/(?<=[.?]) /);
  return usageCard({
    problem,
    format: 'CPI [amount] year',
    grammar: 'CPI <amount> <year>',
    example: EXAMPLES[0],
    more: EXAMPLES.slice(1),
    notes: [rest.join(' '), 'The amount is optional and starts at $100.'],
  });
}

function errorView(el, message) {
  el.innerHTML = panel('1', 'CPI', cpiUsage(message), { cls: 'panel-solo' });
}

// The answer (GET /api/cpi): the value today (hero), what was asked (sub), how much prices
// moved (note), and the four index facts.
export function cpiResultHtml(d) {
  const hero = fmtUsd(d.result);
  const dirWord = d.pct >= 0 ? 'up' : 'down';
  return cardPage({
    cls: 'cpi-card', label: `CPI ${d.year}`,
    hero, heroSize: hero.length <= 10 ? 60 : hero.length <= 16 ? 44 : 32,
    sub: `${fmtUsd(d.amount)} in ${d.year} is worth this today.`,
    note: `Prices are ${dirWord} ${fmtNum(Math.abs(d.pct), 1)}% since ${d.year}.`,
    facts: [
      { value: fmtNum(d.base, 3), label: `CPI ${d.year}` },
      { value: fmtNum(d.latest.value, 3), label: `CPI ${d.latest.label}` },
      { value: `${fmtUsd(d.latest.value / d.base)} now`, label: '$1 then' },
      { value: Number.isFinite(d.perYear) ? `${fmtNum(d.perYear, 1)}%` : '--', label: 'A year, average' },
    ],
  });
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    errorView(el, cmd.error === 'amount' ? 'That amount does not look right. Use digits, up to 1,000,000,000,000.' : 'CPI needs a year, and maybe an amount.');
    ctx.status('CPI: CHECK THE FORMAT', 'warn');
    return;
  }
  const { amount, year } = cmd.args;
  el.innerHTML = `<div class="stack">
    ${panel('1', `CPI ${year}`, `${toolbar({ left: cpiForm({ amount, year }), label: 'Amount and year' })}<div class="fx-out">${LOADING}</div>`, { metaId: 'cpi-meta', bodyCls: 'flush' })}
    ${panel('2', `Prices since ${year}`, `<div class="chart-host" id="cpi-chart">${LOADING}</div>`, { metaId: 'cpi-ch-meta', bodyCls: 'flush' })}
  </div>`;
  const body = el.querySelector('.fx-out');
  el.querySelector('.cpi-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    const next = cpiFormCommand(f.amount.value, f.year.value);
    if (next) ctx.run(next);
    else ctx.status('CPI: AN AMOUNT AND A YEAR FROM 1913, LIKE 100 IN 2015', 'warn');
  });
  const meta = el.querySelector('#cpi-meta');
  const chMeta = el.querySelector('#cpi-ch-meta');
  const host = el.querySelector('#cpi-chart');
  let chartCleanup = null;
  ctx.onCleanup(() => chartCleanup?.());

  const params = new URLSearchParams({ amount: String(amount), year: String(year) });
  ctx.fetchJSON(`/api/cpi?${params}`, { signal: ctx.signal }).then((d) => {
    meta.textContent = `CPI-U ${d.latest.label.toUpperCase()}${d.latest.source === 'static' ? ' (TABLE)' : ''}`;
    body.innerHTML = cpiResultHtml(d);
    const pts = d.series.map((p) => {
      const [y, m] = p.d.split('-').map(Number);
      return { t: Date.UTC(y, m ? m - 1 : 6, 15), v: p.v, label: m ? d.latest.label : String(y) };
    });
    const base = `<span class="dim">1982-84 = 100</span>`;
    // A month BLS never published (Oct 2025) shows as -- on its year, the reason in the
    // tooltip. Nothing fills it in.
    const gapHtml = (label) => (d.gaps || []).filter((g) => g.month.slice(0, 4) === String(label))
      .map((g) => ` <span class="dim" data-prov title="${esc(g.reason)}">${esc(g.label.toUpperCase())} --</span>`).join('');
    chMeta.innerHTML = base;
    host.textContent = '';
    chartCleanup = mountChart(host, pts, {
      fmtY: (v) => fmtNum(v, 0),
      fmtX: (t) => String(new Date(t).getUTCFullYear()),
      label: `Consumer prices since ${d.year}`,
      onHover: (p) => {
        chMeta.innerHTML = p ? `<span class="num">${esc(p.label.toUpperCase())} ${esc(fmtNum(p.v, 3))}</span>${gapHtml(p.label)}` : base;
        // The reason, as the chart's own tooltip while the pointer is on that year.
        host.title = p ? (d.gaps || []).filter((g) => g.month.slice(0, 4) === String(p.label)).map((g) => `${g.label}: ${g.reason}`).join(' ') : '';
      },
    });
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    errorView(el, err.message);
    ctx.status(err.code === 'bad_year' ? 'CPI: PICK ANOTHER YEAR' : 'CPI: NO DATA', 'warn');
  });
}
