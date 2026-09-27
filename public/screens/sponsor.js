// SPONSOR: how sponsors work on Bloombroke, on one short screen. Also the browser side of
// the sponsor config (/api/sponsors, from data/sponsors.json via lib/sponsors.js): the
// line in the status strip, hidden for Pro, and the "SPONSORED BY" note on a WEIRD gauge.
// Plain text and one plain link: no pixels, no third-party scripts, no tracking code.

import { esc, panel, metaNote } from './markets.js';

export const CONTACT = 'hello@bloombroke.com';
export const SPONSOR_LINES = [
  'One plain line in the status strip, one sponsor at a time. Pro users never see it.',
  'No tracking: no pixels, no third-party scripts, no tracking code on the link.',
  'We do not take brokers, exchanges, crypto, funds or tip sellers, or anyone who sells or promotes investment products.',
  'Sponsors have no say over data or content.',
];

// The status strip: SPONSOR  <name>: <text>. '' when there is no line, or for Pro.
export function sponsorLineHtml(cfg, { pro = false } = {}) {
  const line = cfg?.line;
  if (pro || !line?.name || !line?.text) return '';
  const words = `${esc(line.name)}: ${esc(line.text)}`;
  const body = /^https:\/\//.test(line.url || '')
    ? `<a href="${esc(line.url)}" rel="sponsored noopener" referrerpolicy="no-referrer" target="_blank">${words}</a>`
    : `<span>${words}</span>`;
  return `<span class="sponsor-k">SPONSOR</span>${body}`;
}

// A WEIRD gauge's title strip: SPONSORED BY <name>, or '' when the gauge has no sponsor.
export function gaugeSponsorHtml(cfg, id) {
  const name = cfg?.gauges?.[id]?.name;
  return name ? metaNote(`SPONSORED BY ${String(name).toUpperCase()}`) : '';
}

// The config, asked once per page load. Anything wrong: no sponsors.
let loading = null;
export function loadSponsors() {
  if (typeof fetch !== 'function') return Promise.resolve({ line: null, gauges: {} });
  loading ||= fetch('/api/sponsors', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && typeof d === 'object' ? { line: d.line || null, gauges: d.gauges || {} } : { line: null, gauges: {} }))
    .catch(() => { loading = null; return { line: null, gauges: {} }; });
  return loading;
}

// The one hook in the WEIRD gauge screen: if the gauge has a sponsor, a note of its own
// goes in the title strip just before the gauge's meta, so the screen can keep writing
// its own notes (record lines) into that meta without touching this one.
export function markGaugeSponsor(metaEl, id) {
  if (!metaEl) return;
  loadSponsors().then((cfg) => {
    const html = gaugeSponsorHtml(cfg, id);
    if (html && metaEl.isConnected) metaEl.insertAdjacentHTML('beforebegin', `<span class="panel-meta wd-sponsor">${html}</span>`);
  });
}

export function sponsorHtml(cfg) {
  const now = cfg?.line?.name ? `Now: ${esc(cfg.line.name)}.` : 'Now: no sponsor.';
  return panel('1', 'Sponsor', `${SPONSOR_LINES.map((t) => `<p class="muted">${esc(t)}</p>`).join('')}
    <p class="notice">To sponsor Bloombroke: <a href="mailto:${CONTACT}">${CONTACT}</a></p>`, { cls: 'panel-solo', meta: metaNote(now.toUpperCase()) });
}

export function render(el, cmd, ctx) {
  el.innerHTML = sponsorHtml(null);
  ctx.status('SPONSOR: ONE LINE, NO TRACKING');
  loadSponsors().then((cfg) => { if (el.isConnected) el.innerHTML = sponsorHtml(cfg); });
}
