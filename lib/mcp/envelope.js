// MCP results: the provenance envelope every result carries, and the result shapes
// (a tool result with structuredContent plus text, or a tool error with isError).
//
// Envelope: { source, source_url, as_of, fetched_at, age_seconds, notice }
//   source       who published the data (SEC EDGAR, BLS, ...)
//   source_url   where it can be checked
//   as_of        the date or time the data describes, ISO 8601
//   fetched_at   when our server got it from the source, ISO 8601
//   age_seconds  now minus fetched_at, whole seconds, never below 0
//   notice       the same fixed line on every result

export const NOTICE = 'Information only. Does not assess whether to buy, sell or hold.';

// 'YYYY-MM' | 'YYYY-MM-DD' | ISO time | ms -> ISO string, or null.
export function isoOf(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(v).toISOString() : null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01T00:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function provenance({ source, source_url, as_of, fetched_at, now = Date.now() }) {
  const fetched = isoOf(fetched_at) || new Date(now).toISOString();
  return {
    source: String(source),
    source_url: String(source_url),
    as_of: isoOf(as_of) || fetched,
    fetched_at: fetched,
    age_seconds: Math.max(0, Math.round((now - Date.parse(fetched)) / 1000)),
    notice: NOTICE,
  };
}

// A tool result: a short summary for people, the same data as JSON text (for clients
// that do not read structuredContent), and the data itself in structuredContent.
export function toolResult(summary, data) {
  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(data) },
    ],
    structuredContent: data,
    isError: false,
  };
}

// A tool error the caller can act on (bad input, a limit, a source that is down).
// extra: plain fields for structuredContent (reset time on a limit).
export function toolError(message, extra = null) {
  const out = { content: [{ type: 'text', text: message }], isError: true };
  if (extra) out.structuredContent = { error: message, ...extra };
  return out;
}

// Numbers kept short: at most `digits` decimals, trailing zeros dropped.
export function round(v, digits = 4) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
