// Punarnava local Build It server: the existing frontend + the core API on one origin, no AWS account needed.
//   node backend/src/local/server.js      (or: cd backend && npm run local)
// Routes:  /                 the frontend (frontend/), /core/* served straight from backend/src/core
//          /config.js        local-mode configuration for the browser
//          /api/*, /public/* the core router (core/api.js), with Cedar at the boundary
//          /local/*          sessions, signed file URLs, agent tools, status and (loopback-only) dev controls
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../core/api.js';
import { PERSONAS } from '../core/personas.js';
import { TOOLS } from '../core/assist.js';
import { allDocs } from '../core/search.js';
import { loadConfig, ROOT } from './env.js';
import { buildLocalContext, seedIfEmpty, resetLocal } from './context.js';
import { createSessions, hashPassword, checkPassword } from './session.js';

const CORE_DIR = path.join(ROOT, 'backend/src/core');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const SIGNUP_ROLES = ['customer', 'technician', 'collector', 'recycler', 'brand'];
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const send = (res, status, body, headers = {}) => {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(isBuf || typeof body === 'string' ? body : JSON.stringify(body));
};
const err = (res, status, code, error) => send(res, status, { error, code, params: {} });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const jsonBody = async (req) => {
  const buf = await readBody(req, 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw Object.assign(new Error('Request body must be JSON'), { status: 400, code: 'badJson' }); }
};

/** Static file under base, or null (no path traversal, no dotfiles). */
function staticFile(base, rel) {
  const clean = path.normalize(decodeURIComponent(rel)).replace(/^(\.\.(\/|\\|$))+/, '');
  if (clean.split(/[\\/]/).some((p) => p.startsWith('.'))) return null;
  const f = path.join(base, clean);
  if (!f.startsWith(base) || !existsSync(f) || !statSync(f).isFile()) return null;
  return f;
}

export async function startServer(overrides = {}, { quiet = false } = {}) {
  const config = loadConfig(overrides);
  const local = await buildLocalContext(config);
  const { ctx, status, stateFile } = local;
  const sessions = createSessions(local.secret);
  const log = quiet ? () => {} : (...a) => console.log(...a);

  // ── Optional services: probe once now, then keep probing in the background ──
  const services = {};
  const probe = async () => {
    services.store = { kind: config.store, ok: true };
    if (config.store === 'localstack' || config.files === 'localstack') {
      const { checkLocalstack } = await import('./localstack-admin.js');
      const ls = await checkLocalstack(config).catch((e) => ({ dynamodb: false, s3: false, errors: [e.message] }));
      services.localstack = ls;
      if (config.store === 'localstack') services.store.ok = ls.dynamodb;
    }
    services.files = { kind: ctx.svc.files.kind, ok: config.files !== 'localstack' || !!services.localstack?.s3 };
    services.authz = { engine: ctx.svc.authz ? 'cedar' : 'route-checks', ok: true, policyFile: ctx.svc.authz ? path.relative(ROOT, config.policyFile) : null };
    services.search = ctx.svc.search ? { engine: 'opensearch', ok: await ctx.svc.search.health(), pending: ctx.svc.search.pending(), indexedAt: ctx.svc.search.status.indexedAt, lastError: ctx.svc.search.status.lastError, version: ctx.svc.search.status.version || null, jvm: ctx.svc.search.status.jvm || null, fallback: 'store' } : { engine: 'store-fallback', ok: true };
    services.agent = ctx.svc.agent ? { engine: 'strands', ok: await ctx.svc.agent.health(), provider: ctx.svc.agent.status.provider, model: ctx.svc.agent.status.model, runtime: ctx.svc.agent.status.runtime || null, lastError: ctx.svc.agent.status.lastError, fallback: 'rules' } : { engine: 'rules', ok: true };
    return services;
  };
  await probe();
  const seeded = await seedIfEmpty(local);
  if (seeded) log(`Seeded ${seeded.personas} personas and ${config.seedSynthetic} labelled synthetic repairs.`);

  // ── Background work: timers (reminders, follow-ups, expiries), search outbox, health ──
  const loops = [];
  const every = (ms, fn) => loops.push(setInterval(() => fn().catch((e) => ctx.onBackgroundError({ name: fn.name || 'loop', error: e.message })), ms));
  every(3000, async function timers() { await ctx.runDueTimers(); });
  if (ctx.svc.search) {
    every(2000, async function searchFlush() {
      if (!services.search.ok) return;
      if (local.state.searchNeedsReindex || !ctx.svc.search.status.indexedAt) { await ctx.svc.search.reindex(await allDocs(ctx)); stateFile.save(); return; }
      if (ctx.svc.search.pending()) { await ctx.svc.search.flush(); stateFile.save(); }
    });
  }
  every(15000, async function health() { await probe(); });

  const authOf = (req) => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    return m ? sessions.verify(m[1]) : null;
  };
  const sessionFor = (userId, claims = {}) => {
    const p = PERSONAS.find((x) => x.userId === userId);
    const role = p?.role || claims['custom:role'];
    const groups = role === 'admin' ? ['admin'] : role ? [role] : [];
    const s = sessions.issue({ userId, groups, claims });
    return { ...s, userId, role, groups };
  };
  const loopback = (req) => LOOPBACK.has(req.socket.remoteAddress);

  async function localRoute(req, res, url) {
    const p = url.pathname;
    // Signed file URLs (uploads: photos, voice notes, request photos)
    if (p.startsWith('/local/files/')) {
      const key = decodeURIComponent(p.slice('/local/files/'.length));
      const q = Object.fromEntries(url.searchParams);
      if (ctx.svc.files.kind !== 'disk') return err(res, 404, 'noRoute', 'Files are served by LocalStack S3 in this mode');
      if (req.method === 'PUT') {
        if (!ctx.svc.files.check('PUT', key, q)) return err(res, 403, 'badSignature', 'Upload link expired or invalid');
        const buf = await readBody(req, 12 * 1024 * 1024);
        ctx.svc.files.write(key, buf, q.type || req.headers['content-type']);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET') {
        if (!ctx.svc.files.check('GET', key, q)) return err(res, 403, 'badSignature', 'Link expired or invalid');
        const f = ctx.svc.files.read(key);
        if (!f) return err(res, 404, 'noFile', 'Not found');
        return send(res, 200, f.body, { 'content-type': f.type, 'cache-control': 'private, max-age=3600' });
      }
    }
    if (req.method === 'POST' && p === '/local/session') {
      if (!config.personas) return err(res, 403, 'notAllowed', 'Persona sign-in is turned off (PN_PERSONAS=false)');
      const { userId } = await jsonBody(req);
      if (!PERSONAS.some((x) => x.userId === userId)) return err(res, 400, 'noUser', 'Unknown persona');
      return send(res, 200, sessionFor(userId));
    }
    if (req.method === 'POST' && p === '/local/signup') {
      const b = await jsonBody(req);
      const email = String(b.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res, 400, 'badEmail', 'Enter a valid email');
      if (String(b.password || '').length < 8) return err(res, 400, 'weakPassword', 'Password must have at least 8 characters');
      if (!SIGNUP_ROLES.includes(b.role)) return err(res, 400, 'signupRole', 'Choose customer, technician, collector, recycler or brand.');
      const userId = `local-${(await import('node:crypto')).randomUUID()}`;
      const claims = { email, name: String(b.name || '').trim().slice(0, 60) || email.split('@')[0], 'custom:role': b.role, ...(b.role === 'brand' && b.brandId ? { 'custom:brandId': String(b.brandId).slice(0, 40) } : {}) };
      try {
        await ctx.store.put({ PK: `LOCALAUTH#${email}`, SK: 'ACCOUNT', type: 'local_account', userId, claims, ...hashPassword(b.password), createdAt: new Date().toISOString() }, { notExists: true });
      } catch (e) {
        if (e.code === 'ConditionFailed') return err(res, 409, 'accountExists', 'An account with this email already exists');
        throw e;
      }
      return send(res, 200, sessionFor(userId, claims));
    }
    if (req.method === 'POST' && p === '/local/login') {
      const b = await jsonBody(req);
      const acct = await ctx.store.get(`LOCALAUTH#${String(b.email || '').trim().toLowerCase()}`, 'ACCOUNT');
      if (!acct || !checkPassword(b.password || '', acct)) return err(res, 401, 'wrongLogin', 'Wrong email or password');
      return send(res, 200, sessionFor(acct.userId, acct.claims));
    }
    // Agent tools: only with a live grant, and only for the job/model that request was about.
    if (req.method === 'POST' && p.startsWith('/local/tools/')) {
      const name = p.slice('/local/tools/'.length);
      const scope = ctx.svc.agent?.grant(/^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1]);
      if (!scope) return err(res, 401, 'noGrant', 'No valid tool grant');
      if (!Object.hasOwn(TOOLS, name)) return err(res, 404, 'noTool', 'Unknown tool');
      const args = await jsonBody(req);
      if (['job_context', 'repair_options'].includes(name) && args.jobId !== scope.jobId) return err(res, 403, 'outOfScope', 'Tool call outside this request');
      if (name === 'model_failure_stats') {
        const want = scope.jobId ? await TOOLS.job_context(ctx, { jobId: scope.jobId }) : scope;
        if (args.brand !== want.brand || args.model !== want.model) return err(res, 403, 'outOfScope', 'Tool call outside this request');
      }
      try { return send(res, 200, await TOOLS[name](ctx, args, null)); } catch (e) { return send(res, e.status || 500, { error: e.message, code: e.code || 'tool' }); }
    }
    if (req.method === 'GET' && p === '/local/status') {
      const timers = Object.values(local.state.timers || {});
      return send(res, 200, {
        mode: 'local', startedAt: status.startedAt, config: status.config, services,
        // For the Build It stack page: where this server runs and what started it (reported, not assumed).
        runtime: { kind: config.runtime, k8sDistro: config.k8sDistro || null, containerCli: config.containerCli || null },
        policy: ctx.svc.authz ? { file: path.relative(ROOT, config.policyFile), rules: (readFileSync(config.policyFile, 'utf8').match(/^@id\(/gm) || []).length } : null,
        partyrockUrl: config.partyrockUrl || null,
        background: { timers: timers.length, retrying: timers.filter((x) => x.attempts).length, deadTimers: (local.state.deadTimers || []).map((x) => ({ name: x.name, error: x.lastError, attempts: x.attempts })), errors: status.errors },
      });
    }
    // Developer controls: loopback only, and only with PN_DEV_TOOLS on.
    if (req.method === 'POST' && (p === '/local/fast-forward' || p === '/local/reset')) {
      if (!config.devTools || !loopback(req)) return err(res, 403, 'notAllowed', 'Developer controls are only available on this machine with PN_DEV_TOOLS=true');
      if (p === '/local/reset') { const r = await resetLocal(local); await probe(); return send(res, 200, { ok: true, seeded: r }); }
      const { minutes = 30 } = await jsonBody(req);
      const offset = Math.min(Math.max(Number(minutes) || 0, 0), 60 * 24 * 40) * 60e3;
      const base = ctx.now;
      ctx.now = () => base() + offset;
      let n = 0;
      try { n = await ctx.runDueTimers(); } finally { ctx.now = base; }
      for (const t of Object.values(local.state.timers)) t.at -= offset;
      stateFile.save();
      return send(res, 200, { ran: n });
    }
    return err(res, 404, 'noRoute', 'No such local route');
  }

  const configJs = () => `// Generated by the local server (backend/src/local/server.js).\nwindow.PUNARNAVA_CONFIG = ${JSON.stringify({ mode: 'local', apiUrl: '', cloudSpeech: false, personas: config.personas, devTools: config.devTools, services: { search: config.search, agent: config.agent, authz: config.authz } })};\n`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    try {
      if (p.startsWith('/api/') || p.startsWith('/public/')) {
        const body = ['GET', 'HEAD'].includes(req.method) ? {} : await jsonBody(req);
        const auth = authOf(req);
        const r = await handle(ctx, { method: req.method, path: p, query: Object.fromEntries(url.searchParams), body, auth, ip: req.socket.remoteAddress || '' });
        if (req.method !== 'GET') stateFile.save();
        return send(res, r.status, r.body);
      }
      if (p.startsWith('/local/')) return await localRoute(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return err(res, 405, 'method', 'Method not allowed');
      if (p === '/config.js') return send(res, 200, configJs(), { 'content-type': MIME['.js'] });
      const f = p.startsWith('/core/') ? staticFile(CORE_DIR, p.slice('/core/'.length)) : staticFile(config.frontendDir, p === '/' ? 'index.html' : p.slice(1));
      if (!f) return err(res, 404, 'notFound', 'Not found');
      return send(res, 200, readFileSync(f), { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    } catch (e) {
      if (!e.status || e.status >= 500) console.error(e);
      return err(res, e.status || 500, e.code || 'server', e.status ? e.message : 'Something went wrong');
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  const addr = server.address();
  const urlBase = `http://${addr.address === '0.0.0.0' ? 'localhost' : addr.address}:${addr.port}`;
  if (ctx.svc.agent) ctx.svc.agent.toolsBase = config.toolsBase || `http://${addr.address === '0.0.0.0' ? '127.0.0.1' : addr.address}:${addr.port}`;
  log(`\nPunarnava (local Build It) on ${urlBase}`);
  log(`  store: ${config.store}${config.store === 'localstack' ? (services.store.ok ? ' (LocalStack DynamoDB)' : ' (LocalStack NOT reachable)') : ` (${path.relative(ROOT, stateFile.file)})`}`);
  log(`  files: ${services.files.kind}   authz: ${services.authz.engine}   search: ${services.search.engine}${ctx.svc.search ? (services.search.ok ? ' (up)' : ' (down: store fallback)') : ''}   agent: ${services.agent.engine}${ctx.svc.agent ? (services.agent.ok ? ' (up)' : ' (down: rule-based fallback)') : ''}`);

  const close = async () => {
    for (const l of loops) clearInterval(l);
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    stateFile.flush();
  };
  return { server, url: urlBase, ctx, local, close, services, probe };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer().then(({ close }) => {
    const stop = async () => { await close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }).catch((e) => {
    console.error(`\nCould not start Punarnava: ${e.message}`);
    if (e.code === 'CEDAR_MISSING') console.error('Install dependencies first:  cd backend && npm install   (or set PN_AUTHZ=routes for route checks only)');
    process.exit(1);
  });
}
