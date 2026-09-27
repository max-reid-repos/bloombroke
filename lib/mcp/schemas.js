// outputSchema for every tool: the shape of its structuredContent. Clients may check
// results against these (the SDK client does), so every result a tool returns without
// isError must fit. Extra fields are allowed; the listed ones are promised.

const str = { type: 'string' };
const int = { type: 'integer' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const strOrNull = { type: ['string', 'null'] };
const numOrNull = { type: ['number', 'null'] };
const intOrNull = { type: ['integer', 'null'] };
const arr = (items) => ({ type: 'array', items });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });

export const PROVENANCE = obj({ source: str, source_url: str, as_of: str, fetched_at: str, age_seconds: int, notice: str });

const GAUGE_ROW = {
  type: 'object',
  properties: {
    id: str, command: str, title: str, link: str,
    status: { type: 'string', enum: ['ok', 'loading', 'no_data'] },
    headline: str, line: strOrNull, value: num, unit: str, as_of: strOrNull, stale: bool, record: str,
    provenance: PROVENANCE,
  },
  required: ['id', 'command', 'title', 'link', 'status', 'provenance'],
};

const SERIES = {
  type: ['object', 'null'],
  properties: {
    step: str, period: strOrNull, bucket_readings: int, dates: arr(str),
    series: arr(obj({ key: str, label: str, values: arr(numOrNull) })),
  },
  required: ['step', 'dates', 'series'],
};

export const OUTPUT_SCHEMAS = {
  latest_filings: obj({
    form: str, count: int,
    rows: arr({
      type: 'object',
      properties: { form: str, company: str, cik: int, ticker: strOrNull, filed_at: strOrNull, items: str, filed_by: arr(str), accession: str, url: str },
      required: ['form', 'company', 'cik', 'ticker', 'filed_at', 'accession', 'url'],
    }),
    link: str, provenance: PROVENANCE,
  }),
  company_filings: obj({
    ticker: str, company: strOrNull, cik: int, form: str, count: int, matched: int,
    rows: arr({
      type: 'object',
      properties: { form: str, description: strOrNull, filed: str, period: strOrNull, items: arr(str), accepted_at: strOrNull, url: strOrNull },
      required: ['form', 'description', 'filed', 'period', 'accepted_at', 'url'],
    }),
    link: str, provenance: PROVENANCE,
  }),
  company_financials: obj({
    ticker: str, company: strOrNull, cik: int,
    statement: { type: 'string', enum: ['income', 'balance', 'cash'] },
    frequency: { type: 'string', enum: ['annual', 'quarterly'] },
    currency: str,
    periods: arr(obj({ label: str, end: str, fiscal_year: intOrNull, form: strOrNull, filed: strOrNull, filing_url: strOrNull })),
    lines: arr({
      type: 'object',
      properties: { id: str, label: str, unit: str, values: arr(numOrNull), derived_periods: arr(str) },
      required: ['id', 'label', 'unit', 'values'],
    }),
    note: str, link: str, provenance: PROVENANCE,
  }),
  weird_gauges: obj({ count: int, gauges: arr(GAUGE_ROW), link: str, provenance: PROVENANCE }),
  weird_gauge: {
    type: 'object',
    properties: {
      ...GAUGE_ROW.properties,
      detail: { type: 'object' },
      series: SERIES,
      parts: arr(obj({ part: str, provenance: PROVENANCE })),
    },
    required: [...GAUGE_ROW.required, 'detail', 'series'],
  },
  cpi: obj({
    series: str, name: str, first_month: str, last_month: str, count: int,
    months: arr(obj({ month: str, index: num, change_vs_year_before_pct: numOrNull })),
    link: str, provenance: PROVENANCE,
  }),
  open_in_bloombroke: {
    type: 'object',
    properties: { command: str, link: str, description: strOrNull, note: str, provenance: PROVENANCE },
    required: ['command', 'link', 'description', 'provenance'],
  },
  bloombroke_pro: (() => {
    const row = { type: 'object', properties: { what: str, status: str, command: str }, required: ['what', 'status'] };
    return obj({ rule: str, free: arr(row), pro: arr(row), link: str, provenance: PROVENANCE });
  })(),
};

// A small checker for the schema subset above (type, one or several; enum; required;
// properties; items), for tests and for the server's own guard. -> [] or the problems.
export function checkSchema(schema, value, at = '$') {
  const types = [].concat(schema.type || []);
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const t = typeOf(value);
  if (types.length && !types.some((x) => x === t || (x === 'number' && t === 'integer'))) return [`${at}: ${t}, not ${types.join('|')}`];
  if (schema.enum && !schema.enum.includes(value)) return [`${at}: not one of ${schema.enum.join(', ')}`];
  const out = [];
  if (t === 'object') {
    for (const k of schema.required || []) if (!Object.hasOwn(value, k)) out.push(`${at}.${k}: missing`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, k)) out.push(...checkSchema(s, value[k], `${at}.${k}`));
  }
  if (t === 'array' && schema.items) value.forEach((v, i) => out.push(...checkSchema(schema.items, v, `${at}[${i}]`)));
  return out;
}
