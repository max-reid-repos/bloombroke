// DESK panels run screens in embed mode, and there they are compact: the DESK panel head
// already names the command, so a screen's first panel head drops its title (its meta,
// counts and tools stay), and no panel title carries the "1)" numbering. Screens draw
// asynchronously, so a MutationObserver keeps the view compact as it fills in.

// "2) CHART 1Y" -> "CHART 1Y"
export function stripNumber(text) {
  return String(text ?? '').replace(/^\s*\d+\)\s+/, '');
}

// Apply to one view now and on every change. Returns a cleanup.
export function compactEmbed(view) {
  if (!view) return () => {};
  const apply = () => {
    view.querySelectorAll('.panel-label').forEach((l) => {
      // Only plain-text labels are rewritten, so links and markup inside stay intact.
      if (l.children.length) return;
      const t = stripNumber(l.textContent);
      if (t !== l.textContent) l.textContent = t;
    });
    const lead = view.querySelector('.panel-head');
    if (lead && !lead.classList.contains('is-lead')) {
      view.querySelectorAll('.panel-head.is-lead').forEach((h) => h.classList.remove('is-lead'));
      lead.classList.add('is-lead');
    }
  };
  apply();
  if (typeof MutationObserver !== 'function') return () => {};
  const mo = new MutationObserver(apply);
  mo.observe(view, { childList: true, subtree: true });
  return () => mo.disconnect();
}
