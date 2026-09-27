// Tool arguments checked against the tool's own inputSchema, so the schema the client
// sees and the check the server runs are the same thing. Covers the subset the tools
// use: an object with properties, required and additionalProperties: false; strings
// (enum, any case, pattern, minLength, maxLength) and integers (minimum, maximum).
// -> { ok: true, value } with defaults filled in, or { ok: false, error }.

export function validateArgs(schema, args) {
  const a = args === undefined || args === null ? {} : args;
  if (typeof a !== 'object' || Array.isArray(a)) return { ok: false, error: 'Arguments must be an object.' };
  const props = schema.properties || {};
  for (const k of Object.keys(a)) {
    if (!(k in props) && schema.additionalProperties === false) return { ok: false, error: `Unknown argument "${String(k).slice(0, 40)}". Allowed: ${Object.keys(props).join(', ') || 'none'}.` };
  }
  for (const k of schema.required || []) {
    if (a[k] === undefined || a[k] === null || a[k] === '') return { ok: false, error: `Missing argument "${k}".` };
  }
  const value = {};
  for (const [k, p] of Object.entries(props)) {
    let v = a[k];
    if (v === undefined || v === null) {
      if (p.default !== undefined) value[k] = p.default;
      continue;
    }
    if (p.type === 'string') {
      if (typeof v !== 'string') return { ok: false, error: `"${k}" must be a string.` };
      v = v.trim();
      if (p.minLength !== undefined && v.length < p.minLength) return { ok: false, error: `"${k}" is too short.` };
      if (p.maxLength !== undefined && v.length > p.maxLength) return { ok: false, error: `"${k}" is longer than ${p.maxLength} characters.` };
      if (p.enum) {
        // Case does not matter: "8-k" is 8-K.
        const hit = p.enum.find((e) => e.toUpperCase() === v.toUpperCase());
        if (!hit) return { ok: false, error: `"${k}" must be one of: ${p.enum.join(', ')}.` };
        v = hit;
      }
      if (p.pattern && !new RegExp(p.pattern).test(v)) return { ok: false, error: `"${k}" is not in the expected form${p.description ? ` (${p.description})` : ''}.` };
    } else if (p.type === 'integer') {
      if (typeof v === 'string' && /^-?\d{1,6}$/.test(v.trim())) v = Number(v.trim());
      if (!Number.isInteger(v)) return { ok: false, error: `"${k}" must be a whole number.` };
      if (p.minimum !== undefined && v < p.minimum) return { ok: false, error: `"${k}" must be at least ${p.minimum}.` };
      if (p.maximum !== undefined && v > p.maximum) return { ok: false, error: `"${k}" must be at most ${p.maximum}.` };
    }
    value[k] = v;
  }
  return { ok: true, value };
}
