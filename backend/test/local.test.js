// Local Build It server: real HTTP, real files on disk, restarts. OpenSearch and the Strands agent are replaced
// by tiny fake HTTP servers here (their real counterparts are checked by scripts/local/verify.sh on your machine),
// so these tests cover our adapters, fallbacks, scoping and validation, not OpenSearch or the model themselves.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../src/local/server.js';
import { loadConfig } from '../src/local/env.js';
import { validateNarrative, allowedNumbers } from '../src/core/assist.js';
import { rankDocs, docFor } from '../src/core/search.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; }
};
const settle = () => new Promise((r) => setTimeout(r, 150));

// ── Fake OpenSearch: just enough REST (indexes, _bulk, _search, health) to exercise the adapter ──
function fakeOpenSearch() {
  const indexes = {};
  let up = true;
  const srv = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (!up) { req.socket.destroy(); return; }
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/_cluster/health') return send(200, { status: 'green' });
    if (u.pathname === '/_nodes/jvm') return send(200, { nodes: { n1: { version: '2.17.1', jvm: { vm_vendor: 'Amazon.com Inc.', version: '21.0.5' } } } });
    if (u.pathname === '/_bulk') {
      const lines = body.trim().split('\n').map((l) => JSON.parse(l));
      const items = [];
      for (let i = 0; i < lines.length; i++) {
        const [op, meta] = Object.entries(lines[i])[0];
        indexes[meta._index] ??= {};
        if (op === 'delete') { delete indexes[meta._index][meta._id]; items.push({ delete: { ...meta, status: 200 } }); } else { indexes[meta._index][meta._id] = lines[++i]; items.push({ index: { ...meta, status: 201 } }); }
      }
      return send(200, { errors: false, items });
    }
    const m = /^\/([^/]+)\/_search$/.exec(u.pathname);
    if (m) {
      const q = JSON.parse(body).query.bool.should[0].multi_match.query.toLowerCase().split(/\s+/);
      const hits = [];
      for (const idx of m[1].split(',')) for (const [id, doc] of Object.entries(indexes[idx] || {})) {
        const hay = JSON.stringify(doc).toLowerCase();
        if (q.every((w) => hay.includes(w))) hits.push({ _index: idx, _id: id, _source: doc });
      }
      return send(200, { hits: { hits } });
    }
    const idx = u.pathname.slice(1);
    if (req.method === 'HEAD') { res.writeHead(indexes[idx] ? 200 : 404); return res.end(); }
    if (req.method === 'PUT') { indexes[idx] ??= {}; return send(200, { acknowledged: true }); }
    if (req.method === 'DELETE') { delete indexes[idx]; return send(200, { acknowledged: true }); }
    return send(404, { error: 'no' });
  });
  return { srv, indexes, set up(v) { up = v; } };
}

// ── Fake Strands service: calls our tools with the grant it was given, then answers in a chosen way ──
function fakeAgent() {
  const a = { mode: 'grounded', calls: [], toolResults: [] };
  a.srv = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (req.url === '/health') return send(200, { ok: true, provider: 'fake', model: 'fake-model', runtime: a.runtime || 'host' });
    const { task, input, tools } = JSON.parse(Buffer.concat(chunks).toString());
    a.calls.push({ task, input });
    const tool = (name, args) => fetch(`${tools.url}/${name}`, { method: 'POST', headers: { authorization: `Bearer ${tools.token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    if (task === 'recommendation') {
      const opts = await tool('repair_options', { jobId: input.jobId });
      a.toolResults.push(opts.status, (await tool('repair_options', { jobId: 'J-OTHER1' })).status);
      const rec = opts.body.options.find((o) => o.id === opts.body.recommended);
      const price = a.mode === 'invented' ? 99999 : rec.cost ?? rec.payout?.low;
      return send(200, { provider: 'fake', model: 'fake-model', narrative: { summary: `Recommended because it costs ₹${price}.`, items: [{ ref: rec.id, text: a.mode === 'unsafe' ? 'It is 100% safe to open.' : 'Keeps the product in use.' }] } });
    }
    return send(500, { error: 'unsupported task' });
  });
  return a;
}
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

const os = fakeOpenSearch();
const agent = fakeAgent();
const osUrl = await listen(os.srv);
const agentUrl = await listen(agent.srv);
const dir = mkdtempSync(path.join(tmpdir(), 'pn-local-'));
const base = { PN_PORT: '0', PN_DATA_DIR: dir, PN_SEED_DEMO: 'false', PN_AUTHZ: process.env.PN_TEST_AUTHZ || 'routes', PN_SEED_SYNTHETIC: '800', OPENSEARCH_URL: osUrl, AGENT_URL: agentUrl, AGENT_TIMEOUT_MS: '5000' };
let s = await startServer(base, { quiet: true });
const j = async (m, p, body, tok, extra = {}) => {
  const r = await fetch(s.url + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (userId) => (await j('POST', '/local/session', { userId })).body.token;

console.log(`Local Build It server (authz: ${base.PN_AUTHZ})`);

await test('fresh start needs no .env, no AWS credentials and no cloud endpoint', () => {
  const c = loadConfig({});
  assert.equal(c.store, 'file');
  assert.equal(c.files, 'disk');
  assert.equal(c.host, '127.0.0.1');
  assert.ok(!Object.values(c).some((v) => typeof v === 'string' && /amazonaws\.com|cognito/i.test(v)), 'no AWS endpoints in the defaults');
});

let RAVI, IMRAN, ADMIN, GREEN, SHYAM;
await test('serves the app, local config and the shared core; blocks traversal and dotfiles', async () => {
  assert.equal((await fetch(`${s.url}/`)).status, 200);
  const cfg = await (await fetch(`${s.url}/config.js`)).text();
  assert.match(cfg, /"mode":"local"/);
  assert.equal((await fetch(`${s.url}/core/api.js`)).status, 200);
  for (const p of ['/core/../local/secret', '/%2e%2e/.local-data/secret', '/.git/config']) assert.equal((await fetch(s.url + p)).status, 404, p);
});

await test('persona sessions are signed by the server; a tampered or missing token is refused', async () => {
  RAVI = await login('demo-ravi'); IMRAN = await login('demo-imran'); ADMIN = await login('demo-admin'); GREEN = await login('demo-green'); SHYAM = await login('demo-shyam');
  assert.equal((await j('GET', '/api/me', null, RAVI)).body.profile.name, 'Ravi Kumar');
  assert.equal((await j('GET', '/api/me', null, `${RAVI}x`)).status, 401);
  assert.equal((await j('GET', '/api/me')).status, 401);
  assert.equal((await j('POST', '/local/session', { userId: 'someone-else' })).status, 400);
  assert.equal((await j('POST', '/api/jobs', { category: 'washing_machine' }, SHYAM)).status, 403, 'collector cannot create jobs (server-side)');
});

await test('local accounts: sign-up is pending until an admin approves; passwords are checked', async () => {
  const su = await j('POST', '/local/signup', { email: 'Neha@Example.com', password: 'longpassword', name: 'Neha', role: 'recycler' });
  assert.equal(su.status, 200);
  const me = (await j('GET', '/api/me', null, su.body.token)).body.profile;
  assert.equal(me.status, 'pending');
  assert.equal((await j('GET', '/api/recycler/incoming', null, su.body.token)).body.code, 'pendingApproval');
  assert.equal((await j('POST', '/local/signup', { email: 'neha@example.com', password: 'longpassword', role: 'recycler' })).status, 409);
  assert.equal((await j('POST', '/local/login', { email: 'neha@example.com', password: 'wrong-password' })).status, 401);
  assert.equal((await j('POST', '/local/signup', { email: 'x@y.z', password: 'short', role: 'recycler' })).body.code, 'weakPassword');
  assert.equal((await j('POST', '/local/signup', { email: 'admin@y.z', password: 'longpassword', role: 'admin' })).body.code, 'signupRole', 'nobody signs up as admin');
  const cust = await j('POST', '/local/signup', { email: 'owner@example.com', password: 'longpassword', name: 'Lata', role: 'customer' });
  assert.equal((await j('GET', '/api/me', null, cust.body.token)).body.profile.status, 'active', 'customers need no approval');
  assert.equal((await j('GET', '/api/customer/home', null, cust.body.token)).status, 200);
  await j('PUT', '/api/me', { name: 'Neha', pincode: '282003', orgType: 'recycler', regNo: 'CPCB-N-1' }, su.body.token);
  assert.equal((await j('POST', '/api/admin/approve', { userId: me.userId }, ADMIN)).status, 200);
  const again = await j('POST', '/local/login', { email: 'neha@example.com', password: 'longpassword' });
  assert.equal((await j('GET', '/api/recycler/incoming', null, again.body.token)).status, 200);
});

let jobId, ownerToken, photoKey;
await test('photos and voice notes: signed upload and download links, refused when tampered', async () => {
  const up = (await j('POST', '/api/uploads', { contentType: 'image/jpeg' }, RAVI)).body;
  assert.match(up.url, /^\/local\/files\/uploads\/demo-ravi\//);
  assert.equal((await fetch(s.url + up.url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: Buffer.from([0xff, 0xd8, 0xff, 1, 2]) })).status, 200);
  assert.equal((await fetch(s.url + up.url.replace(/sig=[^&]+/, 'sig=AAAA'), { method: 'PUT', body: 'x' })).status, 403);
  assert.equal((await fetch(s.url + up.url.replace(/exp=\d+/, 'exp=1'), { method: 'PUT', body: 'x' })).status, 403, 'expired');
  photoKey = up.key;
  const voice = (await j('POST', '/api/uploads', { contentType: 'audio/webm' }, RAVI)).body;
  assert.equal((await fetch(s.url + voice.url, { method: 'PUT', headers: { 'content-type': 'audio/webm' }, body: Buffer.from('OggS-voice') })).status, 200);
  const b = (await j('POST', '/api/jobs', { category: 'washing_machine', brand: 'Brand X', model: 'WM-7', purchaseYear: 2022, ownerPhone: '9876543210' }, RAVI)).body;
  jobId = b.job.jobId; ownerToken = b.job.ownerToken;
  await j('POST', `/api/jobs/${jobId}/diagnosis`, { component: 'control_board', causes: ['voltage_surge'], severity: 'replace_part', spare: 'brand', photoKey, voiceNoteKey: voice.key, quote: { parts: 3000, labour: 600 } }, RAVI);
  const owner = (await j('GET', `/public/owner/${jobId}?t=${ownerToken}`)).body;
  const audio = await fetch(s.url + owner.diagnosis.voiceUrl);
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get('content-type'), 'audio/webm');
  assert.equal(await audio.text(), 'OggS-voice', 'the voice note replays byte for byte');
});

await test('search: OpenSearch results from records indexed on write; store fallback when it is down; outbox catches up', async () => {
  await j('POST', `/public/owner/${jobId}/decision`, { t: ownerToken, option: 'harvest', agree: true, consent: true });
  const pid = (await j('GET', `/api/jobs/${jobId}`, null, RAVI)).body.job.pid;
  await j('POST', `/api/passports/${pid}/harvest`, { parts: [{ component: 'door_lock', condition: 'working', price: 150 }] }, RAVI);
  for (let i = 0; i < 30 && s.ctx.svc.search.pending(); i++) await new Promise((r) => setTimeout(r, 200));
  let r = (await j('GET', '/api/search?q=door%20lock%20WM-7', null, IMRAN)).body;
  assert.equal(r.engine, 'opensearch');
  assert.equal(r.parts.length, 1);
  assert.ok(!JSON.stringify(r).includes('demo-ravi') && !JSON.stringify(r).includes('9876543210'), 'no account IDs or phone numbers in search documents');
  const pub = (await j('GET', '/public/search?q=door%20lock')).body;
  assert.equal(pub.parts, undefined, 'the public cannot search the Parts Exchange');
  assert.equal((await j('GET', '/public/search?q=x')).body.code, 'searchShort');
  assert.equal((await j('GET', `/public/search?q=${pid}`)).body.passport.pid, pid, 'a passport is found by its exact ID');
  os.up = false;
  await s.probe();
  r = (await j('GET', '/api/search?q=door%20lock', null, IMRAN)).body;
  assert.deepEqual([r.engine, r.reason, r.parts.length], ['fallback', 'offline', 1], 'store fallback answers when OpenSearch is down');
  // A write while OpenSearch is down stays queued, then lands when it is back.
  await j('POST', '/api/admin/catalog/model', { category: 'washing_machine', brand: 'Brand X', model: 'WM-NEW1' }, ADMIN);
  assert.ok(s.ctx.svc.search.pending() >= 1);
  os.up = true;
  await s.probe();
  for (let i = 0; i < 30 && s.ctx.svc.search.pending(); i++) await new Promise((res) => setTimeout(res, 200));
  assert.equal(s.ctx.svc.search.pending(), 0);
  assert.equal((await j('GET', '/public/search?q=WM-NEW1')).body.models.length, 1);
});

await test('assistant: grounded agent output is used; invented numbers, unsafe claims and out-of-scope tools are refused', async () => {
  const b = (await j('POST', '/api/jobs', { category: 'washing_machine', brand: 'Brand X', model: 'WM-7', purchaseYear: 2023, ownerPhone: '9123456780' }, IMRAN)).body;
  await j('POST', `/api/jobs/${b.job.jobId}/diagnosis`, { component: 'motor', causes: ['normal_wear'], severity: 'replace_part', spare: 'brand', photoKey: 'k', quote: { parts: 2000, labour: 600 } }, IMRAN);
  agent.mode = 'grounded';
  let r = (await j('POST', '/api/assist/recommendation', { jobId: b.job.jobId }, IMRAN)).body;
  assert.equal(r.source, 'agent', JSON.stringify(r));
  assert.equal(r.agent.model, 'fake-model');
  assert.ok(r.result.recommended, 'the rule-based answer is always included');
  assert.deepEqual(agent.toolResults.slice(-2), [200, 403], 'the agent may read this job only');
  agent.mode = 'invented';
  r = (await j('POST', '/api/assist/recommendation', { jobId: b.job.jobId }, IMRAN)).body;
  assert.deepEqual([r.source, r.reason, r.rejected], ['rules', 'agentRejected', 'ungroundedNumber']);
  agent.mode = 'unsafe';
  assert.equal((await j('POST', '/api/assist/recommendation', { jobId: b.job.jobId }, IMRAN)).body.rejected, 'safetyClaim');
  assert.equal((await j('POST', '/api/assist/recommendation', { jobId: b.job.jobId }, RAVI)).status, 403, "another technician's job");
  assert.equal((await j('POST', '/local/tools/repair_options', { jobId: b.job.jobId }, 'not-a-grant')).status, 401, 'tools need a live grant');
  const d = (await j('POST', '/api/assist/diagnosis', { jobId: b.job.jobId }, IMRAN)).body;
  assert.equal(d.source, 'rules');
  assert.ok(d.result.cautions.length >= 1, 'hazardous parts come from the catalog');
  const design = (await j('POST', '/api/assist/design', { model: 'WM-7' }, await login('demo-priya'))).body;
  assert.ok(design.result.n > 0 && design.result.synthetic, 'design answer is labelled synthetic');
  assert.ok(design.result.basis === 'model' ? design.result.recommendations.every((x) => x.rule && x.params) : design.result.recommendations.length === 0, 'no recommendations below the minimum sample');
});

await test('Build It stack status is detected, not claimed: Corretto JVM, agent runtime, container tool, policy, PartyRock link', async () => {
  agent.runtime = 'firecracker';
  await s.probe();
  const st = (await j('GET', '/local/status')).body;
  assert.deepEqual(st.services.search.jvm, { vendor: 'Amazon.com Inc.', version: '21.0.5', corretto: true }, 'JVM read from OpenSearch /_nodes/jvm');
  assert.equal(st.services.search.version, '2.17.1');
  assert.equal(st.services.agent.runtime, 'firecracker', 'runtime reported by the agent itself');
  assert.equal(st.runtime.kind, 'host');
  assert.equal(st.runtime.containerCli, null, 'not started by the start script here, so no container tool is claimed');
  assert.equal(st.partyrockUrl, null);
  if (base.PN_AUTHZ === 'cedar') assert.ok(st.policy.rules >= 10); else assert.equal(st.policy, null, 'no Cedar claim when Cedar is off');
  agent.runtime = 'host';
  await s.probe();
  assert.equal((await j('GET', '/local/status')).body.services.agent.runtime, 'host');
  const { loadConfig: lc } = await import('../src/local/env.js');
  assert.equal(lc({ PN_PARTYROCK_URL: 'https://evil.example/x' }).partyrockUrl, '', 'only partyrock.aws links are accepted');
  assert.equal(lc({ PN_PARTYROCK_URL: 'https://partyrock.aws/u/me/app' }).partyrockUrl, 'https://partyrock.aws/u/me/app');
  assert.equal(lc({ KUBERNETES_SERVICE_HOST: '10.0.0.1' }).runtime, 'kubernetes');
});

await test('assistant validation and search ranking (pure functions)', () => {
  const g = { cost: 3600, options: [{ id: 'repair_new', cost: 3600 }], sharePct: 34 };
  const refs = new Set(['repair_new', 'sell']);
  assert.ok(validateNarrative('x', { summary: 'Costs ₹3,600, about 34% of failures.', items: [{ ref: 'repair_new', text: 'ok' }] }, g, refs).ok);
  assert.equal(validateNarrative('x', { summary: 'Costs ₹4,100.', items: [] }, g, refs).reason, 'ungroundedNumber');
  assert.equal(validateNarrative('x', { summary: 'खर्च ३६०० रुपये', items: [] }, g, refs).ok, true, 'Devanagari digits are checked too');
  assert.equal(validateNarrative('x', { summary: 'खर्च ४१०० रुपये', items: [] }, g, refs).reason, 'ungroundedNumber');
  assert.equal(validateNarrative('x', { summary: 'fine', items: [{ ref: 'teleport', text: 'x' }] }, g, refs).reason, 'unknownRef');
  assert.equal(validateNarrative('x', { summary: 'This repair is guaranteed.', items: [] }, g, refs).reason, 'safetyClaim');
  assert.equal(validateNarrative('x', 'not json', g, refs).reason, 'notJson');
  assert.ok(allowedNumbers({ a: 0.345 }).has('35') && allowedNumbers({ a: 0.345 }).has('34.5') === false);
  const docs = [docFor({ SK: 'META', type: 'listing', status: 'ACTIVE', listingId: 'L-1', title: 'Brand X WM-7 washing machine', category: 'washing_machine', brand: 'Brand X', model: 'WM-7' }), docFor({ SK: 'META', type: 'part', status: 'LISTED', partId: 'PT-1', category: 'washing_machine', component: 'motor', brand: 'Brand Y', model: 'WM-9', area: '282' })];
  assert.deepEqual(rankDocs(docs, 'मोटर').map((d) => d.id), ['PT-1'], 'Hindi component names are searchable');
  assert.deepEqual(rankDocs(docs, 'wm-7 washing').map((d) => d.id), ['L-1']);
  assert.equal(docFor({ SK: 'META', type: 'part', status: 'SOLD', partId: 'PT-2' }).remove, true, 'sold parts leave the index');
});

await test('background work is retry-safe: a failing timer is retried with back-off, then parked and reported', async () => {
  const st = s.local.state;
  st.timers['test-broken'] = { at: 0, payload: { type: 'reminder', jobId: 'J-NOPE00' } };
  await s.ctx.runDueTimers();
  assert.equal(st.timers['test-broken'].attempts, 1);
  assert.ok(st.timers['test-broken'].at > Date.now(), 'retried later, not dropped');
  for (let i = 0; i < 4; i++) { st.timers['test-broken'].at = 0; await s.ctx.runDueTimers(); }
  assert.equal(st.timers['test-broken'], undefined);
  const status = (await j('GET', '/local/status')).body;
  assert.ok(status.background.deadTimers.some((d) => d.name === 'test-broken' && d.attempts === 5));
  assert.ok(!JSON.stringify(status).includes(s.local.secret), 'no secrets in the status page');
});

await test('reminders, 30-day follow-up and reservation expiry run on the server clock (fast-forward)', async () => {
  const b = (await j('POST', '/api/jobs', { category: 'ceiling_fan', brand: 'Brand Y', model: 'CF-48', purchaseYear: 2020, ownerPhone: '9000000001' }, RAVI)).body;
  await j('POST', `/api/jobs/${b.job.jobId}/diagnosis`, { component: 'capacitor', causes: ['heat'], severity: 'replace_part', spare: 'local', photoKey: 'k', quote: { parts: 180, labour: 150 } }, RAVI);
  await j('POST', `/public/owner/${b.job.jobId}/decision`, { t: b.job.ownerToken, option: 'repair_new', agree: true });
  await j('POST', `/api/jobs/${b.job.jobId}/complete`, { partSource: 'new', amount: 330 }, RAVI);
  await j('POST', `/public/owner/${b.job.jobId}/confirm`, { t: b.job.ownerToken, working: true });
  const ff = await j('POST', '/local/fast-forward', { minutes: 10 });
  assert.ok(ff.body.ran >= 1);
  assert.equal((await j('GET', `/public/owner/${b.job.jobId}?t=${b.job.ownerToken}`)).body.followup.due, true);
  const part = (await j('GET', '/api/search?q=door%20lock', null, IMRAN)).body.parts[0];
  await j('POST', `/api/parts/${part.partId}/reserve`, {}, IMRAN);
  await j('POST', '/local/fast-forward', { minutes: 25 * 60 });
  assert.ok((await j('GET', '/api/notifications', null, IMRAN)).body.notifications.some((n) => n.key === 'notif.reservationExpired'));
});

await test('everything survives a restart: records, files, sessions, timers and the search queue', async () => {
  const before = (await j('GET', `/api/jobs/${jobId}`, null, RAVI)).body;
  const timers = Object.keys(s.local.state.timers).length;
  await s.close();
  await settle();
  s = await startServer(base, { quiet: true });
  const after = (await j('GET', `/api/jobs/${jobId}`, null, RAVI)).body;
  assert.equal(after.job.status, before.job.status);
  assert.equal(Object.keys(s.local.state.timers).length, timers);
  assert.equal((await fetch(s.url + after.photos.diagnosis)).status, 200);
  assert.equal((await j('GET', '/api/me', null, ADMIN)).status, 200, 'sessions stay valid (the signing secret is kept)');
});

await test('developer controls: reset reseeds; they can be turned off; persona sign-in can be turned off', async () => {
  assert.equal((await j('POST', '/local/reset')).status, 200);
  assert.equal((await j('GET', `/api/jobs/${jobId}`, null, RAVI)).status, 404, 'reset removed the jobs');
  assert.equal((await j('GET', '/api/me', null, RAVI)).body.profile.name, 'Ravi Kumar', 'personas are back');
  await s.close();
  await settle();
  s = await startServer({ ...base, PN_DEV_TOOLS: 'false', PN_PERSONAS: 'false' }, { quiet: true });
  assert.equal((await j('POST', '/local/reset')).status, 403);
  assert.equal((await j('POST', '/local/fast-forward', { minutes: 5 })).status, 403);
  assert.equal((await j('POST', '/local/session', { userId: 'demo-ravi' })).status, 403);
  assert.match(await (await fetch(`${s.url}/config.js`)).text(), /"personas":false/);
});

await s.close();
os.srv.close();
agent.srv.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
