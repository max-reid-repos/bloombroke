// GUESS: one mystery S&P 100 stock a day. The chart is its last year of daily closes as
// % change (no price, no name); six tries, and each guess gets four hint cells from the
// server (data/guess.js). Progress and stats live in this browser only (bb.guess).
// Pure parts (share text, stats, countdown, matching, the chart) are exported for tests.

import { esc, q, panel, metaNote, LOADING } from './markets.js';
import { guessEmbedSnippet } from '../embed-snippet.js'; // EMBED: the iframe line
import { goal } from '../goal.js'; // GOALS
import { loadModule, loadCss, stylesOf } from '../lazy.js'; // POST TO CHAT: pro.js by name (the page's own copy, not in the embed); HOW TO PLAY: howto.js

export const STORE_KEY = 'bb.guess';
export const TRIES = 6;
export const SHARE_URL = 'bloombroke.com/?c=GUESS';
// Coloured squares only in the share text: they are how a result reads on X. Green a
// match, blue (the ice blue of the site, never yellow) near, black a miss.
export const SQUARES = { hit: '\u{1F7E9}', near: '\u{1F7E6}', miss: '\u2B1B', none: '\u2B1B' };
const KEEP_RESULTS = 400;

// rows: [{ cells: [{ grade }] }] -> the text people paste.
export function shareText(n, rows, solved) {
  const score = solved ? rows.length : 'X';
  const lines = rows.map((r) => (r.cells || []).map((c) => SQUARES[c.grade] || SQUARES.none).join(''));
  return [`BLOOMBROKE GUESS #${n} ${score}/${TRIES}`, ...lines, SHARE_URL].join('\n');
}

export function shareOnX(text) {
  return `https://x.com/intent/post?${new URLSearchParams({ text })}`;
}

// results: { [n]: { t: tries, w: 1 won | 0 lost } }; today: today's puzzle number.
// The current streak counts back from today (or from yesterday while today is still
// open), so a missed day or a loss breaks it.
export function guessStats(results, today) {
  const r = results && typeof results === 'object' ? results : {};
  const ns = Object.keys(r).map(Number).filter((n) => Number.isInteger(n) && n >= 1).sort((a, b) => a - b);
  const played = ns.length;
  const wins = ns.filter((n) => r[n]?.w).length;
  let current = 0;
  for (let k = r[today] ? today : today - 1; k >= 1 && r[k]?.w; k -= 1) current += 1;
  let max = 0;
  let run = 0;
  let prev = null;
  for (const n of ns) {
    if (!r[n]?.w) run = 0;
    else run = prev === n - 1 ? run + 1 : 1;
    max = Math.max(max, run);
    prev = n;
  }
  return { played, wins, winPct: played ? Math.round((wins / played) * 100) : null, current, max };
}

// The saved state, always the right shape.
export function readState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const results = s.results && typeof s.results === 'object' && !Array.isArray(s.results) ? s.results : {};
  const g = s.game && typeof s.game === 'object' ? s.game : null;
  const okRow = (r) => r && typeof r.ticker === 'string' && typeof r.name === 'string' && Array.isArray(r.cells);
  const game = g && Number.isInteger(g.n) && Array.isArray(g.rows) ? { n: g.n, rows: g.rows.filter(okRow).slice(0, TRIES) } : null;
  // The answer that came with the last wrong guess (today's is not revealed any other way).
  if (game && typeof g.answer?.ticker === 'string' && typeof g.answer?.name === 'string') game.answer = { ticker: g.answer.ticker, name: g.answer.name };
  return { results, game };
}

// The check query: the puzzle, this guess, and the guesses before it (p), so the last
// wrong one brings the answer back.
export function checkQuery(game, ticker) {
  const q = { n: String(game.n), g: ticker };
  if (game.rows.length) q.p = game.rows.map((r) => r.ticker).join(',');
  return new URLSearchParams(q).toString();
}

// A finished game goes into results (once), the oldest dropping past KEEP_RESULTS.
export function recordResult(state, n, tries, won) {
  const results = { ...state.results };
  if (!results[n]) results[n] = { t: tries, w: won ? 1 : 0 };
  const keys = Object.keys(results).map(Number).sort((a, b) => a - b);
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_RESULTS))) delete results[k];
  return { ...state, results };
}

const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function nyClock(ms) {
  const p = NY.formatToParts(new Date(ms));
  const get = (k) => Number(p.find((x) => x.type === k)?.value) || 0;
  return { h: get('hour') % 24, m: get('minute'), s: get('second') };
}

// Milliseconds to the next New York midnight (a new puzzle), right on the days the
// clocks change too.
export function msToNextPuzzle(nowMs) {
  const { h, m, s } = nyClock(nowMs);
  const since = ((h * 60 + m) * 60 + s) * 1000 + (nowMs % 1000);
  let at = nowMs - since + 86_400_000;
  const c = nyClock(at);
  if (c.h === 23) at += 3_600_000; // a 25-hour day
  else if (c.h === 1) at -= 3_600_000; // a 23-hour day
  return Math.max(0, at - nowMs);
}

// "13 h 20 m": hours and whole minutes, no ticking seconds (the screen updates it once a
// minute). A part minute counts as a whole one, so it never reads 0 m before the new one.
export function fmtCountdown(ms) {
  const t = Math.max(0, Math.ceil(ms / 60_000));
  return `${Math.floor(t / 60)} h ${t % 60} m`;
}

// pool: [[ticker, name]]. Ticker matches first, then names that start with the words,
// then names that contain them. Guessed tickers are left out.
export function matchPool(pool, text, { exclude = [], limit = 6 } = {}) {
  const s = String(text || '').trim().toUpperCase().replace(/-/g, '.');
  if (!s) return [];
  const skip = new Set(exclude);
  const score = ([t, name]) => {
    const n = name.toUpperCase();
    if (t === s) return 0;
    if (t.startsWith(s)) return 1;
    if (n.startsWith(s)) return 2;
    if (n.split(/[\s&.-]+/).some((w) => w.startsWith(s))) return 3;
    if (n.includes(s)) return 4;
    return -1;
  };
  return pool
    .filter(([t]) => !skip.has(t))
    .map((m) => [score(m), m])
    .filter(([sc]) => sc >= 0)
    .sort((a, b) => a[0] - b[0] || (a[1][0] < b[1][0] ? -1 : 1))
    .slice(0, limit)
    .map(([, m]) => m);
}

// The exact pick for what was typed: a ticker or a whole company name.
export function exactPick(pool, text) {
  const s = String(text || '').trim().toUpperCase().replace(/-/g, '.');
  return pool.find(([t]) => t === s) || pool.find(([, n]) => n.toUpperCase() === s) || null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MINUS = '−';
const pctLabel = (v, dp = 0) => `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v).toFixed(dp)}%`;

// A tick step that gives about `want` lines over the span.
export function niceStep(span, want = 5) {
  const raw = span / Math.max(1, want);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw * 0.7) return m * mag;
  return 10 * mag;
}

// series: [[t, pct]] -> an SVG string sized w x h: % lines on the right, months below.
export function chartSvg(series, w, h) {
  if (!Array.isArray(series) || series.length < 2 || !(w > 80) || !(h > 60)) return '';
  const padR = 56; const padB = 20; const padT = 8; const padL = 6;
  const pw = w - padL - padR; const ph = h - padT - padB;
  const vs = series.map((p) => p[1]);
  let lo = Math.min(0, ...vs); let hi = Math.max(0, ...vs);
  const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const t0 = series[0][0]; const t1 = series[series.length - 1][0];
  const x = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * pw;
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * ph;
  const step = niceStep(hi - lo, h < 240 ? 3 : 5);
  const f = (n) => n.toFixed(1);
  const grid = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const vy = f(y(v));
    const zero = Math.abs(v) < step / 1000;
    // A label the end tag would cover is left out.
    const lab = Math.abs(y(v) - y(series[series.length - 1][1])) < 18 ? '' : `<text class="gs-ylab" x="${w - 4}" y="${f(y(v) + 4)}" text-anchor="end">${esc(pctLabel(zero ? 0 : v))}</text>`;
    grid.push(`<line class="gs-grid${zero ? ' is-zero' : ''}" x1="${padL}" x2="${padL + pw}" y1="${vy}" y2="${vy}"/>${lab}`);
  }
  const months = [];
  // A label where each month starts (the part month at the left gets none).
  let lastM = new Date(t0).getUTCMonth(); let lastX = -Infinity;
  for (const [t] of series) {
    const mo = new Date(t).getUTCMonth();
    if (mo === lastM) continue;
    lastM = mo;
    const mx = x(t);
    if (mx - lastX < 34 || mx > padL + pw - 12) continue;
    lastX = mx;
    months.push(`<line class="gs-mtick" x1="${f(mx)}" x2="${f(mx)}" y1="${padT}" y2="${padT + ph}"/><text class="gs-xlab" x="${f(mx + 3)}" y="${h - 5}">${MONTHS[mo]}</text>`);
  }
  const pts = series.map(([t, v]) => `${f(x(t))},${f(y(v))}`).join(' ');
  const base = f(y(Math.max(lo, Math.min(hi, 0))));
  const end = series[series.length - 1][1];
  const ey = y(end);
  return `<svg class="gs-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="The mystery stock over one year, as percent change: ${esc(pctLabel(end, 1))}">
    ${months.join('')}${grid.join('')}
    <polygon class="gs-area" points="${f(padL)},${base} ${pts} ${f(padL + pw)},${base}"/>
    <polyline class="gs-line" points="${pts}"/>
    <rect class="gs-tag" x="${padL + pw + 2}" y="${f(ey - 8)}" width="${padR - 4}" height="16"/><text class="gs-tagt" x="${w - 4}" y="${f(ey + 4)}" text-anchor="end">${esc(pctLabel(end, 1))}</text>
  </svg>`;
}

const HEADS = ['SECTOR', '1Y MOVE', 'SIZE', 'FIRST LETTER'];

// Rows saved before the hints said "answer ..." (games still open on the day it changed).
const OLD_DIRS = { OTHER: 'DIFFERENT', HIGHER: 'ANSWER HIGHER', LOWER: 'ANSWER LOWER', BIGGER: 'ANSWER BIGGER', SMALLER: 'ANSWER SMALLER', LATER: 'ANSWER AFTER', EARLIER: 'ANSWER BEFORE' };
export const dirText = (d) => OLD_DIRS[d] || d;

// One arrow per cell, pointing to the answer: up when the answer is higher, bigger or
// later in A to Z, down when it is lower, smaller or earlier. No arrow when it is the
// same, close, or has no direction (a sector). The words stay as the tooltip.
const UP = new Set(['ANSWER HIGHER', 'ANSWER BIGGER', 'ANSWER AFTER']);
const DOWN = new Set(['ANSWER LOWER', 'ANSWER SMALLER', 'ANSWER BEFORE']);
export function dirArrow(d) {
  const t = dirText(d);
  return UP.has(t) ? '\u2191' : DOWN.has(t) ? '\u2193' : '';
}
const sayDir = (d) => { const t = dirText(d); return t && t !== '--' ? t.charAt(0) + t.slice(1).toLowerCase() : ''; };

// How to read the rows: one line under the table, never in it.
export const LEGEND = 'Arrows point to the answer. Green: same or close. Blue: near.';
export function legendHtml() {
  return `<p class="gs-legend">${esc(LEGEND)}</p>`;
}

// One hint cell: the guess's value, the arrow to the answer, the words for screen readers.
export function cellHtml(c) {
  const arrow = dirArrow(c.dir);
  const say = sayDir(c.dir);
  return `<td class="gs-cell g-${esc(c.grade)}"${say ? ` title="${esc(say)}"` : ''}><span class="gs-v">${esc(c.value)}</span>${arrow ? `<span class="gs-d" aria-hidden="true">${arrow}</span>` : ''}${say ? `<span class="offscreen">${esc(say)}</span>` : ''}</td>`;
}

// The guess rows, then the tries still open as blank rows.
export function rowsHtml(rows, tries = TRIES) {
  const done = rows.map((r, i) => `<tr class="gs-row${r.solved ? ' is-solved' : ''}">
      <td class="num gs-i">${i + 1}</td>
      <th scope="row" class="gs-g"><span class="gs-tk">${esc(r.ticker)}</span><span class="gs-nm">${esc(r.name)}</span></th>
      ${(r.cells || []).map(cellHtml).join('')}
    </tr>`);
  const open = [];
  for (let i = rows.length; i < tries; i += 1) open.push(`<tr class="gs-row is-open"><td class="num gs-i">${i + 1}</td><th scope="row" class="gs-g">--</th>${HEADS.map(() => '<td class="gs-cell g-open"></td>').join('')}</tr>`);
  return `<table class="gs-table">
    <thead><tr><th scope="col" class="num gs-i">#</th><th scope="col" class="gs-g">Guess</th>${HEADS.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody>${done.join('')}${open.join('')}</tbody>
  </table>`;
}

// ---- HOW TO PLAY (public/howto.js): the pop-up, opened once by itself, then by the
// link under the table or ?. In a DESK panel the legend line stays instead.
export const HOWTO_KEY = 'bb.guess.howto';
// The example: guess KO (Coca-Cola) when the answer is MDLZ (Mondelez), graded as
// data/guess.js grades it (a test checks): the same sector (green); a 1Y move 5 to 20
// points under the answer's (blue, up); over twice the answer's size (dim, down); a first
// letter 2 before the answer's (blue, up: later in A to Z).
export const HOWTO_EXAMPLE = {
  ticker: 'KO',
  name: 'Coca-Cola',
  cells: [
    { key: 'SECTOR', value: 'STAPLES', dir: 'SAME', grade: 'hit' },
    { key: '1Y MOVE', value: '+6.2%', dir: 'ANSWER HIGHER', grade: 'near' },
    { key: 'SIZE', value: '$300B', dir: 'ANSWER SMALLER', grade: 'miss' },
    { key: 'LETTER', value: 'K', dir: 'ANSWER AFTER', grade: 'near' },
  ],
};
export const HOWTO = {
  title: 'How to play',
  goal: `Find the mystery stock in ${TRIES} guesses.`,
  lines: [
    'Chart: its 1-year price, in %.',
    'Each guess gets 4 clues.',
    'Arrows point to the answer.',
  ],
  // The key: each a tiny cell of the table's own look, with a letter in it (hit: a green
  // fill; near: blue text and its arrow, no box; miss: dim text).
  legend: [
    { cls: 'gs-cell g-hit', say: 'Green', label: 'hit', sample: 'A' },
    { cls: 'gs-cell g-near', say: 'Blue', label: 'near', sample: 'A\u2191' },
    { cls: 'gs-cell g-miss', say: 'Dim', label: 'miss', sample: 'A\u2193' },
  ],
  foot: 'A new stock every day at midnight New York time.',
  button: 'PLAY',
};
// The example row: the real cells of the table, under the table's own column labels.
export function howtoExampleHtml(ex = HOWTO_EXAMPLE) {
  return `<table class="gs-table gs-howto-ex" aria-label="An example guess: ${esc(ex.ticker)}, ${esc(ex.name)}">
    <thead><tr><th scope="col" class="gs-g"><span class="offscreen">Guess</span></th>${HEADS.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody><tr class="gs-row">
      <th scope="row" class="gs-g"><span class="gs-tk">${esc(ex.ticker)}</span></th>
      ${ex.cells.map(cellHtml).join('')}
    </tr></tbody></table>`;
}
export const howtoSlots = () => ({ ...HOWTO, example: howtoExampleHtml() });
// Under the table, where the legend line was. The ? beside it (the key that opens it)
// only while the guess input is there: after the game the focus is in the command bar,
// where ? is HELP.
export function howtoLinkHtml(withKey = true) {
  return `<p class="gs-legend"><button type="button" class="card-link gs-howto" aria-haspopup="dialog"${withKey ? ' aria-keyshortcuts="?"' : ''}>How to play</button>${withKey ? '<span class="gs-key" aria-hidden="true">?</span>' : ''}</p>`;
}

// GUESS LEAGUE: POST TO CHAT beside the share buttons, for Pro with at least one chat
// that is open. rooms: [{ id, title, readOnly }] from GET /api/chat.
export const postable = (rooms) => (Array.isArray(rooms) ? rooms.filter((r) => r && !r.readOnly) : []);
export function postChatHtml(pro, rooms) {
  return pro && postable(rooms).length ? '<button type="button" class="chip gs-chat" aria-expanded="false">POST TO CHAT</button>' : '';
}
// Without Pro, where Pro members see POST TO CHAT: one quiet line, its word PRO a link to
// the PRO screen (kit.js proLine's markup). visitor: known to have no Pro (never while that
// is still being looked up, never in an embed).
export const CHAT_PRO_LINE = 'PRO: compare scores with friends in CHAT.';
export function proChatLineHtml(visitor) {
  return visitor ? `<p class="gs-pro">${esc(CHAT_PRO_LINE).replace(/^PRO/, `<a class="pro-line-link" href="${esc(q('PRO'))}" data-cmd="PRO">PRO</a>`)}</p>` : '';
}
// The chats to pick from: ALL, then each chat (up to 8; ALL covers the rest).
export function roomsPickHtml(rooms) {
  const list = postable(rooms).slice(0, 8);
  return `<span class="gs-rooms">${['<button type="button" class="chip" data-room="all">ALL</button>', ...list.map((r) => `<button type="button" class="chip" data-room="${Number(r.id)}">${esc(r.title)}</button>`)].join('')}</span>`;
}

export function statsHtml(s) {
  const item = (k, v) => `<span class="gs-stat"><span class="gs-sk">${k}</span> <b>${esc(v)}</b></span>`;
  return `<p class="gs-stats">${item('PLAYED', String(s.played))}${item('WIN %', s.winPct === null ? '--' : String(s.winPct))}${item('STREAK', String(s.current))}</p>`;
}

// The chart's strip once the game is over, won or lost: "SO · Southern Company · −12.3% in
// a year" (the ticker, the name, the 1Y move the chart ends on). Before that, and while
// the answer is still loading, the strip keeps saying MYSTERY STOCK.
export function revealHtml(answer, move) {
  if (!answer?.ticker) return '';
  const pct = Number.isFinite(move) ? ` · <span class="${move > 0 ? 'up' : move < 0 ? 'down' : 'flat'}">${esc(pctLabel(move, 1))}</span> in a year` : '';
  return `<span class="meta-note gs-reveal"><b class="gs-rtk">${esc(answer.ticker)}</b> · ${esc(answer.name)}${pct}</span>`;
}
// The move the chart ends on: the % change of its last close.
export const seriesMove = (series) => (Array.isArray(series) && series.length ? Number(series[series.length - 1][1]) : NaN);

// The end line: "Got it in 3." or "It was UPS (United Parcel Service)."
export function endLine(solvedIn, answer) {
  if (solvedIn) return `Got it in ${solvedIn}.`;
  return answer ? `It was ${answer.ticker} (${answer.name}).` : '';
}

// The chart's strip while the stock is still a mystery.
const MYSTERY = metaNote('MYSTERY STOCK · 1 YEAR · % CHANGE', 'Past prices only: its daily closes over the last year, as percent change from the first close.');

export function render(el, cmd, ctx) {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  el.innerHTML = `<div class="grid grid-guess">
    ${panel('1', 'Guess', LOADING, { metaId: 'gs-meta', meta: MYSTERY, bodyCls: 'flush', cls: 'gs-chart-panel' })}
    ${panel('2', 'Your guesses', LOADING, { metaId: 'gs-left', cls: 'gs-play', bodyCls: 'flush' })}
  </div>`;
  const [chartBody, playBody] = el.querySelectorAll('.panel-body');
  const label = el.querySelector('.gs-chart-panel').querySelector('.panel-label');
  const chartMeta = el.querySelector('#gs-meta');
  const left = el.querySelector('#gs-left');

  let puzzle = null;
  let state = readState(ctx.store.get(STORE_KEY, null));
  let game = null;
  let answer = null;
  let busy = false;
  let active = -1;
  let matches = [];
  let resize = null;
  let chat = null; // POST TO CHAT: { pro, key, header, rooms } once looked up
  // The next New York midnight from when the screen opened: the new puzzle is out then.
  const nextAt = Date.now() + msToNextPuzzle(Date.now());
  // HOW TO PLAY: howto.js and its stylesheet, loaded with this screen (never in a DESK
  // panel). It opens by itself on a first visit only: a player with a result or a saved
  // game has been here before.
  const howto = ctx.embed ? Promise.resolve(null) : Promise.all([loadModule('howto.js', { recover: false }), ...stylesOf('howto.js').map(loadCss)])
    .then(([m]) => {
      if (ctx.signal.aborted) return null;
      const played = Object.keys(state.results).length > 0 || Boolean(state.game?.rows?.length);
      // On close the focus goes to the guess input (the next thing to do is guess); after
      // the game, to the command bar.
      const h = m.mountHowto({ key: HOWTO_KEY, slots: howtoSlots(), auto: !played, fields: '.gs-in', focus: () => playBody.querySelector('.gs-in:not(:disabled)') });
      ctx.onCleanup?.(() => h.destroy());
      return h;
    }, () => null);

  const save = () => ctx.store.set(STORE_KEY, { results: state.results, game });
  const isDone = () => game.rows.some((r) => r.solved) || game.rows.length >= TRIES;
  const solved = () => game.rows.some((r) => r.solved);

  function drawChart() {
    const host = chartBody.querySelector('.gs-chart');
    if (!host || !puzzle) return;
    host.innerHTML = chartSvg(puzzle.series, Math.floor(host.clientWidth), Math.floor(host.clientHeight));
  }

  function formHtml() {
    return `<form class="gs-form add-form" data-own-focus autocomplete="off">
      <div class="gs-field">
        <input class="add-in gs-in" name="g" type="text" maxlength="40" spellcheck="false" autocapitalize="characters" autocorrect="off"
          placeholder="Type a company or ticker" aria-label="Your guess: an S&P 100 ticker or company" role="combobox" aria-autocomplete="list" aria-controls="gs-sug" aria-expanded="false">
        <ul id="gs-sug" class="gs-sug" role="listbox" hidden></ul>
      </div>
      <button type="submit" class="chip gs-go">GUESS</button>
    </form>`;
  }

  function endHtml() {
    const s = guessStats(state.results, game.n);
    const who = solved()
      ? `<p class="gs-result">${esc(endLine(game.rows.length, answer))}</p>`
      : answer
        ? `<p class="gs-result">It was <a class="gs-tk" href="${esc(q(answer.ticker))}" data-cmd="${esc(answer.ticker)}" title="Open its real chart">${esc(answer.ticker)}</a> (${esc(answer.name)}).</p>`
        : '<p class="gs-result loading">LOADING...</p>';
    return `<div class="gs-end">
      ${who}
      ${statsHtml(s)}
      <div class="gs-share">
        <button type="button" class="pf-btn btn-solid gs-copy">COPY RESULT</button>
        <a class="card-link gs-link gs-x" href="${esc(shareOnX(shareText(game.n, game.rows, solved())))}" target="_blank" rel="noopener">SHARE ON X</a>
        <button type="button" class="card-link gs-link gs-embed" title="Copy one line of HTML that puts today's GUESS on your site">EMBED</button>
        ${postChatHtml(chat?.pro, chat?.rooms)}
        <span class="gs-next">NEXT IN <span class="gs-cd">${fmtCountdown(nextAt - Date.now())}</span></span>
      </div>
      ${proChatLineHtml(!ctx.embed && chat?.visitor === true)}
    </div>`;
  }

  function paint() {
    const done = isDone();
    left.textContent = done ? '' : `GUESS ${game.rows.length + 1} OF ${TRIES}`;
    // After the game, no blank rows for tries never used (a win in 3 leaves room for the chart).
    playBody.innerHTML = `${done ? '' : formHtml()}${rowsHtml(game.rows, done ? game.rows.length : TRIES)}${ctx.embed ? legendHtml() : howtoLinkHtml(!done)}${done ? endHtml() : ''}`;
    // The game is over: the chart's strip names the stock.
    chartMeta.innerHTML = (done && revealHtml(answer, seriesMove(puzzle?.series))) || MYSTERY;
    if (!done && !coarse) playBody.querySelector('.gs-in')?.focus();
  }

  function closeList() {
    const list = playBody.querySelector('.gs-sug');
    const input = playBody.querySelector('.gs-in');
    matches = [];
    active = -1;
    if (list) { list.hidden = true; list.innerHTML = ''; }
    input?.setAttribute('aria-expanded', 'false');
  }

  function showList() {
    const input = playBody.querySelector('.gs-in');
    const list = playBody.querySelector('.gs-sug');
    if (!input || !list) return;
    matches = matchPool(puzzle.pool, input.value, { exclude: game.rows.map((r) => r.ticker) });
    active = matches.length ? Math.min(Math.max(active, -1), matches.length - 1) : -1;
    list.innerHTML = matches.map(([t, n], i) => `<li role="option" id="gs-o${i}" aria-selected="${i === active}"><button type="button" tabindex="-1" data-pick="${esc(t)}"><span class="gs-tk">${esc(t)}</span><span class="gs-nm">${esc(n)}</span></button></li>`).join('');
    list.hidden = !matches.length;
    input.setAttribute('aria-expanded', String(Boolean(matches.length)));
    if (active >= 0) input.setAttribute('aria-activedescendant', `gs-o${active}`); else input.removeAttribute('aria-activedescendant');
  }

  async function reveal() {
    if (answer) return;
    const hit = game.rows.find((r) => r.solved);
    if (hit) { answer = { ticker: hit.ticker, name: hit.name }; return; }
    if (game.answer) { answer = game.answer; return; }
    try {
      answer = await ctx.fetchJSON(`/api/guess/reveal?${new URLSearchParams({ n: String(game.n) })}`, { signal: ctx.signal });
    } catch (err) {
      if (err.name !== 'AbortError') ctx.status('COULD NOT LOAD THE ANSWER', 'warn');
    }
  }

  // POST TO CHAT: only for Pro, only with a chat to post in. Looked up once the game is over.
  async function lookUpChats() {
    if (chat) return;
    chat = { pro: false, rooms: [] };
    try {
      const pro = await loadModule('pro.js');
      if (!pro.isPro()) {
        // A visitor: the quiet PRO line under the share buttons.
        chat = { pro: false, rooms: [], visitor: true };
        if (!ctx.signal.aborted && !ctx.embed && isDone()) paint();
        return;
      }
      const res = await fetch('/api/chat', { headers: { Accept: 'application/json', [pro.HEADER]: pro.getKey() || '' }, cache: 'no-store', signal: ctx.signal });
      if (!res.ok) return;
      const d = await res.json();
      chat = { pro: true, key: pro.getKey(), header: pro.HEADER, rooms: postable(d.rooms) };
      if (!ctx.signal.aborted && chat.rooms.length && isDone()) paint();
    } catch { /* no POST TO CHAT */ }
  }
  async function postToChat(which) {
    const rooms = which === 'all' ? 'all' : [Number(which)];
    try {
      const res = await fetch('/api/chat/guess', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', [chat.header]: chat.key || '' },
        body: JSON.stringify({ n: game.n, guesses: game.rows.map((r) => r.ticker), rooms }),
        cache: 'no-store',
        signal: ctx.signal,
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { ctx.status(d?.message || 'COULD NOT POST TO CHAT', 'warn'); return; }
      const n = d.posted.length;
      ctx.status(n > 1 ? `POSTED TO ${n} CHATS` : 'POSTED TO CHAT');
      playBody.querySelector('.gs-rooms')?.remove();
    } catch (err) {
      if (err.name !== 'AbortError') ctx.status('COULD NOT POST TO CHAT', 'warn');
    }
  }

  async function finish() {
    state = recordResult(state, game.n, game.rows.length, solved());
    save();
    goal('guess_played', { result: solved() ? 'solved' : 'missed' }, { once: game.n });
    paint();
    await reveal();
    if (!ctx.signal.aborted) paint();
    lookUpChats();
  }

  async function submit(ticker) {
    if (busy || isDone()) return;
    const pick = exactPick(puzzle.pool, ticker);
    if (!pick) { ctx.status('PICK A STOCK FROM THE S&P 100 LIST', 'warn'); return; }
    if (game.rows.some((r) => r.ticker === pick[0])) { ctx.status(`${pick[0]} IS ALREADY A GUESS`, 'warn'); return; }
    busy = true;
    closeList();
    const input = playBody.querySelector('.gs-in');
    if (input) input.disabled = true;
    try {
      const d = await ctx.fetchJSON(`/api/guess/check?${checkQuery(game, pick[0])}`, { signal: ctx.signal });
      game.rows.push({ ticker: d.guess.ticker, name: d.guess.name, cells: d.cells, solved: Boolean(d.solved) });
      if (d.answer?.ticker) game.answer = { ticker: d.answer.ticker, name: d.answer.name };
      save();
      ctx.status('');
      if (isDone()) await finish(); else paint();
    } catch (err) {
      if (err.name === 'AbortError') return;
      ctx.status(err.message || 'COULD NOT CHECK THAT GUESS', 'warn');
      if (input) { input.disabled = false; if (!coarse) input.focus(); }
    } finally {
      busy = false;
    }
  }

  playBody.addEventListener('input', (e) => {
    if (!e.target.matches('.gs-in')) return;
    active = -1;
    showList();
  });
  playBody.addEventListener('keydown', (e) => {
    if (!e.target.matches('.gs-in')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!matches.length) return;
      e.preventDefault();
      active = e.key === 'ArrowDown' ? (active + 1) % matches.length : (active <= 0 ? matches.length - 1 : active - 1);
      showList();
    } else if (e.key === 'Escape' && matches.length) {
      e.preventDefault();
      closeList();
    }
  });
  playBody.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = playBody.querySelector('.gs-in')?.value || '';
    const pick = active >= 0 ? matches[active] : exactPick(puzzle.pool, text) || (text.trim() ? matchPool(puzzle.pool, text, { exclude: game.rows.map((r) => r.ticker), limit: 1 })[0] : null);
    if (!pick) { ctx.status(text.trim() ? 'PICK A STOCK FROM THE S&P 100 LIST' : 'TYPE A TICKER OR A COMPANY', 'warn'); return; }
    submit(pick[0]);
  });
  playBody.addEventListener('click', async (e) => {
    const opt = e.target.closest('[data-pick]');
    if (opt) { submit(opt.dataset.pick); return; }
    if (e.target.closest('.gs-howto')) { howto.then((h) => h?.open()); return; }
    if (e.target.closest('.gs-x')) goal('guess_shared', { via: 'x' }, { once: game.n });
    // POST TO CHAT: pick a chat (or ALL), then it posts.
    const toChat = e.target.closest('.gs-chat');
    if (toChat && chat?.rooms?.length) {
      const open = playBody.querySelector('.gs-rooms');
      if (open) open.remove(); else toChat.insertAdjacentHTML('afterend', roomsPickHtml(chat.rooms));
      toChat.setAttribute('aria-expanded', String(!open));
      return;
    }
    const pickRoom = e.target.closest('.gs-rooms [data-room]');
    if (pickRoom) { postToChat(pickRoom.dataset.room); return; }
    if (e.target.closest('.gs-copy')) {
      const ok = await ctx.copy(shareText(game.n, game.rows, solved()));
      ctx.status(ok ? 'RESULT COPIED' : 'COULD NOT COPY', ok ? '' : 'warn');
      if (ok) goal('guess_shared', { via: 'copy' }, { once: game.n });
    }
    // EMBED: copies the iframe line (public/embed-snippet.js), says so on the button.
    const embedBtn = e.target.closest('.gs-embed');
    if (embedBtn) {
      const ok = await ctx.copy(guessEmbedSnippet());
      if (ok) { embedBtn.textContent = 'COPIED'; setTimeout(() => { embedBtn.textContent = 'EMBED'; }, 2000); }
      ctx.status(ok ? 'EMBED CODE COPIED' : 'COULD NOT COPY', ok ? '' : 'warn');
    }
  });
  playBody.addEventListener('focusout', (e) => {
    if (e.target.matches('.gs-in') && !playBody.contains(e.relatedTarget)) setTimeout(() => { if (!playBody.querySelector('.gs-sug:hover')) closeList(); }, 150);
  });

  async function load() {
    try {
      puzzle = await ctx.fetchJSON('/api/guess/today', { signal: ctx.signal });
    } catch (err) {
      if (err.name === 'AbortError') return;
      chartBody.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      playBody.innerHTML = '';
      ctx.status('COULD NOT LOAD GUESS', 'warn');
      return;
    }
    label.textContent = `1) GUESS #${puzzle.n}`;
    game = state.game && state.game.n === puzzle.n ? state.game : { n: puzzle.n, rows: [] };
    chartBody.innerHTML = '<div class="gs-chart"></div>';
    drawChart();
    if (typeof ResizeObserver === 'function') {
      resize = new ResizeObserver(() => drawChart());
      resize.observe(chartBody.querySelector('.gs-chart'));
    }
    ctx.updated(new Date().toISOString(), false);
    ctx.status('');
    if (isDone()) {
      if (!state.results[game.n]) { state = recordResult(state, game.n, game.rows.length, solved()); save(); }
      paint();
      await reveal();
      if (!ctx.signal.aborted) paint();
      lookUpChats();
    } else {
      paint();
    }
  }

  load();
  // NEXT IN, once a minute.
  ctx.every(() => {
    const cd = playBody.querySelector('.gs-cd');
    if (!cd) return;
    const now = Date.now();
    if (now < nextAt) { cd.textContent = fmtCountdown(nextAt - now); return; }
    const next = playBody.querySelector('.gs-next');
    if (next) next.innerHTML = `A NEW PUZZLE IS OUT. <a class="code" href="${esc(q('GUESS'))}" data-cmd="GUESS">GUESS</a>`;
  }, 60_000);
  return () => resize?.disconnect();
}
