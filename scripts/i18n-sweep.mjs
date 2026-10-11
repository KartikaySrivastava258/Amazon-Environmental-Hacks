#!/usr/bin/env node
// Browser sweep for languages and voice: loads every route in every language in demo mode, in headless Chrome at
// 360px, with ?i18n-debug=1. Collects untranslated text (window.__i18nIssues), missing keys, console errors and
// exceptions, sideways scrolling, and whether the speech controls are present.
// Zero dependencies: Node 22 (global WebSocket and fetch) and google-chrome on PATH (or CHROME=/path).
//
//   node scripts/i18n-sweep.mjs [--langs en,hi] [--json out.json] [--keep-open]
//
// #/signup is live-only (demo mode sends it to #/login), so it is not in the plan.
// Exit 1 on any console error or exception (or a route that never rendered); untranslated text is reported, and
// also fails the run with --strict.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const LANGS = arg('--langs', 'en,hi,mr,bn,ta').split(',');
const JSON_OUT = arg('--json', null);
const STRICT = args.includes('--strict');
const ONLY = arg('--only', null); // run only the routes whose entry contains this text (debugging)
const WIDTH = 360;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static server ──
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
function serve() {
  const server = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
      let file = join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

// ── Chrome over CDP ──
async function launchChrome() {
  const dir = await mkdtemp(join(tmpdir(), 'pn-sweep-'));
  const bin = process.env.CHROME || 'google-chrome';
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-extensions', '--mute-audio', `--window-size=${WIDTH},800`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => rej(new Error('Chrome did not start')), 20000);
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(to); res(m[1]); } });
    proc.on('exit', (c) => rej(new Error(`Chrome exited (${c}): ${buf.slice(0, 400)}`)));
  });
  return { proc, dir, wsUrl };
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.wait = new Map(); this.handlers = []; ws.addEventListener('message', (e) => this.onMsg(JSON.parse(e.data))); }
  static open(url) { return new Promise((r, j) => { const ws = new WebSocket(url); ws.addEventListener('open', () => r(new CDP(ws))); ws.addEventListener('error', j); }); }
  onMsg(m) {
    if (m.id && this.wait.has(m.id)) { const { res, rej } = this.wait.get(m.id); this.wait.delete(m.id); if (m.error) rej(new Error(`${m.error.message} ${m.error.data || ''}`)); else res(m.result); return; }
    for (const h of this.handlers) h(m);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.wait.set(id, { res, rej }));
  }
}

async function openPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  const page = { s, log: [] };
  cdp.handlers.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; page.log.push({ type: 'exception', text: d.exception?.description || d.text }); }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (m.params.type === 'error' || m.params.type === 'assert') page.log.push({ type: 'console.error', text });
      else if (m.params.type === 'warning' && /\[i18n\] missing key/.test(text)) page.log.push({ type: 'missing-key', text });
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') page.log.push({ type: 'log.error', text: `${m.params.entry.text} ${m.params.entry.url || ''}`.trim() });
  });
  await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 760, deviceScaleFactor: 2, mobile: true });
  return page;
}

async function evaluate(page, expr, { timeout = 30000 } = {}) {
  const r = await page.s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

/** Waits until the router is idle (#progress not running) and #main has stopped changing for a moment. */
const SETTLED = `new Promise((done) => {
  const t0 = Date.now(); let last = ''; let stable = 0;
  const tick = () => {
    const main = document.getElementById('main');
    const html = main ? main.innerHTML.length + ':' + main.childElementCount + ':' + document.title : '';
    const busy = document.getElementById('progress')?.className === 'run' || !main || !main.childElementCount;
    if (!busy && html === last) stable += 1; else stable = 0;
    last = html;
    if (stable >= 4 || Date.now() - t0 > 12000) done(!busy); else setTimeout(tick, 150);
  };
  setTimeout(tick, 200);
})`;

async function navigate(page, url) {
  // Via about:blank, so a URL that differs only after the # is a real reload (new session, new language).
  await page.s('Page.navigate', { url: 'about:blank' });
  await sleep(50);
  await page.s('Page.navigate', { url });
  await sleep(300);
  for (let i = 0; i < 100; i++) {
    const ok = await evaluate(page, 'document.readyState === "complete"').catch(() => false);
    if (ok) break;
    await sleep(100);
  }
  return evaluate(page, SETTLED);
}
/** A real tap (CDP mouse events), so the page gets user activation like a person's tap (speech, vibrate). */
async function realClick(page, sel) {
  const box = await evaluate(page, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!box) return false;
  await sleep(120);
  for (const type of ['mousePressed', 'mouseReleased']) await page.s('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  return true;
}
async function goHash(page, hash) {
  await evaluate(page, `location.hash = ${JSON.stringify(hash)}`);
  await sleep(150);
  return evaluate(page, SETTLED);
}

const PROBE = `(() => {
  const issues = typeof window.__i18nIssues === 'function' ? window.__i18nIssues() : [];
  const de = document.documentElement;
  const wide = [];
  if (de.scrollWidth > innerWidth) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 0.5 && r.width > 0 && !el.closest('[hidden]')) wide.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/)[0] : '')) + ' ' + Math.round(r.right) + (getComputedStyle(el).position === 'fixed' ? ' (fixed)' : ''));
      if (wide.length > 7) break;
    }
  }
  const main = document.getElementById('main');
  const inputs = main ? [...main.querySelectorAll('input:not([type]),input[type=text],input[type=search],input[type=tel],input[type=number],textarea')].filter((i) => !i.readOnly && !i.disabled && !i.closest('[data-novoice]') && i.offsetParent) : [];
  return {
    hash: location.hash, title: document.title, htmlLang: de.lang,
    issues, overflow: de.scrollWidth > innerWidth ? de.scrollWidth - innerWidth : 0, wide, dims: [innerWidth, de.clientWidth, de.scrollWidth, document.body.scrollWidth, scrollX],
    listen: !!document.querySelector('header .listen-ctl, .topbar .listen-ctl, .listen-ctl [data-lc-listen]'),
    inputs: inputs.length, mics: inputs.filter((i) => i.dataset.micReady || i.parentElement?.classList.contains('mic-wrap')).length,
    micBtns: main ? main.querySelectorAll('.mic-btn').length : 0, fields: main ? main.querySelectorAll('input,textarea,select').length : 0,
    speakHosts: main ? main.querySelectorAll('[data-speak]').length : 0, sayBtns: main ? main.querySelectorAll('.say-btn').length : 0,
  };
})()`;

// ── Demo data: jobs at the useful states, made through the same API calls the views make ──
const SETUP = `(async () => {
  const api = await import('/js/api.js');
  const auth = await import('/js/auth.js');
  auth.demoSignIn('demo-ravi');
  const P = (path, body) => api.call('POST', path, body);
  const make = async (phone, name, lang) => (await P('/api/jobs', { category: 'washing_machine', brand: 'Brand X', model: 'WM-7', purchaseYear: 2016, ownerPhone: phone, ownerName: name, ownerLang: lang, pincode: '282001' })).job;
  const diagnose = (j) => P('/api/jobs/' + j.jobId + '/diagnosis', { component: 'control_board', causes: ['voltage_surge'], severity: 'replace_part', spare: 'local', barrier: 'none', photoKey: 'uploads/demo-ravi/sweep.jpg', quote: { parts: 3200, labour: 600 }, note: 'बोर्ड जल गया, नया लगेगा', noteLang: 'hi' });
  const decide = (j, tok, option) => P('/public/owner/' + j.jobId + '/decision', { t: tok, option, agree: true, consent: true, lang: 'hi' });
  const out = {};
  // A: waiting for the owner (options screen)
  const a = await make('9810000101', 'Sunita Devi', 'hi'); const da = await diagnose(a);
  out.waiting = { jobId: a.jobId, token: da.ownerToken, pid: a.pid };
  // B: repaired with a new part (bill, confirm screen)
  const b = await make('9810000102', 'Meena Iyer', 'ta'); const db = await diagnose(b);
  await decide(b, db.ownerToken, 'repair_new');
  await P('/api/jobs/' + b.jobId + '/complete', { partSource: 'new', amount: 3800, warrantyDays: 90 });
  out.repaired = { jobId: b.jobId, token: db.ownerToken, pid: b.pid };
  // C: owner chose harvest (product in stock)
  const c = await make('9810000103', 'Arjun Das', 'bn'); const dc = await diagnose(c);
  await decide(c, dc.ownerToken, 'harvest').catch((e) => { out.harvestError = e.message; });
  out.harvest = { jobId: c.jobId, token: dc.ownerToken, pid: c.pid };
  // D: new job, not diagnosed (diagnose screen)
  const d = await make('9810000104', 'Kavita Rao', 'mr');
  out.fresh = { jobId: d.jobId, pid: d.pid };
  // E: owner gave the product up; the technician passes it to the refurbisher, who lists it on the market
  const e = await make('9810000105', 'Rahul Verma', 'en'); const de = await diagnose(e);
  try {
    await decide(e, de.ownerToken, 'harvest');
    await P('/api/passports/' + e.pid + '/transfer', { refurbisherId: 'demo-green' });
    auth.demoSignIn('demo-green');
    await P('/api/listings', { pid: e.pid, price: 9500, warrantyMonths: 3, photoKey: 'uploads/demo-green/sweep.jpg', checklist: { tested: true, safety: true, cleaned: true } });
  } catch (err) { out.sellError = err.message; }
  auth.demoSignIn('demo-ravi');
  // F: owner chose recycle (a pickup for the collector)
  const f = await make('9810000106', 'Fatima Begum', 'hi'); const df = await diagnose(f);
  await decide(f, df.ownerToken, 'recycle').catch((err) => { out.recycleError = err.message; });
  out.recycle = { jobId: f.jobId, pid: f.pid };
  // G: a second recycle job, left open for the collector
  const g = await make('9810000107', 'Lakshmi N', 'ta'); const dg = await diagnose(g);
  await decide(g, dg.ownerToken, 'recycle').catch(() => {});
  // The collector takes F's pickup to the recycler (incoming delivery to confirm)
  try {
    auth.demoSignIn('demo-shyam');
    const open = (await api.call('GET', '/api/pickups/open', null, { area: 'all' })).pickups;
    const pk = open.find((x) => x.pid === f.pid) || open[0];
    await P('/api/pickups/' + pk.pickupId + '/accept', {});
    await P('/api/pickups/' + pk.pickupId + '/collect', { weightKg: 31.5, photoKey: 'uploads/demo-shyam/sweep.jpg', gates: Object.fromEntries((pk.gates || []).map((x) => [x, true])) });
    await P('/api/pickups/' + pk.pickupId + '/deliver', { recyclerId: 'demo-green' });
    out.delivered = pk.pickupId;
  } catch (err) { out.pickupError = err.message; }
  auth.demoSignIn('demo-ravi');
  const m = await api.call('GET', '/public/market');
  out.listing = m.listings?.[0]?.listingId || null;
  auth.signOut();
  await new Promise((r) => setTimeout(r, 800)); // demo state is saved on a 150 ms debounce
  return out;
})()`;

function plan(ids) {
  const job = (x) => (x ? [`#/t/job/${x.jobId}`] : []);
  return [
    { persona: null, routes: ['#/', '#/login', '#/market', ...(ids.listing ? [`#/market/${ids.listing}`] : []), '#/scores', `#/p/${ids.repaired.pid}`, `#/p/${ids.harvest.pid}`, `#/p/${ids.repaired.pid}|#main [data-tag]`, '#/no-such-page'] },
    { persona: null, owner: true, routes: [`#/o/${ids.waiting.jobId}/${ids.waiting.token}`, `#/o/${ids.waiting.jobId}/${ids.waiting.token}|#main [data-opt]:not([aria-pressed="true"]):not(.selected)`, `#/o/${ids.repaired.jobId}/${ids.repaired.token}`, `#/o/${ids.harvest.jobId}/${ids.harvest.token}`, `#/o/${ids.waiting.jobId}/badtoken`] },
    { persona: 'demo-ravi', routes: ['#/t', '#/t/new', '#/t/new|#main [data-cat]', ...job(ids.waiting), ...job(ids.repaired), `#/t/job/${ids.repaired.jobId}|#main [data-tag]`, ...job(ids.harvest), ...job(ids.fresh), `#/t/job/${ids.fresh.jobId}/diagnose`, `#/t/job/${ids.fresh.jobId}/diagnose|#main [data-comp]`, '#/parts', '#/inventory', '#/inbox', '#/me'] },
    { persona: 'demo-imran', routes: ['#/t', '#/parts', '#/inventory', '#/t|[data-palette]'] },
    { persona: 'demo-shyam', routes: ['#/c', '#/inbox', '#/me'] },
    { persona: 'demo-green', routes: ['#/r', '#/r/listings', '#/inventory', '#/inbox', '#/me'] },
    { persona: 'demo-priya', routes: ['#/b', '@brandReport', '#/inbox', '#/me'] },
    { persona: 'demo-admin', routes: ['#/admin', '#/b', '#/inbox', '#/me', '#/me|[data-reset]'] },
  ];
}

const PERSONA_ROLES = { 'demo-ravi': ['technician', 'Ravi Kumar'], 'demo-imran': ['technician', 'Imran Khan'], 'demo-shyam': ['collector', 'Shyam Lal'], 'demo-green': ['recycler', 'GreenCycle Recyclers'], 'demo-priya': ['brand', 'Priya Sharma'], 'demo-admin': ['admin', 'Hackathon Admin'] };
const sessionJson = (id) => (id ? JSON.stringify({ demo: true, userId: id, role: PERSONA_ROLES[id][0], name: PERSONA_ROLES[id][1] }) : null);

async function main() {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const chrome = await launchChrome();
  const cdp = await CDP.open(chrome.wsUrl);
  const page = await openPage(cdp);
  const results = [];
  let ids;
  const cleanup = async () => { try { chrome.proc.kill('SIGKILL'); } catch { /* gone */ } server.close(); await rm(chrome.dir, { recursive: true, force: true }).catch(() => {}); };
  try {
    process.stderr.write('Setting up demo data… ');
    await navigate(page, `${origin}/#/`);
    ids = await evaluate(page, SETUP, { timeout: 120000 });
    process.stderr.write(`done ${JSON.stringify(ids)}\n`);
    page.log.length = 0;

    for (const l of LANGS) {
      for (const group of plan(ids)) {
        await evaluate(page, `(() => { try { localStorage.setItem('pn-lang', ${JSON.stringify(l)}); ${group.persona ? `localStorage.setItem('pn-auth', ${JSON.stringify(sessionJson(group.persona))});` : "localStorage.removeItem('pn-auth');"} localStorage.removeItem('pn-audio-mode'); } catch {} })()`);
        let first = true;
        for (const entry of group.routes.filter((r) => !ONLY || r.includes(ONLY) || r === '@brandReport' && ONLY.includes('#/b/'))) {
          // "route|selector|selector": load the route, then click each selector in turn (a state inside the page).
          let [route, ...clicks] = entry.split('|');
          if (route === '@brandReport') route = (await evaluate(page, `document.querySelector('#main a[href^="#/b/"]')?.getAttribute('href') || '#/b/WM-7'`));
          page.log.length = 0;
          let ok;
          if (group.owner) ok = await navigate(page, `${origin}/?lang=${l}&i18n-debug=1${route}`);
          else if (first) ok = await navigate(page, `${origin}/?i18n-debug=1${route}`);
          else ok = await goHash(page, route);
          first = false;
          for (const sel of clicks) {
            const hit = await realClick(page, sel);
            if (!hit) page.log.push({ type: 'console.error', text: `sweep: nothing matched ${sel}` });
            await sleep(700);
          }
          await sleep(350); // the debug checker scans 300 ms after the last change
          const probe = await evaluate(page, PROBE);
          const log = page.log.splice(0);
          results.push({ lang: l, persona: group.persona || (group.owner ? 'owner' : 'public'), route: clicks.length ? `${route} +${clicks.join('+')}` : route, rendered: ok, ...probe, errors: log.filter((x) => x.type !== 'missing-key'), missing: log.filter((x) => x.type === 'missing-key').map((x) => x.text) });
          const r = results.at(-1);
          process.stderr.write(`${l} ${r.persona.padEnd(10)} ${r.route.padEnd(34)} issues=${r.issues.length} err=${r.errors.length}${r.overflow ? ` overflow=${r.overflow}` : ''}${r.hash !== route && !group.owner && !clicks.length ? ` -> ${r.hash}` : ''}\n`);
        }
      }
    }

    // ── Canary: the debug checker must see an English sentence planted in a Hindi page ──
    await evaluate(page, `(() => { localStorage.setItem('pn-lang', 'hi'); localStorage.removeItem('pn-auth'); })()`);
    await navigate(page, `${origin}/?i18n-debug=1#/market`);
    const canary = await evaluate(page, `(() => { const p = document.createElement('p'); p.textContent = 'Plain English canary'; p.title = 'English title'; document.getElementById('main').append(p); const n = window.__i18nIssues().filter((i) => /canary|English title/.test(i.text)).length; p.remove(); return n; })()`);
    if (canary !== 2) console.error(`Canary failed: the debug checker found ${canary} of 2 planted strings.`);

    // ── Speech wiring: audio mode on, speaker buttons, Listen control, no errors without voices ──
    const speech = [];
    for (const [persona, route, owner] of [[null, '#/'], [null, `#/o/${ids.waiting.jobId}/${ids.waiting.token}`, true], ['demo-ravi', '#/t/new'], ['demo-ravi', `#/t/job/${ids.repaired.jobId}`], ['demo-ravi', '#/parts'], ['demo-ravi', '#/me'], ['demo-shyam', '#/c']]) {
      await evaluate(page, `(() => { localStorage.setItem('pn-lang', 'mr'); ${persona ? `localStorage.setItem('pn-auth', ${JSON.stringify(sessionJson(persona))});` : "localStorage.removeItem('pn-auth');"} localStorage.removeItem('pn-audio-mode'); })()`);
      page.log.length = 0;
      await navigate(page, `${origin}/${owner ? '?lang=mr' : ''}${route}`);
      if (route === '#/t/new') { await evaluate(page, `document.querySelector('#main [data-cat]')?.click()`); await sleep(600); }
      const before = await evaluate(page, PROBE);
      const q = (expr) => evaluate(page, expr);
      const toggled = { audioBtn: await realClick(page, '[data-lc-audio]') };
      if (toggled.audioBtn) {
        await sleep(900);
        toggled.sayBtns = await q(`document.querySelectorAll('#main .say-btn').length`);
        await realClick(page, '#main .say-btn'); await sleep(700);
        await realClick(page, '[data-lc-listen]'); await sleep(900);
        toggled.noVoiceHelp = await q(`!!document.querySelector('.nv-dlg')`);
        await realClick(page, '[data-nv-close]'); await sleep(300);
        toggled.voices = await q(`speechSynthesis?.getVoices?.().length ?? -1`);
        toggled.hasSR = await q(`!!(window.SpeechRecognition || window.webkitSpeechRecognition)`);
        await realClick(page, '[data-lc-audio]'); await sleep(300);
        toggled.sayAfterOff = await q(`document.querySelectorAll('#main .say-btn').length`);
      }
      speech.push({ persona: persona || (owner ? 'owner' : 'public'), route, listen: before.listen, fields: before.fields, inputs: before.inputs, mics: before.mics, micBtns: before.micBtns, speakHosts: before.speakHosts, ...toggled, errors: page.log.splice(0).filter((x) => x.type !== 'missing-key') });
    }

    // ── Summary ──
    const by = {};
    for (const r of results) {
      const b = (by[r.lang] ||= { routes: 0, issues: 0, errors: 0, overflow: 0, missing: 0, notRendered: 0, noListen: 0 });
      b.routes++; b.issues += r.issues.length; b.errors += r.errors.length; b.overflow += r.overflow ? 1 : 0; b.missing += r.missing.length; b.notRendered += r.rendered ? 0 : 1; b.noListen += r.listen ? 0 : 1;
    }
    console.log('\nlang  routes  issues  errors  overflow  missing-keys  not-rendered  no-listen');
    for (const [l, b] of Object.entries(by)) console.log(`${l.padEnd(6)}${String(b.routes).padEnd(8)}${String(b.issues).padEnd(8)}${String(b.errors).padEnd(8)}${String(b.overflow).padEnd(10)}${String(b.missing).padEnd(14)}${String(b.notRendered).padEnd(14)}${b.noListen}`);
    const uniq = new Map();
    for (const r of results) for (const i of r.issues) { const k = `${i.kind}|${i.attr || ''}|${i.text}`; const u = uniq.get(k) || { ...i, langs: new Set(), routes: new Set() }; u.langs.add(r.lang); u.routes.add(r.route.replace(/\/[A-Z0-9-]{5,}(\/[^/]+)?$/i, '/:id')); uniq.set(k, u); }
    if (uniq.size) {
      console.log(`\nUntranslated (${uniq.size} distinct):`);
      for (const u of uniq.values()) console.log(`  [${u.kind}${u.attr ? ' ' + u.attr : ''}] "${u.text.slice(0, 80)}"  ${[...u.langs].join(',')}  ${[...u.routes].slice(0, 3).join(' ')}  @ ${u.path}`);
    }
    const errs = results.filter((r) => r.errors.length);
    if (errs.length) { console.log('\nConsole errors:'); for (const r of errs) for (const e of r.errors) console.log(`  ${r.lang} ${r.route}: [${e.type}] ${e.text.slice(0, 300)}`); }
    const wide = results.filter((r) => r.overflow);
    if (wide.length) { console.log('\nSideways scroll at 360px:'); for (const r of wide) console.log(`  ${r.lang} ${r.route}: +${r.overflow}px [${r.dims}] ${r.wide.join(', ')}`); }
    const notShown = results.filter((r) => !r.rendered);
    if (notShown.length) { console.log('\nNot rendered within 12 s:'); for (const r of notShown) console.log(`  ${r.lang} ${r.persona} ${r.route} (now at ${r.hash})`); }
    const miss = [...new Set(results.flatMap((r) => r.missing))];
    if (miss.length) console.log('\nMissing keys:\n  ' + miss.join('\n  '));
    console.log(`\nDebug-checker canary: ${canary === 2 ? 'ok' : 'FAILED'}`);
    console.log('\nSpeech:');
    for (const s of speech) console.log(`  ${s.persona.padEnd(10)} ${s.route.padEnd(34)} listen=${s.listen} audioBtn=${s.audioBtn} sayBtns=${s.sayBtns} afterOff=${s.sayAfterOff} fields=${s.fields} inputs=${s.inputs} mics=${s.mics}/${s.micBtns} voices=${s.voices} SR=${s.hasSR} noVoiceHelp=${s.noVoiceHelp} errors=${s.errors.length}${s.errors.length ? ' ' + s.errors.map((e) => e.text.slice(0, 160)).join(' | ') : ''}`);

    const out = { at: new Date().toISOString(), ids, canary, summary: by, distinctIssues: [...uniq.values()].map((u) => ({ ...u, langs: [...u.langs], routes: [...u.routes] })), speech, results };
    if (JSON_OUT) { const { writeFile } = await import('node:fs/promises'); await writeFile(JSON_OUT, JSON.stringify(out, null, 2)); console.log(`\nSaved ${JSON_OUT}`); }
    const speechErrors = speech.reduce((n, s) => n + s.errors.length + (s.listen ? 0 : 1), 0);
    const fail = canary !== 2 || errs.length || speechErrors || results.some((r) => !r.rendered) || (STRICT && (uniq.size || miss.length || wide.length));
    await cleanup();
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error(e);
    await cleanup();
    process.exit(2);
  }
}
// Importable for one-off checks: import { serve, launchChrome, CDP, openPage, navigate, evaluate, realClick } from './i18n-sweep.mjs'
export { serve, launchChrome, CDP, openPage, navigate, goHash, evaluate, realClick, SETUP };
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
