// Customer accounts and journeys, and the labelled demo seed (core/demo-seed.js).
import assert from 'node:assert/strict';
import { createMemoryContext } from '../src/core/adapters/memory.js';
import { handle } from '../src/core/api.js';
import { seedDemo, PERSONAS } from '../src/core/personas.js';
import { seedDemoJourneys } from '../src/core/demo-seed.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; }
};
const world = () => {
  const ctx = createMemoryContext({});
  const as = (userId) => { const p = PERSONAS.find((x) => x.userId === userId); return { userId, groups: [p?.role === 'admin' ? 'admin' : p?.role], claims: {} }; };
  const req = (method, path, body, userId, query) => handle(ctx, { method, path, body, query, auth: userId ? as(userId) : null, ip: '198.51.100.1' });
  const ok = async (...a) => { const r = await req(...a); assert.equal(r.status, 200, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  return { ctx, req, ok };
};

console.log('Customers and demo data');

await test('demo seed: idempotent, every state present, labelled, and excluded from real impact', async () => {
  const { ctx, ok } = world();
  const first = await seedDemo(ctx, { synthetic: 400 });
  assert.equal(first.journeys.skipped, false);
  const items = () => Object.keys(ctx.state.items).length;
  const n = items();
  assert.deepEqual(await seedDemoJourneys(ctx), { skipped: true }, 'second run does nothing');
  assert.equal(items(), n, 'no duplicates');
  const jobs = Object.values(ctx.state.items).filter((x) => x.type === 'job');
  const states = new Set(jobs.map((j) => j.status));
  for (const s of ['repaired', 'recycled', 'harvested', 'with_refurbisher', 'awaiting_owner', 'repairing', 'recycling', 'no_decision', 'owner_declined']) assert.ok(states.has(s), `a job in ${s}`);
  assert.ok(jobs.every((j) => j.demo === true), 'every seeded job is labelled demo');
  assert.ok(Object.values(ctx.state.items).filter((x) => ['listing', 'part', 'pickup', 'request'].includes(x.type)).every((x) => x.demo === true), 'listings, parts, pickups and requests too');
  const imp = await ok('GET', '/public/impact');
  for (const k of ['repairsLogged', 'productsKeptInUse', 'kgToRecycler', 'partsReused', 'productsResold']) {
    assert.equal(imp.impact[k], 0, `public ${k} counts real activity only`);
    assert.ok(imp.demo[k] > 0, `demo ${k} reported separately`);
  }
  const total = await ctx.store.get('AGG#Brand X#WM-7', 'TOTAL');
  assert.equal(total.n, total.n_syn, 'demo decisions count as synthetic in brand analytics, never as real records');
  const rewards = Object.values(ctx.state.items).filter((x) => x.type === 'reward');
  assert.ok(rewards.length >= 4 && rewards.every((r) => r.demo), 'rewards from demo journeys are labelled');
  assert.ok(Object.values(ctx.state.timers).every((t) => t.payload?.type !== 'sfn-timeout' || t.at > Date.now() + 7 * 86400000), 'waiting decisions will not expire during a demo');
});

await test('seeded customers see their own history; a decision is waiting; staff see the live work', async () => {
  const { ctx, ok, req } = world();
  await seedDemo(ctx, { synthetic: 0 });
  const sunita = await ok('GET', '/api/customer/home', null, 'demo-sunita');
  assert.equal(sunita.green.summary.points, 25);
  assert.deepEqual(sunita.green.summary.badges, ['repair_champion']);
  assert.ok(sunita.requests.some((r) => r.status === 'open'));
  const arjun = await ok('GET', '/api/customer/home', null, 'demo-arjun');
  assert.ok(arjun.green.summary.badges.includes('responsible_recycler'));
  assert.ok(arjun.jobs.some((j) => j.needsYou && j.status === 'awaiting_owner'), 'Arjun has a decision to make');
  assert.ok(!JSON.stringify(arjun).includes(sunita.green.token), "one customer's home never contains another's passport link");
  assert.equal((await ok('GET', '/api/requests', null, 'demo-ravi')).offers.length, 1, "Sunita's new request is waiting for Ravi");
  assert.equal((await ok('GET', '/api/pickups/open', null, 'demo-shyam', {})).pickups.length, 1);
  assert.equal((await ok('GET', '/api/recycler/incoming', null, 'demo-green')).pickups.filter((p) => p.status === 'DELIVERED').length, 1, 'a delivery waits for the recycler');
  assert.equal((await ok('GET', '/public/market')).listings.length, 1);
  assert.ok((await ok('GET', '/api/notifications', null, 'demo-sunita')).notifications.some((n) => n.key === 'cnotif.reward'), 'customer notifications also reach the account inbox');
  assert.equal((await req('GET', '/api/customer/home', null, 'demo-ravi')).status, 403, 'technicians cannot open a customer home');
  assert.equal((await req('POST', '/api/jobs', {}, 'demo-sunita')).status, 403, 'customers cannot act as technicians');
  assert.equal((await req('GET', '/api/customer/home')).status, 401);
});

await test('a customer account: report → technician → diagnosis → decline needs agreement → repair → verified points', async () => {
  const { ctx, ok, req } = world();
  await seedDemo(ctx, { synthetic: 0, journeys: false });
  const r = await ok('POST', '/api/customer/requests', { consent: true, contactMethod: 'call', category: 'washing_machine', brand: 'Brand X', model: 'WM-7', intent: 'repair', symptoms: ['noise'], description: 'Loud noise during spin.' }, 'demo-sunita');
  const home1 = await ok('GET', '/api/customer/home', null, 'demo-sunita');
  assert.equal(home1.requests[0].requestId, r.requestId);
  assert.equal(home1.requests[0].intent, 'repair');
  assert.equal(r.green.cid, home1.green.cid, 'the request is linked to the account\'s own Green Passport');
  assert.equal((await req('POST', '/api/customer/requests', { category: 'washing_machine', contactMethod: 'call', description: 'Loud noise.' }, 'demo-sunita')).body.code, 'requestConsent');
  await ok('POST', `/api/requests/${r.requestId}/accept`, {}, 'demo-ravi');
  const j = (await ok('POST', `/api/requests/${r.requestId}/job`, { purchaseYear: 2024 }, 'demo-ravi')).job;
  assert.equal((await ok('GET', '/api/requests', null, 'demo-ravi')).assigned[0].phone, '9876543210', 'contact comes from the customer profile');
  await ok('POST', `/api/jobs/${j.jobId}/diagnosis`, { component: 'drum_bearing', causes: ['normal_wear'], severity: 'replace_part', spare: 'brand', photoKey: 'k', quote: { parts: 1200, labour: 600 } }, 'demo-ravi');
  const owner = (await ok('GET', '/api/customer/home', null, 'demo-sunita')).jobs[0];
  assert.equal(owner.needsYou, true);
  const [, , jobId, token] = owner.ownerPath.split('/');
  assert.equal((await req('POST', `/public/owner/${jobId}/decision`, { t: token, option: 'decline' })).body.code, 'agreeFirst', 'declining also needs explicit agreement');
  await ok('POST', `/public/owner/${jobId}/decision`, { t: token, option: 'repair_new', agree: true });
  await ok('POST', `/api/jobs/${jobId}/complete`, { partSource: 'new', amount: 1800 }, 'demo-ravi');
  await ok('POST', `/public/owner/${jobId}/confirm`, { t: token, working: true });
  const home2 = await ok('GET', '/api/customer/home', null, 'demo-sunita');
  assert.equal(home2.green.summary.points, 20);
  assert.equal(home2.jobs[0].verified, true);
  assert.equal(home2.jobs[0].demo, false, 'a real journey is not labelled demo');
  // Decline path on a second request.
  const r2 = await ok('POST', '/api/customer/requests', { consent: true, contactMethod: 'call', category: 'ceiling_fan', description: 'Fan wobbles badly.', intent: 'sell' }, 'demo-sunita');
  await ok('POST', `/api/requests/${r2.requestId}/accept`, {}, 'demo-ravi');
  const j2 = (await ok('POST', `/api/requests/${r2.requestId}/job`, { purchaseYear: 2020, brand: 'Brand Y', model: 'CF-48' }, 'demo-ravi')).job;
  await ok('POST', `/api/jobs/${j2.jobId}/diagnosis`, { component: 'bearing', causes: ['normal_wear'], severity: 'replace_part', spare: 'local', photoKey: 'k', quote: { parts: 300, labour: 200 } }, 'demo-ravi');
  const p2 = (await ok('GET', '/api/customer/home', null, 'demo-sunita')).jobs.find((x) => x.jobId === j2.jobId).ownerPath.split('/');
  const v = await ok('POST', `/public/owner/${j2.jobId}/decision`, { t: p2[3], option: 'decline', agree: true });
  assert.equal(v.status, 'owner_declined');
  assert.equal(v.journey.stages.find((s) => s.id === 'progress').state, 'stopped');
  assert.equal((await ctx.store.get(`PASSPORT#${j2.pid}`, 'META')).status, 'in_use', 'the product stays with its owner');
  assert.equal((await ok('GET', '/api/customer/home', null, 'demo-sunita')).green.summary.points, 20, 'declining earns nothing');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
