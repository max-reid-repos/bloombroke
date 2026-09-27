// PROFILE: what a company does. Description, sector, industry and website from the
// Nasdaq API; headquarters and fiscal year end from SEC EDGAR (both no key).

import { createCache } from './cache.js';
import { companyTicker } from './quotes.js';
import { getNasdaq, money, iso } from './lists.js';

const TTL = 24 * 60 * 60_000;
// SEC asks for a User-Agent that names the app and a contact address.
const SEC_HEADERS = { 'User-Agent': 'Bloombroke dev@bloombroke.com', Accept: 'application/json' };

export class ProfileError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const val = (d, k) => {
  const v = d?.[k]?.value;
  return typeof v === 'string' && v.trim() && v.trim() !== 'N/A' ? v.trim() : null;
};

export function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export function parseNasdaqProfile(body) {
  const d = body?.data;
  if (!d) return null;
  const name = val(d, 'CompanyName');
  if (!name) return null;
  return {
    name,
    description: val(d, 'CompanyDescription'),
    sector: val(d, 'Sector'),
    industry: val(d, 'Industry'),
    region: val(d, 'Region'),
    website: safeUrl(val(d, 'CompanyUrl')),
  };
}

export function parseNasdaqSummary(body) {
  const d = body?.data?.summaryData;
  if (!d) return null;
  return {
    exchange: val(d, 'Exchange'),
    marketCap: money(val(d, 'MarketCap')),
    sector: val(d, 'Sector'),
    industry: val(d, 'Industry'),
  };
}

const title = (s) => String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// SEC submissions JSON -> { hq, fiscalYearEnd }.
export function parseSecSubmission(body) {
  const b = body?.addresses?.business;
  let hq = null;
  if (b?.city) {
    const where = b.isForeignLocation === 1 || b.country ? (b.country || b.stateOrCountryDescription) : b.stateOrCountry;
    hq = [title(b.city), where].filter(Boolean).join(', ');
  }
  const fy = /^(\d{2})(\d{2})$/.exec(body?.fiscalYearEnd || '');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return {
    hq,
    fiscalYearEnd: fy && Number(fy[1]) >= 1 && Number(fy[1]) <= 12 ? `${months[Number(fy[1]) - 1]} ${Number(fy[2])}` : null,
  };
}

// SEC company_tickers.json -> Map("BRK-B" -> 1067983)
export function parseSecTickers(body) {
  const map = new Map();
  for (const r of Object.values(body || {})) {
    if (r && typeof r.ticker === 'string' && Number.isFinite(r.cik_str)) map.set(r.ticker.toUpperCase(), r.cik_str);
  }
  return map;
}

export function makeProfile({ fetchImpl = globalThis.fetch, cache = createCache() } = {}) {
  async function sec(url) {
    const res = await fetchImpl(url, { headers: SEC_HEADERS, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`sec source HTTP ${res.status}`);
    return res.json();
  }
  const tickers = () => cache.cached('sec:tickers', TTL, async () => parseSecTickers(await sec('https://www.sec.gov/files/company_tickers.json')));

  async function secFacts(ticker) {
    const { value: map } = await tickers();
    const cik = map.get(ticker.replace('.', '-'));
    if (!cik) return null;
    const { value } = await cache.cached(`sec:${cik}`, TTL, async () => parseSecSubmission(await sec(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`)));
    return value;
  }

  async function getProfile(raw) {
    const ticker = companyTicker(raw);
    if (!ticker) throw new ProfileError('bad_symbol', 'That does not look like a ticker.');
    let got;
    try {
      got = await cache.cached(`profile:${ticker}`, TTL, async () => {
        const [p, s] = await Promise.all([
          getNasdaq(fetchImpl, `company/${encodeURIComponent(ticker)}/company-profile`),
          getNasdaq(fetchImpl, `quote/${encodeURIComponent(ticker)}/summary?assetclass=stocks`).catch(() => null),
        ]);
        return { profile: parseNasdaqProfile(p), summary: parseNasdaqSummary(s) };
      });
    } catch {
      throw new ProfileError('unavailable', 'Company data is taking a break. Try again in a minute.');
    }
    const { profile, summary } = got.value;
    if (!profile) throw new ProfileError('not_found', `No company profile for ${ticker}.`);
    const facts = await secFacts(ticker).catch(() => null);
    return {
      ticker,
      ...profile,
      sector: profile.sector || summary?.sector || null,
      industry: profile.industry || summary?.industry || null,
      exchange: summary?.exchange || null,
      marketCap: summary?.marketCap ?? null,
      hq: facts?.hq || null,
      fiscalYearEnd: facts?.fiscalYearEnd || null,
      stale: got.stale,
      updated: iso(got.fetchedAt),
    };
  }

  return { getProfile };
}

export const { getProfile } = makeProfile();
