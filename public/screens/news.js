// NEWS: finance headlines from a few public feeds, newest first.

import { esc, panel, LOADING } from './markets.js';
import { toolbar, segmented } from '../kit.js';

const SHORT = { CNBC: 'CNBC', MarketWatch: 'MKTW', 'Yahoo Finance': 'YHOO' };
export const shortSource = (name) => SHORT[name] || String(name || '').slice(0, 4).toUpperCase();

export function safeHref(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// Today in New York -> "13:02". Older -> "SEP 24".
export function fmtNewsTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '--';
  const day = (x) => x.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  if (day(d) === day(now)) {
    return d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: '2-digit' }).toUpperCase();
}

// The same day on a phone: "9/24" (fits the narrow time column without wrapping).
export function fmtNewsTimeShort(iso, now = new Date()) {
  const long = fmtNewsTime(iso, now);
  if (!/^[A-Z]{3} \d{2}$/.test(long)) return long;
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' });
}

// The time cell: SEP 24 on wide screens, 9/24 on phones (CSS picks one).
export function newsTimeHtml(iso, now = new Date()) {
  const long = fmtNewsTime(iso, now);
  const short = fmtNewsTimeShort(iso, now);
  return long === short
    ? `<span class="news-time num">${esc(long)}</span>`
    : `<span class="news-time num"><span class="nt-l">${esc(long)}</span><span class="nt-s">${esc(short)}</span></span>`;
}

// NEWS source filter: ALL or one feed's short name.
export function filterNews(items, src) {
  return !src || src === 'ALL' ? items : items.filter((n) => shortSource(n.source) === src);
}

export function newsList(items) {
  const rows = items.map((n) => {
    const href = safeHref(n.link);
    if (!href) return '';
    const src = shortSource(n.source);
    return `<li class="news-row">
      ${newsTimeHtml(n.time)}
      <span class="news-src" title="${esc(n.source || '')}">${esc(src)}</span>
      <a class="news-title" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
    </li>`;
  }).join('');
  return `<ol class="news">${rows}</ol>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'News', `<div class="news-bar">${LOADING}</div><div class="news-body"></div>`, { cls: 'panel-solo', metaId: 'news-meta', bodyCls: 'flush' })
    + '<p class="footnote">Headlines from the CNBC, MarketWatch and Yahoo Finance feeds: the headline, the publisher and a link only. Each one opens on the original publisher\'s site, in a new tab. The status line shows when the list was last updated.</p>';
  const bar = el.querySelector('.news-bar');
  const body = el.querySelector('.news-body');
  const meta = el.querySelector('#news-meta');
  let data = null;
  let src = 'ALL';

  function paint() {
    if (!data) return;
    const sources = data.sources.map(shortSource);
    if (!sources.includes(src)) src = 'ALL';
    const items = filterNews(data.items, src);
    bar.innerHTML = toolbar({ left: segmented([{ label: 'ALL', value: 'ALL' }, ...sources.map((x) => ({ label: x, value: x }))], src, { label: 'Source' }), label: 'Source' });
    body.innerHTML = items.length ? newsList(items) : '<p class="panel-msg">No headlines from this feed right now.</p>';
    meta.textContent = `${items.length} HEADLINES`;
  }

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (!b) return;
    src = b.dataset.value;
    paint();
  });

  async function load() {
    try {
      data = await ctx.fetchJSON('/api/news', { signal: ctx.signal });
      paint();
      ctx.updated(data.updated, data.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('.news')) { bar.textContent = ''; body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`; }
      ctx.status('COULD NOT REFRESH NEWS', 'warn');
    }
  }

  load();
  ctx.every(load, 5 * 60_000);
}
