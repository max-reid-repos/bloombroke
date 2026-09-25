// MARKETS: one table of world markets. Also exports number helpers used by the ticker tape.

const MINUS = '−';

export function fmtNum(n, decimals = 2) {
  if (!Number.isFinite(n)) return '--';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (n < 0 ? MINUS : '') + s;
}

export function fmtSigned(n, decimals = 2) {
  if (!Number.isFinite(n)) return '--';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (Number(s.replace(/,/g, '')) === 0) return s;
  return (n > 0 ? '+' : MINUS) + s;
}

export function fmtPct(n) {
  return Number.isFinite(n) ? fmtSigned(n, 2) + '%' : '--';
}

export function dirOf(n) {
  if (!Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

function nyTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
}

// Number pop-in: characters re-enter from below (price up) or above (price down),
// the last two trail slightly behind.
export function digitsHtml(text, dir = 1) {
  const chars = [...text];
  const n = chars.length;
  return `<span class="digits is-animating" style="--digit-dir-y:${dir}">${chars
    .map((c, i) => `<span class="digit"${i === n - 2 ? ' data-stagger="1"' : i === n - 1 ? ' data-stagger="2"' : ''}>${c}</span>`)
    .join('')}</span>`;
}

const previous = new Map();

function cell(id, key, value, text, cls = '') {
  const prev = previous.get(id + key);
  previous.set(id + key, value);
  if (prev === undefined || prev === value) return `<td class="num ${cls}">${text}</td>`;
  return `<td class="num ${cls}">${digitsHtml(text, value > prev ? 1 : -1)}</td>`;
}

function rowsHtml(instruments, esc) {
  let group = '';
  return instruments.map((q) => {
    const d = dirOf(q.change);
    const head = q.group !== group
      ? `<tr class="group-row"><th colspan="4" scope="rowgroup">${esc((group = q.group))}</th></tr>`
      : '';
    return `${head}<tr>
      <th scope="row" class="name">${esc(q.name)}</th>
      ${cell(q.id, 'last', q.last, fmtNum(q.last, q.decimals), 'last')}
      ${cell(q.id, 'chg', q.change, fmtSigned(q.change, q.decimals), `chg ${d}`)}
      ${cell(q.id, 'pct', q.changePct, fmtPct(q.changePct), `pct ${d}`)}
    </tr>`;
  }).join('');
}

export function render(el, cmd, ctx) {
  const esc = ctx.escapeHtml;
  el.innerHTML = `
    <div class="screen-head">
      <h1 class="eyebrow">Markets</h1>
      <p class="meta" id="mk-meta">Loading</p>
    </div>
    <table class="quotes" aria-describedby="mk-meta">
      <thead><tr><th scope="col">Name</th><th scope="col" class="num">Last</th><th scope="col" class="num">Change</th><th scope="col" class="num">% Change</th></tr></thead>
      <tbody id="mk-body" aria-busy="true">${'<tr class="skeleton"><th><span class="skel-bar"></span></th><td class="num"><span class="skel-bar"></span></td><td class="num chg"><span class="skel-bar"></span></td><td class="num pct"><span class="skel-bar"></span></td></tr>'.repeat(11)}</tbody>
    </table>
    <p class="footnote">Prices may be delayed. Not financial advice.</p>`;

  const body = el.querySelector('#mk-body');
  const meta = el.querySelector('#mk-meta');

  async function load() {
    try {
      const data = await ctx.fetchJSON('/api/markets', { signal: ctx.signal });
      const first = body.getAttribute('aria-busy') === 'true';
      body.innerHTML = rowsHtml(data.instruments, esc);
      if (first) {
        body.removeAttribute('aria-busy');
        body.classList.add('is-revealed');
        setTimeout(() => body.classList.remove('is-revealed'), 500);
      }
      meta.textContent = (data.stale ? 'Last known data, ' : 'Updated ') + nyTime(data.updated) + ' ET';
      meta.classList.toggle('is-stale', !!data.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('.name')) {
        body.innerHTML = `<tr><td colspan="4" class="error-cell">${esc(err.message)}</td></tr>`;
      }
      meta.textContent = 'Could not refresh';
    }
  }

  load();
  const timer = setInterval(load, 60_000);
  return () => clearInterval(timer);
}
