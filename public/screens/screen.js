// SCREEN: the stock screener. A filter form and a sortable results table. The form,
// the command bar and the URL (?c=SCREEN ...) always say the same thing: running the
// form builds the command, and the command fills the form.

import { esc, q, fmtNum, fmtPct, dirOf, panel, LOADING, rowAttrs, nameCell } from './markets.js';
import {
  SECTORS, COUNTRIES, FIELDS, FIELD_ORDER, PRESETS, SORTS, parseCond, parseScreenArgs, screenWords, sortOf, isEmptySpec, needsCnbc, SCREEN_ERRORS,
} from '../screener.js';
import { resolveInstrument } from '../instruments.js';
import { toolbar, segmented } from '../kit.js';

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

const condBox = (c) => [`${c.field}_${c.op.startsWith('>') ? 'min' : 'max'}`, c.text.slice(c.field.length + c.op.length)];

// A preset's own rules as form boxes: GAINERS -> { CHG_min: "0", MCAP_min: "300M" }.
export function presetValues(preset) {
  const out = {};
  for (const t of PRESETS[preset]?.conds || []) {
    const c = parseCond(t);
    if (c) { const [k, v] = condBox(c); out[k] = v; }
  }
  return out;
}

// Number filters shown as min and max boxes: MCAP>10B -> min "10B". A preset's rules
// fill their boxes too, so the form shows what the screen really does; a typed
// condition on the same box wins.
export function formValues(spec) {
  const v = { preset: spec.preset || '', sector: spec.sector || '', country: spec.country || '', industry: spec.industry || '' };
  Object.assign(v, presetValues(spec.preset));
  for (const c of spec.conds || []) {
    const [k, text] = condBox(c);
    v[k] = text;
  }
  return v;
}

// Form fields -> the words after SCREEN, or { error }. A box still holding its
// preset's value is the preset's rule, not a word of its own.
export function wordsFromForm(fields, sort) {
  const words = [];
  const fromPreset = presetValues(fields.preset);
  if (fields.preset) words.push(fields.preset);
  if (fields.sector) words.push('SECTOR', fields.sector);
  const ind = String(fields.industry || '').toUpperCase().replace(/[^A-Z0-9&/ -]/g, ' ').trim().replace(/\s+/g, ' ');
  if (ind) words.push('INDUSTRY', ind);
  if (fields.country) words.push('COUNTRY', fields.country);
  for (const f of FIELD_ORDER) {
    for (const [side, op] of [['min', '>'], ['max', '<']]) {
      const raw = String(fields[`${f}_${side}`] || '').trim().toUpperCase().replace(/[\s,$]/g, '');
      if (!raw) continue;
      if (fromPreset[`${f}_${side}`] === raw) continue;
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

function formHtml(spec, open = true) {
  const v = formValues(spec);
  const pv = presetValues(spec.preset);
  const isPreset = (k) => pv[k] !== undefined && pv[k] === v[k];
  const opt = (value, label, on) => `<option value="${esc(value)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const sectors = [opt('', 'Any sector', !v.sector), ...SECTORS.map((s) => opt(s.code, s.name, v.sector === s.code))].join('');
  const countries = [opt('', 'Any country', !v.country), ...Object.entries(COUNTRIES)
    .sort((a, b) => (a[0] === 'US' ? -1 : b[0] === 'US' ? 1 : a[1].localeCompare(b[1])))
    .map(([code, name]) => opt(code, `${name} (${code})`, v.country === code))].join('');
  const nums = FIELD_ORDER.map((f) => `<div class="sc-field sc-range">
      <span class="sc-lab">${esc(FIELDS[f].label)}${f === 'CHG' || f === 'DIV' ? ' (%)' : ''}</span>
      <input name="${f}_min" value="${esc(v[`${f}_min`] || '')}"${isPreset(`${f}_min`) ? ` data-preset="${esc(spec.preset)}" title="${esc(`Set by the ${spec.preset} preset`)}"` : ''} placeholder="over" aria-label="${esc(FIELDS[f].label)} over" autocomplete="off" spellcheck="false">
      <input name="${f}_max" value="${esc(v[`${f}_max`] || '')}"${isPreset(`${f}_max`) ? ` data-preset="${esc(spec.preset)}" title="${esc(`Set by the ${spec.preset} preset`)}"` : ''} placeholder="under" aria-label="${esc(FIELDS[f].label)} under" autocomplete="off" spellcheck="false">
    </div>`).join('');
  const words = screenWords(spec);
  return `<details class="sc-filters"${open ? ' open' : ''}><summary><span class="sc-sum-k">Filters</span> <span class="sc-sum-v">${esc(words || 'none')}</span></summary><form class="sc-form" novalidate>
    <input type="hidden" name="preset" value="${esc(v.preset)}">
    <label class="sc-field"><span class="sc-lab">Sector</span><select name="sector">${sectors}</select></label>
    <label class="sc-field"><span class="sc-lab">Country</span><select name="country">${countries}</select></label>
    <label class="sc-field"><span class="sc-lab">Industry has</span><input name="industry" value="${esc(v.industry)}" placeholder="a word in its name" autocomplete="off" spellcheck="false"></label>
    ${nums}
    <div class="sc-actions"><button class="wi-run" type="submit">RUN SCREEN</button><button class="sc-clear" type="button">CLEAR</button><span class="sc-err" role="alert"></span></div>
  </form></details>
  <p class="sc-presets muted">Numbers are the least (over) and the most (under). Sizes take K, M, B and T, like MCAP&gt;10B or VOL&gt;1M. P/E from CNBC, may be missing for some stocks; so may dividend yield.</p>`;
}

// The presets: one set of buttons under the title, the one in use lit. Picking one keeps
// the other filters; picking the lit one again drops it.
export function presetBar(active) {
  return toolbar({
    left: `<span class="tag">Presets</span>${segmented(Object.keys(PRESETS).map((k) => ({ label: k, value: k })), active || '', { label: 'Presets' })}`,
    label: 'Presets',
  });
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

export function resultsTable(rows, spec, asOf = null) {
  const cur = sortOf(spec);
  const cols = columnsFor(spec);
  const extra = cols !== COLS;
  const head = cols.map((c) => {
    const on = cur.by === c.by;
    const arrow = on ? (cur.dir === 'HIGH' ? ' ▼' : ' ▲') : '';
    const cmd = sortCmd(spec, c.by);
    const day = c.by === 'CHG' ? fmtDay(asOf) : null;
    return `<th scope="col" class="${c.num ? 'num ' : ''}${c.cls || ''}${c.by === 'NAME' ? ' name' : ''}"${on ? ` aria-sort="${cur.dir === 'HIGH' ? 'descending' : 'ascending'}"` : ''}><a class="sc-sort${on ? ' is-on' : ''}" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}"${day ? ` title="${esc(`% change on ${day}`)}"` : ''}>${esc(c.label)}${day ? ` ${esc(day)}` : ''}${arrow}</a></th>`;
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

// The line above the results that says which session the numbers are from. The
// Nasdaq screener file is refreshed after the close, so during a session it holds the
// previous day: "Screener data as of SEP 24 close".
export function asOfLine(asOf, today) {
  const day = fmtDay(asOf);
  if (!day) return '<p class="sc-rule sc-asof">Screener data date unknown: prices and % change may be from an earlier session. MOVERS has today\'s moves.</p>';
  const old = /^\d{4}-\d{2}-\d{2}$/.test(today || '') && asOf < today;
  return `<p class="sc-rule sc-asof"><span class="sc-rule-k">DATA</span> Screener data as of ${esc(day)}${old ? ' close' : ''}: last price and % change are for that session${old ? ', not today' : ''}. <a class="code" href="${esc(q('MOVERS'))}" data-cmd="MOVERS">MOVERS</a> has today's live moves.</p>`;
}

const FOOT = 'Source: Nasdaq stock screener, all stocks listed on Nasdaq, NYSE and NYSE American. Prices are the last sale on the date shown. P/E and dividend yield from CNBC, may be missing for some stocks: a stock without the number is left out of a PE or DIV filter. Not financial advice.';

export function render(el, cmd, ctx) {
  const bad = cmd.error ? SCREEN_ERRORS[cmd.error]?.(cmd.args.bad) : null;
  const spec = cmd.error ? parseScreenArgs([]) : cmd.args;
  const empty = isEmptySpec(spec);
  // On a phone the results come first: the filters fold away once there are results.
  const narrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches;
  el.innerHTML = `<div class="stack">
    ${panel('1', 'Screen', `${presetBar(spec.preset)}<div class="sc-pad">${bad ? `<p class="notice">${esc(bad)}</p>` : ''}${formHtml(spec, empty || !!bad || !narrow)}</div>`, { meta: 'FILTER EVERY US-LISTED STOCK', bodyCls: 'flush' })}
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
  // A new preset drops the boxes the old one filled, so its rules do not stay behind as
  // typed ones.
  el.querySelector('.toolbar .seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (!b) return;
    e.stopPropagation();
    const input = form.querySelector('input[name="preset"]');
    input.value = input.value === b.dataset.value ? '' : b.dataset.value;
    form.querySelectorAll('input[data-preset]').forEach((i) => { if (i.value === i.defaultValue) i.value = ''; });
    form.requestSubmit();
  });

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
      const behind = Boolean(day && d.today && d.asOf < d.today);
      meta.textContent = `${fmtNum(d.count, 0)} OF ${fmtNum(d.total, 0)} STOCKS${day ? ` · AS OF ${day}${behind ? ' CLOSE' : ''}` : ' · DATE UNKNOWN'}`;
      if (!d.count) {
        body.innerHTML = `${asOfLine(d.asOf, d.today)}${presetRule(spec)}<p class="panel-msg sc-none">No stocks match. Loosen a filter.</p>`;
      } else {
        const more = d.rows.length < d.count
          ? `<div class="sc-more-bar"><span class="dim">Showing ${fmtNum(d.rows.length, 0)} of ${fmtNum(d.count, 0)}</span><button type="button" class="sc-more">SHOW ${fmtNum(Math.min(PAGE, d.count - d.rows.length), 0)} MORE</button></div>`
          : '';
        const keep = body.querySelector('.sc-scroll')?.scrollLeft || 0;
        body.innerHTML = asOfLine(d.asOf, d.today) + presetRule(spec) + resultsTable(d.rows, spec, d.asOf) + more;
        body.querySelector('.sc-scroll').scrollLeft = keep;
        body.querySelector('.sc-more')?.addEventListener('click', () => { limit += PAGE; load(); });
      }
      ctx.status(`${d.stale ? 'LAST KNOWN DATA · ' : ''}SCREEN: ${fmtNum(d.count, 0)} MATCHES${day ? ` · SCREENER DATA AS OF ${day}${behind ? ' CLOSE' : ''}` : ' · DATA DATE UNKNOWN'}`, d.stale ? 'warn' : '');
    } catch (e) {
      if (e.name === 'AbortError') return;
      body.innerHTML = `<p class="panel-msg sc-none">${esc(e.message)}</p>`;
      ctx.status('SCREEN: COULD NOT LOAD', 'warn');
    }
  }
  load();
}
