// Acceptance tests for the Customer Green Passport, verified rewards, repair requests and technician matching,
// transparent owner decisions, journeys and brand PDF reports. Same in-memory adapter as run-tests.js.
import assert from 'node:assert/strict';
import { createMemoryContext } from '../src/core/adapters/memory.js';
import { handle } from '../src/core/api.js';
import { summarize, REWARD_RULES, CHAMPION } from '../src/core/rewards.js';
import { matchTechnicians, journeyOf } from '../src/core/requests.js';
import { fairRepairRange } from '../src/core/decision.js';
import { renderPdf, sanitize, wrap } from '../src/core/pdf.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; }
};

/** A fresh world: technicians, collector, recycler/refurbisher, brand user. */
async function world(config = {}) {
  const ctx = createMemoryContext({ config: { demoMode: true, requests: { createPerIp: 100, matchPerIp: 100, uploadPerIp: 100 }, ...config } });
  let clock = Date.UTC(2026, 9, 9, 6, 0, 0);
  ctx.now = () => clock;
  const req = (method, path, body, auth, query, ip = '198.51.100.10') => handle(ctx, { method, path, body, auth, query, ip });
  const ok = async (...a) => {
    const r = await req(...a);
    assert.equal(r.status, 200, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const profile = (userId, role, extra = {}) => ctx.store.put({ PK: `USER#${userId}`, SK: 'PROFILE', type: 'profile', userId, role, status: extra.status || 'active', name: extra.name || userId, trust: 50, jobs: 0, verifiedJobs: 0, complete: true, ...extra, GSI1PK: `ROLE#${role}`, GSI1SK: `${extra.status || 'active'}#${role === 'brand' ? extra.brandId : extra.area || ''}#${userId}` });
  await profile('ravi', 'technician', { name: 'Ravi', shop: 'Ravi Electricals', pincode: '282001', area: '282', categories: ['washing_machine', 'ceiling_fan'] });
  await profile('imran', 'technician', { name: 'Imran', shop: 'Imran Repairs', pincode: '282005', area: '282', categories: ['washing_machine', 'smartphone'] });
  await profile('gen', 'technician', { name: 'Gen', shop: 'General Fixers', pincode: '283001', area: '283' }); // no categories: general shop, nearby
  await profile('far', 'technician', { name: 'Far', shop: 'Far Away', pincode: '560001', area: '560', categories: ['washing_machine'] });
  await profile('phones', 'technician', { name: 'Phones', shop: 'Phones Only', pincode: '282003', area: '282', categories: ['smartphone'] });
  await profile('susp', 'technician', { name: 'Susp', shop: 'Suspended', pincode: '282004', area: '282', categories: ['washing_machine'], status: 'suspended' });
  await profile('shyam', 'collector', { name: 'Shyam', pincode: '282002', area: '282' });
  await profile('green', 'recycler', { name: 'GreenCycle', pincode: '282007', area: '282', orgType: 'both', regNo: 'CPCB-UP-0001' });
  await profile('priya', 'brand', { name: 'Priya', brandId: 'Brand X' });
  const as = (userId, groups = []) => ({ userId, groups, claims: {} });
  return { ctx, req, ok, as, tick: async (ms) => { clock += ms; await ctx.runDueTimers(); } };
}

const REQUEST = { category: 'washing_machine', brand: 'Brand X', model: 'WM-7', ageBand: '1-3', description: 'Drum does not spin and it shows an error.', symptoms: ['error_code'], pincode: '282002', phone: '98765 43210', name: 'Sunita Devi', contactMethod: 'whatsapp', lang: 'hi', consent: true };

/** Customer request → Ravi accepts → job → diagnosis. Returns ids and links. */
async function requestToOptions(w, { body = {}, diag = {}, tech = 'ravi', job = {} } = {}) {
  const { ok, as } = w;
  const r = await ok('POST', '/public/requests', { ...REQUEST, ...body });
  await ok('POST', `/api/requests/${r.requestId}/accept`, {}, as(tech));
  const j = await ok('POST', `/api/requests/${r.requestId}/job`, { purchaseYear: 2024, brand: 'Brand X', model: 'WM-7', ...job }, as(tech));
  await ok('POST', `/api/jobs/${j.job.jobId}/diagnosis`, { component: 'control_board', causes: ['voltage_surge'], severity: 'replace_part', spare: 'brand', photoKey: `uploads/${tech}/x.jpg`, quote: { parts: 3000, labour: 600 }, ...diag }, as(tech));
  const view = await ok('GET', `/public/requests/${r.requestId}`, null, null, { t: r.token });
  const [, , jobId, ownerToken] = view.job.ownerPath.split('/');
  return { r, jobId, ownerToken, green: r.green, view };
}
const points = async (w, green) => (await w.ok('GET', `/public/green/${green.cid}`, null, null, { t: green.token })).summary;

console.log('Rewards and Green Passport');

await test('rewards are awarded only for verified events, exactly once under retries and concurrent requests', async () => {
  const w = await world();
  const { ok, req, as } = w;
  const { jobId, ownerToken, green } = await requestToOptions(w);
  assert.equal((await points(w, green)).points, 0, 'a submitted request earns nothing');
  await ok('POST', `/public/owner/${jobId}/decision`, { t: ownerToken, option: 'repair_new', agree: true, consent: true });
  await ok('POST', `/api/jobs/${jobId}/complete`, { partSource: 'new', amount: 3600, warrantyDays: 90 }, as('ravi'));
  assert.equal((await points(w, green)).points, 0, 'a completed but unconfirmed repair earns nothing');
  const trustBefore = (await w.ctx.store.get('USER#ravi', 'PROFILE')).trust;
  const results = await Promise.all([1, 2, 3].map(() => req('POST', `/public/owner/${jobId}/confirm`, { t: ownerToken, working: true })));
  assert.ok(results.every((x) => x.status === 200));
  await ok('POST', `/public/owner/${jobId}/confirm`, { t: ownerToken, working: true }); // a retry later
  let s = await points(w, green);
  assert.equal(s.points, REWARD_RULES.repair.points);
  assert.equal(s.byKind.repair, 1);
  assert.equal((await w.ctx.store.get('USER#ravi', 'PROFILE')).trust, trustBefore + 3, 'trust bumped once');
  assert.equal((await w.ctx.store.query({ pk: `JOB#${jobId}`, skPrefix: 'REWARD#' })).length, 1);
  await w.tick(6 * 60 * 1000); // follow-up timer
  const fu = await Promise.all([1, 2].map(() => req('POST', `/public/owner/${jobId}/followup`, { t: ownerToken, working: true })));
  assert.deepEqual(fu.map((x) => x.status).sort(), [200, 409]);
  s = await points(w, green);
  assert.equal(s.points, REWARD_RULES.repair.points + REWARD_RULES.followup.points);
  assert.deepEqual(s.badges, ['repair_champion']);
  const g = await ok('GET', `/public/green/${green.cid}`, null, null, { t: green.token });
  assert.ok(g.rewards.every((x) => x.key && x.jobId && x.evidence), 'each reward explains why and links its job');
  assert.ok(g.notifications.some((n) => n.key === 'cnotif.reward'));
  assert.ok(g.notifications.some((n) => n.key === 'cnotif.badge' && n.params.badge.msg === 'badge.repair_champion'));
  assert.ok(g.jobs.some((j) => j.jobId === jobId));
});

await test('a "not working" answer earns nothing, and no API lets anyone submit a reward', async () => {
  const w = await world();
  const { ok, req, as } = w;
  const { jobId, ownerToken, green } = await requestToOptions(w);
  await ok('POST', `/public/owner/${jobId}/decision`, { t: ownerToken, option: 'repair_new', agree: true });
  await ok('POST', `/api/jobs/${jobId}/complete`, { partSource: 'new', amount: 3600 }, as('ravi'));
  await ok('POST', `/public/owner/${jobId}/confirm`, { t: ownerToken, working: false });
  assert.equal((await points(w, green)).points, 0);
  for (const [m, p] of [['POST', `/public/green/${green.cid}`], ['POST', `/public/green/${green.cid}/rewards`], ['POST', `/api/jobs/${jobId}/reward`]]) {
    const r = await req(m, p, { t: green.token, kind: 'recycle', points: 999 }, as('ravi'));
    assert.equal(r.status, 404, `${m} ${p} must not exist`);
  }
});

await test('recycling is rewarded and marked recycled only after the registered recycler confirms receipt', async () => {
  const w = await world();
  const { ok, req, as } = w;
  const first = await requestToOptions(w);
  // Same customer, second product: the browser sends its remembered Green Passport credential.
  const { jobId, ownerToken, green } = await requestToOptions(w, { body: { green: { cid: first.green.cid, t: first.green.token } } });
  assert.equal(green.cid, first.green.cid, 'the same Green Passport collects both products');
  await ok('POST', `/public/owner/${jobId}/decision`, { t: ownerToken, option: 'recycle', agree: true });
  const pickup = (await ok('GET', '/api/pickups/open', null, as('shyam'))).pickups.find((p) => p.jobId === jobId);
  await ok('POST', `/api/pickups/${pickup.pickupId}/accept`, {}, as('shyam'));
  await ok('POST', `/api/pickups/${pickup.pickupId}/collect`, { weightKg: 31, photoKey: 'uploads/shyam/w.jpg', gates: { capacitors_discharged: true } }, as('shyam'));
  await ok('POST', `/api/pickups/${pickup.pickupId}/deliver`, { recyclerId: 'green' }, as('shyam'));
  let v = await ok('GET', `/public/owner/${jobId}`, null, null, { t: ownerToken });
  assert.equal((await points(w, green)).points, 0, 'collection and delivery alone are not verified');
  assert.notEqual(v.journey.stages.find((s) => s.id === 'verified').state, 'done', 'not recycled before the recycler confirms');
  assert.equal(v.journey.recycling.find((s) => s.id === 'collected').state, 'done');
  assert.equal(v.journey.recycling.find((s) => s.id === 'recyclerConfirmed').state, 'current');
  const both = await Promise.all([1, 2].map(() => req('POST', `/api/pickups/${pickup.pickupId}/confirm`, { weightKg: 30.5 }, as('green'))));
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 409], 'a concurrent second confirmation is refused');
  const s = await points(w, green);
  assert.equal(s.points, REWARD_RULES.recycle.points);
  assert.equal(s.impact.recycledKgMeasured, 30.5);
  assert.ok(s.badges.includes('responsible_recycler'));
  v = await ok('GET', `/public/owner/${jobId}`, null, null, { t: ownerToken });
  assert.equal(v.journey.stages.find((x) => x.id === 'verified').state, 'done');
  assert.equal(v.journey.verified, true);
  assert.equal(v.rewards[0].evidence.regNo, 'CPCB-UP-0001');
  const g = await ok('GET', `/public/green/${green.cid}`, null, null, { t: green.token });
  assert.ok(g.notifications.some((n) => n.key === 'cnotif.collected'), 'collection notified');
  assert.ok(g.notifications.some((n) => n.key === 'cnotif.recycled'), 'confirmation notified');
  assert.equal(g.jobs.length, 2);
});

await test('resale by a registered refurbisher and verified part reuse reward the original owner', async () => {
  const w = await world();
  const { ok, as } = w;
  // A: sells the product → refurbisher lists and sells it.
  // Imran takes this one (both list washing machines); a young washing machine with a costly board can be sold.
  const a = await requestToOptions(w, { tech: 'imran', body: { phone: '9000000011', techIds: ['imran'] } });
  const v = await ok('GET', `/public/owner/${a.jobId}`, null, null, { t: a.ownerToken });
  const choice = v.build.options.find((o) => o.id === 'sell') ? 'sell' : 'harvest';
  await ok('POST', `/public/owner/${a.jobId}/decision`, { t: a.ownerToken, option: choice, agree: true });
  if (choice === 'sell') {
    const pid = v.pid;
    await ok('POST', `/api/passports/${pid}/transfer`, { refurbisherId: 'green' }, as('imran'));
    const l = await ok('POST', '/api/listings', { pid, price: 6000, photoKey: 'p', checklist: { tested: true, safety: true, cleaned: true, data_wiped: true } }, as('green'));
    assert.equal((await points(w, a.green)).points, 0, 'listing alone is not a verified resale');
    await ok('POST', `/api/listings/${l.listing.listingId}/sold`, {}, as('green'));
    const s = await points(w, a.green);
    assert.equal(s.points, REWARD_RULES.resale.points);
    assert.ok(s.badges.includes('second_life'));
    const v2 = await ok('GET', `/public/owner/${a.jobId}`, null, null, { t: a.ownerToken });
    assert.equal(v2.journey.stages.at(-1).state, 'done', 'resale verifies the sell journey');
  } else assert.fail('expected a sell option for a young phone');
  // B: harvest; C: repair with B's reused part → reward to B only after handover AND C's owner confirms.
  const b = await requestToOptions(w, { body: { phone: '9000000022' }, diag: { component: 'drum_bearing', causes: ['normal_wear'], spare: 'none', quote: {} } });
  await ok('POST', `/public/owner/${b.jobId}/decision`, { t: b.ownerToken, option: 'harvest', agree: true });
  const pidB = (await ok('GET', `/public/owner/${b.jobId}`, null, null, { t: b.ownerToken })).pid;
  const h = await ok('POST', `/api/passports/${pidB}/harvest`, { parts: [{ component: 'door_lock', condition: 'working', price: 150 }] }, as('ravi'));
  const partId = h.parts[0].partId;
  const c = await ok('POST', '/api/jobs', { category: 'washing_machine', brand: 'Brand X', model: 'WM-7', purchaseYear: 2023, ownerPhone: '9000000033' }, as('imran'));
  await ok('POST', `/api/jobs/${c.job.jobId}/diagnosis`, { component: 'door_lock', causes: ['manufacturing_defect'], severity: 'replace_part', spare: 'local', photoKey: 'k', quote: { parts: 700, labour: 300 } }, as('imran'));
  await ok('POST', `/public/owner/${c.job.jobId}/decision`, { t: c.job.ownerToken, option: 'repair_reused', agree: true });
  await ok('POST', `/api/parts/${partId}/handover`, {}, as('ravi'));
  await ok('POST', `/api/jobs/${c.job.jobId}/complete`, { partSource: 'reused', partId, amount: 450 }, as('imran'));
  assert.equal((await points(w, b.green)).byKind.reuse, 0, 'installation alone is not verified');
  await ok('POST', `/public/owner/${c.job.jobId}/confirm`, { t: c.job.ownerToken, working: true });
  const sb = await points(w, b.green);
  assert.equal(sb.byKind.reuse, 1);
  assert.equal(sb.points, REWARD_RULES.reuse.points);
});

await test('badge thresholds and contribution totals', () => {
  const r = (kind, extra = {}) => ({ kind, points: REWARD_RULES[kind].points, ...extra });
  assert.deepEqual(summarize([]).badges, []);
  assert.equal(summarize([]).nextBadge, 'repair_champion');
  let s = summarize([r('repair'), r('followup')]);
  assert.equal(s.points, 25);
  assert.deepEqual(s.badges, ['repair_champion']);
  s = summarize([r('repair'), r('reuse'), r('recycle', { evidence: { weightKg: 12.5 } })]);
  assert.deepEqual(s.badges, ['repair_champion', 'second_life', 'responsible_recycler', 'circular_champion'], 'three kinds → champion');
  assert.equal(s.points, 90);
  assert.equal(s.impact.recycledKgMeasured, 12.5);
  s = summarize([r('recycle'), r('recycle'), r('recycle')]);
  assert.equal(s.points, 120);
  assert.ok(s.points >= CHAMPION.points && s.badges.includes('circular_champion'), 'points threshold → champion');
  assert.ok(!s.badges.includes('repair_champion'));
  s = summarize([r('repair'), r('resale')]);
  assert.ok(s.badges.includes('second_life') && !s.badges.includes('circular_champion'));
});

await test("nobody can read another customer's private Green Passport", async () => {
  const w = await world();
  const { ok, req, as } = w;
  const a = await ok('POST', '/public/requests', REQUEST);
  const b = await ok('POST', '/public/requests', { ...REQUEST, phone: '9111111111' });
  assert.notEqual(a.green.cid, b.green.cid, 'the same form from a new browser makes a new passport: a phone number alone grants nothing');
  for (const t of [undefined, '', 'wrong', b.green.token]) {
    const r = await req('GET', `/public/green/${a.green.cid}`, null, null, { t });
    assert.equal(r.status, 403, String(t));
    assert.equal(r.body.code, 'greenLink');
  }
  assert.equal((await req('GET', `/public/green/${a.green.cid}`, null, as('ravi'), {})).status, 403, 'signing in as staff does not help');
  assert.equal((await req('GET', '/public/green/C-NOTREAL1', null, null, { t: a.green.token })).status, 403);
  // A request link is also private.
  assert.equal((await req('GET', `/public/requests/${a.requestId}`, null, null, { t: b.token })).status, 403);
  // Walk-in owner links: first claim links the job; a later claim without that passport's credential is refused.
  const j = await ok('POST', '/api/jobs', { category: 'ceiling_fan', brand: 'Brand Y', model: 'CF-48', purchaseYear: 2020, ownerPhone: '9222222222' }, as('ravi'));
  const claim = await ok('POST', `/public/owner/${j.job.jobId}/green`, { t: j.job.ownerToken });
  assert.equal(claim.created, true);
  const again = await req('POST', `/public/owner/${j.job.jobId}/green`, { t: j.job.ownerToken });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'greenClaimed');
  const mine = await ok('POST', `/public/owner/${j.job.jobId}/green`, { t: j.job.ownerToken, green: { cid: claim.cid, t: claim.token } });
  assert.equal(mine.cid, claim.cid);
  assert.equal((await req('POST', `/public/owner/${j.job.jobId}/green`, { t: 'bad' })).status, 403);
  // The public product passport shows nothing about rewards or Green Passports.
  const pass = await ok('GET', `/public/passport/${j.job.pid}`);
  assert.ok(!JSON.stringify(pass).match(/reward|green|C-[A-Z0-9]{8}|9222222222/i));
});

console.log('Requests and matching');

await test('matching uses active status, category expertise and service area, and explains every suggestion', async () => {
  const w = await world();
  const { ok } = w;
  const m = await ok('POST', '/public/requests/match', { category: 'washing_machine', pincode: '282002' });
  const ids = m.technicians.map((x) => x.userId);
  assert.deepEqual(ids.slice(0, 2).sort(), ['imran', 'ravi'], 'same area + category first');
  assert.ok(ids.includes('gen'), 'a nearby general shop is suggested');
  for (const bad of ['far', 'phones', 'susp']) assert.ok(!ids.includes(bad), `${bad} must not match`);
  const ravi = m.technicians.find((x) => x.userId === 'ravi');
  assert.deepEqual(ravi.reasons.map((x) => x.key).slice(0, 3), ['match.category', 'match.sameArea', 'match.trust']);
  assert.equal(m.technicians.find((x) => x.userId === 'gen').reasons[0].key, 'match.general');
  assert.equal(m.availability, 'request', 'availability is a request, not a live claim');
  assert.ok(!('phone' in ravi) && !('score' in ravi));
  // Pure matcher: pending or wrong role never matches.
  assert.deepEqual(matchTechnicians({ category: 'washing_machine', pincode: '282002' }, [{ userId: 'x', role: 'technician', status: 'pending', pincode: '282001', area: '282' }, { userId: 'y', role: 'collector', status: 'active', pincode: '282001', area: '282' }]), []);
});

await test('requests need consent and valid input; technicians must accept, and only the assigned one sees contact details', async () => {
  const w = await world();
  const { ok, req, as } = w;
  const bad = async (body, code) => { const r = await req('POST', '/public/requests', { ...REQUEST, ...body }); assert.equal(r.status, 400, code); assert.equal(r.body.code, code); };
  await bad({ consent: false }, 'requestConsent');
  await bad({ consent: undefined }, 'requestConsent');
  await bad({ phone: '12345' }, 'phone10');
  await bad({ pincode: '28' }, 'pincode6');
  await bad({ contactMethod: 'pigeon' }, 'contactMethod');
  await bad({ description: 'hi', symptoms: [] }, 'describeProblem');
  await bad({ lang: 'fr' }, 'badLang');
  await bad({ techIds: ['far'] }, 'pickTechnician');
  const noOne = await req('POST', '/public/requests', { ...REQUEST, pincode: '700001' });
  assert.equal(noOne.body.code, 'noTechNearby');
  const r = await ok('POST', '/public/requests', { ...REQUEST, techIds: ['ravi', 'imran', 'far'] });
  assert.equal(r.offered, 2, 'a technician the matcher did not suggest is never offered');
  const n = await ok('GET', '/api/notifications', null, as('ravi'));
  assert.ok(n.notifications.some((x) => x.key === 'notif.repairRequest'));
  const offers = (await ok('GET', '/api/requests', null, as('imran'))).offers;
  assert.equal(offers.length, 1);
  const seen = JSON.stringify(offers[0]);
  for (const secret of ['9876543210', 'Sunita', '282002', r.token]) assert.ok(!seen.includes(secret), `offer leaks ${secret}`);
  assert.equal(offers[0].areaName !== undefined, true);
  assert.equal((await req('GET', `/api/requests/${r.requestId}`, null, as('gen'))).status, 403, 'not offered → no access');
  assert.equal((await req('POST', `/api/requests/${r.requestId}/accept`, {}, as('gen'))).body.code, 'notOffered');
  assert.equal((await req('POST', `/api/requests/${r.requestId}/job`, { purchaseYear: 2024 }, as('ravi'))).body.code, 'notAssigned', 'no job before accepting');
  const both = await Promise.all([req('POST', `/api/requests/${r.requestId}/accept`, {}, as('ravi')), req('POST', `/api/requests/${r.requestId}/accept`, {}, as('imran'))]);
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 409], 'exactly one technician is assigned');
  const winner = both[0].status === 200 ? 'ravi' : 'imran';
  const loser = winner === 'ravi' ? 'imran' : 'ravi';
  const full = await ok('GET', `/api/requests/${r.requestId}`, null, as(winner));
  assert.equal(full.request.phone, '9876543210');
  assert.equal(full.request.name, 'Sunita Devi');
  assert.equal((await req('GET', `/api/requests/${r.requestId}`, null, as(loser))).status, 403);
  const cv = await ok('GET', `/public/requests/${r.requestId}`, null, null, { t: r.token });
  assert.equal(cv.journey.stages.find((s) => s.id === 'assigned').state, 'done');
  assert.ok(cv.notifications.some((x) => x.key === 'cnotif.assigned'));
  const job = await ok('POST', `/api/requests/${r.requestId}/job`, { purchaseYear: 2024 }, as(winner));
  assert.equal(job.job.ownerToken, undefined, 'the technician never receives the owner token of a request job');
  assert.equal(job.job.requestId, r.requestId);
  const detail = await ok('GET', `/api/jobs/${job.job.jobId}`, null, as(winner));
  assert.equal(detail.job.ownerToken, undefined);
  assert.equal((await req('POST', `/api/requests/${r.requestId}/job`, { purchaseYear: 2024 }, as(winner))).body.code, 'requestHasJob');
  const d = await ok('POST', `/api/jobs/${job.job.jobId}/diagnosis`, { component: 'motor', causes: ['normal_wear'], severity: 'replace_part', spare: 'brand', photoKey: 'k', quote: { parts: 2000, labour: 600 } }, as(winner));
  assert.equal(d.ownerToken, undefined);
  assert.equal(d.job.ownerToken, undefined);
});

await test('all technicians declining closes the request and tells the customer; customers can cancel', async () => {
  const w = await world();
  const { ok, req, as } = w;
  const r = await ok('POST', '/public/requests', { ...REQUEST, techIds: ['ravi', 'imran'] });
  await ok('POST', `/api/requests/${r.requestId}/decline`, {}, as('ravi'));
  assert.equal((await ok('GET', '/api/requests', null, as('ravi'))).offers.length, 0);
  await ok('POST', `/api/requests/${r.requestId}/decline`, {}, as('imran'));
  const v = await ok('GET', `/public/requests/${r.requestId}`, null, null, { t: r.token });
  assert.equal(v.request.status, 'no_match');
  assert.ok(v.notifications.some((x) => x.key === 'cnotif.noMatch'));
  const r2 = await ok('POST', '/public/requests', REQUEST);
  assert.equal((await req('POST', `/public/requests/${r2.requestId}/cancel`, { t: 'nope' })).status, 403);
  await ok('POST', `/public/requests/${r2.requestId}/cancel`, { t: r2.token });
  assert.equal((await req('POST', `/api/requests/${r2.requestId}/accept`, {}, as('ravi'))).status, 409);
});

await test('public request routes are rate-limited per IP and photo keys are confined to uploads/req/', async () => {
  const w = await world({ requests: { createPerIp: 2, matchPerIp: 100, uploadPerIp: 1 } });
  const { req } = w;
  assert.equal((await req('POST', '/public/requests', REQUEST)).status, 200);
  assert.equal((await req('POST', '/public/requests', REQUEST)).status, 200);
  const third = await req('POST', '/public/requests', REQUEST);
  assert.equal(third.status, 429);
  assert.equal((await req('POST', '/public/requests', REQUEST, null, null, '203.0.113.99')).status, 200, 'another IP is not affected');
  const up = await req('POST', '/public/requests/uploads', { contentType: 'image/jpeg' });
  assert.match(up.body.key, /^uploads\/req\/\d{4}-\d\d-\d\d\/[A-Z0-9]{12}\.jpg$/);
  assert.equal((await req('POST', '/public/requests/uploads', { contentType: 'image/jpeg' })).status, 429);
  assert.equal((await req('POST', '/public/requests/uploads', { contentType: 'text/html' }, null, null, '203.0.113.5')).body.code, 'uploadType');
  const r = await req('POST', '/public/requests', { ...REQUEST, photoKey: 'uploads/ravi/secret.jpg' }, null, null, '203.0.113.7');
  const rec = await w.ctx.store.get(`REQUEST#${r.body.requestId}`, 'META');
  assert.equal(rec.photoKey, null, "someone else's upload key is ignored");
});

console.log('Transparent decisions');

await test('owner must select an option AND agree; technicians cannot decide for request jobs or move the fair range', async () => {
  const w = await world();
  const { ok, req, as } = w;
  const { jobId, ownerToken } = await requestToOptions(w, { diag: { fair: { low: 1, high: 999999, mid: 5 }, offerWarrantyDays: 90, techSuggests: 'repair_new', quote: { parts: 9000, labour: 1000 } } });
  const v = await ok('GET', `/public/owner/${jobId}`, null, null, { t: ownerToken });
  const want = fairRepairRange({ categoryId: 'washing_machine', componentId: 'control_board', brand: 'Brand X', severity: 'replace_part' });
  assert.deepEqual(v.build.fair, want, 'fair range comes from reference values only');
  assert.equal(v.build.options.find((o) => o.id === 'repair_new').quote.status, 'above');
  assert.equal(v.diagnosis.techSuggests, 'repair_new');
  for (const o of v.build.options) {
    assert.ok(o.terms, `${o.id} has terms`);
    assert.ok(['owner', 'technician', 'recycler'].includes(o.terms.payer));
    assert.ok(o.terms.lines.length >= 1 && o.terms.ownership && o.terms.material && o.terms.next);
  }
  assert.equal(v.build.options.find((o) => o.id === 'repair_new').terms.warrantyDays, 90);
  assert.equal(v.build.options.find((o) => o.id === 'recycle').terms.ownership, 'to_recycler');
  assert.equal(v.build.options.find((o) => o.id === 'harvest').terms.ownership, 'to_technician');
  // No option, no agreement, or a made-up option: nothing proceeds.
  for (const body of [{ option: 'repair_new' }, { option: 'repair_new', agree: 'yes' }, { agree: true }, { option: 'teleport', agree: true }]) {
    const r = await req('POST', `/public/owner/${jobId}/decision`, { t: ownerToken, ...body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await ok('GET', `/api/jobs/${jobId}`, null, as('ravi'))).job.status, 'awaiting_owner', 'still waiting for the owner');
  // The technician has no owner token for this job, so cannot use the owner route.
  assert.equal((await req('POST', `/public/owner/${jobId}/decision`, { t: undefined, option: 'sell', agree: true }, as('ravi'))).status, 403);
  const both = await Promise.all([1, 2].map(() => req('POST', `/public/owner/${jobId}/decision`, { t: ownerToken, option: 'repair_new', agree: true, consent: false })));
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 409], 'one decision only');
  const job = await w.ctx.store.get(`JOB#${jobId}`, 'META');
  assert.equal(job.decision.option, 'repair_new');
  assert.equal(job.decisionAudit.channel, 'customer_request');
  assert.equal(job.decisionAudit.dataConsent, false);
  assert.ok(job.decisionAudit.agreedAt && job.decisionAudit.terms.total === 10000);
  assert.ok(job.timeline.some((e) => e.key === 'event.ownerAgreed'));
  const after = await ok('GET', `/public/owner/${jobId}`, null, null, { t: ownerToken });
  assert.equal(after.journey.stages.find((s) => s.id === 'decision').state, 'done');
  // Walk-in decisions record the owner-link channel.
  const wj = await ok('POST', '/api/jobs', { category: 'ceiling_fan', brand: 'Brand Y', model: 'CF-48', purchaseYear: 2020, ownerPhone: '9333333333' }, as('ravi'));
  await ok('POST', `/api/jobs/${wj.job.jobId}/diagnosis`, { component: 'capacitor', causes: ['heat'], severity: 'replace_part', spare: 'local', photoKey: 'k', quote: { parts: 180, labour: 150 } }, as('ravi'));
  await ok('POST', `/public/owner/${wj.job.jobId}/decision`, { t: wj.job.ownerToken, option: 'recycle', agree: true });
  assert.equal((await w.ctx.store.get(`JOB#${wj.job.jobId}`, 'META')).decisionAudit.channel, 'owner_link');
});

await test('journey timeline: pure stages for walk-in, request, refusal and recycling', () => {
  const j0 = journeyOf({ request: { createdAt: 'a', status: 'open' } });
  assert.deepEqual(j0.stages.map((s) => s.state), ['done', 'current', 'todo', 'todo', 'todo', 'todo']);
  assert.equal(journeyOf({ request: { createdAt: 'a', status: 'cancelled' } }).stages[1].state, 'stopped');
  const walk = journeyOf({ job: { createdAt: 'a', status: 'awaiting_owner', category: 'ceiling_fan', diagnosis: { component: 'capacitor', at: 'b' } } });
  assert.deepEqual(walk.stages.map((s) => s.state), ['done', 'done', 'done', 'current', 'todo', 'todo']);
  const notWorking = journeyOf({ job: { createdAt: 'a', status: 'repaired', category: 'ceiling_fan', diagnosis: { component: 'capacitor', at: 'b' }, decision: { option: 'repair_new', at: 'c' }, repair: { at: 'd' }, verified: false } });
  assert.equal(notWorking.stages.at(-1).state, 'problem');
  const rec = journeyOf({ job: { createdAt: 'a', status: 'recycling', category: 'ceiling_fan', diagnosis: { component: 'capacitor', at: 'b' }, decision: { option: 'recycle', at: 'c' } }, pickups: [{ wholeProduct: true, status: 'DELIVERED', createdAt: 'x', estKg: 5, weightKg: 5 }] });
  assert.equal(rec.stages.at(-1).state, 'todo');
  assert.equal(rec.verified, false);
});

console.log('Brand PDF reports');

const pdfText = (b64) => Buffer.from(b64, 'base64').toString('latin1');
/** Structural check: header, trailer, and every xref offset points at "<n> 0 obj". */
function checkPdf(raw) {
  assert.ok(raw.startsWith('%PDF-1.4\n'));
  assert.ok(raw.trimEnd().endsWith('%%EOF'));
  const startxref = Number(raw.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(raw.slice(startxref, startxref + 4), 'xref');
  const [, count] = raw.slice(startxref).match(/xref\n0 (\d+)\n/);
  const entries = raw.slice(startxref).split('\n').slice(3, 3 + Number(count) - 1);
  entries.forEach((e, i) => assert.ok(raw.slice(Number(e.slice(0, 10))).startsWith(`${i + 1} 0 obj`), `xref entry ${i + 1}`));
  for (const m of raw.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) assert.equal(raw.slice(m.index + m[0].length + Number(m[1]), m.index + m[0].length + Number(m[1]) + 10), '\nendstream');
  return (raw.match(/\/Type \/Page /g) || []).length;
}
const textOf = (raw) => [...raw.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1].replace(/\\(.)/g, '$1')).join(' ');

await test('PDF writer: valid structure, escaping, wrapping and sanitising', () => {
  const raw = Buffer.from(renderPdf({ info: { title: 'T (x)', created: '2026-10-09T06:00:00Z' }, footer: 'f', blocks: [{ h1: 'A (b) \\ c' }, { p: 'word '.repeat(400) }, { table: { cols: [{ label: 'x', w: 0.5 }, { label: 'y', w: 0.5, align: 'right' }], rows: Array.from({ length: 80 }, (_, i) => [`row ${i}`, String(i)]) } }] })).toString('latin1');
  assert.ok(checkPdf(raw) >= 2, 'long content flows onto more pages');
  assert.ok(textOf(raw).includes('A (b) \\ c'));
  assert.equal(sanitize('₹3,200 – “ok” • हिंदी'), 'Rs 3,200 - "ok" - ?????');
  assert.ok(wrap('x'.repeat(500), 100, 10).every((l) => l.length > 0));
});

await test('brand PDF: brand scope enforced on the server, filters, sample size, synthetic label, no personal data', async () => {
  const w = await world();
  const { ok, req, as } = w;
  // Real, consented records with personal data around them.
  for (let i = 0; i < 3; i++) {
    const phone = `98765000${10 + i}`;
    const j = await ok('POST', '/api/jobs', { category: 'washing_machine', brand: 'Brand X', model: 'WM-7', purchaseYear: 2022, ownerName: `Owner Name${i}`, ownerPhone: phone, pincode: '282009' }, as('ravi'));
    await ok('POST', `/api/jobs/${j.job.jobId}/diagnosis`, { component: 'control_board', causes: ['voltage_surge'], severity: 'replace_part', spare: 'brand', photoKey: 'uploads/ravi/face.jpg', note: 'Customer at Flat 12 MG Road', quote: { parts: 3000, labour: 600 } }, as('ravi'));
    await ok('POST', `/public/owner/${j.job.jobId}/decision`, { t: j.job.ownerToken, option: 'recycle', agree: true, consent: true });
  }
  // Only 3 real records: insufficient, and labelled real.
  let r = await ok('GET', '/api/insights/pdf', null, as('priya'), { model: 'WM-7' });
  let raw = pdfText(r.base64);
  checkPdf(raw);
  let text = textOf(raw);
  assert.match(r.filename, /^punarnava-Brand-X-WM-7-2026-10-09\.pdf$/);
  assert.equal(r.contentType, 'application/pdf');
  assert.equal(r.facts.sampleSize, 3);
  assert.equal(r.facts.realRecords, 3);
  assert.equal(r.facts.insufficient, true);
  assert.ok(text.includes('INSUFFICIENT DATA'));
  assert.ok(text.includes('Sample size') && text.includes('3 records: 3 real, 0 synthetic'));
  assert.ok(text.includes('Insufficient data: no component of WM-7'), 'no per-component findings below the minimum sample');
  // Add labelled synthetic data and filter by months.
  await ok('POST', '/api/admin/seed', { count: 3000 }, as('admin1', ['admin']));
  r = await ok('GET', '/api/insights/pdf', null, as('priya'), { model: 'WM-7', from: '2026-01', to: '2026-06', brand: 'Brand Y' });
  raw = pdfText(r.base64);
  const pages = checkPdf(raw);
  text = textOf(raw);
  assert.ok(pages >= 2);
  assert.equal(r.facts.brand, 'Brand X', "a brand user's brand param is ignored");
  assert.ok(text.includes('Brand X') && !text.includes('Brand Y'));
  assert.ok(text.includes('Scope (model / category)') && text.includes('Model WM-7'));
  assert.ok(text.includes('Date filter') && text.includes('2026-01 to 2026-06'));
  assert.ok(text.includes('CONTAINS SYNTHETIC DEMO DATA'));
  assert.ok(r.facts.syntheticRecords > 0 && r.facts.realRecords === 3);
  assert.ok(text.includes('In period'));
  assert.ok(text.includes('Part needs replacing 100% (n=3)'), 'severity comes from the 3 real records only');
  assert.ok(text.includes('Methodology'));
  assert.ok(text.includes('never ranked by raw counts') || text.includes('never used to rank'));
  for (const pii of ['Owner Name', '9876500010', '282009', 'Flat 12', 'face.jpg', 'uploads/', 'J-', 'ravi', 'Ravi']) assert.ok(!raw.includes(pii), `PDF contains ${pii}`);
  assert.ok(!JSON.stringify(r.facts).includes('Owner Name'));
  // Category report, admin choosing a brand, other brands' models, roles, bad periods.
  const cat = await ok('GET', '/api/insights/pdf', null, as('priya'), { category: 'washing_machine' });
  assert.ok(cat.facts.models.includes('WM-7') && cat.facts.models.includes('WM-9'));
  assert.deepEqual(cat.facts.models, [...cat.facts.models].sort(), 'models are listed alphabetically, not by volume');
  assert.equal((await req('GET', '/api/insights/pdf', null, as('priya'), { model: 'RO-6' })).status, 404, "another brand's model");
  assert.equal((await req('GET', '/api/insights/pdf', null, as('ravi'), { model: 'WM-7' })).status, 403, 'technicians cannot download brand reports');
  assert.equal((await req('GET', '/api/insights/pdf', null, null, { model: 'WM-7' })).status, 401);
  assert.equal((await req('GET', '/api/insights/pdf', null, as('priya'), { model: 'WM-7', from: '2026-09', to: '2026-01' })).body.code, 'badPeriod');
  assert.equal((await req('GET', '/api/insights/pdf', null, as('priya'), { model: 'WM-7', from: '2026-13' })).body.code, 'badPeriod');
  const adm = await ok('GET', '/api/insights/pdf', null, as('admin1', ['admin']), { brand: 'Brand Y', model: 'RO-6' });
  assert.equal(adm.facts.brand, 'Brand Y');
  await w.ctx.store.put({ PK: 'USER#pending', SK: 'PROFILE', type: 'profile', userId: 'pending', role: 'brand', status: 'pending', brandId: 'Brand X', name: 'P', complete: true });
  assert.equal((await req('GET', '/api/insights/pdf', null, as('pending'), { model: 'WM-7' })).body.code, 'pendingApproval');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
