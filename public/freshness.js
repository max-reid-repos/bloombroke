// Live or delayed: the tag on each price and the summary in the status line.
// The quote service marks each row realTime: true for US stocks (Nasdaq Last Sale),
// US indexes, FX, crypto and Treasury yields; futures (about 10 minutes) and most
// non-US indexes (about 15 minutes) are delayed.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NY = 'America/New_York';

function nyTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('en-US', { timeZone: NY, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}

// What RT and DLY mean, in the tooltip of every tag.
export const RT_TITLE = 'Real time';
export const DLY_TITLE = 'Delayed: futures about 10 min, indexes about 15 min';

export function freshTag(item) {
  if (!item || typeof item.realTime !== 'boolean') return '';
  return item.realTime
    ? `<span class="fresh is-rt" title="${RT_TITLE}">RT</span>`
    : `<span class="fresh is-dly" title="${DLY_TITLE}">DLY</span>`;
}

// The tooltip of the freshness dot: "Updated 22:48:47 ET".
export function updatedTitle(iso, stale) {
  const t = iso ? nyTime(iso) : '--:--:--';
  return `${stale ? 'Last known data' : 'Updated'} ${t} ET`;
}

// Which bucket an instrument falls in for the status line.
export function category(item) {
  switch (item?.kind) {
    case 'stock': case 'etf': return 'US STOCKS';
    case 'future': return 'FUTURES';
    case 'fx': return 'FX';
    case 'spot': return 'SPOT METALS';
    case 'crypto': return 'CRYPTO';
    case 'yield': return 'YIELDS';
    case 'index': return item.us ? 'US INDEXES' : 'NON-US INDEXES';
    default: return null;
  }
}

const ORDER = ['US STOCKS', 'US INDEXES', 'FX', 'SPOT METALS', 'CRYPTO', 'YIELDS', 'FUTURES', 'NON-US INDEXES'];

// ["US INDEXES, FX REAL TIME", "FUTURES DELAYED"]. A bucket with both kinds of rows
// is listed as delayed with SOME in front, so the line never overstates.
export function freshnessParts(items) {
  const cats = new Map();
  for (const it of items || []) {
    const c = category(it);
    if (!c || typeof it.realTime !== 'boolean') continue;
    const e = cats.get(c) || { rt: 0, dly: 0 };
    if (it.realTime) e.rt += 1; else e.dly += 1;
    cats.set(c, e);
  }
  const rt = [];
  const dly = [];
  for (const c of ORDER) {
    const e = cats.get(c);
    if (!e) continue;
    if (!e.dly) rt.push(c);
    else if (!e.rt) dly.push(c);
    else dly.push(`SOME ${c}`);
  }
  const parts = [];
  if (rt.length) parts.push(`${rt.join(', ')} REAL TIME`);
  if (dly.length) parts.push(`${dly.join(', ')} DELAYED`);
  return parts;
}

// "UPDATED 10:09:50 ET · US STOCKS REAL TIME (NASDAQ LAST SALE) · FUTURES DELAYED"
export function statusLine(iso, stale, items) {
  const t = iso ? nyTime(iso) : '--:--:--';
  const head = stale ? `LAST KNOWN DATA ${t} ET` : `UPDATED ${t} ET`;
  return [head, ...freshnessParts(items)].join(' · ');
}

// The last trade line on an instrument screen: "LAST TRADE 10:14:46 ET · REAL TIME".
export function lastTradeLine(d, now = new Date()) {
  const asOf = d?.asOf;
  let when = '--';
  if (asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) when = `CLOSE ${asOf}`;
  else if (asOf) {
    const day = new Date(asOf);
    const ymd = (x) => x.toLocaleDateString('en-CA', { timeZone: NY });
    when = `LAST TRADE ${ymd(day) === ymd(now) ? '' : `${ymd(day)} `}${nyTime(asOf)} ET`;
  }
  let fresh = '';
  if (d?.realTime === true) fresh = 'REAL TIME';
  else if (d?.realTime === false) fresh = d.kind === 'future' ? 'DELAYED ABOUT 10 MIN' : 'DELAYED';
  return esc([when, fresh].filter(Boolean).join(' · '));
}
