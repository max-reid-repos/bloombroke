// Speed: lazy screens, the startup command index, per-file hashed assets, one base stylesheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildAssets, hashIndex, serveAssets, preloadTags, HASH_LEN } from '../lib/assets.js';
import { parseCommand, screenFor, screenFiles, SHEET_ORDER, FKEYS, lazyMenu } from '../public/app.js';
import { HELP_LINE } from '../public/cards.js';
import { EXTRA } from '../public/commands.js';
import { COMPANY } from '../public/company.js';
import { MARKETS_EXTRA } from '../public/commands-markets.js';
import { WEIRD_SCREENS } from '../public/commands-weird.js';
import { WEIRD_GAUGE_COMMANDS } from '../public/command-args.js';
import { WEIRD_GAUGES } from '../public/screens/weird-gauges.js';
import { REGISTRY, LISTED } from '../lib/registry.js';
import { DETAIL } from '../public/registry-detail.js';
import { assetUrl, loadModule, lazyScreen, screenNow, loadScreen } from '../public/lazy.js';

const PUBLIC = path.join(import.meta.dirname, '..', 'public');

function tree(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bb-speed-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test('assets: each file has its own hash; a change moves only that file and what imports it', () => {
  const files = {
    'app.js': "import { a } from './kit.js';\nexport const go = () => import('./screens/far.js');\n",
    'kit.js': 'export const a = 1;\n',
    'screens/far.js': "import { a } from '../kit.js';\nexport const b = a;\n",
    'screens/near.js': 'export const c = 3;\n',
    'style.css': '@font-face { src: url(/fonts/x.woff2) format("woff2"); }\n.a { color: red; }\n',
    'fonts/x.woff2': 'font',
    'img/y.png': 'png',
  };
  const a = buildAssets(tree(files));
  const url = (r) => a.url(r);
  assert.match(url('app.js'), new RegExp(`^/app\\.[0-9a-f]{${HASH_LEN}}\\.js$`));
  assert.match(url('screens/far.js'), /^\/screens\/far\.[0-9a-f]+\.js$/);
  assert.equal(url('img/y.png'), null, 'images keep their plain path');
  const app = a.files.get('app.js').body.toString();
  assert.ok(app.includes(`from './${url('kit.js').slice(1)}'`), 'static import rewritten');
  assert.ok(app.includes(`import('./${url('screens/far.js').slice(1)}')`), 'literal dynamic import rewritten');
  assert.ok(a.files.get('screens/far.js').body.toString().includes(`from '../${url('kit.js').slice(1)}'`), 'relative from a folder');
  assert.ok(a.files.get('style.css').body.toString().includes(`url(${url('fonts/x.woff2')})`), 'fonts in CSS');

  const b = buildAssets(tree({ ...files, 'kit.js': 'export const a = 2;\n' }));
  assert.notEqual(b.url('kit.js'), url('kit.js'));
  assert.notEqual(b.url('app.js'), url('app.js'), 'an importer moves with what it imports');
  assert.notEqual(b.url('screens/far.js'), url('screens/far.js'));
  assert.equal(b.url('screens/near.js'), url('screens/near.js'), 'an unrelated file keeps its URL (and its cache)');
  assert.equal(b.url('style.css'), url('style.css'));
  assert.equal(b.url('fonts/x.woff2'), url('fonts/x.woff2'));
});

test('assets: import cycles share one hash and still point at each other', () => {
  const a = buildAssets(tree({ 'x.js': "import './y.js';\n", 'y.js': "import './x.js';\n" }));
  assert.equal(a.files.get('x.js').hash, a.files.get('y.js').hash);
  assert.ok(a.files.get('x.js').body.toString().includes(`'./${a.url('y.js').slice(1)}'`));
  assert.ok(a.files.get('y.js').body.toString().includes(`'./${a.url('x.js').slice(1)}'`));
});

test('assets: the page gets one stylesheet, the manifest as data, and preload hints', () => {
  const dir = tree({
    'app.js': "import './shell.js';\n", 'shell.js': '', 'screens/w.js': "import '../extra.js';\n", 'extra.js': '', 'screens/w.css': '.w{}', 'extra.css': '.e{}',
    'fonts.css': '.f{}', 'style.css': '.s{}',
  });
  const a = buildAssets(dir, { bundles: { 'base.css': ['fonts.css', 'style.css'] } });
  const html = hashIndex('<head>\n  <link rel="stylesheet" href="/fonts.css">\n  <link rel="stylesheet" href="/style.css">\n  <script type="module" src="/app.js"></script>\n</head>', a, { bundle: 'base.css', preload: ['shell.js'] });
  assert.equal((html.match(/rel="stylesheet"/g) || []).length, 1, 'one render-blocking stylesheet');
  assert.ok(html.includes(`href="${a.url('base.css')}"`));
  assert.equal(a.files.get('base.css').body.toString(), '/* fonts.css */\n.f{}\n/* style.css */\n.s{}', 'the bundle keeps the order');
  assert.ok(html.includes(`<script type="module" src="${a.url('app.js')}">`));
  assert.ok(html.includes(`<link rel="modulepreload" href="${a.url('shell.js')}">`));
  const json = JSON.parse(/<script type="application\/json" id="bb-assets">(.*?)<\/script>/.exec(html)[1]);
  assert.equal(json.files['screens/w.js'], a.files.get('screens/w.js').hash);
  assert.deepEqual(json.deps['screens/w.js'], ['extra.js'], 'what a lazy module imports, for prefetch');
  assert.deepEqual(json.css['screens/w.js'], ['screens/w.css', 'extra.css'], 'its own sheet and the ones beside what it imports');
  assert.equal(json.css['app.js'], undefined, 'the page\'s own modules have no sheets of their own');
  assert.doesNotMatch(html.replace(/<script type="(module|application\/json)"[^>]*>/g, ''), /<script/, 'no inline script');
  assert.match(preloadTags(a, { modules: ['screens/w.js'], styles: ['screens/w.css'] }), /rel="preload" as="style" href="\/screens\/w\.[0-9a-f]+\.css".*rel="modulepreload" href="\/screens\/w\.[0-9a-f]+\.js"/);
});

test('assets: today\'s hash is immutable, an old hash is a 404 that is never cached', () => {
  const a = buildAssets(tree({ 'app.js': 'export {};\n', 'screens/x.js': 'export {};\n' }));
  const mw = serveAssets(a, { shell: ['app.js'] });
  const call = (p) => {
    const res = { headers: {}, code: 200, body: null, end() { return this; }, set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, type(t) { this.headers.type = t; return this; }, send(b) { this.body = b; return this; } };
    let next = false;
    mw({ method: 'GET', path: p }, res, () => { next = true; });
    return { res, next };
  };
  const ok = call(a.url('app.js')).res;
  assert.equal(ok.code, 200);
  assert.equal(ok.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  const old = call('/screens/x.0123456789.js').res;
  assert.equal(old.code, 404);
  assert.equal(old.headers['Cache-Control'], 'no-store');
  const page = call('/app.0123456789.js').res;
  assert.equal(page.code, 302, 'an old page\'s own app.js: back to /, never a blank page');
  assert.equal(page.headers.Location, '/');
  assert.equal(page.headers['Cache-Control'], 'no-store');
  assert.equal(call('/app.js').next, true, 'plain paths go on to the static files');
  assert.equal(call('/nope.0123456789.js').next, true);
});

test('startup: the page loads the shell, HOME and MARKETS, never another screen', () => {
  const a = buildAssets(PUBLIC);
  const shell = a.closure('app.js');
  const screens = shell.filter((r) => r.startsWith('screens/'));
  // HOME's own parts: its chart, its news box, the markets table.
  const allowed = new Set(['screens/home.js', 'screens/markets.js', 'screens/chart.js', 'screens/chart-view.js', 'screens/chart-math.js',
    'screens/intraday.js', 'screens/size-guard.js', 'screens/news.js']);
  assert.deepEqual(screens.filter((r) => !allowed.has(r)), [], 'no other screen module at startup');
  assert.ok(!shell.includes('registry-detail.js'), 'HELP\'s long text is not at startup');
  for (const f of ['cards.js', 'menu.js', 'hints.js', 'here-now.js', 'chat-badge.js', 'trending.js']) assert.ok(!shell.includes(f), `${f} comes in after the first screen`);
  // The card pages (kit.js) too: startup modules take the toolbar, table and date parts from kit-core.js.
  assert.ok(!shell.includes('kit.js') && shell.includes('kit-core.js'), 'kit.js (the card pages) is not at startup');
  assert.ok(shell.length <= 45, `${shell.length} modules at startup`);
  const bytes = shell.reduce((n, r) => n + a.files.get(r).body.length, 0);
  assert.ok(bytes < 600_000, `${bytes} bytes of JS at startup`);
});

test('lazy screens: every routed screen names a module that exists and draws', async () => {
  const entries = [
    ...EXTRA.map((c) => [c.name, c.screen]), ...COMPANY.map((c) => [c.name, c.screen]), ...MARKETS_EXTRA.map((c) => [c.name, c.screen]),
    ...Object.entries(WEIRD_SCREENS),
    ...['HELP', 'MENU', 'FX', 'QUOTE', 'CPI', 'RATES', 'AFFORD', 'WAGE', 'WHATIF', 'FUNDING', 'WATCH', 'PORTFOLIO', 'FINANCIALS', 'SCREEN', 'DESK', 'GIFT', 'REDEEM', 'CHAT', 'SPONSOR', 'FEEDBACK', 'GRAVEYARD', 'IPOIT']
      .map((n) => [n, screenFor(n)]),
  ];
  for (const [name, entry] of entries) {
    assert.ok(entry?.js, `${name} is lazy`);
    assert.ok(existsSync(path.join(PUBLIC, entry.js)), `${name}: ${entry.js}`);
    const screen = await loadScreen(entry);
    assert.equal(typeof screen?.render, 'function', `${name} draws`);
    assert.equal(screenNow(entry), screen, `${name}: drawn at once the next time`);
  }
  assert.equal(typeof screenFor('HOME').render, 'function', 'HOME comes with the page');
  assert.equal(typeof screenFor('MARKETS').render, 'function');
  assert.deepEqual(screenFiles('WHATIF'), { modules: ['screens/whatif.js'] });
  assert.deepEqual(screenFiles('HOME'), { modules: [] });
  assert.deepEqual(screenFiles('SECTORS 1M'), { modules: ['screens/sectors.js'] });
  for (const k of FKEYS) assert.ok(screenFor(parseCommand(k.cmd).name), `${k.key} has a screen to prefetch`);
});

test('lazy.js: names resolve next to it without a manifest, and load once', async () => {
  assert.equal(assetUrl('screens/help.js'), new URL('../public/screens/help.js', import.meta.url).href);
  const [a, b] = await Promise.all([loadModule('screens/chat.js'), loadModule('screens/chat.js')]);
  assert.equal(a, b);
  assert.equal(typeof (await loadScreen(lazyScreen('screens/pro.js', 'loginCommand'))).render, 'function', 'a named export');
  assert.equal(typeof (await loadScreen(lazyScreen('screens/nosuch.js', (m) => m.NOSUCH_SCREENS.GRAVEYARD))).render, 'function', 'a picked one');
});

test('lazy.js: an optional extra that fails to load never reloads the page; a screen does', async () => {
  const reloads = [];
  const store = {};
  const saved = { window: globalThis.window, sessionStorage: globalThis.sessionStorage };
  globalThis.window = { location: { reload: () => reloads.push(1) } };
  globalThis.sessionStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(loadModule('no-such-extra.js', { recover: false }));
    assert.equal(reloads.length, 0, 'recover: false: no reload, the page carries on');
    await assert.rejects(loadModule('screens/no-such-screen.js'));
    assert.equal(reloads.length, 1, 'a screen that fails still reloads once for a newer build');
  } finally {
    globalThis.window = saved.window;
    globalThis.sessionStorage = saved.sessionStorage;
    console.warn = warn;
  }
  // The five optional extras in app.js load with { recover: false }.
  const app = readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  assert.match(app, /const OPTIONAL = \{ recover: false \};/);
  for (const f of ['here-now.js', 'chat-badge.js', 'hints.js', 'trending.js', 'menu.js']) assert.ok(app.includes(`loadModule('${f}', OPTIONAL)`), f);
  assert.ok(!/loadModule\('(here-now|chat-badge|hints|trending|menu)\.js'\)/.test(app), 'none without it');
});

test('menu: while menu.js loads, each Ctrl+K flips whether it opens, and Esc cancels', async () => {
  const made = () => { const m = { opened: 0, open() { this.opened += 1; this.on = true; }, toggle() { this.on = !this.on; }, isOpen() { return Boolean(this.on); } }; return m; };
  const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
  // One Ctrl+K: it opens when the file arrives.
  let d = deferred(); let real = made(); let loads = 0;
  let menu = lazyMenu(() => { loads += 1; return d.p; });
  menu.toggle();
  assert.equal(menu.isOpen(), false, 'not yet');
  d.resolve(real); await d.p; await new Promise((r) => setImmediate(r));
  assert.equal(real.opened, 1);
  assert.equal(menu.isOpen(), true);
  menu.toggle();
  assert.equal(menu.isOpen(), false, 'then a plain toggle');
  // Two Ctrl+K before it arrives: it stays shut; one load only.
  d = deferred(); real = made(); loads = 0;
  menu = lazyMenu(() => { loads += 1; return d.p; });
  menu.toggle(); menu.toggle();
  d.resolve(real); await new Promise((r) => setImmediate(r));
  assert.equal(real.opened, 0, 'opened and closed again: shut');
  assert.equal(loads, 1);
  // Ctrl+K then Esc before it arrives: shut.
  d = deferred(); real = made();
  menu = lazyMenu(() => d.p);
  menu.toggle(); menu.cancel();
  d.resolve(real); await new Promise((r) => setImmediate(r));
  assert.equal(real.opened, 0, 'Esc cancelled the pending open');
  // A load that fails leaves the page as it is, and the next Ctrl+K tries again.
  let fail = true; real = made();
  menu = lazyMenu(() => (fail ? Promise.reject(new Error('offline')) : Promise.resolve(real)));
  menu.toggle(); await new Promise((r) => setImmediate(r));
  assert.equal(menu.isOpen(), false);
  fail = false; menu.toggle(); await new Promise((r) => setImmediate(r));
  assert.equal(real.opened, 1);
  const app = readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  assert.match(app, /const menu = embed \? null : lazyMenu\(\(\) => loadModule\('menu\.js', OPTIONAL\)/);
  assert.match(app, /document\.addEventListener\('keydown', \(e\) => \{ if \(e\.key === 'Escape'\) menu\?\.cancel\(\); \}, true\);/);
});

test('startup index: the parser reads every command without loading a screen', () => {
  assert.deepEqual(WEIRD_GAUGE_COMMANDS, WEIRD_GAUGES.map((g) => g.command), 'the gauge list matches the gauges');
  assert.equal(parseCommand('SECTORS ytd map').input, 'SECTORS YTD MAP');
  assert.equal(parseCommand('FISHTANK indus').input, 'FISHTANK IND');
  assert.equal(parseCommand('OPTIONS S&P 500').input, 'OPTIONS SPX');
  assert.equal(parseCommand('FILINGS AAPL 10K').input, 'FILINGS AAPL 10-K');
  assert.equal(parseCommand('LOGIN').name, 'LOGIN');
  assert.deepEqual(parseCommand('HISTORY AAPL 2024').args, { ticker: 'AAPL', from: '2024-01-01', to: '2024-12-31' });
  assert.equal(parseCommand('CANAL 5y').input, 'CANAL 5Y');
});

test('registry: HELP\'s long text is its own file, whole again in Node', () => {
  const src = readFileSync(path.join(PUBLIC, 'registry.js'), 'utf8');
  const list = src.slice(src.indexOf('export const REGISTRY = ['), src.indexOf('\n];', src.indexOf('export const REGISTRY = [')));
  assert.doesNotMatch(list, /(?:^|[{,])\s*(source|delay|options):\s*['"[]/m, 'the startup file has no long text');
  for (const [name, d] of Object.entries(DETAIL)) {
    const entry = REGISTRY.find((c) => c.name === name);
    assert.ok(entry, `${name} is a command`);
    for (const [k, v] of Object.entries(d)) assert.deepEqual(entry[k], v, `${name}.${k}`);
  }
  assert.ok(LISTED.filter((c) => !c.pattern && !c.soon).every((c) => c.source), 'every listed command has its source (in Node)');
  assert.doesNotMatch(src, /^\s*(if \([^)]*\)\s*)?[^/\n]*\bawait\b/m, 'no top-level await in the page\'s copy');
});

test('did you mean: the help line is the same as the NO SUCH screen\'s', async () => {
  const ns = await import('../public/screens/nosuch.js');
  assert.equal(HELP_LINE, ns.HELP_LINE);
});

test('stylesheets: a sheet already in the page\'s bundle is never loaded again by a lazy module', () => {
  const a = buildAssets(tree({ 'app.js': "import './core.js';\n", 'core.js': '', 'kit.js': "export * from './core.js';\n", 'kit.css': '.k{}', 'screens/w.js': "import '../kit.js';\n", 'screens/w.css': '.w{}' }), { bundles: { 'base.css': ['kit.css'] } });
  assert.deepEqual(a.stylesOf('screens/w.js', 'app.js'), ['screens/w.css'], 'kit.css is in base.css: not again, last in the cascade');
  const b = buildAssets(PUBLIC, { bundles: { 'base.css': ['kit.css'] } });
  for (const [rel, list] of Object.entries(b.lazyStyles('app.js'))) assert.ok(!list.includes('kit.css'), rel);
});

test('stylesheets: each sheet sits beside its module and is in the stacking order', () => {
  const sheets = readdirSync(path.join(PUBLIC, 'screens')).filter((f) => f.endsWith('.css')).map((f) => `screens/${f}`);
  assert.ok(sheets.length > 10);
  for (const s of sheets) {
    assert.ok(existsSync(path.join(PUBLIC, s.replace(/\.css$/, '.js'))), `${s} has a module`);
    assert.ok(SHEET_ORDER.includes(s), `${s} is in SHEET_ORDER`);
  }
  assert.deepEqual(SHEET_ORDER.filter((s) => !sheets.includes(s)), [], 'SHEET_ORDER names only sheets that exist');
  const html = readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  for (const s of sheets) assert.ok(!html.includes(`/${s}`), `${s} is not on the page from the start`);
});

test('speed files: house rules (no banned brand word, no em dash)', () => {
  const files = ['lazy.js', 'command-args.js', 'registry-detail.js', ...readdirSync(path.join(PUBLIC, 'screens')).filter((f) => f.endsWith('.css')).map((f) => `screens/${f}`)];
  for (const f of files) {
    const s = readFileSync(path.join(PUBLIC, f), 'utf8');
    assert.doesNotMatch(s, new RegExp(['bloom', 'berg'].join(''), 'i'), f);
    assert.doesNotMatch(s, /—/, `${f}: em dash`);
  }
  assert.doesNotMatch(readFileSync(path.join(import.meta.dirname, '..', 'lib', 'assets.js'), 'utf8'), new RegExp(['bloom', 'berg'].join(''), 'i'));
});
