// ALERTS: the alerts saved in this browser. ALERTS <symbol> > <level> adds one (checked
// against a live quote first), ALERTS CLEAR asks, then removes them all. The rows show
// the condition, the value now, how far it is, and WAITING or TRIGGERED. The checking
// itself is public/alerts.js (startAlerts); this screen reads what it saves.

import { esc, q, panel } from './markets.js';
import { decimalsOf } from './quote.js';
import { toolbar } from '../kit.js';
import { rowActions, listTools } from './watch.js';
import {
  parseAlertArgs, loadAlerts, saveAlerts, addAlert, removeAlert, rearm, markSeen,
  fmtLevel, fmtNow, distance, MAX_ALERTS, HONEST_LINE,
} from '../alerts.js';

export const parse = (args) => parseAlertArgs(args);

const ERRORS = {
  usage: () => 'Type ALERTS, a symbol, > or <, and a level.',
  symbol: (bad) => `${bad} is not a symbol this terminal knows.`,
  gauge: (bad) => `${bad} has no single number to watch.`,
  level: (bad) => `${bad} is not a level. Use a number.`,
  full: () => `There are ${MAX_ALERTS} alerts, the most this browser keeps. Remove one first.`,
  duplicate: (bad) => `${bad} is already set.`,
};

const code = (c) => `<span class="code">${esc(c)}</span>`;
const pad = (n) => String(n).padStart(2, '0');

// TRIGGERED 14:32 today, TRIGGERED SEP 25 14:32 before (this browser's time).
export function firedAt(ms, now = Date.now()) {
  const d = new Date(ms);
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (new Date(now).toDateString() === d.toDateString()) return t;
  return `${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()} ${t}`;
}

export function alertsTable(list, now = Date.now()) {
  const rows = list.map((a) => {
    const fired = a.state === 'triggered';
    const state = fired
      ? `<span class="al-state is-fired" title="${esc(new Date(a.firedAt).toString())}">TRIGGERED ${esc(firedAt(a.firedAt, now))}</span>`
      : '<span class="al-state">WAITING</span>';
    const acts = [
      ...(fired ? [{ act: 'rearm', label: 'RE-ARM', aria: `Re-arm the ${a.sym} alert`, text: true }] : []),
      { act: 'remove', label: '×', aria: `Remove the ${a.sym} alert` },
    ];
    return `<tr class="row-link${fired ? ' is-fired' : ''}" data-cmd="${esc(a.sym)}" data-id="${esc(a.id)}" tabindex="0">
      <th scope="row" class="wl-sym"><a href="${esc(q(a.sym))}" data-cmd="${esc(a.sym)}" tabindex="-1">${esc(a.sym)}</a></th>
      <td class="name al-name">${esc(a.name || '')}</td>
      <td class="num al-cond">${esc(a.op)} ${esc(fmtLevel(a))}</td>
      <td class="num last${a.stale ? ' is-stale' : ''}"${a.stale ? ' title="The source is not answering: the last value it gave"' : ''}>${esc(fmtNow(a))}${a.stale ? ' <span class="al-stale">stale</span>' : ''}</td>
      <td class="num al-dist">${esc(distance(a))}</td>
      <td class="al-st">${state}</td>
      ${rowActions(acts)}
    </tr>`;
  }).join('');
  return `<table class="grid-table wl-table al-table">
    <thead><tr><th scope="col" class="wl-sym">Symbol</th><th scope="col" class="name-h al-name">Name</th><th scope="col" class="num">Condition</th><th scope="col" class="num">Now</th><th scope="col" class="num">Distance</th><th scope="col" class="al-st">State</th><th scope="col" class="wl-act"><span class="offscreen">Re-arm or remove</span></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  const a = cmd.args || { action: 'show' };
  let list = loadAlerts(ctx.store);
  let msg = '';
  let warn = false;
  let confirming = false;
  let perm = '';

  el.innerHTML = panel('1', 'Alerts', `${toolbar({ left: `<span class="al-honest">${esc(HONEST_LINE)}</span>`, right: '<span class="list-tools"></span>', label: 'Alerts' })}<div class="wl-top al-top"></div><div class="al-body"></div>`,
    { cls: 'panel-solo', metaId: 'al-meta', meta: '', bodyCls: 'flush' });
  const top = el.querySelector('.al-top');
  const body = el.querySelector('.al-body');
  const meta = el.querySelector('#al-meta');
  const tools = el.querySelector('.list-tools');

  function drawTools() {
    tools.innerHTML = list.length ? listTools([{ tool: 'clear', label: 'CLEAR' }], { confirming, count: list.length, what: list.length === 1 ? 'alert' : 'alerts' }) : '';
  }
  function drawTop() {
    drawTools();
    top.innerHTML = `${msg ? `<p class="wl-msg${warn ? ' is-warn' : ''}" role="status">${esc(msg)}</p>` : ''}${perm}`;
    meta.textContent = `${list.length} OF ${MAX_ALERTS}`;
  }
  function draw() {
    if (!list.length) {
      body.innerHTML = `<p class="panel-msg wl-empty">No alerts. Add one from the command bar: ${code('ALERTS <symbol> > <level>')} or ${code('ALERTS <symbol> < <level>')}. Stocks, indexes, FX, yields, coins and WEIRD gauges with a number.</p>`;
    } else {
      body.innerHTML = alertsTable(list);
    }
    const at = Math.max(0, ...list.map((x) => x.lastAt || 0));
    if (at) ctx.updated(new Date(at).toISOString(), Date.now() - at > 3 * 60_000);
  }
  // Seen here: the "1 ALERT" flag in the status line goes away.
  function seen() {
    const next = markSeen(list);
    if (next !== list) {
      list = next;
      saveAlerts(ctx.store, list);
      window.dispatchEvent(new Event('bb:alerts-seen'));
    }
  }
  function commit(next) {
    list = next;
    saveAlerts(ctx.store, list);
    window.dispatchEvent(new Event('bb:alerts-seen'));
    drawTop();
    draw();
  }

  // One plain line to ask for browser notifications: after the first alert, and on this
  // screen while the browser has never been answered. The ask itself is a click.
  function askLine() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return '';
    return '<p class="al-perm">Get a browser notification when an alert fires? <button type="button" class="quiet" data-tool="notify">ALLOW NOTIFICATIONS</button></p>';
  }

  async function add(parsed) {
    let info = {};
    if (parsed.kind === 'quote') {
      msg = `Checking ${parsed.sym}...`;
      drawTop();
      try {
        const d = await ctx.fetchJSON(`/api/quotes?s=${encodeURIComponent(parsed.sym)}`, { signal: ctx.signal });
        const qt = (d.quotes || []).find((x) => x.ticker === parsed.sym) || (d.quotes || [])[0];
        if (!qt || !Number.isFinite(qt.last)) {
          msg = `No quote for ${parsed.sym}. Nothing added.`;
          warn = true;
          drawTop();
          ctx.status('ALERTS: NO SUCH SYMBOL', 'warn');
          return;
        }
        info = { dp: decimalsOf(qt), unit: qt.kind === 'yield' ? '%' : '', name: qt.label || qt.name || '', last: qt.last };
      } catch (err) {
        if (err.name === 'AbortError') return;
        msg = `Could not check ${parsed.sym} right now. Nothing added. Try again in a minute.`;
        warn = true;
        drawTop();
        ctx.status('ALERTS: COULD NOT CHECK THE SYMBOL', 'warn');
        return;
      }
    }
    list = loadAlerts(ctx.store); // another tab may have changed it meanwhile
    const r = addAlert(list, parsed, info);
    if (r.error) {
      msg = ERRORS[r.error](`${parsed.sym} ${parsed.op} ${parsed.level}`);
      warn = true;
      drawTop();
      ctx.status(r.error === 'full' ? 'ALERTS: THE LIST IS FULL' : 'ALERTS: ALREADY SET', 'warn');
      return;
    }
    list = r.list;
    saveAlerts(ctx.store, list);
    const now = Number.isFinite(r.alert.last) ? ` Now ${fmtNow(r.alert)}.` : '';
    msg = `Added ${r.alert.sym} ${r.alert.op} ${fmtLevel(r.alert)}.${now}`;
    warn = false;
    perm = askLine();
    drawTop();
    draw();
    ctx.status(`ALERT ADDED: ${r.alert.sym} ${r.alert.op} ${fmtLevel(r.alert)}`);
    // Check now: a condition that is already true fires on this check.
    window.dispatchEvent(new Event('bb:alerts-check'));
  }

  if (list.length) perm = askLine();
  if (a.error) {
    msg = ERRORS[a.error](a.bad || '');
    warn = true;
    ctx.status('ALERTS: CHECK THE WORDS', 'warn');
  } else if (a.action === 'clear') {
    if (list.length) confirming = true;
    else msg = 'There are no alerts to clear.';
  }
  drawTop();
  draw();
  if (a.error && a.action === 'add') {
    top.insertAdjacentHTML('beforeend', `<p class="muted examples">Like ${code('ALERTS AAPL > 350')} ${code('ALERTS CANAL < 5')}</p>`);
  }
  if (!a.error && a.action === 'add') add(a.alert);
  else if (!a.error) ctx.status(confirming ? 'CONFIRM TO CLEAR YOUR ALERTS' : '', confirming ? 'warn' : '');
  if (confirming) tools.querySelector('[data-tool="clear-no"]')?.focus();
  seen();

  // A check or another tab changed the list: redraw, and what shows here is seen.
  const onChange = () => {
    list = loadAlerts(ctx.store);
    drawTools();
    meta.textContent = `${list.length} OF ${MAX_ALERTS}`;
    draw();
    // A hidden tab has shown nobody anything: the flag stays until someone looks.
    if (!document.hidden) seen();
  };
  window.addEventListener('bb:alerts', onChange);
  ctx.onCleanup(() => window.removeEventListener('bb:alerts', onChange));

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]')?.dataset.tool;
    if (t) {
      e.stopPropagation();
      if (t === 'clear') { confirming = true; drawTools(); tools.querySelector('[data-tool="clear-no"]')?.focus(); return; }
      if (t === 'clear-no') { confirming = false; drawTools(); ctx.status(''); return; }
      if (t === 'clear-yes') {
        const n = list.length;
        confirming = false;
        msg = `Removed all ${n} alert${n === 1 ? '' : 's'}.`;
        warn = false;
        perm = '';
        commit([]);
        ctx.status('ALERTS CLEARED');
        return;
      }
      if (t === 'notify' && typeof Notification !== 'undefined') {
        Notification.requestPermission().then((p) => {
          perm = p === 'granted' ? '<p class="al-perm">Notifications are on.</p>'
            : '<p class="al-perm">Notifications are off in this browser. Alerts still show here and in the status line.</p>';
          drawTop();
        }).catch(() => {});
      }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const id = btn.closest('tr')?.dataset.id;
    const al = list.find((x) => x.id === id);
    if (!al) return;
    list = loadAlerts(ctx.store);
    if (btn.dataset.act === 'remove') {
      msg = `Removed ${al.sym} ${al.op} ${fmtLevel(al)}.`;
      warn = false;
      commit(removeAlert(list, id));
      ctx.status(`REMOVED THE ${al.sym} ALERT`);
    } else if (btn.dataset.act === 'rearm') {
      const next = rearm(list, id);
      const again = next.find((x) => x.id === id);
      msg = again?.rearmed
        ? `Re-armed ${al.sym} ${al.op} ${fmtLevel(al)}. It fires after ${al.sym} crosses the level again.`
        : `Re-armed ${al.sym} ${al.op} ${fmtLevel(al)}.`;
      warn = false;
      commit(next);
      ctx.status(`RE-ARMED THE ${al.sym} ALERT`);
    }
  });
}
