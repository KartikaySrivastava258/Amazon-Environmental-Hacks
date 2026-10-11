// Demo journeys: realistic, interconnected records created by driving the REAL API and workflow as each persona
// (core/api.js handle), so every job, decision, part, pickup, listing, notification, journey and reward is internally
// consistent. Every record is flagged `demo: true`: labelled in the UI, counted with synthetic data in brand
// analytics (workflow.js) and subtracted from the public impact counter (IMPACT/DEMO). Idempotent: runs once per
// store (SYSTEM/DEMO_SEEDED); `reset` clears everything and seeds again.
import { handle } from './api.js';
import { BRANDS, CATEGORIES } from './catalog.js';
import { PERSONAS } from './personas.js';

export const DEMO_VERSION = 1;
const DAY = 86400000;
// Demo mode gives owners 15 minutes to decide (memory.js ownerTimeoutSeconds), so decisions follow within minutes.

const auth = (userId) => {
  const p = PERSONAS.find((x) => x.userId === userId);
  return { userId, groups: p?.role === 'admin' ? ['admin'] : [p?.role], claims: {} };
};
const svg = (label) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><rect width="480" height="320" fill="#123b2a"/><rect x="16" y="16" width="448" height="288" rx="14" fill="#f4efe3"/><text x="240" y="130" font-family="sans-serif" font-size="22" fill="#8a4b2a" text-anchor="middle">DEMO PHOTO</text><text x="240" y="175" font-family="sans-serif" font-size="26" font-weight="bold" fill="#123b2a" text-anchor="middle">${label.replace(/[<&>]/g, '')}</text><text x="240" y="220" font-family="sans-serif" font-size="16" fill="#555" text-anchor="middle">Punarnava labelled demo data</text></svg>`)))}`;
const modelFor = (category, pref) => {
  if (pref) return pref;
  for (const [brand, b] of Object.entries(BRANDS)) if (b.models[category]?.length) return { brand, model: b.models[category][0] };
  return { brand: 'Brand X', model: 'DEMO-1' };
};

export async function seedDemoJourneys(ctx, { force = false } = {}) {
  if (!force && (await ctx.store.get('SYSTEM', 'DEMO_SEEDED'))) return { skipped: true };
  const realNow = ctx.now;
  const realLimits = ctx.config.requests;
  let T = realNow();
  ctx.now = () => T;
  ctx.config.requests = { ...(realLimits || {}), createPerIp: 1e6, matchPerIp: 1e6, uploadPerIp: 1e6 };
  const at = (daysAgo, hours = 0) => { T = realNow() - daysAgo * DAY + hours * 3600000; };
  const tick = async (minutes) => { T += minutes * 60000; await ctx.runDueTimers?.(); };
  const counts = { jobs: 0, requests: 0, listings: 0, parts: 0, pickups: 0 };

  const call = async (method, path, body, userId, query) => {
    const r = await handle(ctx, { method, path, body: body || {}, query: query || {}, auth: userId ? auth(userId) : null, ip: 'demo-seed' });
    if (r.status !== 200) throw new Error(`demo seed: ${method} ${path} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
  };
  const mark = (pk, sk = 'META') => ctx.store.update(pk, sk, { set: { demo: true } });
  const photo = async (who, label) => {
    const key = `uploads/${who}/demo/${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.round(T / 1000)}.svg`;
    await ctx.svc.files.putData?.(key, svg(label));
    return key;
  };
  const job = (id) => ctx.store.get(`JOB#${id}`, 'META');

  // A customer request through the signed-in customer route, accepted by a technician, opened as a job.
  async function viaRequest(customer, tech, req, jobBody) {
    const r = await call('POST', '/api/customer/requests', { consent: true, contactMethod: 'whatsapp', techIds: [tech], ...req }, customer);
    await mark(`REQUEST#${r.requestId}`); counts.requests++;
    await call('POST', `/api/requests/${r.requestId}/accept`, {}, tech);
    const out = await call('POST', `/api/requests/${r.requestId}/job`, jobBody, tech);
    await mark(`JOB#${out.job.jobId}`); counts.jobs++;
    return { requestId: r.requestId, jobId: out.job.jobId };
  }
  async function walkIn(tech, body) {
    const out = await call('POST', '/api/jobs', { continueUnderWarranty: true, ...body }, tech);
    await mark(`JOB#${out.job.jobId}`); counts.jobs++;
    if (out.job.status === 'warranty_check') await call('POST', `/api/jobs/${out.job.jobId}/continue`, {}, tech);
    return out.job.jobId;
  }
  async function diagnose(tech, jobId, d) {
    const j = await job(jobId);
    const comp = CATEGORIES[j.category].components.find((c) => c.id === d.component);
    await call('POST', `/api/jobs/${jobId}/diagnosis`, { severity: 'replace_part', spare: 'brand', causes: ['normal_wear'], photoKey: await photo(tech, `${comp?.en || d.component}`), offerWarrantyDays: 90, ...d }, tech);
    return job(jobId);
  }
  async function decide(jobId, want, { consent = true } = {}) {
    const j = await job(jobId);
    const ids = j.build.options.map((o) => o.id);
    const option = want === 'decline' || ids.includes(want) ? want : j.build.recommended;
    await call('POST', `/public/owner/${jobId}/decision`, { t: j.ownerToken, option, agree: true, consent });
    return option;
  }
  async function complete(tech, jobId, body = {}) {
    await call('POST', `/api/jobs/${jobId}/complete`, { partSource: 'new', amount: (await job(jobId)).build.options.find((o) => o.id === 'repair_new')?.cost || 1000, warrantyDays: 90, afterPhotoKey: await photo(tech, 'After repair'), ...body }, tech);
  }
  const confirm = async (jobId, working = true) => call('POST', `/public/owner/${jobId}/confirm`, { t: (await job(jobId)).ownerToken, working });
  async function followup(jobId) {
    await tick(10);
    const j = await job(jobId);
    if (j.followup?.due && !j.followup.answered) await call('POST', `/public/owner/${jobId}/followup`, { t: j.ownerToken, working: true });
  }
  async function pickupFor(jobId) {
    const ptr = (await ctx.store.query({ pk: `JOB#${jobId}`, skPrefix: 'PICKUP#' }))[0];
    if (ptr) { await mark(`PICKUP#${ptr.pickupId}`); counts.pickups++; }
    return ptr ? ctx.store.get(`PICKUP#${ptr.pickupId}`, 'META') : null;
  }
  async function collect(p, { deliver = true, confirmIt = true } = {}) {
    await call('POST', `/api/pickups/${p.pickupId}/accept`, {}, 'demo-shyam');
    await tick(90);
    const gates = Object.fromEntries((p.gates || []).map((g) => [g, true]));
    await call('POST', `/api/pickups/${p.pickupId}/collect`, { weightKg: Math.max(0.2, Math.round(p.estKg * 0.95 * 10) / 10), photoKey: await photo('demo-shyam', 'Weighed at pickup'), gates }, 'demo-shyam');
    if (!deliver) return;
    await tick(180);
    await call('POST', `/api/pickups/${p.pickupId}/deliver`, { recyclerId: 'demo-green' }, 'demo-shyam');
    if (!confirmIt) return;
    await tick(120);
    await call('POST', `/api/pickups/${p.pickupId}/confirm`, {}, 'demo-green');
  }

  try {
    const wm7 = modelFor('washing_machine', { brand: 'Brand X', model: 'WM-7' });
    const fridge = modelFor('refrigerator');
    const fan = modelFor('ceiling_fan');
    const mixer = modelFor('mixer_grinder');
    const comp0 = (cat) => CATEGORIES[cat].components[0].id;

    // 1. Sunita: request → Ravi → control board replaced → confirmed working → 30-day check (Repair Champion).
    at(24);
    const s1 = await viaRequest('demo-sunita', 'demo-ravi',
      { category: 'washing_machine', brand: wm7.brand, model: wm7.model, ageBand: '1-3', symptoms: ['error_code', 'not_starting'], description: 'Shows an error and the drum does not turn after a power cut.' },
      { purchaseYear: new Date(T).getUTCFullYear() - 2, brand: wm7.brand, model: wm7.model });
    await tick(240);
    await diagnose('demo-ravi', s1.jobId, { component: 'control_board', causes: ['voltage_surge'], quote: { parts: 3000, labour: 600 }, techSuggests: 'repair_new', note: 'Board burnt near the relay; likely a voltage surge.' });
    await tick(5); await decide(s1.jobId, 'repair_new');
    at(23); await complete('demo-ravi', s1.jobId, { amount: 3600 });
    await tick(60); await confirm(s1.jobId);
    await followup(s1.jobId);

    // 2. Arjun: old refrigerator → recycle → collector → registered recycler confirms (Responsible Recycler).
    at(18);
    const a1 = await viaRequest('demo-arjun', 'demo-ravi',
      { intent: 'recycle', category: 'refrigerator', brand: fridge.brand, model: fridge.model, ageBand: '10+', symptoms: ['not_cooling'], description: 'Very old fridge, stopped cooling, gas leak suspected.' },
      { purchaseYear: new Date(T).getUTCFullYear() - 13, brand: fridge.brand, model: fridge.model });
    await tick(300);
    await diagnose('demo-ravi', a1.jobId, { component: comp0('refrigerator'), severity: 'unsafe', spare: 'none', causes: ['normal_wear'], quote: {} });
    await tick(5); await decide(a1.jobId, 'recycle');
    at(17); await collect(await pickupFor(a1.jobId));

    // 3. Walk-in at Ravi's: old washing machine → parts harvested → listed on Parts Exchange; rest awaits a collector.
    at(14);
    await call('POST', '/api/searches', { category: 'washing_machine', component: 'drain_pump' }, 'demo-imran');
    const w1 = await walkIn('demo-ravi', { category: 'washing_machine', brand: 'Brand X', model: 'WM-9', purchaseYear: new Date(T).getUTCFullYear() - 9, ownerName: 'Meena Kumari', ownerPhone: '9123456780', ownerLang: 'hi' });
    await diagnose('demo-ravi', w1, { component: 'drum_bearing', spare: 'none', causes: ['normal_wear'], quote: {} });
    await tick(5); await decide(w1, 'harvest');
    const pid1 = (await job(w1)).pid;
    const h = await call('POST', `/api/passports/${pid1}/harvest`, { parts: [
      { component: 'motor', condition: 'working', price: 1400 }, { component: 'door_lock', condition: 'working', price: 150 },
      { component: 'drain_pump', condition: 'working', price: 300 }, { component: 'control_board', condition: 'dead' }] }, 'demo-ravi');
    for (const p of h.parts) { await mark(`PART#${p.partId}`); counts.parts++; }
    await mark(`PICKUP#${h.pickup.pickupId}`); counts.pickups++;
    const doorLock = h.parts.find((p) => p.component === 'door_lock');

    // 4. Walk-in at Imran's: Brand X WM-7 door lock → repaired with Meena's reused door lock (reuse reward for Meena's job).
    at(11);
    const w2 = await walkIn('demo-imran', { category: 'washing_machine', brand: 'Brand X', model: 'WM-7', purchaseYear: new Date(T).getUTCFullYear() - 1, ownerName: 'Kavita Rao', ownerPhone: '9000011122' });
    await diagnose('demo-imran', w2, { component: 'door_lock', spare: 'local', causes: ['manufacturing_defect'], quote: { parts: 700, labour: 300 } });
    const chosen = await decide(w2, 'repair_reused');
    if (chosen === 'repair_reused' && doorLock) {
      await tick(120); await call('POST', `/api/parts/${doorLock.partId}/handover`, {}, 'demo-ravi');
      at(10); await complete('demo-imran', w2, { partSource: 'reused', partId: doorLock.partId, amount: 450 });
    } else { at(10); await complete('demo-imran', w2); }
    await tick(30); await confirm(w2);

    // 5. Sell → registered refurbisher → ReLife listing → sold (resale reward), and a second one still for sale.
    for (const [daysAgo, owner, phone, sold] of [[16, 'Rahul Verma', '9000033344', true], [7, 'Farah Khan', '9000055566', false]]) {
      at(daysAgo);
      const w = await walkIn('demo-imran', { category: 'washing_machine', brand: 'Brand X', model: 'WM-7', purchaseYear: new Date(T).getUTCFullYear() - 2, ownerName: owner, ownerPhone: phone });
      await diagnose('demo-imran', w, { component: 'control_board', causes: ['voltage_surge'], quote: { parts: 6800, labour: 900 } });
      if ((await decide(w, 'sell')) !== 'sell') continue;
      const pid = (await job(w)).pid;
      await tick(60); await call('POST', `/api/passports/${pid}/transfer`, { refurbisherId: 'demo-green' }, 'demo-imran');
      await tick(60 * 24);
      const l = await call('POST', '/api/listings', { pid, price: sold ? 9200 : 9800, warrantyMonths: 6, photoKey: await photo('demo-green', 'Refurbished washing machine'), checklist: { tested: true, safety: true, cleaned: true } }, 'demo-green');
      await mark(`LISTING#${l.listing.listingId}`); counts.listings++;
      await call('POST', `/public/market/${l.listing.listingId}/interest`, { name: 'Neha Gupta', phone: '9876501234', message: 'Is it available this weekend?' });
      if (sold) { await tick(60 * 48); await call('POST', `/api/listings/${l.listing.listingId}/sold`, { buyerPhone: '9876501234' }, 'demo-green'); }
    }

    // 6. Exceptions: owner never decided; repair reported not working; owner declined every option.
    at(9);
    const x1 = await walkIn('demo-ravi', { category: 'ceiling_fan', brand: fan.brand, model: fan.model, purchaseYear: new Date(T).getUTCFullYear() - 4, ownerName: 'Vikram Singh', ownerPhone: '9000077788' });
    await diagnose('demo-ravi', x1, { component: 'capacitor', causes: ['heat'], spare: 'local', quote: { parts: 180, labour: 150 } });
    await tick(60 * 24 * 2); // past the owner timeout
    at(8);
    const x2 = await walkIn('demo-ravi', { category: 'mixer_grinder', brand: mixer.brand, model: mixer.model, purchaseYear: new Date(T).getUTCFullYear() - 3, ownerName: 'Pooja Iyer', ownerPhone: '9000099900' });
    await diagnose('demo-ravi', x2, { component: comp0('mixer_grinder'), causes: ['normal_wear'], spare: 'local', quote: { parts: 400, labour: 200 } });
    if ((await decide(x2, 'repair_new')) === 'repair_new') { await tick(240); await complete('demo-ravi', x2, { amount: 600, warrantyDays: 30 }); await tick(30); await confirm(x2, false); }
    at(6);
    const a2 = await viaRequest('demo-arjun', 'demo-ravi',
      { category: 'ceiling_fan', brand: fan.brand, model: fan.model, ageBand: '5-10', symptoms: ['noise'], description: 'Fan makes a grinding noise at high speed.' },
      { purchaseYear: new Date(T).getUTCFullYear() - 7, brand: fan.brand, model: fan.model });
    await diagnose('demo-ravi', a2.jobId, { component: 'bearing', causes: ['normal_wear'], spare: 'local', quote: { parts: 350, labour: 250 } });
    await tick(5); await decide(a2.jobId, 'decline');

    // 7. In progress right now (for the live demo).
    at(3);
    const w3 = await walkIn('demo-imran', { category: 'washing_machine', brand: 'Brand X', model: 'WM-9', purchaseYear: new Date(T).getUTCFullYear() - 8, ownerName: 'Suresh Nair', ownerPhone: '9000012121' });
    await diagnose('demo-imran', w3, { component: 'drum_bearing', spare: 'none', quote: {} });
    await decide(w3, 'recycle');
    await collect(await pickupFor(w3), { deliver: true, confirmIt: false }); // waiting at GreenCycle for confirmation
    at(1);
    const w4 = await walkIn('demo-ravi', { category: 'refrigerator', brand: fridge.brand, model: fridge.model, purchaseYear: new Date(T).getUTCFullYear() - 5, ownerName: 'Anita Desai', ownerPhone: '9000034343' });
    await diagnose('demo-ravi', w4, { component: comp0('refrigerator'), causes: ['voltage_surge'], spare: 'brand', quote: { parts: 2600, labour: 800 } });
    await decide(w4, 'repair_new'); // repairing: Ravi can mark it complete during the demo
    at(0, -3);
    const a3 = await viaRequest('demo-arjun', 'demo-ravi',
      { category: 'mixer_grinder', brand: mixer.brand, model: mixer.model, ageBand: '3-5', symptoms: ['not_starting'], description: 'Jar does not spin, motor hums.' },
      { purchaseYear: new Date(T).getUTCFullYear() - 4, brand: mixer.brand, model: mixer.model });
    await diagnose('demo-ravi', a3.jobId, { component: comp0('mixer_grinder'), causes: ['normal_wear'], spare: 'local', quote: { parts: 450, labour: 200 }, techSuggests: 'repair_new' });
    // Arjun's decision is now waiting on his "My repairs" page.
    at(0, -1);
    const open = await call('POST', '/api/customer/requests', { consent: true, contactMethod: 'call', category: 'ceiling_fan', brand: fan.brand, model: fan.model, ageBand: '1-3', symptoms: ['no_power'], description: 'Fan stopped after a storm; regulator may be fine.', techIds: ['demo-ravi'] }, 'demo-sunita');
    await mark(`REQUEST#${open.requestId}`); counts.requests++;
    // Sunita's new request is now waiting in Ravi's Requests.
  } finally {
    ctx.now = realNow;
    ctx.config.requests = realLimits;
  }

  // Waits that must not expire during the live demo (owner decision, repair in progress) are pushed out.
  const timers = ctx.state?.timers || {};
  for (const t of Object.values(timers)) if (t.payload?.type === 'sfn-timeout' && t.at < realNow() + 7 * DAY) t.at = realNow() + 30 * DAY;
  for (const [name, t] of Object.entries(timers)) if (t.at < realNow() && name.startsWith('pn-rem-')) delete timers[name];

  // Everything above counted in the impact counters; record it so the public counter excludes it.
  const impact = await ctx.store.get('IMPACT', 'GLOBAL');
  const demo = Object.fromEntries(Object.entries(impact || {}).filter(([, v]) => typeof v === 'number'));
  await ctx.store.put({ PK: 'IMPACT', SK: 'DEMO', ...demo });
  await ctx.store.put({ PK: 'SYSTEM', SK: 'DEMO_SEEDED', version: DEMO_VERSION, at: new Date(realNow()).toISOString(), ...counts });
  return { skipped: false, ...counts };
}
