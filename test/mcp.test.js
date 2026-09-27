// MCP endpoint (lib/mcp/): protocol (legacy initialize and modern 2026-07-28), every
// tool, caps, limits, the provenance envelope, the gauge allowlist, links, /llms.txt.
// No network: every data source is a fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import {
  mountMcp, MODERN_VERSION, LEGACY_VERSIONS, SUPPORTED_VERSIONS, MAX_BODY, ERR, decodeHeader,
} from '../lib/mcp/server.js';
import { makeTools, TOOLS, TOOL_DEFS, MAX_ROWS, MAX_PERIODS, MAX_POINTS, seriesOut } from '../lib/mcp/tools.js';
import { makeMcpLimits, makeStats, MCP_LIMITS, windowLimiter } from '../lib/mcp/limits.js';
import { NOTICE, provenance, isoOf } from '../lib/mcp/envelope.js';
import { MCP_GAUGES, MCP_GAUGE_IDS, mcpGauge } from '../lib/mcp/gauges.js';
import { parseCurrent, queuedFetch, currentUrl, CURRENT_FORMS } from '../lib/mcp/sec.js';
import { validateArgs } from '../lib/mcp/validate.js';
import { OUTPUT_SCHEMAS, checkSchema } from '../lib/mcp/schemas.js';
import { llmsTxt, mountLlmsTxt } from '../lib/mcp/llms.js';
import { GAUGES } from '../data/weird/index.js';
import { SEC_UA } from '../data/financials.js';
import { makeFilings, SecBusyError } from '../data/filings.js';
import { parseCommand } from '../public/app.js';
import { findCommand, REGISTRY } from '../public/registry.js';
import { mcpHtml, MCP_URL, MCP_APPS, MCP_RULE } from '../public/screens/mcp.js';
import { TERMS_VERSION } from '../public/legal-version.js';

// The brand word the house rules ban, never written out in full.
const BANNED = ['bloom', 'berg'].join('');
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);
const ISO0 = new Date(T0).toISOString();

// ---- fakes ---------------------------------------------------------------------------

function fakeCurrent() {
  const calls = [];
  return {
    calls,
    async getCurrent(form) {
      calls.push(form);
      const rows = Array.from({ length: 50 }, (_, i) => ({
        form, company: `Company ${i}`, cik: 1000 + i, ticker: i % 2 ? `T${i}` : null, filed_at: '2026-09-26T01:00:00.000Z',
        accession: `0000000000-26-${String(i).padStart(6, '0')}`, url: `https://www.sec.gov/Archives/edgar/data/${1000 + i}/x-index.htm`,
      }));
      return { value: { updated: '2026-09-27T11:59:00.000Z', rows }, stale: false, fetchedAt: T0 - 30_000 };
    },
  };
}

async function fakeGetFilings(ticker, form) {
  if (ticker === 'ZZZZ') throw Object.assign(new Error('No SEC filings for ZZZZ. Only companies that file with the SEC are listed.'), { code: 'not_found' });
  if (ticker === 'DOWN') throw Object.assign(new Error('SEC data is taking a break.'), { code: 'unavailable' });
  const rows = Array.from({ length: 40 }, (_, i) => ({ form: '8-K', family: '8-K', filed: `2026-09-${String(26 - (i % 20)).padStart(2, '0')}`, period: null, description: 'Current report: Results', items: ['2.02'], accepted: '2026-09-26T20:30:00.000Z', url: `https://www.sec.gov/Archives/edgar/data/320193/${i}/` }));
  return { ticker, form, name: 'Apple Inc.', cik: 320193, rows, counts: {}, matched: 40, stale: false, updated: new Date(T0 - 60_000).toISOString(), source: 'US SEC EDGAR filing index' };
}

function fakeFinancials() {
  const periods = Array.from({ length: 10 }, (_, i) => ({ end: `${2016 + i}-09-30`, fy: 2016 + i, label: `FY${2016 + i}`, accn: `0000320193-${16 + i}-000001`, form: '10-K', filed: `${2016 + i}-10-30` }));
  const vals = (base) => periods.map((_, i) => ({ v: base + i, form: '10-K', filed: periods[i].filed, ...(i === 9 ? { derived: true } : {}) }));
  const mode = { periods, values: { revenue: vals(100), grossProfit: vals(50), operatingIncome: vals(30), netIncome: vals(20), epsDiluted: vals(1), sharesDiluted: vals(1000), cash: vals(5), totalAssets: vals(500), totalLiabilities: vals(300), longTermDebt: vals(80), equity: vals(200), operatingCashFlow: vals(40), capex: vals(10), dividendsPaid: vals(3), freeCashFlow: vals(30) }, ratios: {} };
  return async (t) => {
    if (t === 'ZZZZ') throw Object.assign(new Error('No SEC filings for this symbol.'), { code: 'not_found' });
    return { ticker: t, title: 'Apple Inc.', name: 'Apple Inc.', cik: 320193, annual: mode, quarterly: mode, updated: new Date(T0 - 3600_000).toISOString(), stale: false, source: 'SEC', split: null };
  };
}

// Answers for ANY gauge id, so a test can prove the tools never ask for an excluded one.
function fakeGauges() {
  const asked = [];
  const hist = { step: 'day', d: Array.from({ length: 600 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86400_000).toISOString().slice(0, 10)), series: [{ key: 'total', label: 'Total', v: Array.from({ length: 600 }, (_, i) => i) }], lead: 'total', bucket: 1 };
  async function getGauge(id, opts = {}) {
    asked.push(id);
    const base = { id, ok: true, headline: `${id.toUpperCase()} 1`, line: `${id} line`, asOf: '2026-09-25', source: 'X', stale: false, updated: new Date(T0 - 120_000).toISOString(), period: opts.period || '1Y', hist };
    if (id === 'omens') return { ...base, moon: { name: 'Full moon', lit: 0.98, age: 15.2, nextFull: '2026-10-26T04:12:59.121Z', nextNew: '2026-10-10T15:51:13.855Z' }, sky: { text: 'Fair', tempC: 15, at: '2026-09-27T11:51:00+00:00' }, sunspots: { month: '2026-08', ssn: 76 } };
    if (id === 'sick') return { ...base, rows: [{ label: 'COVID', week: '2026-09-05', level: 2.7, sites: 1000, level4w: 1.1, change4w: 1.6, points: [1, 2, 3] }] };
    return { ...base, value: 1, unit: '%' };
  }
  return { getGauge, asked };
}

const BLS = JSON.parse(readFileSync(new URL('../data/bls-monthly.json', import.meta.url), 'utf8'));

async function start({ limits = makeMcpLimits(), tools, origins, log = () => {} } = {}) {
  const app = express();
  const gauges = fakeGauges();
  const current = fakeCurrent();
  const stats = makeStats({ every: 0, log: () => {} });
  const t = tools || makeTools({ current, getFilings: fakeGetFilings, getFinancials: fakeFinancials(), getGauge: gauges.getGauge, now: () => T0 });
  mountMcp(app, { tools: t, limits, stats, log, ...(origins ? { allowedOrigins: origins } : {}) });
  mountLlmsTxt(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  let id = 0;
  // Legacy (initialize era) call.
  const rpc = async (method, params, headers = { 'MCP-Protocol-Version': '2025-11-25' }) => {
    const r = await post({ jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) }, headers);
    return { status: r.status, headers: r.headers, body: await r.json() };
  };
  const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).body.result;
  // Modern (2026-07-28) call, with the headers the spec requires.
  const modern = async (method, params = {}, extra = {}) => {
    const meta = { 'io.modelcontextprotocol/protocolVersion': MODERN_VERSION, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' } };
    const headers = { 'MCP-Protocol-Version': MODERN_VERSION, 'Mcp-Method': method, ...(method === 'tools/call' ? { 'Mcp-Name': params.name } : {}), ...extra.headers };
    const r = await post({ jsonrpc: '2.0', id: ++id, method, params: { ...params, _meta: { ...meta, ...(extra.meta || {}) } } }, headers);
    return { status: r.status, body: await r.json() };
  };
  return { server, base, post, rpc, call, modern, gauges, current, stats };
}

function assertEnvelope(p, where = '') {
  assert.ok(p, `envelope missing ${where}`);
  assert.deepEqual(Object.keys(p).sort(), ['age_seconds', 'as_of', 'fetched_at', 'notice', 'source', 'source_url'], where);
  assert.equal(p.notice, NOTICE);
  assert.ok(p.source && typeof p.source === 'string', where);
  assert.match(p.source_url, /^https:\/\//, where);
  assert.ok(isoOf(p.as_of) === p.as_of && isoOf(p.fetched_at) === p.fetched_at, `ISO times ${where}`);
  assert.ok(Number.isInteger(p.age_seconds) && p.age_seconds >= 0, where);
}

const GOOD_ARGS = {
  latest_filings: {},
  company_filings: { ticker: 'AAPL' },
  company_financials: { ticker: 'AAPL' },
  weird_gauges: {},
  weird_gauge: { name: 'panic' },
  cpi: {},
  open_in_bloombroke: { command: 'AAPL 1Y' },
  bloombroke_pro: {},
};

// ---- protocol ------------------------------------------------------------------------

test('mcp legacy: initialize negotiates a version, no session, notifications get 202', async () => {
  const s = await start();
  try {
    const init = await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }, {});
    assert.equal(init.status, 200);
    assert.equal(init.body.result.protocolVersion, '2025-06-18');
    assert.deepEqual(init.body.result.capabilities, { tools: { listChanged: false } });
    assert.equal(init.body.result.serverInfo.name, 'bloombroke');
    assert.equal(init.headers.get('mcp-session-id'), null, 'stateless: no session is minted');
    const odd = await s.rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {} }, {});
    assert.equal(odd.body.result.protocolVersion, LEGACY_VERSIONS[0]);
    const note = await s.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(note.status, 202);
    assert.equal(await note.text(), '');
    assert.deepEqual((await s.rpc('ping')).body.result, {});
    // Without the header (2025-03-26 clients) a request still works; a bad header does not.
    assert.equal((await s.rpc('tools/list', undefined, {})).body.result.tools.length, TOOLS.length);
    const bad = await s.rpc('tools/list', undefined, { 'MCP-Protocol-Version': '2024-01-01' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, ERR.unsupportedVersion);
    assert.deepEqual(bad.body.error.data.supported, SUPPORTED_VERSIONS);
    const nf = await s.rpc('resources/list');
    assert.equal(nf.body.error.code, ERR.methodNotFound);
  } finally { s.server.close(); }
});

test('mcp tools/list: every tool read-only with a title and annotations, fixed order', async () => {
  const s = await start();
  try {
    const { tools } = (await s.rpc('tools/list')).body.result;
    assert.deepEqual(tools.map((t) => t.name), ['latest_filings', 'company_filings', 'company_financials', 'weird_gauges', 'weird_gauge', 'cpi', 'open_in_bloombroke', 'bloombroke_pro']);
    assert.deepEqual((await s.rpc('tools/list')).body.result, { tools }, 'deterministic');
    for (const t of tools) {
      assert.ok(t.title && t.description && t.inputSchema?.type === 'object', t.name);
      assert.equal(t.annotations.readOnlyHint, true, t.name);
      assert.equal(t.annotations.destructiveHint, false, t.name);
      assert.equal(typeof t.annotations.openWorldHint, 'boolean', t.name);
      assert.equal(t.inputSchema.additionalProperties, false, t.name);
      assert.ok(/^[a-z_]{1,64}$/.test(t.name));
    }
  } finally { s.server.close(); }
});

test('mcp modern (2026-07-28): discover, list and call, stateless, with headers checked', async () => {
  const s = await start();
  try {
    const d = await s.modern('server/discover');
    assert.equal(d.status, 200);
    assert.equal(d.body.result.resultType, 'complete');
    assert.deepEqual(d.body.result.supportedVersions, SUPPORTED_VERSIONS);
    assert.ok(d.body.result.capabilities.tools);
    assert.equal(d.body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'bloombroke');
    assert.ok(d.body.result.ttlMs >= 0 && d.body.result.cacheScope === 'public');
    const l = await s.modern('tools/list');
    assert.equal(l.body.result.resultType, 'complete');
    assert.equal(l.body.result.tools.length, TOOLS.length);
    assert.ok(l.body.result.ttlMs > 0 && l.body.result.cacheScope === 'public');
    const c = await s.modern('tools/call', { name: 'cpi', arguments: {} });
    assert.equal(c.status, 200);
    assert.equal(c.body.result.resultType, 'complete');
    assert.equal(c.body.result.isError, false);
    assertEnvelope(c.body.result.structuredContent.provenance, 'modern cpi');
    // A Base64 sentinel Mcp-Name is decoded before the check.
    const b64 = await s.modern('tools/call', { name: 'cpi', arguments: {} }, { headers: { 'Mcp-Name': `=?base64?${Buffer.from('cpi').toString('base64')}?=` } });
    assert.equal(b64.status, 200);
    assert.equal(decodeHeader('=?base64?Y3Bp?='), 'cpi');
    // Header failures: 400 with HeaderMismatch.
    for (const headers of [{ 'Mcp-Name': 'latest_filings' }, { 'Mcp-Method': 'tools/list' }, { 'MCP-Protocol-Version': '2025-11-25' }]) {
      const r = await s.modern('tools/call', { name: 'cpi', arguments: {} }, { headers });
      assert.equal(r.status, 400, JSON.stringify(headers));
      assert.equal(r.body.error.code, ERR.headerMismatch);
    }
    const noName = await s.post({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'cpi', _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN_VERSION, 'io.modelcontextprotocol/clientCapabilities': {} } } }, { 'MCP-Protocol-Version': MODERN_VERSION, 'Mcp-Method': 'tools/call' });
    assert.equal(noName.status, 400);
    assert.equal((await noName.json()).error.code, ERR.headerMismatch);
    // Unsupported version: 400 with the list; missing capabilities: invalid params.
    const v = await s.modern('tools/list', {}, { meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' }, headers: { 'MCP-Protocol-Version': '2099-01-01' } });
    assert.equal(v.status, 400);
    assert.equal(v.body.error.code, ERR.unsupportedVersion);
    assert.deepEqual(v.body.error.data, { supported: SUPPORTED_VERSIONS, requested: '2099-01-01' });
    const caps = await s.modern('tools/list', {}, { meta: { 'io.modelcontextprotocol/clientCapabilities': undefined } });
    assert.equal(caps.status, 400);
    assert.equal(caps.body.error.code, ERR.invalidParams);
    // The modern header without _meta: malformed.
    const bare = await s.rpc('tools/list', undefined, { 'MCP-Protocol-Version': MODERN_VERSION, 'Mcp-Method': 'tools/list' });
    assert.equal(bare.status, 400);
    assert.equal(bare.body.error.code, ERR.invalidParams);
    // ping is gone in the modern era: 404, method not found.
    const ping = await s.modern('ping');
    assert.equal(ping.status, 404);
    assert.equal(ping.body.error.code, ERR.methodNotFound);
  } finally { s.server.close(); }
});

test('mcp transport: POST only, origin, content type, accept, size, parse errors, batches', async () => {
  const s = await start();
  try {
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const r = await fetch(`${s.base}/mcp`, { method });
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.get('allow'), 'POST');
    }
    for (const origin of ['null', 'http://evil.example', 'https://evil.example/path', 'javascript:alert(1)']) {
      const evil = await s.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Origin: origin });
      assert.equal(evil.status, 403, origin);
      assert.equal((await evil.json()).id, undefined, 'no id: the request was never read');
    }
    assert.equal((await s.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Origin: 'https://claude.ai' })).status, 200, 'a public endpoint: any https origin');
    assert.equal((await s.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Origin: 'https://bloombroke.com' })).status, 200);
    assert.equal((await s.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Origin: 'http://localhost:6274' })).status, 200, 'the MCP Inspector on loopback');
    assert.equal((await s.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await s.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Accept: 'text/html' })).status, 406);
    const big = await s.post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(MAX_BODY) } }));
    assert.equal(big.status, 413);
    const junk = await s.post('{not json');
    assert.equal(junk.status, 400);
    assert.equal((await junk.json()).error.code, ERR.parse);
    const batch = await s.post([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
    assert.equal(batch.status, 400);
    assert.equal((await batch.json()).error.code, ERR.invalidRequest);
    const noVer = await s.post({ id: 1, method: 'tools/list' });
    assert.equal(noVer.status, 400);
    const nullId = await s.post({ jsonrpc: '2.0', id: null, method: 'tools/list' });
    assert.equal(nullId.status, 400);
    assert.equal((await s.rpc('tools/call', { name: 'nope', arguments: {} })).body.error.code, ERR.invalidParams, 'unknown tool: a protocol error');
    assert.equal((await s.rpc('tools/call', { name: 'cpi', arguments: [1] })).body.error.code, ERR.invalidParams);
    const r = await s.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-type'), /^application\/json/);
  } finally { s.server.close(); }
});

// ---- tools ---------------------------------------------------------------------------

test('mcp tools: every tool answers with structuredContent, a text summary and the envelope', async () => {
  const s = await start();
  try {
    for (const t of TOOLS) {
      const r = await s.call(t.name, GOOD_ARGS[t.name]);
      assert.equal(r.isError, false, `${t.name}: ${r.content?.[0]?.text}`);
      assert.equal(r.content[0].type, 'text');
      assert.ok(r.content[0].text.length > 0 && r.content[0].text.length < 2000, `${t.name}: short summary`);
      assert.deepEqual(JSON.parse(r.content[1].text), r.structuredContent, `${t.name}: the JSON text is the structured content`);
      assertEnvelope(r.structuredContent.provenance, t.name);
      assert.deepEqual(t.outputSchema, OUTPUT_SCHEMAS[t.name], `${t.name}: outputSchema listed`);
      assert.deepEqual(checkSchema(t.outputSchema, r.structuredContent), [], `${t.name}: fits its outputSchema`);
      assert.ok(JSON.stringify(r).length < 64 * 1024, `${t.name}: reasonably sized`);
      assert.doesNotMatch(JSON.stringify(r), new RegExp(BANNED, 'i'));
    }
  } finally { s.server.close(); }
});

test('mcp latest_filings and company_filings: rows capped, form checked, errors are tool errors', async () => {
  const s = await start();
  try {
    let r = await s.call('latest_filings', {});
    assert.equal(r.structuredContent.form, '8-K');
    assert.equal(r.structuredContent.rows.length, 10);
    r = await s.call('latest_filings', { form: '4', limit: 20 });
    assert.equal(r.structuredContent.rows.length, MAX_ROWS);
    r = await s.call('latest_filings', { form: '13d', limit: 2 });
    assert.equal(r.structuredContent.form, 'SCHEDULE 13D', '13D is the SCHEDULE 13D feed');
    assert.equal(r.structuredContent.provenance.fetched_at, new Date(T0 - 30_000).toISOString());
    assert.equal(r.structuredContent.provenance.age_seconds, 30);
    assert.equal(r.structuredContent.provenance.as_of, '2026-09-27T11:59:00.000Z');
    for (const bad of [{ limit: 21 }, { limit: 0 }, { limit: 'lots' }, { form: 'X-99' }, { extra: 1 }]) {
      const e = await s.call('latest_filings', bad);
      assert.equal(e.isError, true, JSON.stringify(bad));
    }
    r = await s.call('company_filings', { ticker: 'aapl', form: '8-k', limit: 20 });
    assert.equal(r.isError, false);
    assert.equal(r.structuredContent.rows.length, MAX_ROWS);
    assert.equal(r.structuredContent.link, 'https://bloombroke.com/?c=AAPL+FILINGS');
    assert.equal(r.structuredContent.provenance.source, 'SEC EDGAR company submissions');
    assert.equal((await s.call('company_filings', { ticker: 'ZZZZ' })).isError, true);
    assert.match((await s.call('company_filings', { ticker: 'ZZZZ' })).content[0].text, /No SEC filings for ZZZZ/);
    assert.match((await s.call('company_filings', { ticker: 'DOWN' })).content[0].text, /taking a break/);
    for (const bad of [{}, { ticker: 'AAPL; DROP' }, { ticker: 'TOOLONGTICKER' }, { ticker: 'AAPL', limit: 21 }, { ticker: 'AAPL', form: '13F' }]) {
      assert.equal((await s.call('company_filings', bad)).isError, true, JSON.stringify(bad));
    }
  } finally { s.server.close(); }
});

test('mcp company_financials: filed lines only, periods capped, no prices or ratios', async () => {
  const s = await start();
  try {
    let r = await s.call('company_financials', { ticker: 'AAPL', statement: 'income', periods: 8 });
    const d = r.structuredContent;
    assert.equal(d.periods.length, MAX_PERIODS);
    assert.deepEqual(d.periods.map((p) => p.label), ['FY2018', 'FY2019', 'FY2020', 'FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025'], 'newest 8, oldest first');
    assert.deepEqual(d.lines.map((l) => l.id), ['revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'epsDiluted', 'sharesDiluted']);
    assert.deepEqual(d.lines[0].values, [102, 103, 104, 105, 106, 107, 108, 109]);
    assert.deepEqual(d.lines[0].derived_periods, ['FY2025']);
    assert.match(d.periods[0].filing_url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\/\d{18}\/$/);
    assert.doesNotMatch(JSON.stringify(d), /price|market ?cap|mktcap|p\/e|"pe"|ratio|margin/i);
    assert.equal(d.provenance.as_of, '2025-10-30T00:00:00.000Z', 'as of the newest filing shown');
    r = await s.call('company_financials', { ticker: 'AAPL', statement: 'cash', frequency: 'quarterly', periods: 2 });
    assert.deepEqual(r.structuredContent.lines.map((l) => l.id), ['operatingCashFlow', 'capex', 'dividendsPaid', 'freeCashFlow']);
    r = await s.call('company_financials', { ticker: 'AAPL', statement: 'balance', periods: 1 });
    assert.deepEqual(r.structuredContent.lines.map((l) => l.id), ['cash', 'totalAssets', 'totalLiabilities', 'longTermDebt', 'equity']);
    for (const bad of [{ ticker: 'AAPL', periods: 9 }, { ticker: 'AAPL', statement: 'ratios' }, { ticker: 'AAPL', frequency: 'daily' }, { ticker: 'ZZZZ' }]) {
      assert.equal((await s.call('company_financials', bad)).isError, true, JSON.stringify(bad));
    }
  } finally { s.server.close(); }
});

test('mcp gauges: only public-source gauges, each with its own envelope, points capped', async () => {
  const s = await start();
  try {
    const all = await s.call('weird_gauges', {});
    assert.deepEqual(all.structuredContent.gauges.map((g) => g.id), MCP_GAUGE_IDS);
    for (const g of all.structuredContent.gauges) {
      assertEnvelope(g.provenance, g.id);
      assert.equal(g.status, 'ok');
      assert.match(g.link, /^https:\/\/bloombroke\.com\/\?c=[A-Z]+$/);
    }
    let r = await s.call('weird_gauge', { name: 'panic', period: '5Y', points: MAX_POINTS });
    assert.ok(r.structuredContent.series.dates.length <= MAX_POINTS);
    assert.equal(r.structuredContent.series.dates.length, r.structuredContent.series.series[0].values.length);
    assert.equal(r.structuredContent.series.period, '5Y');
    r = await s.call('weird_gauge', { name: 'MOON', points: 10 });
    assert.equal(r.structuredContent.id, 'omens', 'command words name the gauge');
    assert.ok(r.structuredContent.series.dates.length <= 10);
    assert.deepEqual(r.structuredContent.parts.map((p) => p.part), ['moon', 'sky', 'sunspots']);
    for (const p of r.structuredContent.parts) assertEnvelope(p.provenance, `omens ${p.part}`);
    assert.equal(r.structuredContent.parts[2].provenance.as_of, '2026-08-01T00:00:00.000Z');
    r = await s.call('weird_gauge', { name: 'sick' });
    assert.ok(!JSON.stringify(r.structuredContent.detail).includes('points'), 'no raw point lists in the detail');
    for (const bad of [{ name: 'panic', points: 251 }, { name: 'panic', points: 1 }, { name: 'panic', period: '2Y' }, {}]) {
      assert.equal((await s.call('weird_gauge', bad)).isError, true, JSON.stringify(bad));
    }
  } finally { s.server.close(); }
});

test('mcp gauges: every excluded gauge is unreachable, by id and by command', async () => {
  const s = await start();
  try {
    const allowedSources = new Set(['Wikimedia', 'NWS, NOAA SWPC', 'BLS', 'SEC EDGAR', 'Federal Reserve', 'CDC NWSS']);
    for (const g of MCP_GAUGES) {
      const mod = GAUGES.find((x) => x.id === g.id);
      assert.ok(mod, g.id);
      assert.ok(allowedSources.has(mod.source), `${g.id}: source ${mod.source} is public domain or open`);
    }
    const excluded = GAUGES.filter((g) => !MCP_GAUGE_IDS.includes(g.id));
    assert.deepEqual(excluded.map((g) => g.id).sort(), ['bigmac', 'billions', 'boxes', 'boxrate', 'canal', 'degen', 'eggs', 'hiring', 'hotdog', 'lipstick', 'macau', 'odds', 'pizza', 'rides', 'trucks', 'waffle', 'wsb']);
    for (const g of excluded) {
      const cmd = findCommand(g.id.toUpperCase())?.name;
      for (const name of [g.id, g.id.toUpperCase(), cmd].filter(Boolean)) {
        assert.equal(mcpGauge(name), null, name);
        const r = await s.call('weird_gauge', { name });
        assert.equal(r.isError, true, name);
      }
    }
    // The tools never asked the gauge store for an excluded gauge, even the list.
    await s.call('weird_gauges', {});
    assert.ok(s.gauges.asked.every((id) => MCP_GAUGE_IDS.includes(id)), s.gauges.asked.join());
    for (const t of TOOLS) assert.doesNotMatch(t.description, /\b(canal|pizza|hotdog|waffle|rides|billions|wsb|macau|bigmac)\b/i, t.name);
  } finally { s.server.close(); }
});

test('mcp cpi: BLS months, default the last 24, range checked', async () => {
  const s = await start();
  try {
    const s0 = BLS.series.CUUR0000SA0;
    let r = await s.call('cpi', {});
    const d = r.structuredContent;
    assert.equal(d.months.length, 24);
    assert.equal(d.months.at(-1).month, s0.last);
    assert.equal(d.months.at(-1).index, s0.values[s0.last]);
    const yb = `${Number(s0.last.slice(0, 4)) - 1}${s0.last.slice(4)}`;
    assert.equal(d.months.at(-1).change_vs_year_before_pct, Math.round((s0.values[s0.last] / s0.values[yb] - 1) * 10000) / 100);
    assert.equal(d.provenance.source_url, 'https://data.bls.gov/timeseries/CUUR0000SA0');
    assert.match(d.provenance.source, /Bureau of Labor Statistics/);
    r = await s.call('cpi', { from: '2020-01', to: '2020-12' });
    assert.deepEqual(r.structuredContent.months.map((m) => m.month).slice(0, 2), ['2020-01', '2020-02']);
    assert.equal(r.structuredContent.months.length, 12);
    assert.equal((await s.call('cpi', { from: '2007-01' })).structuredContent.months[0].change_vs_year_before_pct, null);
    for (const bad of [{ from: '2020-12', to: '2020-01' }, { from: '1990-01', to: '1990-05' }, { from: '2020-13' }, { from: 'Jan 2020' }]) {
      assert.equal((await s.call('cpi', bad)).isError, true, JSON.stringify(bad));
    }
    // More months than the cap in a longer series: refused.
    const long = { built: '2026-09-27', series: { CUUR0000SA0: { name: 'x', values: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, 100 + i])) } } };
    const t = makeTools({ bls: long, now: () => T0 });
    assert.equal((await t.handlers.cpi({ from: '2000-01', to: '2024-12' })).isError, true);
  } finally { s.server.close(); }
});

test('mcp open_in_bloombroke: registry commands only, correct links, keys never echoed', async () => {
  const s = await start();
  try {
    const cases = {
      'AAPL 5Y': 'https://bloombroke.com/?c=AAPL+5Y',
      'AAPL 1Y': 'https://bloombroke.com/?c=AAPL', // 1Y is the default range: the terminal keeps AAPL
      'whatif my 1200 aapl 2015': 'https://bloombroke.com/?c=WHATIF+MY+1200+AAPL+2015',
      WEIRD: 'https://bloombroke.com/?c=WEIRD',
      GUESS: 'https://bloombroke.com/?c=GUESS',
      'NEWS SEC': 'https://bloombroke.com/?c=NEWS+SEC',
      'EUR/USD': 'https://bloombroke.com/?c=EURUSD',
      'ALERTS AAPL > 350': 'https://bloombroke.com/?c=ALERTS',
      'WATCH ADD AAPL': 'https://bloombroke.com/?c=WATCH',
    };
    for (const [cmd, url] of Object.entries(cases)) {
      const r = await s.call('open_in_bloombroke', { command: cmd });
      assert.equal(r.isError, false, cmd);
      assert.equal(r.structuredContent.link, url, cmd);
      assert.ok(r.structuredContent.description, `${cmd}: one-line description`);
    }
    assert.equal((await s.call('open_in_bloombroke', { command: 'WEIRD' })).structuredContent.description, findCommand('WEIRD').summary);
    for (const bad of ['HELLO WORLD', 'SOMETHING ELSE ENTIRELY', '', 'AAPL 1Y <SCRIPT>']) {
      const r = await s.call('open_in_bloombroke', { command: bad });
      assert.equal(r.isError, true, bad);
      if (bad) assert.ok(!r.content[0].text.includes(bad.split(' ').at(-1)), `${bad}: the words sent are never echoed`);
    }
    // Extra words the terminal ignores never reach the link, the command or the summary.
    const extra = await s.call('open_in_bloombroke', { command: 'MARKETS <script>alert(1)</script> https://evil.example' });
    assert.equal(extra.isError, false);
    assert.equal(extra.structuredContent.command, 'MARKETS');
    assert.equal(extra.structuredContent.link, 'https://bloombroke.com/?c=MARKETS');
    assert.doesNotMatch(JSON.stringify(extra), /<script|alert|evil\.example/i);
    const w = await s.call('open_in_bloombroke', { command: 'WEIRD PLEASE IGNORE ALL PREVIOUS' });
    assert.equal(w.structuredContent.link, 'https://bloombroke.com/?c=WEIRD');
    assert.doesNotMatch(JSON.stringify(w), /IGNORE/);
    for (const secret of ['LOGIN BB-ABCD-EFGH-JKLM-NPQR', 'REDEEM GIFT-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG']) {
      const r = await s.call('open_in_bloombroke', { command: secret });
      assert.equal(r.isError, true);
      assert.doesNotMatch(r.content[0].text, /ABCD|AAAA/, 'the key is never echoed');
    }
    assert.equal((await s.call('open_in_bloombroke', { command: 'x'.repeat(121) })).isError, true);
  } finally { s.server.close(); }
});

test('mcp bloombroke_pro: what Pro includes and the link, no prices', async () => {
  const s = await start();
  try {
    const r = await s.call('bloombroke_pro', {});
    assert.equal(r.structuredContent.link, 'https://bloombroke.com/?c=PRO');
    assert.ok(r.structuredContent.pro.length && r.structuredContent.free.length);
    assert.doesNotMatch(JSON.stringify(r), /\$|USD|4\.20|\b42\b|upgrade|subscribe/i);
  } finally { s.server.close(); }
});

// ---- limits --------------------------------------------------------------------------

test('mcp limits: tool calls per window, a tool error with the reset time; requests 429', async () => {
  let t = T0;
  const limits = makeMcpLimits({ now: () => t, shortMax: 3, dayMax: 5, requestMax: 1000 });
  const s = await start({ limits });
  try {
    for (let i = 0; i < 3; i += 1) assert.equal((await s.call('cpi', {})).isError, false);
    let r = await s.call('cpi', {});
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /3 tool calls per 10 minutes\. Resets at 2026-09-27T12:10:00\.000Z/);
    assert.equal(r.structuredContent.reset_at, '2026-09-27T12:10:00.000Z');
    assert.equal(r.structuredContent.retry_after_seconds, 600);
    assert.equal((await s.rpc('tools/list')).status, 200, 'listing is not a tool call');
    t += 10 * 60_000;
    assert.equal((await s.call('cpi', {})).isError, false);
    assert.equal((await s.call('cpi', {})).isError, false);
    r = await s.call('cpi', {});
    assert.equal(r.isError, true, 'the day window: 5 a day');
    assert.match(r.content[0].text, /5 tool calls per 24 hours/);
    assert.equal(r.structuredContent.reset_at, new Date(T0 + 24 * 3600_000).toISOString());
    // Refused calls did not count against the day, and the short window's refusals did
    // not eat into it either: exactly 5 went through.
    assert.equal(s.stats.snapshot().cpi, 5);
    assert.ok(s.stats.snapshot().refused_limit >= 2);
  } finally { s.server.close(); }
  const s2 = await start({ limits: makeMcpLimits({ now: () => T0, requestMax: 2 }) });
  try {
    await s2.rpc('tools/list');
    await s2.rpc('tools/list');
    const r = await s2.rpc('tools/list');
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('retry-after'), '60');
    assert.equal(r.body.error.code, ERR.tooManyRequests);
  } finally { s2.server.close(); }
});

test('mcp limits: the defaults, per IP bucket, and stats hold counts only', () => {
  assert.deepEqual([MCP_LIMITS.shortMax, MCP_LIMITS.shortWindowMs, MCP_LIMITS.dayMax, MCP_LIMITS.dayWindowMs], [30, 600_000, 300, 86_400_000]);
  let t = T0;
  const l = makeMcpLimits({ now: () => t });
  for (let i = 0; i < 30; i += 1) assert.equal(l.call('1.2.3.4').ok, true);
  assert.equal(l.call('1.2.3.4').ok, false);
  assert.equal(l.call('5.6.7.8').ok, true, 'another address has its own bucket');
  const lines = [];
  const st = makeStats({ every: 0, log: (m) => lines.push(m) });
  st.add('cpi'); st.add('cpi'); st.add('latest_filings');
  st.flush();
  assert.deepEqual(lines, ['[mcp] calls in the last hour {"cpi":2,"latest_filings":1}']);
  assert.equal(st.flush(), null, 'nothing to count: no line');
  t += 1;
});

test('mcp server logs nothing about a request but its tool and outcome', async () => {
  const logs = [];
  const tools = { handlers: { ...makeTools({ now: () => T0 }).handlers, cpi: async () => { throw new Error('secret detail 9.9.9.9'); } } };
  const s = await start({ tools, log: (m) => logs.push(m) });
  try {
    const r = await s.call('cpi', { from: '2020-01' });
    assert.equal(r.isError, true);
    assert.doesNotMatch(r.content[0].text, /secret/);
    assert.deepEqual(logs, ['[mcp cpi] failed']);
  } finally { s.server.close(); }
});

// ---- pieces ----------------------------------------------------------------------------

test('mcp envelope: fields, ISO times, age never below zero', () => {
  const p = provenance({ source: 'BLS', source_url: 'https://www.bls.gov/', as_of: '2026-08', fetched_at: T0 - 5_500, now: T0 });
  assert.deepEqual(p, { source: 'BLS', source_url: 'https://www.bls.gov/', as_of: '2026-08-01T00:00:00.000Z', fetched_at: new Date(T0 - 5500).toISOString(), age_seconds: 6, notice: NOTICE });
  assert.equal(provenance({ source: 'x', source_url: 'https://x.y/', fetched_at: T0 + 9000, now: T0 }).age_seconds, 0);
  assert.equal(provenance({ source: 'x', source_url: 'https://x.y/', now: T0 }).as_of, ISO0);
  assert.equal(NOTICE, 'Information only. Does not assess whether to buy, sell or hold.');
});

test('mcp validate: schema subset, defaults, enums in any case, integers from digits', () => {
  const schema = TOOL_DEFS.find((d) => d.name === 'latest_filings').inputSchema;
  assert.deepEqual(validateArgs(schema, {}), { ok: true, value: { form: '8-K', limit: 10 } });
  assert.deepEqual(validateArgs(schema, { form: '10-q', limit: '5' }), { ok: true, value: { form: '10-Q', limit: 5 } });
  assert.equal(validateArgs(schema, { limit: 2.5 }).ok, false);
  assert.equal(validateArgs(schema, []).ok, false);
  assert.match(validateArgs(schema, { nope: 1 }).error, /Unknown argument "nope"/);
  for (const k of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    const args = JSON.parse(`{"${k}": 1}`);
    assert.equal(validateArgs(schema, args).ok, false, k);
  }
  assert.equal(validateArgs({ type: 'object', properties: {}, additionalProperties: false }, JSON.parse('{"__proto__": {"x": 1}}')).ok, false);
});

test('mcp sec: the latest-filings feed groups parties, names tickers, keeps only the form', () => {
  const xml = `<?xml version="1.0" encoding="ISO-8859-1" ?><feed xmlns="http://www.w3.org/2005/Atom"><title>Latest Filings</title><updated>2026-09-27T02:16:55-04:00</updated>
<entry><title>4 - Bernes Marshall (0002045034) (Reporting)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/2045034/000204503426000009/0002045034-26-000009-index.htm"/><summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-09-25</summary><updated>2026-09-25T21:57:29-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0002045034-26-000009</id></entry>
<entry><title>4 - GigaCloud Technology Inc (0001857816) (Issuer)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1857816/000204503426000009/0002045034-26-000009-index.htm"/><summary type="html">x</summary><updated>2026-09-25T21:57:29-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0002045034-26-000009</id></entry>
<entry><title>424B2 - SOME BANK (0000000001) (Filer)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1/x-index.htm"/><updated>2026-09-25T21:00:00-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000001</id></entry>
<entry><title>4/A - Evil (0000000002) (Issuer)</title><link rel="alternate" type="text/html" href="https://evil.example/x"/><updated>2026-09-25T21:00:00-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000000002-26-000001</id></entry>
</feed>`;
  const out = parseCurrent(xml, '4', new Map([[1857816, 'GCT']]));
  assert.equal(out.updated, '2026-09-27T06:16:55.000Z');
  assert.deepEqual(out.rows, [{
    form: '4', company: 'GigaCloud Technology Inc', cik: 1857816, ticker: 'GCT', filed_at: '2026-09-26T01:57:29.000Z',
    filed_by: ['Bernes Marshall'], accession: '0002045034-26-000009',
    url: 'https://www.sec.gov/Archives/edgar/data/1857816/000204503426000009/0002045034-26-000009-index.htm',
  }], 'one row per accession; 424B2 is not form 4; a non-SEC link is dropped');
  const k8 = `<feed><entry><title>8-K - TIDEWATER INC (0000098222) (Filer)</title><link href="https://www.sec.gov/Archives/edgar/data/98222/a-index.htm"/><summary type="html">Item 1.01: x Item 2.03: y Item 9.01: z</summary><updated>2026-09-25T17:00:00-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000098222-26-000010</id></entry></feed>`;
  const r8 = parseCurrent(k8, '8-K', null).rows[0];
  assert.equal(r8.company, 'Tidewater Inc');
  assert.equal(r8.items, 'Deal, New debt');
  assert.equal(r8.ticker, null);
  assert.ok(CURRENT_FORMS.includes('SCHEDULE 13D') && CURRENT_FORMS.length <= 12);
  assert.equal(currentUrl('SCHEDULE 13D'), 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SCHEDULE%2013D&company=&dateb=&owner=include&count=100&output=atom');
});

test('mcp sec: every SEC request waits in the shared queue with the SEC User-Agent', async () => {
  const queued = [];
  const seen = [];
  const f = queuedFetch(async (url, opts) => { seen.push([url, opts.headers['User-Agent']]); return { ok: true }; }, (task, opts) => { queued.push(opts); return task(); });
  await f('https://www.sec.gov/x', { headers: { 'User-Agent': 'other', Accept: 'a' } });
  assert.deepEqual(queued, [{ low: true }], 'MCP waits in the low lane');
  assert.deepEqual(seen, [['https://www.sec.gov/x', SEC_UA]]);
  // The tools module builds its SEC access on the shared queue from data/filings.js.
  const src = readFileSync('lib/mcp/sec.js', 'utf8');
  assert.match(src, /import \{ secQueued \} from '\.\.\/\.\.\/data\/filings\.js'/);
  assert.match(readFileSync('lib/mcp/tools.js', 'utf8'), /makeFinancials\(\{ fetchImpl: secFetch/);
});

test('mcp series: capped points keep dates and values in step', () => {
  const hist = { step: 'day', d: Array.from({ length: 1000 }, (_, i) => new Date(Date.UTC(2020, 0, 1) + i * 86400_000).toISOString().slice(0, 10)), series: [{ key: 'a', label: 'A', v: Array.from({ length: 1000 }, (_, i) => i / 3) }], lead: 'a', bucket: 2 };
  const s = seriesOut(hist, 250, '5Y');
  assert.ok(s.dates.length <= 250);
  assert.equal(s.series[0].values.length, s.dates.length);
  assert.equal(s.bucket_readings, 2 * 5, 'runs of 5 of the already-paired readings');
  assert.equal(s.dates.at(-1), hist.d.at(-1), 'ends on the newest reading');
  assert.equal(seriesOut(null, 10, '1Y'), null);
});

test('mcp copy: plain factual descriptions, house rules', () => {
  const text = [
    ...TOOLS.flatMap((t) => [t.title, t.description, ...Object.values(t.inputSchema.properties).map((p) => p.description || '')]),
    llmsTxt(), mcpHtml(), readFileSync('server.json', 'utf8'),
  ].join('\n');
  assert.doesNotMatch(text, new RegExp(BANNED, 'i'));
  assert.doesNotMatch(text, /—/, 'no em dash');
  assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'no emoji');
  for (const t of TOOLS) {
    assert.doesNotMatch(t.description, /\b(you should|always use|must use|recommend|best|signal|rating|buy|sell|upgrade)\b/i, t.name);
    assert.ok(t.description.length <= 600, t.name);
  }
});

test('mcp /llms.txt: what Bloombroke is, the URL, every tool, the data rules, the notice', async () => {
  const s = await start();
  try {
    const r = await fetch(`${s.base}/llms.txt`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/plain/);
    const body = await r.text();
    assert.ok(body.startsWith('# Bloombroke\n'));
    assert.ok(body.includes('https://bloombroke.com/mcp'));
    for (const t of TOOLS) assert.ok(body.includes(`- ${t.name}: `), t.name);
    assert.ok(body.includes(NOTICE));
    assert.match(body, /may not be passed on/);
    assert.match(body, /30 tool calls per 10 minutes, 300 per 24 hours/);
    assert.match(body, /50,000 tool calls per 24 hours for everyone together/);
  } finally { s.server.close(); }
});

test('mcp terminal command: MCP opens the screen, plain lines, one per app', () => {
  assert.equal(parseCommand('MCP').name, 'MCP');
  // AI is C3.ai's ticker: never an alias.
  assert.equal(parseCommand('AI').name, 'QUOTE');
  assert.equal(parseCommand('AI FINANCIALS').name, 'FINANCIALS');
  assert.equal(findCommand('AI'), null);
  assert.equal(MCP_URL, 'https://bloombroke.com/mcp');
  assert.deepEqual(MCP_APPS.map(([a]) => a), ['CLAUDE', 'CHATGPT', 'GROK', 'CURSOR']);
  assert.equal(MCP_RULE, 'Free. Public data only. 300 calls a day.');
  assert.equal(MCP_LIMITS.dayMax, 300, 'the screen says what the limiter does');
  const html = mcpHtml();
  assert.ok(html.includes(MCP_URL) && html.includes(MCP_RULE));
  for (const [, how] of MCP_APPS) assert.ok(!how.includes('\n') && how.length < 110, how);
});

test('mcp legal: terms allow the MCP endpoint narrowly, privacy covers its limiter, version 1.2', () => {
  const terms = readFileSync('legal/terms.md', 'utf8');
  const s6 = terms.slice(terms.indexOf('## 6.'), terms.indexOf('## 7.'));
  assert.ok(s6.includes('call our API routes directly'), 'the general rule stays');
  assert.match(s6, /\*\*The MCP endpoint\.\*\* As a narrow exception/);
  assert.match(s6, /within its published limits/);
  assert.match(s6, /for your own personal information only/);
  assert.match(s6, /change the limits of the MCP endpoint, or turn it off/);
  const privacy = readFileSync('legal/privacy.md', 'utf8');
  assert.match(privacy, /counts it per tool\. The count has no IP address/);
  assert.equal(TERMS_VERSION, '1.2');
});

test('mcp server.json: registry entry for the remote, not published from here', () => {
  const j = JSON.parse(readFileSync('server.json', 'utf8'));
  assert.equal(j.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
  assert.equal(j.name, 'com.bloombroke/terminal');
  assert.match(j.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.ok(j.description.length <= 100 && j.title.length <= 100);
  assert.deepEqual(j.remotes, [{ type: 'streamable-http', url: 'https://bloombroke.com/mcp' }]);
});

test('registry: no alias is a listed ticker (SEC company_tickers.json, 2026-09-27)', () => {
  const tickers = new Set(readFileSync('test/fixtures/sec-tickers.txt', 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((t) => t.replace('-', '.')));
  assert.ok(tickers.size > 5000 && tickers.has('AI') && tickers.has('AAPL') && tickers.has('BRK.B'));
  // Older one-letter shortcuts, kept on purpose before this check existed (Hyatt, Macy's).
  const KNOWN = new Set(['H', 'M']);
  const clashes = REGISTRY.flatMap((c) => (c.aliases || []).filter((a) => tickers.has(a) && !KNOWN.has(a)).map((a) => `${a} (${c.name})`));
  assert.deepEqual(clashes, [], 'an alias hides a real ticker');
});

test('mcp limits: a full table never locks everyone out; the global cap bounds the total', () => {
  let t = T0;
  const w = windowLimiter({ max: 2, windowMs: 60_000, now: () => t, maxKeys: 3, sweepEvery: 0 });
  for (const k of ['a', 'b', 'c']) w.hit(k);
  w.hit('a');
  assert.equal(w.blocked('a'), true);
  // Full of live entries: a new address still gets in, the oldest entry makes room.
  assert.equal(w.hit('d').ok, true);
  assert.equal(w.size(), 3);
  assert.equal(w.blocked('a'), false, 'a was the oldest: dropped');
  assert.equal(w.blocked('z'), false, 'no entry: never blocked, even when full');
  t += 60_000;
  assert.equal(w.hit('e').ok, true);
  assert.ok(w.size() <= 3);
  // Through makeMcpLimits: a flood of addresses past maxKeys refuses none of them.
  const l = makeMcpLimits({ now: () => T0, maxKeys: 100, globalDayMax: 1_000_000 });
  for (let i = 0; i < 500; i += 1) assert.equal(l.call(`10.0.${i >> 8}.${i & 255}`).ok, true, `address ${i}`);
  assert.ok(l.size().day <= 100 && l.size().short <= 100);
  // The global cap: every address together.
  const g = makeMcpLimits({ now: () => T0, globalDayMax: 5 });
  for (let i = 0; i < 5; i += 1) assert.equal(g.call(`1.1.1.${i}`).ok, true);
  const r = g.call('9.9.9.9');
  assert.deepEqual([r.ok, r.scope, r.resetAt], [false, 'all', new Date(T0 + 24 * 3600_000).toISOString()]);
});

test('mcp limits: the global cap answers with an honest tool error', async () => {
  const s = await start({ limits: makeMcpLimits({ now: () => T0, globalDayMax: 1 }) });
  try {
    assert.equal((await s.call('cpi', {})).isError, false);
    const r = await s.call('cpi', {});
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /total of 1 tool calls for everyone for this 24 hours\. Resets at 2026-09-28T12:00:00\.000Z/);
  } finally { s.server.close(); }
});

test('SEC queue: the site goes first, the MCP lane is capped and refuses at once when full', async () => {
  const { queued, waiting } = makeFilings({ gapMs: 0, lowMaxWaiting: 2 });
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const first = queued(async () => { await gate; order.push('site-1'); });
  const lowA = queued(async () => order.push('mcp-a'), { low: true });
  const lowB = queued(async () => order.push('mcp-b'), { low: true });
  await assert.rejects(queued(async () => order.push('mcp-c'), { low: true }), (e) => e instanceof SecBusyError && e.code === 'busy');
  const site2 = queued(async () => order.push('site-2'));
  assert.deepEqual(waiting(), { high: 1, low: 2 });
  release();
  await Promise.all([first, lowA, lowB, site2]);
  assert.deepEqual(order, ['site-1', 'site-2', 'mcp-a', 'mcp-b'], 'the site request queued later still goes before MCP work');
  assert.deepEqual(waiting(), { high: 0, low: 0 });
  await assert.rejects(queued(async () => { throw new Error('x'); }), /x/);
  assert.equal(await queued(async () => 7), 7, 'a failed task does not stop the queue');
});

test('mcp tools: a backed-up SEC queue gives a busy tool error, not more SEC work', async () => {
  let asked = 0;
  const t = makeTools({
    secBusy: () => true, now: () => T0,
    getFilings: async () => { asked += 1; return null; },
    getFinancials: async () => { asked += 1; return null; },
    current: { getCurrent: async () => { throw new SecBusyError(); } },
  });
  for (const [name, args] of [['company_filings', { ticker: 'AAPL', form: 'KEY', limit: 5 }], ['company_financials', { ticker: 'AAPL', statement: 'income', frequency: 'annual', periods: 4 }], ['latest_filings', { form: '8-K', limit: 5 }]]) {
    const r = await t.handlers[name](args);
    assert.equal(r.isError, true, name);
    assert.equal(r.content[0].text, 'SEC EDGAR requests are busy on our side. Try again in a minute.', name);
  }
  assert.equal(asked, 0);
});

test('mcp outputSchema: every variant a tool returns fits; an off-schema result is never sent', async () => {
  const s = await start();
  try {
    const variants = [
      ['latest_filings', { form: '4', limit: 20 }], ['company_filings', { ticker: 'AAPL', form: 'ALL', limit: 20 }],
      ['company_financials', { ticker: 'AAPL', statement: 'cash', frequency: 'quarterly', periods: 8 }],
      ['company_financials', { ticker: 'AAPL', statement: 'balance' }],
      ['weird_gauge', { name: 'omens', points: 5 }], ['weird_gauge', { name: 'sick', period: 'MAX' }],
      ['cpi', { from: '2007-01', to: '2007-03' }], ['open_in_bloombroke', { command: 'WATCH ADD AAPL' }],
    ];
    for (const [name, args] of variants) {
      const r = await s.call(name, args);
      assert.equal(r.isError, false, name);
      assert.deepEqual(checkSchema(OUTPUT_SCHEMAS[name], r.structuredContent), [], `${name} ${JSON.stringify(args)}`);
    }
  } finally { s.server.close(); }
  assert.deepEqual(checkSchema(OUTPUT_SCHEMAS.cpi, { months: 'x' }).length > 0, true);
  const logs = [];
  const tools = { handlers: { ...makeTools({ now: () => T0 }).handlers, cpi: async () => ({ content: [{ type: 'text', text: 'x' }], structuredContent: { months: 'wrong' }, isError: false }) } };
  const s2 = await start({ tools, log: (m) => logs.push(m) });
  try {
    const r = await s2.call('cpi', {});
    assert.equal(r.isError, true);
    assert.deepEqual(logs, ['[mcp cpi] result off its schema']);
  } finally { s2.server.close(); }
});
