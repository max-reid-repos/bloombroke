// MENU (Ctrl+K): START HERE, then every command by category, in a quick overlay with a
// find box. The same groups as HELP (registry.js commandGroups), in five fixed columns
// (MENU_COLUMNS): a category never breaks across two. Picking a command runs its first
// example. The columns hold names only: the picked (or pointed at) command's line shows
// in the footer. A find lists its matches with their lines.

import { LISTED, commandGroups, inGroups, searchCommands, START_GROUP } from './registry.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = (c) => '?' + new URLSearchParams({ c }).toString();

// What the menu lists: runnable commands (not MENU itself, not patterns or SOON).
export const menuItems = () => LISTED.filter(inGroups);

// it: a group item ({ name, cmd, summary }) or a registry entry (a search result).
// In the columns (sum false) the line waits in data-sum for the footer.
function item(it, sum) {
  const cmd = it.cmd || it.examples[0];
  return sum
    ? `<li><a class="mn-item" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}"><span class="mn-name">${esc(it.name)}</span><span class="mn-sum">${esc(it.summary)}</span></a></li>`
    : `<li><a class="mn-item" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}" data-sum="${esc(it.summary)}"><span class="mn-name">${esc(it.name)}</span></a></li>`;
}

// The five columns, top to bottom. Whole categories only, so none is split. A category
// not named here goes to the last column.
export const MENU_COLUMNS = [
  [START_GROUP, 'Markets', 'News and info'],
  ['Stocks and companies', 'Charts', 'Money tools'],
  ['Weird data'],
  ['Your stuff', 'Rates, FX, crypto', 'Economy and calendars'],
  ['Pro', 'About'],
];

// The menu's groups as HTML, column by column. Names only.
export function menuGroupsHtml(groups = commandGroups()) {
  const cols = MENU_COLUMNS.map((names) => names.map((n) => groups.find((g) => g.name === n)).filter(Boolean));
  for (const g of groups) if (!MENU_COLUMNS.flat().includes(g.name)) cols[cols.length - 1].push(g);
  const cat = (g) => `<section class="mn-cat" data-group="${esc(g.name)}"><h3 class="mn-h">${esc(g.name)}</h3><ul class="mn-list">${g.items.map((it) => item(it, false)).join('')}</ul></section>`;
  return `<div class="mn-grid">${cols.map((c) => `<div class="mn-col">${c.map(cat).join('')}</div>`).join('')}</div>`;
}

// A find's matches, each with its line.
export function menuFoundHtml(found) {
  return `<ul class="mn-list mn-found">${found.map((c) => item(c, true)).join('')}</ul>`;
}

// The footer: the picked command and its line, or (nothing picked) where the syntax is.
export const MENU_FOOT = `<a class="code" href="${esc(q('HELP'))}" data-cmd="HELP">HELP</a> has the syntax and examples for every command.`;
export function menuFootHtml(name, sum) {
  return sum ? `<span class="mn-foot-name">${esc(name)}</span> ${esc(sum)}` : MENU_FOOT;
}

export function createMenu({ onClose } = {}) {
  const root = document.createElement('div');
  root.className = 'menu-overlay';
  root.hidden = true;
  root.innerHTML = `<div class="menu" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="menu-search">
        <span class="prompt" aria-hidden="true">&gt;</span>
        <input class="menu-q" type="search" maxlength="60" spellcheck="false" autocomplete="off" aria-label="Find a command" placeholder="Find a command: chart, yield, dividend">
        <span class="menu-keys" aria-hidden="true"><kbd>Enter</kbd> run <kbd>Esc</kbd> close</span>
      </div>
      <div class="menu-body"></div>
      <p class="menu-foot">${MENU_FOOT}</p>
    </div>`;
  document.body.appendChild(root);
  const body = root.querySelector('.menu-body');
  const input = root.querySelector('.menu-q');
  const footEl = root.querySelector('.menu-foot');
  let active = -1;
  let returnFocus = null;

  function paint() {
    const text = input.value.trim();
    const items = menuItems();
    active = -1;
    foot(null);
    if (text) {
      const found = searchCommands(text, items);
      body.innerHTML = found.length
        ? menuFoundHtml(found)
        : '<p class="mn-none">No command matches. Press Enter to run what you typed.</p>';
      return;
    }
    body.innerHTML = menuGroupsHtml();
  }

  // The footer line for a column row (a found row has its line already).
  let shown;
  function foot(a) {
    if (a === shown) return;
    shown = a;
    footEl.innerHTML = menuFootHtml(a?.querySelector('.mn-name')?.textContent || '', a?.dataset.sum || '');
  }

  function links() { return [...body.querySelectorAll('.mn-item')]; }
  function mark() {
    const list = links();
    list.forEach((a, i) => a.classList.toggle('is-active', i === active));
    list[active]?.scrollIntoView({ block: 'nearest' });
    foot(list[active] || null);
  }

  function open() {
    if (!root.hidden) { input.focus(); return; }
    returnFocus = document.activeElement;
    root.hidden = false;
    document.body.classList.add('menu-open');
    input.value = '';
    paint();
    input.focus();
  }
  function close() {
    if (root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('menu-open');
    onClose?.(returnFocus);
  }

  input.addEventListener('input', paint);
  // Pointing at a row shows its line; leaving it shows the picked row's again.
  body.addEventListener('mouseover', (e) => foot(e.target.closest('.mn-item') || links()[active] || null));
  body.addEventListener('mouseleave', () => foot(links()[active] || null));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    const list = links();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!list.length) return;
      active = e.key === 'ArrowDown' ? (active + 1) % list.length : (active <= 0 ? list.length - 1 : active - 1);
      mark();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && active >= 0 && !input.value.trim()) {
      // Across the columns: the row nearest the same height in the next column over.
      e.preventDefault();
      const cols = [...body.querySelectorAll('.mn-col')];
      const at = cols.findIndex((c) => c.contains(list[active]));
      const to = cols[(at + (e.key === 'ArrowRight' ? 1 : cols.length - 1)) % cols.length];
      const y = list[active].getBoundingClientRect().top;
      const rows = [...to.querySelectorAll('.mn-item')];
      if (!rows.length) return;
      const near = rows.reduce((a, r) => (Math.abs(r.getBoundingClientRect().top - y) < Math.abs(a.getBoundingClientRect().top - y) ? r : a));
      active = list.indexOf(near);
      mark();
    } else if (e.key === 'Enter' && e.target === input) {
      e.preventDefault();
      e.stopPropagation();
      const pick = list[active >= 0 ? active : 0];
      if (pick && (active >= 0 || input.value.trim())) pick.click();
      else if (input.value.trim()) { const c = input.value.trim(); close(); window.dispatchEvent(new CustomEvent('bb:run', { detail: c })); }
    }
    e.stopPropagation(); // keys in the menu never reach the page (F-keys, digits, typing)
  });
  // A picked command closes the menu; the page's click handler then runs it.
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-cmd]')) { close(); return; }
    if (e.target === root) close();
  });

  return { open, close, isOpen: () => !root.hidden, toggle: () => (root.hidden ? open() : close()) };
}
