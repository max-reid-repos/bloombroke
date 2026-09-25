// HELP: every command with a hint and an example, plus what is coming next.

export function render(el, cmd, ctx) {
  const esc = ctx.escapeHtml;
  const q = (c) => '?' + new URLSearchParams({ c }).toString();

  const live = ctx.commands.map((c) => `
    <li class="cmd-row">
      <span class="cmd-name">${esc(c.name)}</span>
      <span class="cmd-hint">${esc(c.hint)}</span>
      <a class="cmd-example" href="${q(c.example)}" data-cmd="${esc(c.example)}">${esc(c.example)}</a>
    </li>`).join('');

  const soon = ctx.soon.map((c) => `
    <li class="cmd-row is-soon">
      <span class="cmd-name">${esc(c.name)}</span>
      <span class="cmd-hint">${esc(c.hint)}</span>
      <span class="cmd-example">Soon</span>
    </li>`).join('');

  el.innerHTML = `
    <div class="screen-head">
      <h1 class="eyebrow">Help</h1>
    </div>
    <p class="lede">Type a command and press Enter. Plain English, any case.</p>
    <ul class="cmd-list" aria-label="Commands">${live}</ul>
    <h2 class="eyebrow section-gap">Coming soon</h2>
    <ul class="cmd-list" aria-label="Coming soon">${soon}</ul>
    <h2 class="eyebrow section-gap">Keys</h2>
    <dl class="keys">
      <div><dt><kbd>Enter</kbd></dt><dd>Run the command</dd></div>
      <div><dt><kbd>Tab</kbd></dt><dd>Complete the suggestion</dd></div>
      <div><dt><kbd>Up</kbd> <kbd>Down</kbd></dt><dd>Walk through your past commands</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>Clear the command bar</dd></div>
    </dl>
    <p class="footnote">Every screen is a link. Copy the address bar to share what you see.</p>`;
}
