// SCREEN: the stock screener. A filter form and a sortable results table. The form,
// the command bar and the URL (?c=SCREEN ...) always say the same thing: running the
// form builds the command, and the command fills the form.

import { esc, q, fmtNum, fmtPct, dirOf, panel, LOADING, rowAttrs, nameCell } from './markets.js';
import {
  SECTORS, COUNTRIES, FIELDS, FIELD_ORDER, PRESETS, SORTS, parseCond, parseScreenArgs, screenWords, sortOf, isEmptySpec, needsCnbc, SCREEN_ERRORS,
} from '../screener.js';
import { resolveInstrument } from '../instruments.js';

const PAGE = 100;
const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// 4902476945600 -> "4.90T"; 710984898 -> "711.0M"; 4511 -> "4.5K".
export function fmtBig(n) {
  if (!Number.isFinite(n)) return '--';
  const a = Math.abs(n);
  if (a >= 1e12) return `${fmtNum(n / 1e12, 2)}T`;
  if (a >= 1e9) return `${fmtNum(n / 1e9, 2)}B`;
  if (a >= 1e6) return `${fmtNum(n / 1e6, 1)}M`;
  if (a >= 1e3) return `${fmtNum(n / 1e3, 1)}K`;
  return fmtNum(n, 0);
}

export function fmtPrice(n) {
  if (!Number.isFinite(n)) return '--';
  return fmtNum(n, n < 1 ? 4 : 2);
}

// A row opens its quote screen, unless the symbol is not one the router can open
// (preferred shares like ABR^D) or it would open a named instrument instead (GOLD).
export function rowCmd(symbol) {
  return TICKER_RE.test(symbol) && !resolveInstrument(symbol) ? symbol : null;
}

// ---- the form ---------------------------------------------------------------------

// Number filters shown as min and max boxes: MCAP>10B -> min "10B".
export function formValues(spec) {
  const v = { preset: spec.preset || '', sector: spec.sector || '', country: spec.country || '', industry: spec.industry || '' };
  for (const c of spec.conds || []) {
    const text = c.text.slice(c.field.length + c.op.length);
    v[`${c.field}_${c.op.startsWith('>') ? 'min' : 'max'}`] = text;
  }
  return v;
}

// Form fields -> the words after SCREEN, or { error }.
export function wordsFromForm(fields, sort) {
  const words = [];
  if (fields.preset) words.push(fields.preset);
  if (fields.sector) words.push('SECTOR', fields.sector);
  const ind = String(fields.industry || '').toUpperCase().replace(/[^A-Z0-9&/ -]/g, ' ').trim().replace(/\s+/g, ' ');
  if (ind) words.push('INDUSTRY', ind);
  if (fields.country) words.push('COUNTRY', fields.country);
  for (const f of FIELD_ORDER) {
    for (const [side, op] of [['min', '>'], ['max', '<']]) {
      const raw = String(fields[`${f}_${side}`] || '').trim().toUpperCase().replace(/[\s,$]/g, '');
      if (!raw) continue;
      const c = parseCond(`${f}${op}${raw}`);
      if (!c) return { error: `${FIELDS[f].label} ${side}: "${raw}" is not a number.` };
      words.push(c.text);
    }
  }
  const spec = parseScreenArgs(words);
  if (spec.error) return { error: SCREEN_ERRORS[spec.error](spec.bad) };
  if (sort) spec.sort = sort;
  return { words: screenWords(spec) };
}

const HINTS = {
  MCAP: ['10B', '200B'], PRICE: ['5', '50'], CHG: ['2', '-2'], VOL: ['1M', ''], PE: ['', '30'], DIV: ['2', ''],
};

function formHtml(spec, open = true) {
  const v = formValues(spec);
  const opt = (value, label, on) => `<option value="${esc(value)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const sectors = [opt('', 'Any sector', !v.sector), ...SECTORS.map((s) => opt(s.code, s.name, v.sector === s.code))].join('');
  const countries = [opt('', 'Any country', !v.country), ...Object.entries(COUNTRIES)
    .sort((a, b) => (a[0] === 'US' ? -1 : b[0] === 'US' ? 1 : a[1].localeCompare(b[1])))
    .map(([code, name]) => opt(code, `${name} (${code})`, v.country === code))].join('');
  const presets = [opt('', 'None', !v.preset), ...Object.entries(PRESETS).map(([k, p]) => opt(k, `${k}: ${p.hint}`, v.preset === k))].join('');
  const nums = FIELD_ORDER.map((f) => `<div class="sc-field sc-range">
      <span class="sc-lab">${esc(FIELDS[f].label)}${f === 'CHG' || f === 'DIV' ? ' (%)' : ''}</span>
      <input name="${f}_min" value="${esc(v[`${f}_min`] || '')}" placeholder="${esc(HINTS[f][0] ? `over ${HINTS[f][0]}` : 'over')}" aria-label="${esc(FIELDS[f].label)} over" autocomplete="off" spellcheck="false">
      <input name="${f}_max" value="${esc(v[`${f}_max`] || '')}" placeholder="${esc(HINTS[f][1] ? `under ${HINTS[f][1]}` : 'under')}" aria-label="${esc(FIELDS[f].label)} under" autocomplete="off" spellcheck="false">
    </div>`).join('');
  const words = screenWords(spec);
  return `<details class="sc-filters"${open ? ' open' : ''}><summary><span class="sc-sum-k">Filters</span> <span class="sc-sum-v">${esc(words || 'none')}</span></summary><form class="sc-form" novalidate>
    <label class="sc-field"><span class="sc-lab">Preset</span><select name="preset">${presets}</select></label>
    <label class="sc-field"><span class="sc-lab">Sector</span><select name="sector">${sectors}</select></label>
    <label class="sc-field"><span class="sc-lab">Country</span><select name="country">${countries}</select></label>
    <label class="sc-field"><span class="sc-lab">Industry has</span><input name="industry" value="${esc(v.industry)}" placeholder="e.g. semiconductors" autocomplete="off" spellcheck="false"></label>
    ${nums}
    <div class="sc-actions"><button class="wi-run" type="submit">RUN SCREEN</button><button class="sc-clear" type="button">CLEAR</button><span class="sc-err" role="alert"></span></div>
  </form></details>
  <p class="sc-presets muted">Presets: ${Object.keys(PRESETS).map((k) => `<a class="code" href="${esc(q(`SCREEN ${k}`))}" data-cmd="SCREEN ${esc(k)}">${esc(k)}</a>`).join(' ')}</p>
  <p class="sc-presets muted">Sizes take K, M, B and T, like MCAP&gt;10B or VOL&gt;1M. P/E from CNBC, may be missing for some stocks; so may dividend yield.</p>`;
}

// ---- the results --------------------------------------------------------------------

const COLS = [
  { by: 'SYMBOL', label: 'Symbol' },
  { by: 'NAME', label: 'Name' },
  { by: 'PRICE', label: 'Last', num: true },
  { by: 'CHG', label: '%Chg', num: true },
  { by: 'MCAP', label: 'Mkt cap', num: true },
  { by: 'VOL', label: 'Volume', num: true, cls: 'sc-vol' },
  { by: 'SECTOR', label: 'Sector', cls: 'sc-sec' },
  { by: 'INDUSTRY', label: 'Industry', cls: 'sc-ind' },
  { by: 'COUNTRY', label: 'Country', cls: 'sc-cty' },
];
// Shown only when the screen uses them (the numbers come from CNBC).
const CNBC_COLS = [
  { by: 'PE', label: 'P/E', num: true },
  { by: 'DIV', label: 'Yield', num: true },
];

export function columnsFor(spec) {
  return needsCnbc(spec) ? [...COLS.slice(0, 5), ...CNBC_COLS, ...COLS.slice(5)] : COLS;
}

// The command a column header runs: sort by it, or flip the order if it is the sort.
export function sortCmd(spec, by) {
  const cur = sortOf(spec);
  const natural = SORTS[by].text ? 'LOW' : 'HIGH';
  const dir = cur.by === by ? (cur.dir === 'HIGH' ? 'LOW' : 'HIGH') : natural;
  const words = screenWords({ ...spec, sort: { by, dir } });
  return `SCREEN ${words}`;
}

export function resultsTable(rows, spec) {
  const cur = sortOf(spec);
  const cols = columnsFor(spec);
  const extra = cols !== COLS;
  const head = cols.map((c) => {
    const on = cur.by === c.by;
    const arrow = on ? (cur.dir === 'HIGH' ? ' ▼' : ' ▲') : '';
    const cmd = sortCmd(spec, c.by);
    return `<th scope="col" class="${c.num ? 'num ' : ''}${c.cls || ''}${c.by === 'NAME' ? ' name' : ''}"${on ? ` aria-sort="${cur.dir === 'HIGH' ? 'descending' : 'ascending'}"` : ''}><a class="sc-sort${on ? ' is-on' : ''}" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}">${esc(c.label)}${arrow}</a></th>`;
  }).join('');
  const body = rows.map((r) => {
    const cmd = rowCmd(r.symbol);
    return `<tr${rowAttrs(cmd)}>
      <td class="sc-sym">${cmd ? `<a href="${esc(q(cmd))}" data-cmd="${esc(cmd)}" tabindex="-1">${esc(r.symbol)}</a>` : esc(r.symbol)}</td>
      ${nameCell(r.name, null)}
      <td class="num last">${esc(fmtPrice(r.last))}</td>
      <td class="num ${dirOf(r.changePct)}">${esc(fmtPct(r.changePct))}</td>
      <td class="num">${esc(fmtBig(r.marketCap))}</td>
      ${extra ? `<td class="num">${Number.isFinite(r.pe) ? esc(fmtNum(r.pe, 2)) : '--'}</td><td class="num">${Number.isFinite(r.divYield) ? `${esc(fmtNum(r.divYield, 2))}%` : '--'}</td>` : ''}
      <td class="num sc-vol dim">${esc(fmtBig(r.volume))}</td>
      <td class="sc-sec dim">${esc(r.sector || '--')}</td>
      <td class="sc-ind dim">${esc(r.industry || '--')}</td>
      <td class="sc-cty dim">${esc(r.country || '--')}</td>
    </tr>`;
  }).join('');
  return `<div class="sc-scroll"><table class="grid-table sc-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// The preset's own rules, said out loud above the results: "GAINERS: Up today, market cap over $300M, ...".
export function presetRule(spec) {
  const p = PRESETS[spec.preset];
  return p ? `<p class="sc-rule"><span class="sc-rule-k">${esc(spec.preset)}</span> ${esc(p.hint)}</p>` : '';
}

function fmtDay(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).toUpperCase();
}

const FOOT = 'Source: Nasdaq stock screener, all stocks listed on Nasdaq, NYSE and NYSE American. Prices are the last sale on the date shown. P/E and dividend yield from CNBC, may be missing for some stocks: a stock without the number is left out of a PE or DIV filter. Not financial advice.';

export function render(el, cmd, ctx) {
  const bad = cmd.error ? SCREEN_ERRORS[cmd.error]?.(cmd.args.bad) : null;
  const spec = cmd.error ? parseScreenArgs([]) : cmd.args;
  const empty = isEmptySpec(spec);
  // On a phone the results come first: the filters fold away once there are results.
  const narrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches;
  el.innerHTML = `<div class="stack">
    ${panel('1', 'Screen', `${bad ? `<p class="notice">${esc(bad)}</p>` : ''}${formHtml(spec, empty || !!bad || !narrow)}`, { meta: 'FILTER EVERY US-LISTED STOCK' })}
    ${empty ? '' : panel('2', 'Results', LOADING, { metaId: 'sc-meta', bodyCls: 'flush' })}
  </div>
  <p class="footnote">${esc(FOOT)}</p>`;

  const form = el.querySelector('.sc-form');
  const err = el.querySelector('.sc-err');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(form).entries());
    const r = wordsFromForm(fields, spec.sort);
    if (r.error) { err.textContent = r.error; return; }
    ctx.run(r.words ? `SCREEN ${r.words}` : 'SCREEN');
  });
  form.querySelector('.sc-clear').addEventListener('click', () => ctx.run('SCREEN'));
  // Changing a menu runs the screen at once; typed boxes run on Enter or RUN.
  form.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => form.requestSubmit()));

  if (bad) { ctx.status('SCREEN: CHECK THE FILTERS', 'warn'); return; }
  if (empty) { ctx.status('SCREEN: PICK FILTERS, OR TYPE THEM: SCREEN SECTOR TECHNOLOGY MCAP>10B'); return; }

  const body = el.querySelectorAll('.panel-body')[1];
  const meta = el.querySelector('#sc-meta');
  const words = screenWords(spec);
  let limit = PAGE;

  async function load() {
    try {
      const d = await ctx.fetchJSON(`/api/screen?${new URLSearchParams({ c: words, limit: String(limit) })}`, { signal: ctx.signal });
      const day = fmtDay(d.asOf);
      meta.textContent = `${fmtNum(d.count, 0)} OF ${fmtNum(d.total, 0)} STOCKS${day ? ` · PRICES ${day}` : ''}`;
      if (!d.count) {
        body.innerHTML = `${presetRule(spec)}<p class="panel-msg sc-none">No stocks match. Loosen a filter.</p>`;
      } else {
        const more = d.rows.length < d.count
          ? `<div class="sc-more-bar"><span class="dim">Showing ${fmtNum(d.rows.length, 0)} of ${fmtNum(d.count, 0)}</span><button type="button" class="sc-more">SHOW ${fmtNum(Math.min(PAGE, d.count - d.rows.length), 0)} MORE</button></div>`
          : '';
        const keep = body.querySelector('.sc-scroll')?.scrollLeft || 0;
        body.innerHTML = presetRule(spec) + resultsTable(d.rows, spec) + more;
        body.querySelector('.sc-scroll').scrollLeft = keep;
        body.querySelector('.sc-more')?.addEventListener('click', () => { limit += PAGE; load(); });
      }
      ctx.status(`${d.stale ? 'LAST KNOWN DATA · ' : ''}SCREEN: ${fmtNum(d.count, 0)} MATCHES${day ? ` · NASDAQ SCREENER PRICES ${day}` : ''}`, d.stale ? 'warn' : '');
    } catch (e) {
      if (e.name === 'AbortError') return;
      body.innerHTML = `<p class="panel-msg sc-none">${esc(e.message)}</p>`;
      ctx.status('SCREEN: COULD NOT LOAD', 'warn');
    }
  }
  load();
}
