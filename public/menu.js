// MENU (Ctrl+K): every command by category in a quick overlay, with a find box. Same
// data as HELP (registry.js). Picking a command runs its first example.

import { LISTED, categoriesInUse, searchCommands } from './registry.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = (c) => '?' + new URLSearchParams({ c }).toString();

// What the menu lists: runnable commands (not MENU itself, not patterns or SOON).
export const menuItems = () => LISTED.filter((c) => !c.pattern && !c.soon && c.name !== 'MENU' && c.examples.length);

function item(c) {
  const ex = c.examples[0];
  return `<li><a class="mn-item" href="${esc(q(ex))}" data-cmd="${esc(ex)}"><span class="mn-name">${esc(c.name)}</span><span class="mn-sum">${esc(c.summary)}</span></a></li>`;
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
      <p class="menu-foot"><a class="code" href="${esc(q('HELP'))}" data-cmd="HELP">HELP</a> has the syntax and examples for every command.</p>
    </div>`;
  document.body.appendChild(root);
  const body = root.querySelector('.menu-body');
  const input = root.querySelector('.menu-q');
  let active = -1;
  let returnFocus = null;

  function paint() {
    const text = input.value.trim();
    const items = menuItems();
    active = -1;
    if (text) {
      const found = searchCommands(text, items);
      body.innerHTML = found.length
        ? `<ul class="mn-list mn-found">${found.map(item).join('')}</ul>`
        : '<p class="mn-none">No command matches. Press Enter to run what you typed.</p>';
      return;
    }
    body.innerHTML = `<div class="mn-grid">${categoriesInUse().map((cat) => {
      const list = items.filter((c) => c.category === cat);
      return list.length ? `<section class="mn-cat"><h3 class="mn-h">${esc(cat)}</h3><ul class="mn-list">${list.map(item).join('')}</ul></section>` : '';
    }).join('')}</div>`;
  }

  function links() { return [...body.querySelectorAll('.mn-item')]; }
  function mark() {
    links().forEach((a, i) => a.classList.toggle('is-active', i === active));
    links()[active]?.scrollIntoView({ block: 'nearest' });
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
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    const list = links();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!list.length) return;
      active = e.key === 'ArrowDown' ? (active + 1) % list.length : (active <= 0 ? list.length - 1 : active - 1);
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
