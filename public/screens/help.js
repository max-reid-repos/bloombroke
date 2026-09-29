// HELP: the command reference, one numbered panel. The key row first, then START HERE,
// then every group with its count, as one list (two columns on a desktop). The groups
// are the MENU's (registry.js commandGroups): one source. There is no search box: "/"
// puts the command bar in find mode, and what you type there filters this list.
// HELP <command> opens one command: syntax, options, examples, source and delay.

import { esc, q, panel } from './markets.js';
import {
  findCommand, byCategory, searchCommands, commandGroups, START_GROUP,
  START_KEYS, FUNCTION_BAR, mergeDetail, CATEGORIES,
} from '../registry.js';
import { DETAIL } from '../registry-detail.js';
import { commandForWord } from '../resolve.js';
import { LISTED_TICKERS, stockIdOf } from '../known-tickers.js';
import { parseHelp as parse } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { parse };

// Each command's options, source and delay (registry-detail.js) come in with this screen.
mergeDetail(DETAIL);

const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// The HELP groups, in order (START HERE, then the categories: Pro and About included).
export const HELP_GROUPS = [START_GROUP, ...CATEGORIES];
// A group to open the list at (the Category button on a command's page sets it).
const JUMP_KEY = 'bb.helpcat';

// What HELP <topic> shows: { entry, ticker } for a command or a ticker, or { query }
// to filter the list by anything else. Plain words find their command: HELP SHORT and
// HELP SHORT INTEREST open SHORTS, HELP DIVIDEND opens DIVIDENDS, a typo one letter off
// opens the command it meant (from: the words typed).
export function resolveTopic(topic) {
  const words = String(topic || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return {};
  for (const w of words) {
    const entry = findCommand(w);
    if (entry && !entry.hidden) return { entry };
  }
  const one = words.length === 1 && TICKER_RE.test(words[0]) ? words[0] : null;
  if (words.length === 1 && stockIdOf(words[0])) return { entry: findCommand('<TICKER>'), ticker: stockIdOf(words[0]) }; // HELP $GOLD
  if (one && LISTED_TICKERS.has(one)) return { entry: findCommand('<TICKER>'), ticker: one };
  const guess = commandForWord(words.join(' '));
  if (guess) return { entry: guess, from: words.join(' ') };
  const query = words.join(' ').toLowerCase();
  if (one && !searchCommands(query).length) return { entry: findCommand('<TICKER>'), ticker: one };
  return { query };
}

const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;

// The key row: the keys of a keyboard product, first on the page.
// A phone has no Ctrl or F-keys (its key bar has MENU and the screens): those two hide there.
const DESK_KEYS = new Set(['Ctrl K', 'F1-F10']);
export function keyRow() {
  return `<p class="help-keys">${START_KEYS.map(([k, what]) => `<span class="hk${DESK_KEYS.has(k) ? ' hk-desk' : ''}"><kbd>${esc(k)}</kbd> ${esc(what)}</span>`).join('<span class="hk-sep" aria-hidden="true">&middot;</span>')}</p>`;
}

// One row: the command (it runs), what it does.
function row(it) {
  return `<li class="hl-row"><a class="hl-name" href="${esc(q(it.cmd))}" data-cmd="${esc(it.cmd)}">${esc(it.name)}</a><span class="hl-sum">${esc(it.summary)}</span></li>`;
}

export const DOLLAR_LINE = `$ before a ticker always means the stock, e.g. ${code('$GOLD')}.`;

// One group: its header (name and count), its rows. START HERE has no count, and the
// line about $ under it.
function group(g) {
  const start = g.name === START_GROUP;
  const head = start ? esc(g.name) : `${esc(g.name)} <span class="hl-n">&middot; ${g.items.length}</span>`;
  return `<section class="hl-group${start ? ' hl-start' : ''}" data-group="${esc(g.name)}">
    <h3 class="hl-h">${head}</h3>
    <ol class="hl-list">${g.items.map(row).join('')}</ol>
    ${start ? `<p class="help-tip">${DOLLAR_LINE}</p>` : ''}
  </section>`;
}

// START HERE on its own (the first group).
export function startHere() {
  return group(commandGroups()[0]);
}

// The groups for a find: each category with only the commands that match, best first
// overall in `best` (Enter runs it). START HERE drops out (its commands are in their
// categories too). An empty query is every group.
export function filterGroups(query, groups = commandGroups()) {
  const text = String(query || '').trim();
  if (!text) return { groups, best: null, count: null };
  const found = searchCommands(text, groups.flatMap((g) => g.items.map((it) => it.entry).filter(Boolean)));
  const hit = new Set(found);
  const kept = groups.filter((g) => g.name !== START_GROUP)
    .map((g) => ({ ...g, items: g.items.filter((it) => hit.has(it.entry)) }))
    .filter((g) => g.items.length);
  return { groups: kept, best: found[0] ? found[0].examples[0] : null, count: found.length };
}

// The whole list (or a found part of it).
export function listHtml(query = '') {
  const { groups, count } = filterGroups(query);
  if (count === 0) return `<p class="help-none">No command matches "${esc(String(query).trim())}". Enter runs what you typed. Try a plainer word: price, news, rate, dividend.</p>`;
  return `<div class="hl">${groups.map(group).join('')}</div>`;
}

// The HELP page: the key row, the list, one line on HELP <command>.
export function helpHtml(query = '') {
  return `${keyRow()}<div class="help-found">${listHtml(query)}</div>
    <p class="help-foot">${code('HELP FX')} shows how one command works: its words, options and examples.</p>`;
}

function detail(entry, ticker) {
  const name = ticker || entry.name;
  let examples = entry.examples;
  let extra = '';
  if (ticker) {
    examples = [ticker, `${ticker} 5Y`, `${ticker} YTD`, `${ticker} NEWS`];
    const fns = FUNCTION_BAR.map((fn) => findCommand(fn)).filter(Boolean);
    extra = `<h3 class="hs-h">Functions for ${esc(ticker)}</h3>
      <ol class="hc-list">${fns.map((c) => {
        const cmdText = c.name === 'CHART' ? `${ticker} CHART 1Y` : `${ticker} ${c.name}`;
        return `<li class="hc-row hc-row-fn"><a class="hc-name code" href="${esc(q(cmdText))}" data-cmd="${esc(cmdText)}">${esc(cmdText)}</a><span class="hc-sum">${esc(c.summary)}</span></li>`;
      }).join('')}</ol>`;
  }
  const opts = entry.options?.length
    ? `<table class="hd-opts"><tbody>${entry.options.map(([w, m]) => `<tr><th scope="row">${esc(w)}</th><td>${esc(m)}</td></tr>`).join('')}</tbody></table>`
    : '<span class="dim">None</span>';
  const tickerFirst = entry.takesTicker && !entry.pattern
    ? `<div class="hd-row"><dt>Ticker first</dt><dd>${code(`AAPL ${entry.name}`)} <span class="dim">works the same as</span> ${code(`${entry.name} AAPL`)}</dd></div>` : '';
  const related = ticker ? [] : byCategory(entry.category).filter((c) => c !== entry && !c.pattern).slice(0, 8);
  return `<article class="hd">
    <header class="hd-head">
      <h2 class="hd-name">${esc(name)}</h2>
      <p class="hd-sum">${esc(entry.summary)}</p>
    </header>
    <dl class="hd-dl">
      <div class="hd-row"><dt>Syntax</dt><dd class="hd-syn">${esc(entry.syntax)}</dd></div>
      <div class="hd-row"><dt>Options</dt><dd>${opts}</dd></div>
      <div class="hd-row"><dt>Examples</dt><dd class="hd-ex">${entry.soon ? '<span class="dim">Coming soon</span>' : examples.map(code).join('')}</dd></div>
      ${tickerFirst}
      <div class="hd-row"><dt>Source</dt><dd>${esc(entry.source || 'Built in')}</dd></div>
      <div class="hd-row"><dt>Delay</dt><dd>${esc(entry.delay || 'None')}</dd></div>
      <div class="hd-row"><dt>Category</dt><dd><button type="button" class="hd-cat" data-cat="${esc(entry.category)}">${esc(entry.category)}</button></dd></div>
    </dl>
    ${extra}
    ${related.length ? `<h3 class="hs-h">Also in ${esc(entry.category)}</h3><p class="hd-rel">${related.map((c) => `<a class="code" href="${esc(q(`HELP ${c.name}`))}" data-cmd="${esc(`HELP ${c.name}`)}">${esc(c.name)}</a>`).join('')}</p>` : ''}
  </article>`;
}

const ESC_BACK = '<span class="help-esc"><kbd>Esc</kbd> back</span>';

// Find mode: "/" focuses the command bar with its prompt turned to "/", and what is typed
// there filters the list here (the bar's own suggestion list stays shut). Enter runs the
// best match, Esc leaves find mode. Returns the cleanup.
export function findMode({ doc = document, bar, promptEl, onFilter, onRun, status }) {
  let on = false;
  const prompt = promptEl?.textContent;
  function enter() {
    on = true;
    bar.value = '';
    bar.closest('form')?.classList.add('is-find');
    if (promptEl) promptEl.textContent = '/';
    bar.focus();
    onFilter('');
    status('FIND: TYPE A WORD, ENTER RUNS THE FIRST MATCH');
  }
  function leave({ clear = false } = {}) {
    if (!on) return;
    on = false;
    bar.closest('form')?.classList.remove('is-find');
    if (promptEl) promptEl.textContent = prompt;
    if (clear) bar.value = '';
    onFilter('');
    status('');
  }
  function onKey(e) {
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const field = e.target.closest?.('input, textarea, select');
      if (field && !(field === bar && !bar.value)) return;
      e.preventDefault();
      e.stopPropagation();
      enter();
      return;
    }
    if (!on || e.target !== bar) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      leave({ clear: true });
    } else if (e.key === 'Enter') {
      const best = onFilter(bar.value);
      if (!best) { leave(); return; } // nothing matches: the bar runs what was typed
      e.preventDefault();
      e.stopImmediatePropagation();
      leave({ clear: true });
      onRun(best);
    } else if (e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.stopImmediatePropagation(); // no completion or history while finding
      if (e.key === 'Tab') e.preventDefault();
    }
  }
  function onInput(e) {
    if (!on || e.target !== bar) return;
    e.stopImmediatePropagation(); // the bar's suggestion list stays shut
    const n = onFilter(bar.value, true);
    status(bar.value.trim() ? `FIND: ${n} ${n === 1 ? 'COMMAND' : 'COMMANDS'}` : 'FIND: TYPE A WORD, ENTER RUNS THE FIRST MATCH');
  }
  function onBlur() { if (on && !bar.value) leave(); }
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('input', onInput, true);
  bar.addEventListener('blur', onBlur);
  return () => {
    leave();
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('input', onInput, true);
    bar.removeEventListener('blur', onBlur);
  };
}

export function render(el, cmd, ctx) {
  const topic = resolveTopic(cmd.args?.topic);
  if (topic.entry) {
    const label = topic.ticker ? `HELP ${topic.ticker}` : `HELP ${topic.entry.name}`;
    el.innerHTML = `<div class="help">${panel('1', label, detail(topic.entry, topic.ticker), { cls: 'panel-solo', meta: ESC_BACK })}</div>`;
    el.querySelector('.hd-cat')?.addEventListener('click', (e) => {
      ctx.store.set(JUMP_KEY, e.currentTarget.dataset.cat);
      ctx.run('HELP');
    });
    ctx.status(topic.from ? `HELP ${topic.entry.name} (FROM ${topic.from})` : '');
    return () => {};
  }

  el.innerHTML = `<div class="help">${panel('1', 'HELP', helpHtml(topic.query || ''), { cls: 'panel-solo', meta: ESC_BACK })}</div>`;
  const found = el.querySelector('.help-found');
  let shown = topic.query || '';
  // Draws the list for a query; -> the best match's command (Enter), or with count the
  // number of matches.
  function filter(text, count = false) {
    const t = String(text || '').trim();
    const res = filterGroups(t);
    if (t !== shown) { found.innerHTML = listHtml(t); shown = t; }
    found.querySelector('.hl-row.is-best')?.classList.remove('is-best');
    if (res.best) found.querySelector(`.hl-name[data-cmd="${CSS.escape(res.best)}"]`)?.closest('.hl-row').classList.add('is-best');
    return count ? (res.count ?? 0) : res.best;
  }

  // The Category button on a command's page: open the list at that group.
  const jump = ctx.store.get(JUMP_KEY, null);
  if (jump) {
    ctx.store.set(JUMP_KEY, null);
    el.querySelector(`.hl-group[data-group="${CSS.escape(String(jump))}"]`)?.scrollIntoView({ block: 'start' });
  }

  const bar = document.getElementById('cmd');
  const stop = bar
    ? findMode({ bar, promptEl: bar.closest('form')?.querySelector('.prompt'), onFilter: filter, onRun: (c) => ctx.run(c), status: (t) => ctx.status(t) })
    : () => {};
  if (topic.query) {
    const n = filterGroups(topic.query).count;
    ctx.status(`HELP: ${n} ${n === 1 ? 'COMMAND' : 'COMMANDS'} FOR "${topic.query.toUpperCase()}"`);
  } else ctx.status('');
  return stop;
}
