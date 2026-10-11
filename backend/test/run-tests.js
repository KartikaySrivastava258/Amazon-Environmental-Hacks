// End-to-end tests of the core logic using the in-memory adapter.
// Runs the same api/workflow/consumers code the Lambdas run.
import assert from 'node:assert/strict';
import { createMemoryContext, createFakeSpeech } from '../src/core/adapters/memory.js';
import { handle } from '../src/core/api.js';
import { buildOptions } from '../src/core/decision.js';
import { generateRecords } from '../src/core/synthetic.js';
import { aggregateDelta, mergeDeltas, buildModelReport } from '../src/core/insights.js';
import { MSG, format, LANG_CODES } from '../src/core/messages.js';
import { readFileSync, readdirSync } from 'node:fs';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; }
};

const ctx = createMemoryContext({ config: { demoMode: true } });
let clock = Date.UTC(2026, 9, 9, 6, 0, 0);
ctx.now = () => clock;
const advance = async (ms) => { clock += ms; await ctx.runDueTimers(); };

const as = (userId, groups = []) => ({ userId, groups, claims: {} });
const call = async (method, path, body, auth, query) => {
  const res = await handle(ctx, { method, path, body, auth, query });
  return res;
};
const okCall = async (...args) => {
  const res = await call(...args);
  assert.equal(res.status, 200, `${args[0]} ${args[1]} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
const profile = (userId, role, extra = {}) => ctx.store.put({ PK: `USER#${userId}`, SK: 'PROFILE', type: 'profile', userId, role, status: 'active', name: extra.name || userId, trust: 50, jobs: 0, verifiedJobs: 0, complete: true, ...extra, GSI1PK: `ROLE#${role}`, GSI1SK: `active#${role === 'brand' ? extra.brandId : extra.area || ''}#${userId}` });

console.log('Punarnava core tests');

await test('decision engine recommends repair for a young product', () => {
  const r = buildOptions({ category: 'washing_machine', brand: 'Brand X', model: 'WM-7', ageYears: 3.5, diagnosis: { component: 'control_board', severity: 'replace_part', spare: 'brand', quote: { parts: 3000, labour: 600 } } });
  assert.equal(r.recommended, 'repair_new');
  assert.ok(r.fair.low < r.fair.high);
  assert.equal(r.quote.status, 'within');
  assert.deepEqual(r.options.map((o) => o.id).slice(-2), ['harvest', 'recycle']);
});

await test('decision engine flags an inflated quote and prefers a reused part', () => {
  const r = buildOptions({ category: 'washing_machine', brand: 'Brand X', model: 'WM-7', ageYears: 3.5, diagnosis: { component: 'control_board', severity: 'replace_part', spare: 'brand', quote: { parts: 6000, labour: 1000 } } }, { partId: 'PT-1', price: 900, compatibility: 'exact' });
  assert.equal(r.quote.status, 'above');
  assert.equal(r.recommended, 'repair_reused');
  assert.equal(r.options[0].id, 'repair_reused');
});

await test('no repair option when the spare is missing; old product → not repair', () => {
  const r = buildOptions({ category: 'mixer_grinder', brand: 'Brand Z', model: 'MG-750', ageYears: 7, diagnosis: { component: 'motor', severity: 'replace_part', spare: 'none', quote: {} } });
  assert.ok(!r.options.some((o) => o.id === 'repair_new'));
  assert.notEqual(r.recommended, 'repair_new');
});

await test('synthetic data contains the planted patterns', () => {
  const records = generateRecords({ count: 6000, now: clock });
  const items = mergeDeltas(records.flatMap(aggregateDelta));
  const get = (pk, sk) => items.find((i) => i.pk === pk && i.sk === sk);
  const flat = (it) => ({ ...it.set, ...it.add });
  const total = flat(get('AGG#Brand X#WM-7', 'TOTAL'));
  const comps = items.filter((i) => i.pk === 'AGG#Brand X#WM-7' && i.sk.startsWith('COMP#')).map(flat);
  const report = buildModelReport(total, comps);
  assert.equal(report.components[0].component, 'control_board');
  assert.ok(report.recommendations.some((r) => r.rule === 'surge' && r.component === 'control_board'), 'surge rule');
  const surge = report.recommendations.find((r) => r.rule === 'surge');
  assert.deepEqual(surge.params.comp, { comp: ['washing_machine', 'control_board'] });
  assert.match(surge.action, /surge protection/);
  assert.ok(report.recommendations.some((r) => r.rule === 'defect' && r.component === 'door_lock'), 'defect rule');
});

// ── Full journey ──
await profile('ravi', 'technician', { name: 'Ravi Kumar', shop: 'Ravi Electricals', pincode: '282001', area: '282' });
await profile('imran', 'technician', { name: 'Imran', shop: 'Imran Repairs', pincode: '282005', area: '282' });
await profile('shyam', 'collector', { name: 'Shyam', pincode: '282002', area: '282' });
await profile('green', 'recycler', { name: 'GreenCycle Recyclers', pincode: '282007', area: '282', orgType: 'both', regNo: 'CPCB-UP-0000' });
await profile('priya', 'brand', { name: 'Priya', brandId: 'Brand X' });
const RAVI = as('ravi'), IMRAN = as('imran'), SHYAM = as('shyam'), GREEN = as('green'), PRIYA = as('priya'), ADMIN = as('admin1', ['admin']);

let jobA, ownerA, jobB, ownerB, partId;

await test('technician creates a job and passport', async () => {
  const b = await okCall('POST', '/api/jobs', { category: 'washing_machine', brand: 'Brand X', model: 'WM-7', purchaseYear: 2022, ownerName: 'Sunita', ownerPhone: '+91 98765 43210' }, RAVI);
  jobA = b.job; ownerA = b.job.ownerToken;
  assert.equal(jobA.status, 'new');
  assert.match(b.passport.pid, /^P-/);
});

await test('diagnosis without photo is rejected', async () => {
  const r = await call('POST', `/api/jobs/${jobA.jobId}/diagnosis`, { component: 'control_board', causes: ['voltage_surge'], severity: 'replace_part', spare: 'brand' }, RAVI);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'missingField');
  assert.deepEqual(r.body.params, { field: { msg: 'field.photoKey' } });
  assert.equal(r.body.error, 'Please fill in: Photo');
});

await test('diagnosis starts the workflow and options reach the owner', async () => {
  const b = await okCall('POST', `/api/jobs/${jobA.jobId}/diagnosis`, { component: 'control_board', causes: ['voltage_surge'], severity: 'replace_part', spare: 'brand', photoKey: 'uploads/ravi/a.jpg', quote: { parts: 3000, labour: 600 } }, RAVI);
  assert.equal(b.job.status, 'awaiting_owner');
  const v = await okCall('GET', `/public/owner/${jobA.jobId}`, null, null, { t: ownerA });
  assert.ok(v.canDecide);
  assert.ok(v.build.options.length >= 3);
});

await test('wrong owner token is refused', async () => {
  const r = await call('GET', `/public/owner/${jobA.jobId}`, null, null, { t: 'nope' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'ownerLink');
});

await test('owner chooses to harvest; parts listed; pickup requested', async () => {
  await okCall('POST', `/public/owner/${jobA.jobId}/decision`, { agree: true, t: ownerA, option: 'harvest', consent: true });
  const j = (await okCall('GET', `/api/jobs/${jobA.jobId}`, null, RAVI)).job;
  assert.equal(j.status, 'awaiting_harvest');
  const inv = await okCall('GET', '/api/inventory', null, RAVI);
  assert.equal(inv.products.length, 1);
  const h = await okCall('POST', `/api/passports/${j.pid}/harvest`, { parts: [{ component: 'motor', condition: 'working', price: 1400 }, { component: 'door_lock', condition: 'working', price: 150 }, { component: 'control_board', condition: 'dead' }] }, RAVI);
  assert.equal(h.parts.length, 2);
  assert.ok(h.pickup.items.some((i) => i.hazardous), 'capacitor goes to recycler');
  partId = h.parts.find((p) => p.component === 'door_lock').partId;
});

await test('a second job finds the reused part and the owner picks it', async () => {
  // Imran saved a search earlier? Create one now and check part matching on a new listing later.
  const b = await okCall('POST', '/api/jobs', { category: 'washing_machine', brand: 'Brand X', model: 'WM-9', purchaseYear: 2023, ownerName: 'Meena', ownerPhone: '9123456780', pincode: '282004' }, IMRAN);
  jobB = b.job; ownerB = b.job.ownerToken;
  assert.equal(jobB.status, 'new');
  await okCall('POST', `/api/jobs/${jobB.jobId}/diagnosis`, { component: 'door_lock', causes: ['manufacturing_defect'], severity: 'replace_part', spare: 'local', photoKey: 'k', quote: { parts: 700, labour: 300 } }, IMRAN);
  const v = await okCall('GET', `/public/owner/${jobB.jobId}`, null, null, { t: ownerB });
  const reused = v.build.options.find((o) => o.id === 'repair_reused');
  assert.ok(reused, 'reused option offered');
  assert.equal(reused.partId, partId);
  await okCall('POST', `/public/owner/${jobB.jobId}/decision`, { agree: true, t: ownerB, option: 'repair_reused', consent: true });
  const mine = await okCall('GET', '/api/parts/mine', null, IMRAN);
  assert.equal(mine.buying[0].partId, partId);
});

await test('seller hands over, technician completes repair, lineage recorded', async () => {
  await okCall('POST', `/api/parts/${partId}/handover`, {}, RAVI);
  await okCall('POST', `/api/jobs/${jobB.jobId}/complete`, { partSource: 'reused', partId, amount: 450, warrantyDays: 90 }, IMRAN);
  const j = (await okCall('GET', `/api/jobs/${jobB.jobId}`, null, IMRAN)).job;
  assert.equal(j.status, 'repaired');
  assert.equal(j.warranty.days, 90);
  const pass = await okCall('GET', `/public/passport/${jobA.pid}`);
  assert.ok(pass.events.some((e) => e.kind === 'part_reused'), 'source passport shows reuse');
  const impact = (await okCall('GET', '/public/impact')).impact;
  assert.equal(impact.partsReused, 1);
  assert.equal(impact.productsKeptInUse, 1);
  assert.equal(impact.repairsLogged, 2);
});

await test('owner confirms; 30-day follow-up fires and is answered', async () => {
  await okCall('POST', `/public/owner/${jobB.jobId}/confirm`, { t: ownerB, working: true });
  await advance(6 * 60 * 1000);
  const v = await okCall('GET', `/public/owner/${jobB.jobId}`, null, null, { t: ownerB });
  assert.equal(v.followup?.due, true);
  await okCall('POST', `/public/owner/${jobB.jobId}/followup`, { t: ownerB, working: true });
});

await test('kabadi connect: accept, gates enforced, deliver, confirm, payout', async () => {
  const open = await okCall('GET', '/api/pickups/open', null, SHYAM);
  const p = open.pickups[0];
  await okCall('POST', `/api/pickups/${p.pickupId}/accept`, {}, SHYAM);
  const again = await call('POST', `/api/pickups/${p.pickupId}/accept`, {}, SHYAM);
  assert.equal(again.status, 409);
  const noGates = await call('POST', `/api/pickups/${p.pickupId}/collect`, { weightKg: 20, photoKey: 'x' }, SHYAM);
  assert.equal(noGates.status, 400);
  assert.equal(noGates.body.code, 'gatesMissing');
  assert.deepEqual(noGates.body.params.gate, { gate: 'capacitors_discharged' });
  const heavy = await call('POST', `/api/pickups/${p.pickupId}/collect`, { weightKg: 5000, photoKey: 'x' }, SHYAM);
  assert.equal(heavy.body.code, 'outOfRange');
  assert.equal(heavy.body.params.field.msg, 'field.weight');
  await okCall('POST', `/api/pickups/${p.pickupId}/collect`, { weightKg: 20, photoKey: 'x', gates: { capacitors_discharged: true } }, SHYAM);
  await okCall('POST', `/api/pickups/${p.pickupId}/deliver`, { recyclerId: 'green' }, SHYAM);
  const c = await okCall('POST', `/api/pickups/${p.pickupId}/confirm`, { weightKg: 19.5 }, GREEN);
  assert.equal(c.payout, Math.round(19.5 * 18));
  const impact = (await okCall('GET', '/public/impact')).impact;
  assert.equal(impact.kgToRecycler, 19.5);
});

await test('sell → refurbisher → ReLife listing → sold', async () => {
  const b = await okCall('POST', '/api/jobs', { category: 'smartphone', brand: 'Brand Z', model: 'PH-A5', purchaseYear: 2023, ownerName: 'Arjun', ownerPhone: '9988776655' }, RAVI);
  await okCall('POST', `/api/jobs/${b.job.jobId}/diagnosis`, { component: 'display', causes: ['physical_damage'], severity: 'replace_part', spare: 'local', photoKey: 'k', quote: { parts: 2800, labour: 300 } }, RAVI);
  const v = await okCall('GET', `/public/owner/${b.job.jobId}`, null, null, { t: b.job.ownerToken });
  const choice = v.build.options.find((o) => o.id === 'sell') ? 'sell' : 'harvest';
  await okCall('POST', `/public/owner/${b.job.jobId}/decision`, { agree: true, t: b.job.ownerToken, option: choice, consent: false });
  const pid = b.job.pid;
  await okCall('POST', `/api/passports/${pid}/transfer`, { refurbisherId: 'green' }, RAVI);
  const bad = await call('POST', '/api/listings', { pid, price: 6000, photoKey: 'p', checklist: { tested: true, safety: true, cleaned: true } }, GREEN);
  assert.equal(bad.status, 400, 'data wipe required for phones');
  const l = await okCall('POST', '/api/listings', { pid, price: 6000, photoKey: 'p', warrantyMonths: 3, checklist: { tested: true, safety: true, cleaned: true, data_wiped: true } }, GREEN);
  const market = await okCall('GET', '/public/market');
  assert.equal(market.listings.length, 1);
  await okCall('POST', `/public/market/${l.listing.listingId}/interest`, { name: 'Kiran', phone: '9876501234' });
  await okCall('POST', `/api/listings/${l.listing.listingId}/sold`, { buyerPhone: '9876501234' }, GREEN);
  const impact = (await okCall('GET', '/public/impact')).impact;
  assert.equal(impact.productsResold, 1);
  assert.equal(impact.decisionsWithoutConsent, 1, 'no-consent decision not aggregated');
});

await test('owner timeout closes the job with no decision', async () => {
  const b = await okCall('POST', '/api/jobs', { category: 'ceiling_fan', brand: 'Brand Y', model: 'CF-48', purchaseYear: 2020, ownerPhone: '9000000001' }, RAVI);
  await okCall('POST', `/api/jobs/${b.job.jobId}/diagnosis`, { component: 'capacitor', causes: ['heat'], severity: 'replace_part', spare: 'local', photoKey: 'k', quote: { parts: 180, labour: 150 } }, RAVI);
  await advance(16 * 60 * 1000);
  const j = (await okCall('GET', `/api/jobs/${b.job.jobId}`, null, RAVI)).job;
  assert.equal(j.status, 'no_decision');
  const late = await call('POST', `/public/owner/${b.job.jobId}/decision`, { agree: true, t: b.job.ownerToken, option: 'repair_new', consent: true });
  assert.equal(late.status, 409);
});

await test('role checks: collector cannot create jobs; brand sees only its brand', async () => {
  const r = await call('POST', '/api/jobs', {}, SHYAM);
  assert.equal(r.status, 403);
  await okCall('POST', '/api/admin/seed', { count: 6000 }, ADMIN);
  const m = await okCall('GET', '/api/insights/models', { }, PRIYA, { brand: 'Brand Y' });
  assert.equal(m.brand, 'Brand X');
});

await test('seeded report + anomaly detector flags the door-lock spike', async () => {
  const a = await okCall('POST', '/api/admin/anomaly', {}, ADMIN);
  assert.equal(a.result.detector, 'robust_z');
  const rep = await okCall('GET', '/api/insights/report', null, PRIYA, { model: 'WM-7' });
  assert.ok(rep.report.alerts.some((x) => x.component === 'door_lock'), JSON.stringify(a.result));
  assert.ok(rep.report.syntheticShare > 0.9);
  const notes = await okCall('GET', '/api/notifications', null, PRIYA);
  const warn = notes.notifications.find((n) => n.key === 'notif.earlyWarning');
  assert.ok(warn, 'early warning stored with a key');
  assert.ok(warn.title.startsWith('Early warning'));
  assert.equal(warn.params.model, 'WM-7');
  const alert = rep.report.alerts.find((x) => x.component === 'door_lock');
  assert.equal(alert.key, 'alert.spike');
  assert.equal(alert.message, format('alert.spike', alert.params));
  const scores = await okCall('GET', '/public/scores');
  assert.ok(scores.models.filter((x) => x.sufficient).length >= 8);
});

await test('saved search notifies when a matching part is listed', async () => {
  await okCall('POST', '/api/searches', { category: 'washing_machine', component: 'drain_pump', brand: 'Brand X', model: 'WM-7' }, IMRAN);
  const b = await okCall('POST', '/api/jobs', { category: 'washing_machine', brand: 'Brand X', model: 'WM-9', purchaseYear: 2015, ownerPhone: '9000000002' }, RAVI);
  await okCall('POST', `/api/jobs/${b.job.jobId}/diagnosis`, { component: 'drum_bearing', causes: ['normal_wear'], severity: 'replace_part', spare: 'none', photoKey: 'k', quote: {} }, RAVI);
  await okCall('POST', `/public/owner/${b.job.jobId}/decision`, { agree: true, t: b.job.ownerToken, option: 'harvest', consent: true });
  await okCall('POST', `/api/passports/${b.job.pid}/harvest`, { parts: [{ component: 'drain_pump', condition: 'working', price: 300 }] }, RAVI);
  const n = await okCall('GET', '/api/notifications', null, IMRAN);
  const match = n.notifications.find((x) => x.key === 'notif.partMatch');
  assert.ok(match, 'part match stored with a key');
  assert.deepEqual(match.params.comp, { comp: ['washing_machine', 'drain_pump'] });
  assert.ok(match.title.includes('Drain pump'));
  assert.match(format('notif.partMatch.title', match.params, 'hi'), /^आपका ढूँढा पार्ट मिला: /);
});


console.log('New features');
await test('loading synthetic data twice replaces instead of doubling; count 0 removes it', async () => {
  const once = (await ctx.store.get('AGG#Brand X#WM-7', 'TOTAL')).n_syn;
  await okCall('POST', '/api/admin/seed', { count: 6000 }, ADMIN);
  assert.equal((await ctx.store.get('AGG#Brand X#WM-7', 'TOTAL')).n_syn, once);
  await okCall('POST', '/api/admin/seed', { count: 0 }, ADMIN);
  assert.equal((await ctx.store.get('AGG#Brand X#WM-7', 'TOTAL')).n_syn, 0);
  const rep = await okCall('GET', '/api/insights/report', null, PRIYA, { model: 'WM-7' });
  assert.ok(!rep.report.alerts.some((a) => a.synthetic), 'synthetic alerts removed');
  await okCall('POST', '/api/admin/seed', { count: 6000 }, ADMIN);
  assert.equal((await ctx.store.get('AGG#Brand X#WM-7', 'TOTAL')).n_syn, once);
});

await test('admin suspends and restores a user', async () => {
  await okCall('POST', '/api/admin/users/status', { userId: 'imran', status: 'suspended' }, ADMIN);
  const r = await call('GET', '/api/jobs', null, IMRAN);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'suspended');
  assert.match(r.body.error, /suspended/);
  await okCall('POST', '/api/admin/users/status', { userId: 'imran', status: 'active' }, ADMIN);
  await okCall('GET', '/api/jobs', null, IMRAN);
  const users = await okCall('GET', '/api/admin/users', null, ADMIN);
  assert.ok(users.users.length >= 5);
});

await test('an expired reservation is relisted and both technicians are told', async () => {
  const listed = await ctx.store.query({ index: 'GSI2', pk: 'COMP#washing_machine#drain_pump', skPrefix: 'LISTED#' });
  const pid = listed[0].partId;
  await okCall('POST', `/api/parts/${pid}/reserve`, {}, IMRAN);
  await advance(25 * 3600 * 1000);
  const p = await ctx.store.get(`PART#${pid}`, 'META');
  assert.equal(p.status, 'LISTED');
  const n = await okCall('GET', '/api/notifications', null, IMRAN);
  const exp = n.notifications.find((x) => x.key === 'notif.reservationExpired');
  assert.ok(exp, 'reservation expiry stored with a key');
  assert.ok(exp.title.startsWith('Reservation expired'));
  assert.equal(exp.params.partId, pid);
});

await test('a scanned QR tag attaches the new job to the existing passport', async () => {
  const first = await okCall('POST', '/api/jobs', { category: 'ceiling_fan', brand: 'Brand Q', model: 'CF-36', purchaseYear: 2019, ownerPhone: '9111111111' }, RAVI);
  const second = await okCall('POST', '/api/jobs', { category: 'ceiling_fan', brand: 'x', model: 'y', purchaseYear: 2019, ownerPhone: '9222222222', pid: first.passport.pid }, IMRAN);
  assert.equal(second.passport.pid, first.passport.pid);
  assert.equal(second.job.brand, 'Brand Q');
  const wrong = await call('POST', '/api/jobs', { category: 'smartphone', brand: 'x', model: 'y', purchaseYear: 2019, ownerPhone: '9222222222', pid: first.passport.pid }, IMRAN);
  assert.equal(wrong.status, 400);
});

await test('voice note uploads are accepted and only the owner of the upload can attach it', async () => {
  const up = await okCall('POST', '/api/uploads', { contentType: 'audio/webm;codecs=opus' }, RAVI);
  assert.match(up.key, /\.webm$/);
  const b = await okCall('POST', '/api/jobs', { category: 'mixer_grinder', brand: 'Brand X', model: 'MG-500', purchaseYear: 2023, ownerPhone: '9333333333' }, RAVI);
  await okCall('POST', `/api/jobs/${b.job.jobId}/diagnosis`, { component: 'coupler', causes: ['normal_wear'], severity: 'replace_part', spare: 'local', photoKey: 'k', voiceNoteKey: up.key, quote: { parts: 120, labour: 200 } }, RAVI);
  const j = (await okCall('GET', `/api/jobs/${b.job.jobId}`, null, RAVI)).job;
  assert.equal(j.diagnosis.voiceNoteKey, up.key);
  const bad = await call('POST', '/api/uploads', { contentType: 'application/pdf' }, RAVI);
  assert.equal(bad.status, 400);
});

console.log('Languages');
const placeholders = (v) => [...new Set((typeof v === 'object' ? Object.values(v).join(' ') : v).match(/\{\w+\}/g) || [])].sort().join(',');
await test('every message has five non-empty translations with the same placeholders', () => {
  assert.deepEqual(LANG_CODES, ['en', 'hi', 'mr', 'bn', 'ta']);
  for (const [key, tuple] of Object.entries(MSG)) {
    assert.equal(tuple.length, 5, `${key}: 5 languages`);
    for (const [i, v] of tuple.entries()) {
      const forms = typeof v === 'object' ? Object.values(v) : [v];
      assert.ok(forms.length && forms.every((f) => typeof f === 'string' && f.trim()), `${key}[${LANG_CODES[i]}] empty`);
      assert.equal(placeholders(v), placeholders(tuple[0]), `${key}[${LANG_CODES[i]}] placeholders`);
      if (i > 0 && typeof v === 'string') assert.notEqual(v, tuple[0], `${key}[${LANG_CODES[i]}] is still English`);
    }
  }
});

await test('every message key and error code used in core exists', () => {
  const dir = new URL('../src/core/', import.meta.url);
  const src = readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'messages.js').map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const missing = [];
  for (const [, code] of src.matchAll(/apiError\(\d+, '(\w+)'/g)) if (!MSG[`err.${code}`]) missing.push(`err.${code}`);
  for (const [, key] of src.matchAll(/(?<!emit\()'((?:notif|event|sms|pickup|alert|cond|check|field)\.\w+)'/g)) {
    if (key.startsWith('notif.')) { if (!MSG[`${key}.title`] || !MSG[`${key}.body`]) missing.push(key); }
    else if (!MSG[key]) missing.push(key);
  }
  assert.deepEqual(missing, []);
  for (const f of ['category', 'brand', 'model', 'purchaseYear', 'ownerPhone', 'component', 'severity', 'spare', 'photoKey', 'partId', 'refurbisherId', 'name', 'phone', 'pid', 'price', 'userId', 'status']) assert.ok(MSG[`field.${f}`], `field.${f}`);
});

await test('format fills params, resolves typed references and falls back', () => {
  assert.equal(format('err.noJob', { id: 'J-1' }, 'hi'), 'काम J-1 नहीं मिला।');
  assert.equal(format('event.diagnosed', { comp: { comp: ['washing_machine', 'motor'] } }), 'Diagnosed: Motor');
  assert.match(format('event.diagnosed', { comp: { comp: ['washing_machine', 'motor'] } }, 'hi'), /मोटर/);
  assert.equal(format('notif.payout.title', { money: { money: 3200 }, pickupId: 'K-1' }), '₹3,200 for pickup K-1');
  assert.equal(format('event.ownerChose', { opt: { opt: 'sell' } }, 'ta'), 'உரிமையாளர் தேர்ந்தெடுத்தது: இருக்கும் நிலையிலேயே விற்கவும்');
  assert.equal(format('err.missingField', { field: { msg: 'field.weight' } }, 'mr'), 'कृपया भरा: वजन');
  assert.equal(format('event.harvestDone', { n: 1, pickupId: 'K-2' }), 'Harvested 1 part; pickup K-2 requested for the rest');
  assert.equal(format('event.harvestDone', { n: 3, pickupId: 'K-2' }), 'Harvested 3 parts; pickup K-2 requested for the rest');
  assert.equal(format('notif.newPickup.body', { cat: { cat: 'ceiling_fan' }, area: { area: '999' } }), 'Ceiling fan, area: Area 999xxx');
  assert.equal(format('err.pickBrand', {}, 'xx'), 'Choose a brand.');
  assert.equal(format('no.such.key'), 'no.such.key');
});

await test('timeline and passport events store key and params', async () => {
  const j = (await okCall('GET', `/api/jobs/${jobB.jobId}`, null, IMRAN)).job;
  assert.equal(j.timeline[0].key, 'event.jobCreated');
  assert.equal(j.timeline[0].text, 'Job card created');
  const chose = j.timeline.find((e) => e.key === 'event.ownerChose');
  assert.deepEqual(chose.params, { opt: { opt: 'repair_reused' } });
  const pass = await okCall('GET', `/public/passport/${jobA.pid}`);
  const reused = pass.events.find((e) => e.kind === 'part_reused');
  assert.equal(reused.key, 'event.partReused');
  assert.ok(reused.text.startsWith('Its Door lock'));
});

await test('owner language: stored on the job, updated by the owner page, used for SMS', async () => {
  const state = {};
  const c2 = createMemoryContext({ state, config: { demoMode: true, enableSms: true, appUrl: 'https://app.test' } });
  let t2 = Date.UTC(2026, 9, 9, 6, 0, 0);
  c2.now = () => t2;
  const call2 = (method, path, body, auth, query) => handle(c2, { method, path, body, auth, query });
  await c2.store.put({ PK: 'USER#lata', SK: 'PROFILE', type: 'profile', userId: 'lata', role: 'technician', status: 'active', name: 'Lata', shop: 'Lata Repairs', pincode: '411001', area: '411', trust: 50, jobs: 0, complete: true, GSI1PK: 'ROLE#technician', GSI1SK: 'active#411#lata' });
  const LATA = as('lata');
  const bad = await call2('POST', '/api/jobs', { category: 'ceiling_fan', brand: 'Brand Y', model: 'CF-48', purchaseYear: 2020, ownerPhone: '9444444444', ownerLang: 'fr' }, LATA);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'badLang');
  const b = (await call2('POST', '/api/jobs', { category: 'ceiling_fan', brand: 'Brand Y', model: 'CF-48', purchaseYear: 2020, ownerPhone: '9444444444', ownerLang: 'mr' }, LATA)).body;
  assert.equal(b.job.ownerLang, 'mr');
  const d = await call2('POST', `/api/jobs/${b.job.jobId}/diagnosis`, { component: 'capacitor', causes: ['heat'], severity: 'replace_part', spare: 'local', photoKey: 'k', note: 'कॅपॅसिटर बदला', noteLang: 'mr', quote: { parts: 180, labour: 150 } }, LATA);
  assert.equal(d.status, 200);
  assert.equal(d.body.job.diagnosis.noteLang, 'mr');
  const first = state.outbox.find((m) => m.channel === 'sms');
  assert.equal(first.message, format('sms.optionsReady', { cat: { cat: 'ceiling_fan' }, link: `https://app.test/?lang=mr#/o/${b.job.jobId}/${b.job.ownerToken}` }, 'mr'));
  assert.match(first.message, /तपासणी/);
  const v = await call2('GET', `/public/owner/${b.job.jobId}`, null, null, { t: b.job.ownerToken, lang: 'hi' });
  assert.equal(v.body.ownerLang, 'hi');
  assert.equal((await c2.store.get(`JOB#${b.job.jobId}`, 'META')).ownerLang, 'hi');
  const ignored = await call2('GET', `/public/owner/${b.job.jobId}`, null, null, { t: b.job.ownerToken, lang: 'zz' });
  assert.equal(ignored.body.ownerLang, 'hi');
  t2 += 3 * 60 * 1000;
  await c2.runDueTimers();
  const reminder = state.outbox.find((m) => m.channel === 'sms');
  assert.notEqual(reminder, first, 'reminder SMS sent');
  assert.ok(reminder.message.includes('याद दिला रहा है'), reminder.message);
  assert.ok(reminder.message.endsWith(`/?lang=hi#/o/${b.job.jobId}/${b.job.ownerToken}`));
});
// ── Cloud speech (core/speech.js) ──
const speechCtx = ({ fake = true, speech = {} } = {}) => {
  const state = {};
  const c = createMemoryContext({ state, config: { demoMode: true, speech } });
  let now = Date.UTC(2026, 9, 9, 6, 0, 0);
  c.now = () => now;
  if (fake) c.svc.speech = createFakeSpeech(state);
  const req = (method, path, body, { auth = null, query, ip = '203.0.113.7' } = {}) => handle(c, { method, path, body, auth, query, ip });
  return { c, state, req, tick: (ms) => { now += ms; } };
};
const speechJob = async (req, c) => {
  await c.store.put({ PK: 'USER#lata', SK: 'PROFILE', type: 'profile', userId: 'lata', role: 'technician', status: 'active', name: 'Lata', shop: 'Lata Repairs', pincode: '411001', area: '411', trust: 50, jobs: 0, complete: true, GSI1PK: 'ROLE#technician', GSI1SK: 'active#411#lata' });
  const r = await req('POST', '/api/jobs', { category: 'ceiling_fan', brand: 'Brand Y', model: 'CF-48', purchaseYear: 2020, ownerPhone: '9444444444', ownerLang: 'ta' }, { auth: as('lata') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.job;
};

await test('speech: demo mode answers unsupported and stores nothing', async () => {
  const { req, state } = speechCtx({ fake: false });
  const before = Object.keys(state.items).length;
  const pub = await req('POST', '/public/tts', { text: 'Your repair is ready.', lang: 'en' });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.unsupported, true);
  assert.equal(pub.body.reason, 'cloudSpeechOff');
  assert.equal(Object.keys(state.items).length, before, 'no rate rows in demo mode');
  const stt = await req('POST', '/api/stt', { key: 'uploads/u1/2026-10-09/ABC.webm', lang: 'hi' }, { auth: as('u1') });
  assert.equal(stt.status, 200);
  assert.equal(stt.body.unsupported, true);
});

await test('speech: language allowlist, text cleaning and length caps', async () => {
  const { req } = speechCtx({ fake: false });
  for (const lang of ['fr', 'english', '', undefined, 'hi-US']) {
    const r = await req('POST', '/public/tts', { text: 'Hello', lang });
    assert.equal(r.status, 400, String(lang));
    assert.equal(r.body.code, 'badLang');
  }
  assert.equal((await req('POST', '/public/tts', { text: 'Hi', lang: 'HI-in' })).status, 200);
  const long = await req('POST', '/public/tts', { text: 'अ'.repeat(301), lang: 'hi' });
  assert.equal(long.status, 400);
  assert.equal(long.body.code, 'speechTooLong');
  assert.equal(long.body.params.max, 300);
  assert.equal((await req('POST', '/api/tts', { text: 'अ'.repeat(1200), lang: 'hi' }, { auth: as('u1') })).status, 200, 'signed-in cap is higher');
  assert.equal((await req('POST', '/api/tts', { text: 'a'.repeat(1501), lang: 'en' }, { auth: as('u1') })).body.code, 'speechTooLong');
  for (const text of ['   ', '\u0000\u0007\n', 42, null]) assert.equal((await req('POST', '/public/tts', { text, lang: 'en' })).body.code, 'speechEmpty');
  assert.equal((await req('POST', '/public/tts', { text: 'Hi', lang: 'en' }, { auth: null })).status, 200);
});

await test('speech: Polly cache hit, mr/bn/ta unsupported, per-IP limit gives 429', async () => {
  const { c, req, tick, state } = speechCtx({ speech: { ttsPerIp: 3 } });
  const a = await req('POST', '/public/tts', { text: ' Your  repair\u0007 is ready. ', lang: 'en' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.cached, false);
  assert.match(a.body.url, /^mock-audio:tts\/en\/Kajal\/neural\/[0-9a-f]{64}\.mp3$/);
  const b = await req('POST', '/public/tts', { text: 'Your repair is ready.', lang: 'en' });
  assert.equal(b.body.cached, true, 'same cleaned text → same S3 key');
  assert.equal(b.body.url, a.body.url);
  assert.equal(c.svc.speech.calls.synth, 1);
  for (const lang of ['mr', 'bn', 'ta']) {
    const r = await req('POST', '/public/tts', { text: 'नमस्कार', lang });
    assert.equal(r.body.unsupported, true, lang);
    assert.equal(r.body.reason, 'noCloudVoice');
  }
  assert.equal((await req('POST', '/public/tts', { text: 'नमस्ते', lang: 'hi' })).status, 200);
  const blocked = await req('POST', '/public/tts', { text: 'One more', lang: 'en' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'tooMany');
  assert.equal((await req('POST', '/public/tts', { text: 'One more', lang: 'en' }, { ip: '198.51.100.2' })).status, 200, 'another IP is not affected');
  const rows = Object.values(state.items).filter((x) => x.type === 'rate');
  assert.ok(rows.every((x) => /^RATE#[0-9a-f]{64}$/.test(x.PK) && !x.PK.includes('203.0.113.7') && x.ttl > 0), 'only a hash of the IP is stored, with a ttl');
  tick(60 * 1000);
  assert.equal((await req('POST', '/public/tts', { text: 'One more', lang: 'en' })).status, 200, 'next minute is a new window');
});

await test('speech: voice typing needs an uploads key owned by the caller, then polls to a transcript', async () => {
  const { c, req, state } = speechCtx();
  const U1 = { auth: as('u1') };
  for (const key of ['uploads/u2/2026-10-09/ABC.webm', 'tts/en/x.webm', 'uploads/u1/../u2/a.webm', undefined]) {
    const r = await req('POST', '/api/stt', { key, lang: 'hi' }, U1);
    assert.equal(r.status, 400, String(key));
    assert.equal(r.body.code, 'sttKey');
  }
  assert.equal((await req('POST', '/api/stt', { key: 'uploads/u1/2026-10-09/ABC.jpg', lang: 'hi' }, U1)).body.code, 'audioType');
  assert.equal((await req('POST', '/api/stt', { key: 'uploads/u1/2026-10-09/ABC.webm', lang: 'xx' }, U1)).body.code, 'badLang');
  // Same flow the browser uses: presigned upload of the clip, then start and poll.
  const up = await req('POST', '/api/uploads', { contentType: 'audio/webm;codecs=opus' }, U1);
  assert.equal(up.status, 200);
  await c.svc.files.putData(up.body.key, 'data:audio/webm;base64,AAAA');
  const job = await req('POST', '/api/stt', { key: up.body.key, lang: 'ta' }, U1);
  assert.equal(job.status, 200, JSON.stringify(job.body));
  assert.match(job.body.jobName, /^pn-[A-Z0-9]{20}$/);
  assert.deepEqual(c.svc.speech.calls.started.at(-1), { key: up.body.key, languageCode: 'ta-IN', jobName: job.body.jobName, mediaFormat: 'webm' });
  assert.equal((await req('GET', `/api/stt/${job.body.jobName}`, null, { auth: as('u2') })).body.code, 'sttJob', 'another user cannot read it');
  assert.equal((await req('GET', `/api/stt/${job.body.jobName}`, null, U1)).body.status, 'IN_PROGRESS');
  const done = await req('GET', `/api/stt/${job.body.jobName}`, null, U1);
  assert.deepEqual(done.body, { status: 'COMPLETED', text: 'heard in ta-IN' });
  assert.ok(state.files[up.body.key], 'a normal upload is never deleted');
  assert.ok(!JSON.stringify(state.items).includes('heard in'), 'the transcript is not stored');
  // Throwaway clip route: deleted after the transcript is read.
  const tmp = await req('POST', '/api/stt/uploads', { contentType: 'audio/mp4' }, U1);
  assert.match(tmp.body.key, /^uploads\/tmp\/u\/u1\/\d{4}-\d\d-\d\d\/[A-Z0-9]{10}\.m4a$/);
  assert.equal((await req('POST', '/api/stt/uploads', { contentType: 'image/png' }, U1)).body.code, 'audioType');
  await c.svc.files.putData(tmp.body.key, 'data:audio/mp4;base64,AAAA');
  const j2 = (await req('POST', '/api/stt', { key: tmp.body.key, lang: 'en' }, U1)).body;
  assert.equal(c.svc.speech.calls.started.at(-1).mediaFormat, 'mp4');
  await req('GET', `/api/stt/${j2.jobName}`, null, U1);
  assert.equal((await req('GET', `/api/stt/${j2.jobName}`, null, U1)).body.status, 'COMPLETED');
  assert.deepEqual(c.svc.speech.calls.discarded, [tmp.body.key]);
  assert.equal((await req('GET', '/api/stt/not-a-job', null, U1)).status, 404);
});

await test('speech: owner-link voice typing is gated by the owner token', async () => {
  const { c, req } = speechCtx();
  const job = await speechJob(req, c);
  const base = `/public/owner/${job.jobId}`;
  const bad = { query: { t: 'wrong-token' } };
  assert.equal((await req('POST', `${base}/uploads`, { contentType: 'audio/webm', t: 'wrong-token' }, bad)).body.code, 'ownerLink');
  assert.equal((await req('POST', `${base}/stt`, { key: `uploads/tmp/o/${job.jobId}/2026-10-09/AAAA.webm`, lang: 'ta', t: 'wrong-token' }, bad)).status, 403);
  const good = { query: { t: job.ownerToken } };
  const up = await req('POST', `${base}/uploads`, { contentType: 'audio/webm', t: job.ownerToken }, good);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.ok(up.body.key.startsWith(`uploads/tmp/o/${job.jobId}/`));
  await c.svc.files.putData(up.body.key, 'data:audio/webm;base64,AAAA');
  assert.equal((await req('POST', `${base}/stt`, { key: 'uploads/lata/2026-10-09/AAAA.webm', lang: 'ta', t: job.ownerToken }, good)).body.code, 'sttKey', "the technician's uploads are not the owner's");
  const s = await req('POST', `${base}/stt`, { key: up.body.key, lang: 'ta', t: job.ownerToken }, good);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal((await req('GET', `${base}/stt/${s.body.jobName}`, null, bad)).status, 403);
  assert.equal((await req('GET', `/api/stt/${s.body.jobName}`, null, { auth: as('lata') })).body.code, 'sttJob', 'an owner job is not readable as a user job');
  await req('GET', `${base}/stt/${s.body.jobName}`, null, good);
  assert.deepEqual((await req('GET', `${base}/stt/${s.body.jobName}`, null, good)).body, { status: 'COMPLETED', text: 'heard in ta-IN' });
  assert.deepEqual(c.svc.speech.calls.discarded, [up.body.key]);
  // Demo mode: the owner upload is refused clearly, and start answers unsupported.
  const demo = speechCtx({ fake: false });
  const dj = await speechJob(demo.req, demo.c);
  assert.equal((await demo.req('POST', `/public/owner/${dj.jobId}/uploads`, { contentType: 'audio/webm', t: dj.ownerToken })).body.code, 'cloudSpeechOff');
  assert.equal((await demo.req('POST', `/public/owner/${dj.jobId}/stt`, { key: `uploads/tmp/o/${dj.jobId}/2026-10-09/AAAA.webm`, lang: 'ta', t: dj.ownerToken })).body.unsupported, true);
});

await test('speech: per-IP limit on owner-link clips', async () => {
  const { c, req } = speechCtx({ speech: { clipsPerIp: 2 } });
  const job = await speechJob(req, c);
  const send = (ip) => req('POST', `/public/owner/${job.jobId}/uploads`, { contentType: 'audio/ogg', t: job.ownerToken }, { ip });
  assert.equal((await send('192.0.2.1')).status, 200);
  assert.equal((await send('192.0.2.1')).status, 200);
  const r = await send('192.0.2.1');
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'tooMany');
  assert.equal((await send('192.0.2.9')).status, 200);
});
console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
