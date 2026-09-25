// HELP: the command directory. Categories on the left, the commands of one category on
// the right, a search box on top (/ focuses it). HELP <command> opens one command:
// syntax, options, examples, source and delay. Everything comes from ../registry.js.

import { esc, q } from './markets.js';
import {
  CATEGORIES, findCommand, byCategory, categoriesInUse, searchCommands,
  START_HERE, GRAMMAR_RULES, FUNCTION_BAR,
} from '../registry.js';

const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
const CAT_KEY = 'bb.helpcat';

// HELP [topic]: the words after HELP.
export function parse(args) {
  return { topic: args.length ? args.join(' ') : null };
}

// What HELP <topic> shows: { entry, ticker } for a command or a ticker, or { query }
// to search for anything else.
export function resolveTopic(topic) {
  const words = String(topic || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return {};
  for (const w of words) {
    const entry = findCommand(w);
    if (entry && !entry.hidden) return { entry };
  }
  if (words.length === 1 && TICKER_RE.test(words[0])) return { entry: findCommand('<TICKER>'), ticker: words[0] };
  return { query: words.join(' ').toLowerCase() };
}

const code = (c) => `<a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">${esc(c)}</a>`;
const helpCmd = (c) => (c.pattern ? 'HELP AAPL' : `HELP ${c.name}`);

// One command row: name, what it does, syntax, example.
export function commandRow(c, i, { showCategory = false } = {}) {
  const ex = c.soon ? '<span class="hc-soon">SOON</span>' : (c.examples[0] ? code(c.examples[0]) : '');
  const cat = showCategory ? `<span class="hc-cat">${esc(c.category)}</span>` : '';
  return `<li class="hc-row${c.soon ? ' is-soon' : ''}" data-i="${i}" data-ex="${esc(c.soon ? '' : c.examples[0] || '')}">
    <a class="hc-name" href="${esc(q(helpCmd(c)))}" data-cmd="${esc(helpCmd(c))}" title="More about ${esc(c.name)}">${esc(c.name)}</a>
    <span class="hc-sum">${esc(c.summary)}${cat}</span>
    <span class="hc-syn">${esc(c.syntax)}</span>
    <span class="hc-ex">${ex}</span>
  </li>`;
}

function rows(list, opts) {
  return `<ol class="hc-list">${list.map((c, i) => commandRow(c, i, opts)).join('')}</ol>`;
}

function keysList(fkeys) {
  const keys = [
    ['Enter', 'Run the command'], ['Tab', 'Complete the suggestion'], ['Up Down', 'Past commands'],
    ['Esc', 'Clear the bar, then go back'], ['Ctrl K', 'Open the menu'], ['/', 'Search HELP'], ['1-9', 'Stock functions, on a stock screen'],
  ];
  const k = (s) => s.split(' ').map((p) => `<kbd>${esc(p)}</kbd>`).join(' ');
  return `<dl class="keys">${keys.map(([a, b]) => `<div><dt>${k(a)}</dt><dd>${esc(b)}</dd></div>`).join('')}
    ${fkeys.map((f) => `<div><dt><kbd>${esc(f.key)}</kbd></dt><dd>${esc(f.label)}</dd></div>`).join('')}</dl>`;
}

function startHere(fkeys) {
  const rules = GRAMMAR_RULES.map(([rule, ex], i) => `<li class="hs-rule"><span class="hs-n">${i + 1}</span><span class="hs-text">${esc(rule)}</span>${code(ex)}</li>`).join('');
  const tries = START_HERE.map(([c, what]) => `<li><a class="hs-try" href="${esc(q(c))}" data-cmd="${esc(c)}"><span class="hs-cmd">${esc(c)}</span><span class="hs-what">${esc(what)}</span></a></li>`).join('');
  return `<section class="hs-card" aria-label="Start here">
      <h3 class="hs-h">How it works</h3>
      <ol class="hs-rules">${rules}</ol>
      <h3 class="hs-h">Try these first</h3>
      <ul class="hs-tries">${tries}</ul>
    </section>
    <h3 class="hs-h">Help and navigation</h3>
    ${rows(byCategory('Start here'))}
    <h3 class="hs-h">Keys</h3>
    ${keysList(fkeys)}`;
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

function readCat(store) {
  const c = store.get(CAT_KEY, CATEGORIES[0]);
  return categoriesInUse().includes(c) ? c : CATEGORIES[0];
}

export function render(el, cmd, ctx) {
  const topic = resolveTopic(cmd.args?.topic);
  const cats = categoriesInUse();
  let cat = readCat(ctx.store);
  let query = topic.query || '';
  let view = topic.entry ? 'detail' : (query ? 'search' : 'cat');
  let active = -1;

  el.innerHTML = `<div class="help">
    <div class="help-search">
      <span class="prompt" aria-hidden="true">/</span>
      <input class="help-q" type="search" maxlength="60" spellcheck="false" autocomplete="off" aria-label="Search commands" placeholder="Search commands: insider, yield, dividend, earnings" value="${esc(query)}">
      <span class="help-count dim" aria-live="polite"></span>
    </div>
    <div class="help-body">
      <nav class="help-cats" aria-label="Command categories">
        ${cats.map((c) => `<button type="button" class="help-cat" data-cat="${esc(c)}">${esc(c)}<span class="help-n">${c === 'Start here' ? '' : byCategory(c).length}</span></button>`).join('')}
      </nav>
      <div class="help-main"></div>
    </div>
  </div>`;
  const main = el.querySelector('.help-main');
  const input = el.querySelector('.help-q');
  const count = el.querySelector('.help-count');

  function paint() {
    el.querySelectorAll('.help-cat').forEach((b) => {
      const on = view === 'cat' && b.dataset.cat === cat;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    active = -1;
    count.textContent = '';
    if (view === 'detail') {
      main.innerHTML = detail(topic.entry, topic.ticker);
    } else if (view === 'search') {
      const found = searchCommands(query);
      count.textContent = `${found.length} ${found.length === 1 ? 'command' : 'commands'}`;
      main.innerHTML = found.length
        ? `<h2 class="help-h">Commands for "${esc(query)}"</h2>${rows(found, { showCategory: true })}<p class="help-tip dim">Up and Down pick a row, Enter runs its example.</p>`
        : `<h2 class="help-h">Nothing for "${esc(query)}"</h2><p class="muted">Try a plainer word, like price, news, rate or dividend. Or type a ticker in the command bar: ${code('AAPL')}</p>`;
    } else if (cat === 'Start here') {
      main.innerHTML = `<h2 class="help-h">Start here</h2>${startHere(ctx.fkeys)}`;
    } else {
      main.innerHTML = `<h2 class="help-h">${esc(cat)}</h2>${rows(byCategory(cat))}`;
    }
  }

  function markActive() {
    const list = [...main.querySelectorAll('.hc-row[data-ex]')];
    list.forEach((r, i) => r.classList.toggle('is-active', i === active));
    list[active]?.scrollIntoView({ block: 'nearest' });
  }

  el.querySelector('.help-cats').addEventListener('click', (e) => {
    const b = e.target.closest('.help-cat');
    if (!b) return;
    cat = b.dataset.cat;
    ctx.store.set(CAT_KEY, cat);
    view = 'cat';
    query = '';
    input.value = '';
    paint();
  });
  main.addEventListener('click', (e) => {
    const b = e.target.closest('.hd-cat');
    if (!b) return;
    ctx.store.set(CAT_KEY, b.dataset.cat);
    ctx.run('HELP');
  });

  input.addEventListener('input', () => {
    query = input.value.trim().toLowerCase();
    view = query ? 'search' : (topic.entry ? 'detail' : 'cat');
    paint();
  });
  input.addEventListener('keydown', (e) => {
    const list = [...main.querySelectorAll('.hc-row[data-ex]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list.length) return;
      e.preventDefault();
      active = e.key === 'ArrowDown' ? Math.min(list.length - 1, active + 1) : Math.max(0, active - 1);
      markActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = list[active >= 0 ? active : 0];
      if (row?.dataset.ex) ctx.run(row.dataset.ex);
    } else if (e.key === 'Escape') {
      // First Esc clears the search, the next one leaves it.
      e.preventDefault();
      e.stopPropagation();
      if (input.value) { input.value = ''; input.dispatchEvent(new Event('input')); } else input.blur();
    }
  });

  // "/" focuses the search, from the empty command bar or from anywhere on the page.
  function onSlash(e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const field = t.closest?.('input, textarea, select');
    if (field && !(field.id === 'cmd' && !field.value)) return;
    e.preventDefault();
    e.stopPropagation();
    input.focus();
    input.select();
  }
  document.addEventListener('keydown', onSlash, true);

  paint();
  if (query) input.focus();
  ctx.status(topic.entry ? `HELP ${topic.ticker || topic.entry.name}` : 'HELP: PICK A CATEGORY, OR PRESS / TO SEARCH');
  return () => document.removeEventListener('keydown', onSlash, true);
}
