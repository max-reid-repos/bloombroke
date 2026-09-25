// The ticker tape: a scrolling strip of market prices. Off by default. TAPE ON puts it
// above the status line (never over the key bar), TAPE OFF hides it, and TAPE alone is
// a screen (and a DESK panel) that shows it.
//
// API, kept small on purpose:
//   parseTapeArgs(words)        -> { set: 'ON'|'OFF' } | {} | { error: 'usage' }
//   tapeOn(store) / setTapeOn(store, on)
//   tapeItems(data)             -> the instruments the tape shows
//   mountTape(el, ctx)          -> fills el and keeps it live; returns a cleanup
//     ctx: { fetchJSON, live(fn, ms) -> cleanup, toQuery, escape }

import { fmtNum, fmtPct, dirOf, cmdForInstrument } from './screens/markets.js';
import { freshTag } from './freshness.js';

export const TAPE_KEY = 'bb.tape';

export function parseTapeArgs(words) {
  if (!words.length) return {};
  if (words.length === 1 && (words[0] === 'ON' || words[0] === 'OFF')) return { set: words[0] };
  return { error: 'usage' };
}

export function tapeOn(store) {
  return store.get(TAPE_KEY, false) === true;
}

export function setTapeOn(store, on) {
  store.set(TAPE_KEY, Boolean(on));
}

export function tapeItems(data) {
  return (data?.instruments || []).filter((q) => q.tape);
}

// Prices update in place, so the scroll does not jump back to the start on every refresh.
export function mountTape(el, { fetchJSON, live, toQuery, escape }) {
  el.classList.add('tape-track');
  let ids = '';
  let stopped = false;
  async function load() {
    try {
      const list = tapeItems(await fetchJSON('/api/markets'));
      if (stopped) return;
      const next = list.map((q) => q.id).join(',');
      if (next === ids) {
        for (const q of list) {
          el.querySelectorAll(`.tape-item[data-id="${q.id}"]`).forEach((a) => {
            a.querySelector('.tape-last').textContent = fmtNum(q.last, q.decimals);
            const chg = a.querySelector('.tape-chg');
            chg.textContent = fmtPct(q.changePct);
            chg.className = `tape-chg num ${dirOf(q.change)}`;
          });
        }
        return;
      }
      const html = list.map((q) => {
        const c = cmdForInstrument(q.id) || 'MARKETS';
        return `<a class="tape-item" href="${toQuery(c)}" data-cmd="${escape(c)}" data-id="${escape(q.id)}">
          <span class="tape-name">${escape(q.name)}</span>
          <span class="tape-last num">${fmtNum(q.last, q.decimals)}</span>
          <span class="tape-chg num ${dirOf(q.change)}">${fmtPct(q.changePct)}</span>${freshTag(q)}</a>`;
      }).join('');
      ids = next;
      const group = `<div class="tape-group">${html}</div>`;
      el.innerHTML = group + group.replace('class="tape-group"', 'class="tape-group" aria-hidden="true"');
      el.querySelectorAll('.tape-group[aria-hidden] a').forEach((a) => a.setAttribute('tabindex', '-1'));
      const w = el.firstElementChild.getBoundingClientRect().width;
      el.style.setProperty('--tape-duration', `${Math.max(30, Math.round(w / 40))}s`);
      el.classList.add('is-running');
    } catch {
      if (!ids && !stopped) el.innerHTML = '<span class="tape-empty">MARKET DATA IS TAKING A BREAK.</span>';
    }
  }
  load();
  const stop = live(load, 15_000);
  return () => {
    stopped = true;
    stop?.();
    el.innerHTML = '';
    el.classList.remove('is-running');
  };
}
