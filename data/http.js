// One capped fetch for every data source: a timeout, a size cap on the body (read as a
// stream, so a huge or endless answer is cut off, not buffered), and a content-type check
// (text, JSON, XML, CSV only: a source that suddenly sends an image, a PDF or an archive
// is refused before its body is read).
//
// cappedFetch(url, init) is a drop-in for fetch: it resolves to a Response with the body
// already read (res.ok, status, headers, json(), text() as usual). Extra init options:
// - maxBytes: the body cap for this call (default FETCH_DEFAULTS.maxBytes).
// - timeoutMs: used when the caller passes no signal of its own (a caller's signal, for
//   example AbortSignal.timeout(90_000) for a slow source, is kept as it is).
// - types: a RegExp the content-type must match (default: textual types). A missing
//   content-type passes.
// Every call is also cut off at FETCH_DEFAULTS.ceilingMs, whatever the caller asked.

export const FETCH_DEFAULTS = {
  maxBytes: 16 * 1024 * 1024,
  timeoutMs: 20_000,
  ceilingMs: 120_000,
};

export const TEXT_TYPES = /^\s*(text\/|application\/(json|[\w.+-]+\+json|xml|[\w.+-]+\+xml|javascript|x-javascript|ecmascript|csv|x-ndjson|octet-stream)\b)/i;

export class FetchCapError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const hostOf = (url) => { try { return new URL(String(url)).host; } catch { return 'source'; } };
// Headers that described the wire body, not the bytes we hand on.
const WIRE = new Set(['content-length', 'content-encoding', 'transfer-encoding']);

export function makeCappedFetch({ fetchImpl = (...a) => globalThis.fetch(...a), ...opts } = {}) {
  const d = { ...FETCH_DEFAULTS, types: TEXT_TYPES, ...opts };
  return async function cappedFetch(url, init = {}) {
    const { maxBytes = d.maxBytes, timeoutMs = d.timeoutMs, types = d.types, signal, ...rest } = init || {};
    const ctl = new AbortController();
    const signals = [ctl.signal, AbortSignal.timeout(d.ceilingMs)];
    signals.push(signal || AbortSignal.timeout(timeoutMs));
    const res = await fetchImpl(url, { ...rest, signal: AbortSignal.any(signals) });
    const host = hostOf(url);
    const drop = async (err) => {
      ctl.abort();
      try { await res.body?.cancel?.(); } catch { /* ignore */ }
      throw err;
    };

    const type = res.headers?.get?.('content-type') || '';
    if (type && types && !types.test(type)) {
      return drop(new FetchCapError(`${host}: unexpected content type ${type.split(';')[0].slice(0, 60)}`, 'bad_type'));
    }
    const declared = Number(res.headers?.get?.('content-length'));
    const tooBig = () => new FetchCapError(`${host}: response over ${Math.round(maxBytes / 1024)} KB`, 'too_large');
    if (Number.isFinite(declared) && declared > maxBytes) return drop(tooBig());

    const noBody = rest.method === 'HEAD' || res.status === 204 || res.status === 304;
    let buf = null;
    if (!noBody) {
      const reader = res.body?.getReader?.();
      const chunks = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            ctl.abort();
            try { await reader.cancel(); } catch { /* ignore */ }
            throw tooBig();
          }
          chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        }
      } else if (typeof res.arrayBuffer === 'function') {
        const ab = Buffer.from(await res.arrayBuffer());
        if (ab.length > maxBytes) throw tooBig();
        chunks.push(ab);
      }
      buf = Buffer.concat(chunks);
    }

    const headers = new Headers();
    res.headers?.forEach?.((v, k) => { if (!WIRE.has(k.toLowerCase())) headers.append(k, v); });
    const out = new Response(noBody ? null : buf, { status: res.status, statusText: res.statusText, headers });
    Object.defineProperty(out, 'url', { value: res.url || String(url) });
    Object.defineProperty(out, 'redirected', { value: Boolean(res.redirected) });
    return out;
  };
}

// The default every data source uses (fetchImpl = cappedFetch). It calls the global fetch
// at call time.
export const cappedFetch = makeCappedFetch();
