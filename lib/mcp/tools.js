// The MCP tools: read-only, public-domain data only.
//
// Served as data: SEC EDGAR (latest filings, a company's filings, its filed financial
// statements), the WEIRD gauges from public sources (lib/mcp/gauges.js), and BLS CPI-U
// from the baked monthly file. Quotes, charts, symbol search, news, WHATIF, GUESS and
// anything priced from them come from sources we may not pass on: they are reachable
// only as a bloombroke.com link (open_in_bloombroke).
//
// Every result carries the provenance envelope (lib/mcp/envelope.js). Row and point
// counts are capped by each tool's inputSchema, which validate.js also enforces.

import { readFileSync } from 'node:fs';
import { createCache } from '../../data/cache.js';
import { makeFinancials, LINES } from '../../data/financials.js';
import { getFilings as sharedGetFilings, filingUrl, NEWS_MAX_AGE_MS } from '../../data/filings.js';
import { getGauge as sharedGetGauge } from '../../data/weird/index.js';
import { sliceHist } from '../../data/weird/history.js';
import { parseCommand, urlFor, toQuery, tokenize } from '../../public/app.js';
import { isSecret } from '../../public/commands.js';
import { findCommand, REGISTRY } from '../../public/registry.js';
import { RULE, FREE_ROWS, PRO_ROWS, LIVE, shownRows } from '../../public/screens/pro.js';
import { provenance, toolResult, toolError, round, isoOf } from './envelope.js';
import { makeSecCurrent, secFetch, CURRENT_FORMS, CURRENT_SOURCE, EDGAR_CURRENT_PAGE } from './sec.js';
import { MCP_GAUGES, MCP_GAUGE_IDS, mcpGauge } from './gauges.js';

export const SITE = 'https://bloombroke.com';
export const MAX_ROWS = 20;
export const MAX_PERIODS = 8;
export const MAX_POINTS = 250;
export const MAX_CPI_MONTHS = 240;
export const GAUGE_WAIT_MS = 1500;
export const MCP_TIMEOUT_MS = 25_000;

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const TICKER = { type: 'string', minLength: 1, maxLength: 8, pattern: '^[A-Za-z]{1,5}([.-][A-Za-z]{1,2})?$', description: 'US ticker as listed with the SEC, like AAPL or BRK.B' };
const PERIODS = ['3M', '1Y', '5Y', '10Y', 'MAX'];
const link = (command) => `${SITE}/${toQuery(command)}`;

// ---- data sources -----------------------------------------------------------------

// BLS CPI-U, US city average, all items, not seasonally adjusted (data/bls-monthly.json).
const BLS = JSON.parse(readFileSync(new URL('../../data/bls-monthly.json', import.meta.url), 'utf8'));
export const CPI_SERIES = 'CUUR0000SA0';

// FINANCIALS for MCP: its own instance whose SEC requests go through the shared SEC queue,
// with no split adjustment (split history comes from a source we may not pass on), so
// every figure is as filed.
function mcpFinancials() {
  return makeFinancials({ fetchImpl: secFetch, splitHistory: async () => null, cache: createCache({ maxEntries: 100, retryMs: 60_000 }) }).getFinancials;
}

// ---- tool definitions -------------------------------------------------------------

export const TOOL_DEFS = [
  {
    name: 'latest_filings',
    title: 'Latest SEC filings',
    description: 'The newest filings on SEC EDGAR for one form type, newest first, from the SEC latest-filings feed (refreshed about once a minute). Each row: form, company, CIK, ticker when listed, filing time, 8-K item topics, other parties (Form 4, 13D), accession number and EDGAR link. Source: SEC EDGAR (public domain).',
    inputSchema: {
      type: 'object',
      properties: {
        form: { type: 'string', enum: CURRENT_FORMS, default: '8-K', description: 'Form type. Default 8-K.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS, default: 10, description: `Rows, 1 to ${MAX_ROWS}. Default 10.` },
      },
      additionalProperties: false,
    },
    // "13D", "SC 13D" -> SCHEDULE 13D
    normalize: (a) => {
      if (a && typeof a.form === 'string') {
        const f = a.form.trim().toUpperCase().replace(/^(SC|SCHEDULE)\s*/, '');
        if (f === '13D' || f === '13G') return { ...a, form: `SCHEDULE ${f}` };
      }
      return a;
    },
  },
  {
    name: 'company_filings',
    title: 'Company SEC filings',
    description: "One company's recent SEC EDGAR filings, newest first: form, plain-English description, filing date, report period, 8-K item codes and EDGAR link. form KEY is everything except ownership forms (3, 4, 5, 144, 13D, 13G). Source: SEC EDGAR submissions (public domain).",
    inputSchema: {
      type: 'object',
      properties: {
        ticker: TICKER,
        form: { type: 'string', enum: ['KEY', 'ALL', '10-K', '10-Q', '8-K', '4'], default: 'KEY', description: 'KEY (default), ALL, 10-K, 10-Q, 8-K or 4.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS, default: 10, description: `Rows, 1 to ${MAX_ROWS}. Default 10.` },
      },
      required: ['ticker'],
      additionalProperties: false,
    },
  },
  {
    name: 'company_financials',
    title: 'Company financial statements (SEC filings)',
    description: 'Income statement, balance sheet or cash flow lines as the company filed them in its 10-K and 10-Q reports (SEC EDGAR XBRL company facts), in USD, oldest period first. No prices, market values or ratios. A quarter reported only inside a year-to-date total is that total minus the earlier quarters, and is marked derived. Source: SEC EDGAR (public domain).',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: TICKER,
        statement: { type: 'string', enum: ['income', 'balance', 'cash'], default: 'income', description: 'income (default), balance or cash.' },
        frequency: { type: 'string', enum: ['annual', 'quarterly'], default: 'annual', description: 'annual (default) or quarterly.' },
        periods: { type: 'integer', minimum: 1, maximum: MAX_PERIODS, default: 4, description: `Periods, 1 to ${MAX_PERIODS}. Default 4.` },
      },
      required: ['ticker'],
      additionalProperties: false,
    },
  },
  {
    name: 'weird_gauges',
    title: 'Public-data gauges',
    description: `The Bloombroke WEIRD gauges built only from public sources: ${MCP_GAUGES.map((g) => g.id).join(', ')}. Each: headline, one-line meaning, latest value and date, source. Gauges from other sources are shown on bloombroke.com only.`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'weird_gauge',
    title: 'One public-data gauge',
    description: `One WEIRD gauge with its detail and its history for a period (3M, 1Y, 5Y, 10Y or MAX), at most ${MAX_POINTS} points (longer spans are averaged into runs). Gauges: panic (Wikipedia views of crash pages), omens (moon, New York sky, sunspots), undies (men's underwear price index), buzz (10-Qs naming AI, tariff, recession), beige (Beige Book word counts), sick (wastewater virus levels).`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: MCP_GAUGE_IDS, description: 'Gauge id.' },
        period: { type: 'string', enum: PERIODS, description: "History period. Default: the gauge's own." },
        points: { type: 'integer', minimum: 2, maximum: MAX_POINTS, default: 120, description: `Most history points, 2 to ${MAX_POINTS}. Default 120.` },
      },
      required: ['name'],
      additionalProperties: false,
    },
    // Command words (BUZZWORD, MOON) name the gauge too.
    normalize: (a) => {
      const g = a && typeof a.name === 'string' ? mcpGauge(a.name) : null;
      return g ? { ...a, name: g.id } : a;
    },
  },
  {
    name: 'cpi',
    title: 'US consumer price index (BLS CPI-U)',
    description: 'Monthly CPI-U, US city average, all items, not seasonally adjusted (1982-84 = 100), BLS series CUUR0000SA0, with the change on the same month a year before. Months from 2007-01. Default: the last 24 months. Source: US Bureau of Labor Statistics (public domain).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'First month, YYYY-MM' },
        to: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'Last month, YYYY-MM' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'open_in_bloombroke',
    title: 'Open a command on bloombroke.com',
    description: 'Checks a Bloombroke terminal command (like "AAPL 1Y", "NEWS", "WHATIF MY 1200 AAPL 2015", "WEIRD", "GUESS") and returns its bloombroke.com link and a one-line description of the screen. Returns no market data: quotes, charts, news, WHATIF and GUESS are shown on bloombroke.com only. Unknown commands are refused.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1, maxLength: 120, description: 'A terminal command, as typed on bloombroke.com' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'bloombroke_pro',
    title: 'What Bloombroke Pro includes',
    description: 'What is free on Bloombroke and what the Pro plan adds, with the link to the PRO screen.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// tools/list entries: name, title, description, inputSchema, annotations.
export const TOOLS = TOOL_DEFS.map(({ name, title, description, inputSchema }) => ({
  name, title, description, inputSchema, annotations: { title, ...ANNOTATIONS },
}));

// ---- handlers -----------------------------------------------------------------------

const DOWN = 'The source is taking a break. Try again in a minute.';
const COMPANY_ERRORS = {
  bad_symbol: 'That does not look like a ticker.',
  unavailable: 'SEC EDGAR is taking a break. Try again in a minute.',
};

// hist (data/weird/history.js) -> { step, period, dates, series }, at most `points`
// dates. Runs of readings are averaged past that (bucket_readings says how many).
export function seriesOut(hist, points, period) {
  if (!hist?.d?.length) return null;
  // sliceHist keeps the newest reading as a point of its own, so a run count can come
  // out one over: ask for fewer until it fits.
  let cut = null;
  for (let max = points; max >= 1; max -= 1) {
    cut = sliceHist(hist, 'MAX', max);
    if (!cut || cut.d.length <= points) break;
  }
  if (!cut) return null;
  return {
    step: cut.step,
    period,
    bucket_readings: (hist.bucket || 1) * (cut.bucket || 1),
    dates: cut.d,
    series: cut.series.map((s) => ({ key: s.key, label: s.label, values: s.v.map((v) => round(v, 3)) })),
  };
}

function gaugeRow(entry, g, now) {
  const reg = findCommand(entry.command);
  const base = {
    id: entry.id,
    command: entry.command,
    title: reg?.summary || entry.command,
    link: link(entry.command),
  };
  const prov = (g2) => provenance({ source: entry.source, source_url: entry.sourceUrl, as_of: g2?.asOf, fetched_at: g2?.updated, now });
  if (!g || g.pending) return { ...base, status: 'loading', provenance: prov(null) };
  if (!g.ok) return { ...base, status: 'no_data', provenance: prov(null) };
  return {
    ...base,
    status: 'ok',
    headline: g.headline,
    line: g.line || null,
    ...(Number.isFinite(g.value) && g.unit ? { value: g.value, unit: g.unit } : {}),
    as_of: isoOf(g.asOf),
    stale: Boolean(g.stale),
    ...(g.record?.text ? { record: g.record.text } : {}),
    provenance: prov(g),
  };
}

export function makeTools({
  current = null,
  getFilings = sharedGetFilings,
  getFinancials = null,
  getGauge = sharedGetGauge,
  bls = BLS,
  now = () => Date.now(),
} = {}) {
  let cur = current;
  const sec = () => (cur ||= makeSecCurrent());
  let fin = getFinancials;
  const financials = (t) => (fin ||= mcpFinancials())(t);

  const handlers = {
    async latest_filings({ form, limit }) {
      let got;
      try {
        got = await sec().getCurrent(form);
      } catch {
        return toolError('SEC EDGAR is taking a break. Try again in a minute.');
      }
      const rows = got.value.rows.slice(0, limit);
      const data = {
        form,
        count: rows.length,
        rows,
        link: link('NEWS SEC'),
        provenance: provenance({ source: CURRENT_SOURCE, source_url: EDGAR_CURRENT_PAGE, as_of: got.value.updated || got.fetchedAt, fetched_at: got.fetchedAt, now: now() }),
      };
      const top = rows.slice(0, 3).map((r) => `${r.form} ${r.company}${r.ticker ? ` (${r.ticker})` : ''}${r.items ? `: ${r.items}` : ''}`).join('; ');
      return toolResult(`${rows.length} latest ${form} filings on SEC EDGAR.${top ? ` Newest: ${top}.` : ''}`, data);
    },

    async company_filings({ ticker, form, limit }) {
      let got;
      try {
        got = await getFilings(ticker, form, { maxAgeMs: NEWS_MAX_AGE_MS });
      } catch (err) {
        return toolError(COMPANY_ERRORS[err?.code] || (err?.code === 'not_found' ? err.message : DOWN));
      }
      const rows = got.rows.slice(0, limit).map((r) => ({
        form: r.form, description: r.description || null, filed: r.filed, period: r.period || null,
        ...(r.items?.length ? { items: r.items } : {}), accepted_at: isoOf(r.accepted), url: r.url,
      }));
      const data = {
        ticker: got.ticker, company: got.name, cik: got.cik, form: got.form,
        count: rows.length, matched: got.matched, rows,
        link: link(`${got.ticker} FILINGS`),
        provenance: provenance({
          source: 'SEC EDGAR company submissions',
          source_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(got.cik).padStart(10, '0')}`,
          as_of: got.updated, fetched_at: got.updated, now: now(),
        }),
      };
      const top = rows[0] ? ` Newest: ${rows[0].form} filed ${rows[0].filed}${rows[0].description ? ` (${rows[0].description})` : ''}.` : '';
      return toolResult(`${rows.length} ${form} filings for ${got.name} (${got.ticker}) on SEC EDGAR.${top}`, data);
    },

    async company_financials({ ticker, statement, frequency, periods }) {
      let d;
      try {
        d = await financials(ticker.toUpperCase());
      } catch (err) {
        if (err?.code === 'not_found' || err?.code === 'no_data') return toolError(err.message);
        return toolError(COMPANY_ERRORS[err?.code] || DOWN);
      }
      const mode = frequency === 'quarterly' ? d.quarterly : d.annual;
      const all = mode?.periods || [];
      const from = Math.max(0, all.length - periods);
      const ps = all.slice(from);
      if (!ps.length) return toolError(`No ${frequency} statements on file for ${d.ticker}.`);
      const want = statement === 'cash' ? 'cashflow' : statement;
      const ids = LINES.filter((l) => l.statement === want).map((l) => ({ id: l.id, label: l.label, unit: l.unit }));
      if (want === 'cashflow') ids.push({ id: 'freeCashFlow', label: 'Free cash flow (operating cash flow minus capex)', unit: 'USD' });
      const lines = ids.map((l) => {
        const cells = (mode.values[l.id] || []).slice(from);
        const derived = ps.filter((_, i) => cells[i]?.derived).map((p) => p.label);
        return { id: l.id, label: l.label, unit: l.unit, values: ps.map((_, i) => (Number.isFinite(cells[i]?.v) ? cells[i].v : null)), ...(derived.length ? { derived_periods: derived } : {}) };
      });
      const newest = ps.map((p) => p.filed).filter(Boolean).sort().pop();
      const data = {
        ticker: d.ticker, company: d.name || d.title, cik: d.cik, statement, frequency, currency: 'USD',
        periods: ps.map((p) => ({ label: p.label, end: p.end, fiscal_year: p.fy, form: p.form, filed: p.filed, filing_url: filingUrl(d.cik, p.accn) })),
        lines,
        note: 'As filed. Per-share figures and share counts are not adjusted for later stock splits.',
        link: link(`${d.ticker} FINANCIALS`),
        provenance: provenance({
          source: 'SEC EDGAR XBRL company facts (10-K, 10-Q)',
          source_url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(d.cik).padStart(10, '0')}.json`,
          as_of: newest || d.updated, fetched_at: d.updated, now: now(),
        }),
      };
      return toolResult(`${d.name || d.title} (${d.ticker}) ${statement} statement, ${frequency}, ${ps[0].label} to ${ps[ps.length - 1].label}, as filed with the SEC.`, data);
    },

    async weird_gauges() {
      const got = await Promise.all(MCP_GAUGES.map((e) => getGauge(e.id, { wait: GAUGE_WAIT_MS }).catch(() => null)));
      const t = now();
      const gauges = MCP_GAUGES.map((e, i) => gaugeRow(e, got[i], t));
      const ok = gauges.filter((g) => g.status === 'ok');
      const oldest = ok.map((g) => g.provenance.fetched_at).sort()[0];
      const data = {
        count: gauges.length,
        gauges,
        link: link('WEIRD'),
        provenance: provenance({ source: 'Public sources, one per gauge (see each gauge)', source_url: link('WEIRD'), as_of: oldest, fetched_at: oldest, now: t }),
      };
      const lines = gauges.map((g) => `${g.command}: ${g.status === 'ok' ? `${g.headline} (${g.line})` : g.status.replace('_', ' ').toUpperCase()}`);
      return toolResult(lines.join('\n'), data);
    },

    async weird_gauge({ name, period, points }) {
      const entry = mcpGauge(name);
      if (!entry) return toolError(`No such gauge. Gauges: ${MCP_GAUGE_IDS.join(', ')}.`);
      const g = await getGauge(entry.id, { wait: GAUGE_WAIT_MS, period: period || null }).catch(() => null);
      const t = now();
      if (!g || g.pending) return toolError(`${entry.command} has no value yet. Try again in a minute.`);
      if (!g.ok) return toolError(`${entry.command}: the source has no data right now.`);
      const row = gaugeRow(entry, g, t);
      const data = {
        ...row,
        detail: entry.detail(g),
        series: seriesOut(g.hist, points, g.period || period || null),
      };
      if (entry.parts) {
        data.parts = entry.parts.map((p) => ({
          part: p.key,
          provenance: provenance({ source: p.source, source_url: p.sourceUrl, as_of: p.asOf ? p.asOf(g) : g.asOf, fetched_at: g.updated, now: t }),
        }));
      }
      return toolResult(`${entry.command}: ${g.headline}. ${g.line || ''}`.trim(), data);
    },

    async cpi({ from, to }) {
      const s = bls.series[CPI_SERIES];
      const months = Object.keys(s.values).sort();
      const first = months[0];
      const last = months[months.length - 1];
      const end = to || last;
      let start = from;
      if (!start) {
        const i = Math.max(0, months.indexOf(end) - 23);
        start = months.includes(end) ? months[i] : first;
      }
      if (start > end) return toolError('"from" must be on or before "to".');
      if (start > last || end < first) return toolError(`Months run from ${first} to ${last}.`);
      const picked = months.filter((m) => m >= start && m <= end);
      if (picked.length > MAX_CPI_MONTHS) return toolError(`At most ${MAX_CPI_MONTHS} months at once.`);
      const yearBefore = (m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
      const rows = picked.map((m) => {
        const v = s.values[m];
        const b = s.values[yearBefore(m)];
        return { month: m, index: v, change_vs_year_before_pct: Number.isFinite(b) ? round((v / b - 1) * 100, 2) : null };
      });
      const lastRow = rows[rows.length - 1];
      const data = {
        series: CPI_SERIES,
        name: s.name,
        first_month: first,
        last_month: last,
        count: rows.length,
        months: rows,
        link: link('CPI'),
        provenance: provenance({
          source: `US Bureau of Labor Statistics, CPI-U (${CPI_SERIES})`,
          source_url: `https://data.bls.gov/timeseries/${CPI_SERIES}`,
          as_of: lastRow?.month, fetched_at: bls.built, now: now(),
        }),
      };
      const summary = lastRow ? `CPI-U ${lastRow.month}: ${lastRow.index}${lastRow.change_vs_year_before_pct !== null ? `, ${lastRow.change_vs_year_before_pct}% on a year before` : ''}. ${rows.length} months from ${rows[0].month}.` : 'No months in that range.';
      return toolResult(summary, data);
    },

    async open_in_bloombroke({ command }) {
      const clean = tokenize(command).join(' ');
      const parsed = parseCommand(clean);
      // LOGIN and REDEEM (typed, or a pasted key or gift code): refused without echoing
      // the words, which may hold a key.
      if (parsed.secret || isSecret(clean) || ['LOGIN', 'REDEEM'].includes(parsed.name)) return toolError('Keys and gift codes never go in a link. Type LOGIN or REDEEM on bloombroke.com itself.');
      if (parsed.name === 'UNKNOWN' || parsed.name === 'SOON') return toolError(`"${clean.slice(0, 60)}" is not a Bloombroke command. Commands are listed at ${link('HELP')}.`);
      const entry = parsed.name === 'QUOTE' ? REGISTRY.find((c) => c.name === '<TICKER>') : (findCommand(clean.split(' ')[0]) || findCommand(parsed.name));
      if (parsed.error) {
        const how = entry?.syntax ? ` Form: ${entry.syntax}.` : '';
        return toolError(`"${clean.slice(0, 60)}" is not in a form the terminal runs.${how}`);
      }
      const opens = urlFor(clean).url;
      const data = {
        command: opens,
        link: link(opens),
        description: entry?.summary || null,
        ...(opens !== clean ? { note: `A link only opens a screen; it never changes anything. This one opens ${opens}.` } : {}),
        provenance: provenance({ source: 'Bloombroke command registry', source_url: link('HELP'), now: now() }),
      };
      return toolResult(`${opens}: ${link(opens)}${entry?.summary ? `\n${entry.summary}` : ''}`, data);
    },

    async bloombroke_pro() {
      const rows = (list) => shownRows(list).map(([what, status, cmd]) => ({ what, status: status === LIVE ? 'live' : 'coming when Pro launches', ...(cmd ? { command: cmd } : {}) }));
      const data = {
        rule: RULE,
        free: rows(FREE_ROWS),
        pro: rows(PRO_ROWS),
        link: link('PRO'),
        provenance: provenance({ source: 'Bloombroke PRO screen', source_url: link('PRO'), now: now() }),
      };
      return toolResult(`${RULE}\nPro: ${data.pro.map((r) => r.what).join(', ')}.\n${link('PRO')}`, data);
    },
  };

  return { handlers };
}
