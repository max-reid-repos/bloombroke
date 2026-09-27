// /embed/guess (lib/embed-pages.js): today's GUESS, playable inside another site's page.
// The same /api/guess routes and the same pure parts as the screen (screens/guess.js).
// Progress lives in this browser under its own key (bb.embed.guess), apart from the
// site's own GUESS progress; nothing else is stored, and no analytics load here.

import {
  TRIES, chartSvg, matchPool, exactPick, readState, recordResult, endLine, dirArrow, dirText,
} from './screens/guess.js';

export const EMBED_STORE_KEY = 'bb.embed.guess';
const SITE_GUESS = 'https://bloombroke.com/?c=GUESS';
const HEADS = ['SECTOR', '1Y', 'SIZE', 'LETTER'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const say = (d) => { const t = dirText(d); return t && t !== '--' ? t.charAt(0) + t.slice(1).toLowerCase() : ''; };

function load() {
  try { return readState(JSON.parse(localStorage.getItem(EMBED_STORE_KEY) || 'null')); } catch { return readState(null); }
}
function store(state, game) {
  try { localStorage.setItem(EMBED_STORE_KEY, JSON.stringify({ results: state.results, game })); } catch { /* storage off */ }
}

async function getJSON(url) {
  const r = await fetch(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || 'GUESS is taking a break. Try again in a minute.');
  return d;
}

// The rows: ticker and the four hint cells, then the tries still open.
export function tableHtml(rows, tries = TRIES) {
  const cell = (c) => {
    const a = dirArrow(c.dir);
    const s = say(c.dir);
    return `<td class="g-cell g-${esc(c.grade)}"${s ? ` title="${esc(s)}"` : ''}>${esc(c.value)}${a ? `<span class="d" aria-hidden="true">${a}</span>` : ''}${s ? `<span class="offscreen">${esc(s)}</span>` : ''}</td>`;
  };
  const done = rows.map((r, i) => `<tr><td class="i">${i + 1}</td><th scope="row" class="g" title="${esc(r.name)}">${esc(r.ticker)}</th>${(r.cells || []).map(cell).join('')}</tr>`);
  const open = [];
  for (let i = rows.length; i < tries; i += 1) open.push(`<tr><td class="i">${i + 1}</td><th scope="row" class="g open">--</th>${HEADS.map(() => '<td class="g-cell"></td>').join('')}</tr>`);
  return `<table class="g-table"><thead><tr><th scope="col" class="i">#</th><th scope="col" class="g">GUESS</th>${HEADS.map((h) => `<th scope="col"${h === 'LETTER' ? ' class="l"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${done.join('')}${open.join('')}</tbody></table>`;
}

export function start(doc = document) {
  const chart = doc.getElementById('g-chart');
  const play = doc.getElementById('g-play');
  const left = doc.getElementById('g-left');
  const title = doc.getElementById('g-title');
  let puzzle = null;
  let state = load();
  let game = null;
  let answer = null;
  let busy = false;
  let matches = [];
  let active = -1;
  let message = '';

  const solved = () => game.rows.some((r) => r.solved);
  const isDone = () => solved() || game.rows.length >= TRIES;

  function drawChart() {
    if (!puzzle) return;
    chart.innerHTML = chartSvg(puzzle.series, Math.floor(chart.clientWidth), Math.floor(chart.clientHeight));
  }

  function paint() {
    const done = isDone();
    left.textContent = done ? '' : `${game.rows.length + 1} OF ${TRIES}`;
    const form = `<form class="g-form" autocomplete="off">
        <div class="g-field">
          <input class="g-in" name="g" type="text" maxlength="40" spellcheck="false" autocapitalize="characters" autocorrect="off"
            placeholder="Type a company or ticker" aria-label="Your guess: an S&P 100 ticker or company" role="combobox" aria-autocomplete="list" aria-controls="g-sug" aria-expanded="false">
          <ul id="g-sug" class="g-sug" role="listbox" hidden></ul>
        </div>
        <button type="submit" class="g-go">GUESS</button>
      </form>`;
    const who = solved() ? esc(endLine(game.rows.length, answer)) : answer ? `It was <b>${esc(answer.ticker)}</b> (${esc(answer.name)}).` : 'LOADING...';
    const end = `<div class="g-end"><span>${who}</span><a href="${SITE_GUESS}" target="_blank" rel="noopener">PLAY ON BLOOMBROKE.COM</a></div>`;
    play.innerHTML = `${done ? end : form}<p class="g-status" role="status">${esc(message)}</p>${tableHtml(game.rows)}<p class="g-legend">Arrows point to the answer.<span class="more"> Green: same or close. Blue: near.</span></p>`;
    requestAnimationFrame(drawChart);
  }

  function closeList() {
    const list = play.querySelector('.g-sug');
    matches = [];
    active = -1;
    if (list) { list.hidden = true; list.innerHTML = ''; }
    play.querySelector('.g-in')?.setAttribute('aria-expanded', 'false');
  }

  function showList() {
    const input = play.querySelector('.g-in');
    const list = play.querySelector('.g-sug');
    if (!input || !list) return;
    matches = matchPool(puzzle.pool, input.value, { exclude: game.rows.map((r) => r.ticker), limit: 5 });
    active = matches.length ? Math.min(Math.max(active, -1), matches.length - 1) : -1;
    list.innerHTML = matches.map(([t, n], i) => `<li role="option" id="g-o${i}" aria-selected="${i === active}"><button type="button" tabindex="-1" data-pick="${esc(t)}"><span class="tk">${esc(t)}</span><span class="nm">${esc(n)}</span></button></li>`).join('');
    list.hidden = !matches.length;
    input.setAttribute('aria-expanded', String(Boolean(matches.length)));
    if (active >= 0) input.setAttribute('aria-activedescendant', `g-o${active}`); else input.removeAttribute('aria-activedescendant');
  }

  async function reveal() {
    if (answer) return;
    const hit = game.rows.find((r) => r.solved);
    if (hit) { answer = { ticker: hit.ticker, name: hit.name }; return; }
    try { answer = await getJSON(`/api/guess/reveal?${new URLSearchParams({ n: String(game.n) })}`); } catch { /* the line stays LOADING */ }
  }

  async function finish() {
    state = recordResult(state, game.n, game.rows.length, solved());
    store(state, game);
    paint();
    await reveal();
    paint();
  }

  async function submit(ticker) {
    if (busy || isDone()) return;
    const pick = exactPick(puzzle.pool, ticker);
    if (!pick) { message = 'Pick a stock from the S&P 100 list.'; paint(); return; }
    if (game.rows.some((r) => r.ticker === pick[0])) { message = `${pick[0]} is already a guess.`; paint(); return; }
    busy = true;
    closeList();
    try {
      const d = await getJSON(`/api/guess/check?${new URLSearchParams({ n: String(game.n), g: pick[0] })}`);
      game.rows.push({ ticker: d.guess.ticker, name: d.guess.name, cells: d.cells, solved: Boolean(d.solved) });
      message = '';
      store(state, game);
      if (isDone()) await finish(); else paint();
    } catch (err) {
      message = err.message;
      paint();
    } finally {
      busy = false;
    }
  }

  play.addEventListener('input', (e) => {
    if (!e.target.matches('.g-in')) return;
    active = -1;
    showList();
  });
  play.addEventListener('keydown', (e) => {
    if (!e.target.matches('.g-in') || !matches.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = e.key === 'ArrowDown' ? (active + 1) % matches.length : (active <= 0 ? matches.length - 1 : active - 1);
      showList();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeList();
    }
  });
  play.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = play.querySelector('.g-in')?.value || '';
    const pick = active >= 0 ? matches[active] : exactPick(puzzle.pool, text) || (text.trim() ? matchPool(puzzle.pool, text, { exclude: game.rows.map((r) => r.ticker), limit: 1 })[0] : null);
    if (!pick) { message = text.trim() ? 'Pick a stock from the S&P 100 list.' : 'Type a ticker or a company.'; paint(); return; }
    submit(pick[0]);
  });
  play.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-pick]');
    if (opt) submit(opt.dataset.pick);
  });

  (async () => {
    try {
      puzzle = await getJSON('/api/guess/today');
    } catch (err) {
      play.innerHTML = `<p class="em-msg">${esc(err.message)} <a href="${SITE_GUESS}" target="_blank" rel="noopener">Play it on bloombroke.com</a></p>`;
      return;
    }
    title.textContent = `GUESS #${puzzle.n}`;
    game = state.game && state.game.n === puzzle.n ? state.game : { n: puzzle.n, rows: [] };
    if (typeof ResizeObserver === 'function') new ResizeObserver(drawChart).observe(chart);
    if (isDone()) {
      if (!state.results[game.n]) { state = recordResult(state, game.n, game.rows.length, solved()); store(state, game); }
      paint();
      await reveal();
    }
    paint();
  })();
}

if (typeof document !== 'undefined' && document.getElementById('g-play')) start();
