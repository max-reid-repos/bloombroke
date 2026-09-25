// SCREEN: the stock screener's words and filters. Pure functions, shared by the
// browser (the command bar and the filter form) and the server (the filtering).
//
//   SCREEN                                   the filter form
//   SCREEN SECTOR TECHNOLOGY MCAP>10B CHG>2 PRICE<50 COUNTRY US
//   SCREEN GAINERS SORT VOL                  a preset, then more words
//
// Words: SECTOR <name>, INDUSTRY <words>, COUNTRY <code or name>, MCAP|PRICE|CHG|VOL
// with > < >= <=, SORT <column> [HIGH|LOW], and the presets below.

export const SECTORS = [
  { code: 'TECHNOLOGY', name: 'Technology', aliases: ['TECH'] },
  { code: 'FINANCE', name: 'Finance', aliases: ['FINANCIAL', 'FINANCIALS'] },
  { code: 'HEALTHCARE', name: 'Health Care', aliases: ['HEALTH'] },
  { code: 'DISCRETIONARY', name: 'Consumer Discretionary', aliases: [] },
  { code: 'STAPLES', name: 'Consumer Staples', aliases: [] },
  { code: 'INDUSTRIALS', name: 'Industrials', aliases: ['INDUSTRIAL'] },
  { code: 'ENERGY', name: 'Energy', aliases: [] },
  { code: 'UTILITIES', name: 'Utilities', aliases: ['UTILITY'] },
  { code: 'REALESTATE', name: 'Real Estate', aliases: [] },
  { code: 'MATERIALS', name: 'Basic Materials', aliases: [] },
  { code: 'TELECOM', name: 'Telecommunications', aliases: [] },
  { code: 'MISC', name: 'Miscellaneous', aliases: [] },
];

// Country codes for the names Nasdaq uses.
export const COUNTRIES = {
  US: 'United States', CA: 'Canada', CN: 'China', HK: 'Hong Kong', TW: 'Taiwan', JP: 'Japan',
  KR: 'South Korea', SG: 'Singapore', IN: 'India', IL: 'Israel', UK: 'United Kingdom', IE: 'Ireland',
  NL: 'Netherlands', CH: 'Switzerland', DE: 'Germany', FR: 'France', LU: 'Luxembourg', SE: 'Sweden',
  DK: 'Denmark', BE: 'Belgium', IT: 'Italy', ES: 'Spain', NO: 'Norway', FI: 'Finland', GR: 'Greece',
  CY: 'Cyprus', MC: 'Monaco', JE: 'Jersey', GI: 'Gibraltar', BM: 'Bermuda', KY: 'Cayman Islands',
  VG: 'British Virgin Islands', BS: 'Bahamas', PR: 'Puerto Rico', MX: 'Mexico', BR: 'Brazil',
  AR: 'Argentina', CL: 'Chile', CO: 'Colombia', PE: 'Peru', UY: 'Uruguay', PA: 'Panama',
  AU: 'Australia', NZ: 'New Zealand', MY: 'Malaysia', ID: 'Indonesia', PH: 'Philippines', TH: 'Thailand',
  AE: 'United Arab Emirates', TR: 'Turkey', KZ: 'Kazakhstan', ZA: 'South Africa',
};
const COUNTRY_ALIASES = { USA: 'US', GB: 'UK' };

// Number filters. `scale` allows 10B, 500M, 2.5T.
export const FIELDS = {
  MCAP: { key: 'marketCap', label: 'Market cap', scale: true },
  PRICE: { key: 'last', label: 'Price', scale: false },
  CHG: { key: 'changePct', label: '% change', scale: false },
  VOL: { key: 'volume', label: 'Volume', scale: true },
};
const FIELD_ALIASES = { CAP: 'MCAP', MARKETCAP: 'MCAP', LAST: 'PRICE', CHANGE: 'CHG', '%CHG': 'CHG', PCT: 'CHG', VOLUME: 'VOL' };
export const FIELD_ORDER = ['MCAP', 'PRICE', 'CHG', 'VOL'];

// Sortable columns: numbers start high, words start at A.
export const SORTS = {
  SYMBOL: { key: 'symbol', text: true }, NAME: { key: 'name', text: true },
  PRICE: { key: 'last' }, CHG: { key: 'changePct' }, MCAP: { key: 'marketCap' }, VOL: { key: 'volume' },
  SECTOR: { key: 'sector', text: true }, INDUSTRY: { key: 'industry', text: true }, COUNTRY: { key: 'country', text: true },
};

export const PRESETS = {
  LARGECAPS: { hint: 'Market cap $10B and up', conds: ['MCAP>=10B'] },
  GAINERS: { hint: 'Up today, market cap over $300M, biggest gain first', conds: ['CHG>0', 'MCAP>300M'], sort: { by: 'CHG', dir: 'HIGH' } },
  LOSERS: { hint: 'Down today, market cap over $300M, biggest drop first', conds: ['CHG<0', 'MCAP>300M'], sort: { by: 'CHG', dir: 'LOW' } },
  PENNY: { hint: 'Price under $5, market cap over $300M', conds: ['PRICE<5', 'MCAP>300M'] },
};

export const DEFAULT_SORT = { by: 'MCAP', dir: 'HIGH' };
const KEYWORDS = new Set(['SECTOR', 'INDUSTRY', 'COUNTRY', 'SORT', ...Object.keys(PRESETS)]);
const COND_RE = /^(%?[A-Z]+)(>=|<=|>|<)(-?\$?\d[\d,]*(?:\.\d+)?|-?\$?\.\d+)(%|[KMBT])?$/;
const MULT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

const letters = (s) => String(s).toUpperCase().replace(/[^A-Z]/g, '');

// "MCAP > 10B" and "mcap>10b" both become the one word "MCAP>10B".
export function screenTokens(raw) {
  const s = Array.isArray(raw) ? raw.join(' ') : String(raw ?? '');
  return s.toUpperCase().replace(/\s*(>=|<=|>|<)\s*/g, '$1').trim().split(/\s+/).filter(Boolean);
}

export function matchSector(words) {
  const w = letters(words);
  if (!w) return null;
  return SECTORS.find((s) => s.code === w || letters(s.name) === w || s.aliases.includes(w)) || null;
}

export function matchCountry(words) {
  const w = letters(words);
  if (!w) return null;
  const code = COUNTRY_ALIASES[w] || w;
  if (COUNTRIES[code]) return { code, name: COUNTRIES[code] };
  const hit = Object.entries(COUNTRIES).find(([, name]) => letters(name) === w);
  return hit ? { code: hit[0], name: hit[1] } : null;
}

// "MCAP>10B" -> { field: 'MCAP', op: '>', value: 1e10, text: 'MCAP>10B' }, or null.
export function parseCond(tok) {
  const m = COND_RE.exec(String(tok).toUpperCase());
  if (!m) return null;
  const field = FIELD_ALIASES[m[1]] || m[1];
  const def = FIELDS[field];
  if (!def) return null;
  const suffix = m[4] || '';
  if (suffix && suffix !== '%' && !def.scale) return null;
  if (suffix === '%' && field !== 'CHG') return null;
  const num = Number(m[3].replace(/[$,]/g, ''));
  if (!Number.isFinite(num)) return null;
  const value = num * (MULT[suffix] || 1);
  const shown = m[3].replace(/[$,]/g, '') + (suffix === '%' ? '' : suffix);
  return { field, op: m[2], value, text: `${field}${m[2]}${shown}` };
}

// Words after SCREEN -> a spec, or { error, bad }.
export function parseScreenArgs(args) {
  const toks = screenTokens(args);
  const spec = { preset: null, sector: null, industry: null, country: null, conds: [], sort: null };
  let i = 0;
  const phrase = () => {
    const words = [];
    while (i < toks.length && !KEYWORDS.has(toks[i]) && !parseCond(toks[i])) words.push(toks[i++]);
    return words;
  };
  while (i < toks.length) {
    const t = toks[i++];
    if (PRESETS[t]) {
      if (spec.preset && spec.preset !== t) return { error: 'preset', bad: t };
      spec.preset = t;
    } else if (t === 'SECTOR') {
      const words = phrase();
      const s = matchSector(words.join(' '));
      if (!s) return { error: 'sector', bad: words.join(' ') || t };
      spec.sector = s.code;
    } else if (t === 'COUNTRY') {
      const words = phrase();
      const c = matchCountry(words.join(' '));
      if (!c) return { error: 'country', bad: words.join(' ') || t };
      spec.country = c.code;
    } else if (t === 'INDUSTRY') {
      const words = phrase();
      const text = words.join(' ').replace(/[^A-Z0-9&/ -]/g, '').trim();
      if (!text) return { error: 'industry', bad: t };
      spec.industry = text;
    } else if (t === 'SORT') {
      const by = FIELD_ALIASES[toks[i]] || toks[i];
      if (!SORTS[by]) return { error: 'sort', bad: toks[i] || t };
      i += 1;
      let dir = SORTS[by].text ? 'LOW' : 'HIGH';
      if (toks[i] === 'HIGH' || toks[i] === 'LOW') dir = toks[i++];
      spec.sort = { by, dir };
    } else {
      const c = parseCond(t);
      if (!c) return { error: 'usage', bad: t };
      spec.conds.push(c);
    }
  }
  return spec;
}

// The spec back to words, in one fixed order, so the form, the URL and the command bar agree.
export function screenWords(spec) {
  const out = [];
  if (spec.preset) out.push(spec.preset);
  if (spec.sector) out.push('SECTOR', spec.sector);
  if (spec.industry) out.push('INDUSTRY', spec.industry);
  if (spec.country) out.push('COUNTRY', spec.country);
  const conds = [...(spec.conds || [])].sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field));
  for (const c of conds) out.push(c.text);
  if (spec.sort) {
    const def = SORTS[spec.sort.by];
    const natural = def?.text ? 'LOW' : 'HIGH';
    out.push('SORT', spec.sort.by);
    if (spec.sort.dir !== natural) out.push(spec.sort.dir);
  }
  return out.join(' ');
}

export function isEmptySpec(spec) {
  return !spec.preset && !spec.sector && !spec.industry && !spec.country && !spec.conds.length;
}

// The sort in force: typed SORT, else the preset's, else market cap, biggest first.
export function sortOf(spec) {
  return spec.sort || PRESETS[spec.preset]?.sort || DEFAULT_SORT;
}

// Every condition in force, the preset's included.
export function allConds(spec) {
  const pre = spec.preset ? PRESETS[spec.preset].conds.map(parseCond) : [];
  return [...pre, ...spec.conds];
}

function test(v, op, x) {
  if (!Number.isFinite(v)) return false;
  switch (op) {
    case '>': return v > x;
    case '<': return v < x;
    case '>=': return v >= x;
    case '<=': return v <= x;
    default: return false;
  }
}

// rows: [{ symbol, name, last, changePct, marketCap, volume, sector, industry, country }].
// Returns the matching rows, sorted. A row with no value for a filtered number is left out.
export function applyScreen(rows, spec) {
  const conds = allConds(spec);
  const sector = spec.sector ? SECTORS.find((s) => s.code === spec.sector)?.name : null;
  const country = spec.country ? COUNTRIES[spec.country] : null;
  const industry = spec.industry ? spec.industry.toUpperCase() : null;
  const out = rows.filter((r) => {
    if (sector && r.sector !== sector) return false;
    if (country && r.country !== country) return false;
    if (industry && !String(r.industry || '').toUpperCase().includes(industry)) return false;
    return conds.every((c) => test(r[FIELDS[c.field].key], c.op, c.value));
  });
  return sortRows(out, sortOf(spec));
}

// Missing values always sink to the bottom; ties break on symbol.
export function sortRows(rows, { by, dir }) {
  const def = SORTS[by] || SORTS.MCAP;
  const k = def.key;
  const sign = dir === 'LOW' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[k];
    const y = b[k];
    const xm = def.text ? !x : !Number.isFinite(x);
    const ym = def.text ? !y : !Number.isFinite(y);
    if (xm || ym) return xm === ym ? cmpSym(a, b) : xm ? 1 : -1;
    const c = def.text ? String(x).localeCompare(String(y)) : x - y;
    return c ? c * sign : cmpSym(a, b);
  });
}
const cmpSym = (a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);

export const SCREEN_ERRORS = {
  usage: (bad) => `SCREEN does not know "${bad}". Filters look like MCAP>10B, PRICE<50, CHG>2 or VOL>1M.`,
  sector: (bad) => `No sector called "${bad}". Pick one from the list.`,
  country: (bad) => `No country called "${bad}". Use a code like US, CA or UK.`,
  industry: () => 'INDUSTRY needs a word, like INDUSTRY SEMICONDUCTORS.',
  sort: (bad) => `Cannot sort by "${bad}". Try SORT MCAP, SORT CHG or SORT PRICE LOW.`,
  preset: () => 'Pick one preset at a time.',
};

// The command bar entry point: { name: 'SCREEN', args, error, input }.
export function parseScreenCommand(rest) {
  const args = parseScreenArgs(rest);
  if (args.error) return { name: 'SCREEN', args, error: args.error, input: ['SCREEN', ...screenTokens(rest)].join(' ') };
  const words = screenWords(args);
  return { name: 'SCREEN', args, input: words ? `SCREEN ${words}` : 'SCREEN' };
}
