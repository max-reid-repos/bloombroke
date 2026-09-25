// NEWS: finance headlines from a few public feeds, newest first.

import { esc, panel, LOADING } from './markets.js';

const SHORT = { CNBC: 'CNBC', MarketWatch: 'MKTW', 'Yahoo Finance': 'YHOO' };

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

export function newsList(items) {
  const rows = items.map((n) => {
    const href = safeHref(n.link);
    if (!href) return '';
    const src = SHORT[n.source] || String(n.source || '').slice(0, 4).toUpperCase();
    return `<li class="news-row">
      <span class="news-time num">${esc(fmtNewsTime(n.time))}</span>
      <span class="news-src" title="${esc(n.source || '')}">${esc(src)}</span>
      <a class="news-title" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
    </li>`;
  }).join('');
  return `<ol class="news">${rows}</ol>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'News', LOADING, { cls: 'panel-solo', metaId: 'news-meta', bodyCls: 'flush' })
    + '<p class="footnote">Headlines open on the publisher site in a new tab.</p>';
  const body = el.querySelector('.panel-body');
  const meta = el.querySelector('#news-meta');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/news', { signal: ctx.signal });
      body.innerHTML = newsList(d.items);
      meta.textContent = d.sources.map((s) => SHORT[s] || s).join('  ');
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('.news')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH NEWS', 'warn');
    }
  }

  load();
  ctx.every(load, 5 * 60_000);
}
