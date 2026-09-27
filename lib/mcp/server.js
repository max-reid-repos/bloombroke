// POST /mcp: the Bloombroke MCP endpoint (Streamable HTTP, no auth, read-only tools).
//
// Dual-era, stateless, JSON responses only (never an SSE stream):
// - Modern (spec 2026-07-28): every request carries its protocol version and client
//   capabilities in params._meta, with MCP-Protocol-Version, Mcp-Method and (tools/call)
//   Mcp-Name headers that must match the body. server/discover, tools/list, tools/call.
//   Results carry resultType "complete" and _meta serverInfo; list results carry
//   ttlMs and cacheScope.
// - Legacy (2025-03-26 to 2025-11-25, what most clients speak today): initialize, then
//   tools/list and tools/call. No session is minted: every request stands alone.
// GET, DELETE and anything else: 405. No Mcp-Session-Id, no resumable streams.
//
// Limits (lib/mcp/limits.js): 120 requests a minute per visitor bucket; tool calls 30
// per 10 minutes and 300 per 24 hours, answered as a tool error with the reset time.
// Bodies over MAX_BODY bytes are refused. Nothing about a request is logged but a count
// per tool.

import { clientIp } from '../../pro/ratelimit.js';
import { makeMcpLimits, makeStats } from './limits.js';
import { makeTools, TOOLS, TOOL_DEFS, MCP_TIMEOUT_MS, SITE } from './tools.js';
import { validateArgs } from './validate.js';
import { toolError } from './envelope.js';
import { OUTPUT_SCHEMAS, checkSchema } from './schemas.js';

export const MCP_PATH = '/mcp';
export const MCP_URL = `${SITE}${MCP_PATH}`;
export const MODERN_VERSION = '2026-07-28';
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS];
export const MAX_BODY = 32 * 1024;
export const MAX_RESULT_BYTES = 256 * 1024;
export const LIST_TTL_MS = 60 * 60_000;
export const SERVER_INFO = { name: 'bloombroke', title: 'Bloombroke', version: '0.1.0', websiteUrl: SITE };
export const INSTRUCTIONS = 'Bloombroke public-data tools: SEC EDGAR filings and filed financial statements, BLS CPI-U, and WEIRD gauges from public sources. Market quotes, charts, news, WHATIF and GUESS are not served here; open_in_bloombroke returns a bloombroke.com link for any terminal command. Information only. Does not assess whether to buy, sell or hold.';

// JSON-RPC and MCP error codes.
export const ERR = {
  parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603,
  headerMismatch: -32020, unsupportedVersion: -32022,
  tooManyRequests: -31029, // ours: outside the reserved range, as the spec asks
};

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';
const DEFAULT_ORIGINS = ['https://bloombroke.com', 'https://www.bloombroke.com'];
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

class HttpError extends Error {
  constructor(status, code, message, { id = null, data } = {}) {
    super(message);
    Object.assign(this, { status, code, id, data });
  }
}

// "=?base64?...?=" header values (Mcp-Name) -> the decoded text.
export function decodeHeader(v) {
  if (typeof v !== 'string') return v;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : v;
}

// The body as a Buffer, at most `cap` bytes (a bigger one: 413).
function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.get('content-length'));
    if (Number.isFinite(declared) && declared > cap) { reject(new HttpError(413, ERR.invalidRequest, `Request body over ${cap} bytes.`)); req.resume(); return; }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > cap) { done = true; reject(new HttpError(413, ERR.invalidRequest, `Request body over ${cap} bytes.`)); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (err) => { if (!done) { done = true; reject(err); } });
  });
}

function withTimeout(p, ms) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); timer.unref?.(); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

export function mountMcp(app, {
  tools = makeTools(),
  limits = makeMcpLimits(),
  stats = makeStats(),
  allowedOrigins = DEFAULT_ORIGINS,
  anyHttps = true,
  timeoutMs = MCP_TIMEOUT_MS,
  log = (m) => console.error(m),
} = {}) {
  const defs = new Map(TOOL_DEFS.map((d) => [d.name, d]));

  function send(res, status, body) {
    res.status(status).set({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }).send(JSON.stringify(body));
  }
  function sendError(res, e) {
    const body = { jsonrpc: '2.0', ...(e.id !== null && e.id !== undefined ? { id: e.id } : {}), error: { code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) } };
    send(res, e.status, body);
  }

  // Origin (the spec's DNS rebinding guard). Allowed: no Origin (server-side clients:
  // Claude, ChatGPT and Grok call from their own servers), our own site, loopback (the
  // MCP Inspector), and any well-formed https origin. Why that is enough: this is a
  // public, read-only endpoint on the internet, not a server on someone's own machine,
  // so rebinding has nothing to reach; and it sends no CORS headers, so a web page on
  // another origin cannot read its answers anyway. CORS is deliberately not added.
  // 'null', plain http elsewhere and anything malformed: 403.
  function originOk(origin) {
    if (origin === undefined) return true;
    if (allowedOrigins.includes(origin) || LOOPBACK_ORIGIN.test(origin)) return true;
    if (!anyHttps) return false;
    try {
      const u = new URL(origin);
      return u.protocol === 'https:' && u.origin === origin;
    } catch {
      return false;
    }
  }

  async function callTool(params, key) {
    const name = params?.name;
    if (typeof name !== 'string' || !defs.has(name)) return { error: { code: ERR.invalidParams, message: `Unknown tool: ${String(name).slice(0, 64)}` } };
    const args = params.arguments;
    if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) return { error: { code: ERR.invalidParams, message: 'arguments must be an object.' } };
    const gate = limits.call(key);
    if (!gate.ok) {
      stats.add('refused_limit');
      const what = { '24h': `${limits.limits.dayMax} tool calls per 24 hours`, '10m': `${limits.limits.shortMax} tool calls per 10 minutes` }[gate.scope];
      const text = what ? `Limit reached: ${what}. Resets at ${gate.resetAt}.` : `The MCP server has reached its total of ${limits.limits.globalDayMax} tool calls for everyone for this 24 hours. Resets at ${gate.resetAt}.`;
      return { result: toolError(text, { limit: what || `${limits.limits.globalDayMax} tool calls per 24 hours for everyone`, reset_at: gate.resetAt, retry_after_seconds: gate.retryAfter }) };
    }
    stats.add(name);
    const def = defs.get(name);
    const input = def.normalize ? def.normalize(args || {}) : (args || {});
    const v = validateArgs(def.inputSchema, input);
    if (!v.ok) return { result: toolError(v.error) };
    try {
      const result = await withTimeout(tools.handlers[name](v.value), timeoutMs);
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) return { result: toolError('That answer is too big. Ask for fewer rows or points.') };
      // A result that does not fit the tool's outputSchema is never sent (clients check it).
      if (!result.isError && OUTPUT_SCHEMAS[name] && checkSchema(OUTPUT_SCHEMAS[name], result.structuredContent).length) {
        log(`[mcp ${name}] result off its schema`);
        return { result: toolError('Something went wrong on our side. Try again in a minute.') };
      }
      return { result };
    } catch (err) {
      log(`[mcp ${name}] ${err?.message === 'timeout' ? 'timed out' : 'failed'}`);
      return { result: toolError(err?.message === 'timeout' ? 'That took too long. Try again in a minute.' : 'Something went wrong on our side. Try again in a minute.') };
    }
  }

  function modernChecks(req, msg) {
    const meta = msg.params?._meta;
    const pv = meta?.[META_VERSION];
    if (typeof pv !== 'string' || !pv) throw new HttpError(400, ERR.invalidParams, `Missing _meta "${META_VERSION}".`, { id: msg.id });
    if (pv !== MODERN_VERSION) throw new HttpError(400, ERR.unsupportedVersion, 'Unsupported protocol version', { id: msg.id, data: { supported: SUPPORTED_VERSIONS, requested: pv.slice(0, 40) } });
    if (!meta[META_CAPS] || typeof meta[META_CAPS] !== 'object' || Array.isArray(meta[META_CAPS])) throw new HttpError(400, ERR.invalidParams, `Missing _meta "${META_CAPS}".`, { id: msg.id });
    const hv = req.get('mcp-protocol-version');
    if (hv !== pv) throw new HttpError(400, ERR.headerMismatch, `Header mismatch: MCP-Protocol-Version ${hv ? `'${hv.slice(0, 40)}'` : 'missing'}, body '${pv}'.`, { id: msg.id });
    const hm = req.get('mcp-method');
    if (hm !== msg.method) throw new HttpError(400, ERR.headerMismatch, `Header mismatch: Mcp-Method ${hm ? `'${hm.slice(0, 64)}'` : 'missing'}, body '${String(msg.method).slice(0, 64)}'.`, { id: msg.id });
    if (msg.method === 'tools/call') {
      const hn = decodeHeader(req.get('mcp-name'));
      if (hn !== msg.params?.name) throw new HttpError(400, ERR.headerMismatch, `Header mismatch: Mcp-Name ${hn ? `'${String(hn).slice(0, 64)}'` : 'missing'}, body '${String(msg.params?.name).slice(0, 64)}'.`, { id: msg.id });
    }
  }

  const listResult = () => ({ tools: TOOLS });

  async function handle(req, res) {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return sendError(res, new HttpError(405, ERR.invalidRequest, 'Method not allowed. Send JSON-RPC as POST.'));
    }
    const origin = req.get('origin');
    if (!originOk(origin)) return sendError(res, new HttpError(403, ERR.invalidRequest, 'Origin not allowed.'));
    const key = clientIp(req);
    const gate = limits.request(key);
    if (!gate.ok) {
      res.set('Retry-After', String(gate.retryAfter));
      return sendError(res, new HttpError(429, ERR.tooManyRequests, `Too many requests. Try again at ${gate.resetAt}.`, { data: { reset_at: gate.resetAt, retry_after_seconds: gate.retryAfter } }));
    }
    const accept = req.get('accept');
    if (accept && !/application\/json|application\/\*|\*\/\*/i.test(accept)) return sendError(res, new HttpError(406, ERR.invalidRequest, 'Accept must allow application/json.'));
    if (!/^application\/json\b/i.test(req.get('content-type') || '')) return sendError(res, new HttpError(415, ERR.invalidRequest, 'Content-Type must be application/json.'));

    let msg;
    try {
      const raw = await readBody(req, MAX_BODY);
      try { msg = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, ERR.parse, 'Parse error.'); }
    } catch (err) {
      return sendError(res, err instanceof HttpError ? err : new HttpError(400, ERR.invalidRequest, 'Could not read the request.'));
    }
    if (Array.isArray(msg)) return sendError(res, new HttpError(400, ERR.invalidRequest, 'Batches are not supported. Send one message per request.'));
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      const id = msg && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null;
      return sendError(res, new HttpError(400, ERR.invalidRequest, 'Invalid request.', { id }));
    }
    // A notification (no id): accepted, nothing to answer.
    if (!('id' in msg)) return res.status(202).set('Cache-Control', 'no-store').end();
    if (!(typeof msg.id === 'string' || (typeof msg.id === 'number' && Number.isFinite(msg.id)))) return sendError(res, new HttpError(400, ERR.invalidRequest, 'Invalid request id.'));
    if (msg.params !== undefined && (msg.params === null || typeof msg.params !== 'object' || Array.isArray(msg.params))) return sendError(res, new HttpError(400, ERR.invalidParams, 'params must be an object.', { id: msg.id }));

    const ok = (result, status = 200) => send(res, status, { jsonrpc: '2.0', id: msg.id, result });
    const fail = (code, message, status = 200) => sendError(res, new HttpError(status, code, message, { id: msg.id }));
    const modern = msg.method !== 'initialize'
      && (msg.params?._meta?.[META_VERSION] !== undefined || req.get('mcp-protocol-version') === MODERN_VERSION);

    try {
      if (modern) {
        modernChecks(req, msg);
        const done = (result) => ok({ resultType: 'complete', ...result, _meta: { [META_SERVER]: SERVER_INFO } });
        if (msg.method === 'server/discover') {
          return done({ supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS, ttlMs: LIST_TTL_MS, cacheScope: 'public' });
        }
        if (msg.method === 'tools/list') return done({ ...listResult(), ttlMs: LIST_TTL_MS, cacheScope: 'public' });
        if (msg.method === 'tools/call') {
          const r = await callTool(msg.params, key);
          return r.error ? fail(r.error.code, r.error.message) : done(r.result);
        }
        return fail(ERR.methodNotFound, `Method not found: ${msg.method.slice(0, 64)}`, 404);
      }
      // Legacy: the MCP-Protocol-Version header (2025-06-18 on) must name a version we
      // speak; without it the request is 2025-03-26.
      const hv = req.get('mcp-protocol-version');
      if (msg.method !== 'initialize' && hv && !LEGACY_VERSIONS.includes(hv)) {
        throw new HttpError(400, ERR.unsupportedVersion, 'Unsupported protocol version', { id: msg.id, data: { supported: SUPPORTED_VERSIONS, requested: hv.slice(0, 40) } });
      }
      if (msg.method === 'initialize') {
        const asked = msg.params?.protocolVersion;
        return ok({
          protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      if (msg.method === 'ping') return ok({});
      if (msg.method === 'tools/list') return ok(listResult());
      if (msg.method === 'tools/call') {
        const r = await callTool(msg.params, key);
        return r.error ? fail(r.error.code, r.error.message) : ok(r.result);
      }
      return fail(ERR.methodNotFound, `Method not found: ${msg.method.slice(0, 64)}`);
    } catch (err) {
      if (err instanceof HttpError) return sendError(res, err);
      log(`[mcp] ${msg.method.slice(0, 32)} failed`);
      return fail(ERR.internal, 'Internal error.', 500);
    }
  }

  app.all(MCP_PATH, (req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) res.status(500).end(); });
  });
  return { stats, limits };
}
