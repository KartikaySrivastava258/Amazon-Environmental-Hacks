// All app actions behind API Gateway. Same code runs in the API Lambda and in the browser demo.
import { CATEGORIES, CAUSES, SEVERITY, SPARE, BARRIERS, BRANDS, areaOf, areaName, category as catOf, component as compOf, publicCatalog, MIN_SAMPLE, compatibility } from './catalog.js';
import { buildModelReport, modelScores } from './insights.js';
import { getProfile, profileIndex, getJob, getPassport, passportEvent, jobTimeline, timelineEntry, searchParts, reservePart, createPickup, setHolder, notifyUser, partIndex, usersByRole, partsReservedBy } from './records.js';
import { newId, secretToken, sha256, normalizePhone, maskPhone, iso, requireFields, clampNumber, httpError, apiError, randomString, langOr, format } from './util.js';
import { OPTION_TEXT } from './workflow.js';
import { speechRoutes } from './speech.js';
import { requestRoutes, journeyForJob, rewardView } from './requests.js';
import { award, notifyJobCustomer, jobRewards, existingCustomer, createCustomer, linkJob } from './rewards.js';
import { buildReportDoc, reportFilename, validMonth, catalogModels } from './report.js';
import { renderPdf, toBase64 } from './pdf.js';
import { MAX_OFFER_WARRANTY_DAYS } from './decision.js';
import { searchRoutes } from './search.js';
import { assistRoutes } from './assist.js';

const routes = [];
function route(method, pattern, access, fn) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, pattern, re, keys, access, fn });
}

const SIGNUP_ROLES = ['technician', 'collector', 'recycler', 'brand', 'customer'];

export async function handle(ctx, req) {
  try {
    const method = req.method.toUpperCase();
    const path = req.path.replace(/\/+$/, '') || '/';
    const r = routes.find((x) => x.method === method && x.re.test(path));
    if (!r) throw httpError(404, `No route for ${method} ${path}`, 'noRoute');
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(path.match(r.re)[i + 1])]));
    const input = { params, query: req.query || {}, body: req.body || {}, ip: req.ip || '' };
    const action = `${method} ${r.pattern}`;
    if (r.access === 'public') {
      await authorize(ctx, action, null, input);
      return ok(await r.fn(ctx, input, null));
    }
    if (!req.auth?.userId) throw apiError(401, 'signIn');
    const me = await ensureProfile(ctx, req.auth);
    me.isAdmin = (req.auth.groups || []).includes('admin') || me.role === 'admin';
    if (r.access !== 'self') {
      if (me.status === 'suspended' && !me.isAdmin) throw apiError(403, 'suspended');
      if (me.status !== 'active' && !me.isAdmin) throw apiError(403, 'pendingApproval');
      if (Array.isArray(r.access) && !r.access.includes(me.role) && !me.isAdmin) throw apiError(403, 'wrongRole', { roles: r.access.join(',') });
    }
    await authorize(ctx, action, me, input);
    return ok(await r.fn(ctx, input, me));
  } catch (e) {
    const status = e.status || (e.code === 'ConditionFailed' ? 409 : 500);
    if (status >= 500) console.error(e);
    if (status >= 500) return { status, body: { error: format('err.server'), code: 'server', params: {} } };
    if (!e.status) return { status, body: { error: format('err.conflict'), code: 'conflict', params: {} } };
    return { status, body: { error: e.message, ...(typeof e.code === 'string' ? { code: e.code, params: e.params || {} } : {}) } };
  }
}
const ok = (body) => ({ status: 200, body });

/**
 * Policy check at the API boundary (Cedar in the local Build It server: backend/src/local/cedar.js).
 * The route's own role checks above still apply; both must allow. Without an authz port (browser demo,
 * tests), only the route checks apply. The authz port fails closed: an engine error is a deny.
 */
async function authorize(ctx, action, me, input) {
  if (!ctx.svc.authz) return;
  let allowed = false;
  try {
    allowed = await ctx.svc.authz.isAuthorized({
      action,
      user: me ? { userId: me.userId, role: me.isAdmin ? 'admin' : me.role, status: me.isAdmin ? 'active' : me.status || 'pending', brandId: me.brandId || '', orgType: me.orgType || '' } : null,
      context: { brand: typeof input.query?.brand === 'string' ? input.query.brand : typeof input.body?.brand === 'string' ? input.body.brand : '' },
    });
  } catch (e) {
    console.error('authz error', e);
    allowed = false;
  }
  if (!allowed) throw apiError(403, 'notAllowed');
}

/** Every route as { method, pattern, access, action } (Cedar policy generation and tests). */
export const routeTable = () => routes.map((r) => ({ method: r.method, pattern: r.pattern, access: r.access, action: `${r.method} ${r.pattern}` }));

async function ensureProfile(ctx, auth) {
  let p = await getProfile(ctx, auth.userId);
  if (p) return p;
  const claims = auth.claims || {};
  const role = SIGNUP_ROLES.includes(claims['custom:role']) ? claims['custom:role'] : 'technician';
  p = {
    PK: `USER#${auth.userId}`, SK: 'PROFILE', type: 'profile', userId: auth.userId, role,
    status: ['technician', 'collector', 'customer'].includes(role) ? 'active' : 'pending',
    email: claims.email || '', name: claims.name || (claims.email || '').split('@')[0] || 'New user',
    brandId: role === 'brand' ? claims['custom:brandId'] || '' : '', trust: 50, jobs: 0, verifiedJobs: 0,
    complete: false, createdAt: iso(ctx.now()),
  };
  Object.assign(p, profileIndex(p));
  await ctx.store.put(p, { notExists: true }).catch((e) => { if (e.code !== 'ConditionFailed') throw e; });
  return (await getProfile(ctx, auth.userId)) || p;
}
export { ensureProfile };

const photo = (ctx, key) => (key ? ctx.svc.files.presignGet(key) : null);
const publicProfile = (p) => (p ? { userId: p.userId, name: p.name, shop: p.shop || '', area: p.area || '', areaName: areaName(p.area), trust: p.trust, role: p.role, orgType: p.orgType, regNo: p.regNo } : null);
const yearNow = (ctx) => new Date(ctx.now()).getUTCFullYear();
const strip = (item) => {
  if (!item) return item;
  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...rest } = item;
  return rest;
};

// Pickup items keep an English label for old readers; key/params let each viewer translate it.
const pickupItem = (key, params, extra) => ({ label: format(key, params, 'en'), key, params, ...extra });

// ───────────────────────────── Public ─────────────────────────────

route('GET', '/public/catalog', 'public', async (ctx) => {
  const extra = await ctx.store.query({ pk: 'CATALOG', skPrefix: 'MODEL#' });
  return publicCatalog(extra);
});

route('GET', '/public/impact', 'public', async (ctx) => {
  const all = strip(await ctx.store.get('IMPACT', 'GLOBAL')) || {};
  // Demo journeys (core/demo-seed.js) run through the real workflow, so their counters are recorded at seeding time
  // and subtracted here: the public counter stays "real activity only". They are reported separately as demo.
  const demo = strip(await ctx.store.get('IMPACT', 'DEMO')) || {};
  const impact = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, typeof v === 'number' && typeof demo[k] === 'number' ? Math.round((v - demo[k]) * 100) / 100 : v]));
  const demoOnly = Object.fromEntries(Object.entries(demo).filter(([, v]) => typeof v === 'number' && v));
  return { impact, demo: demoOnly, note: 'Counts real activity on Punarnava only. Synthetic test data and labelled demo records are excluded. Weights are estimates per category.' };
});

route('GET', '/public/passport/:pid', 'public', async (ctx, { params }) => {
  const p = await getPassport(ctx, params.pid);
  const events = await ctx.store.query({ pk: `PASSPORT#${params.pid}`, skPrefix: 'EV#', desc: true });
  const listing = p.listingId ? strip(await ctx.store.get(`LISTING#${p.listingId}`, 'META')) : null;
  return {
    passport: { pid: p.pid, category: p.category, brand: p.brand, model: p.model, purchaseYear: p.purchaseYear, status: p.status, repairs: p.repairs || 0, createdAt: p.createdAt },
    events: events.map(strip),
    listing: listing && listing.status === 'ACTIVE' ? { listingId: listing.listingId, price: listing.price } : null,
  };
});

async function ownerJob(ctx, jobId, t) {
  const job = await getJob(ctx, jobId);
  if (!t || t !== job.ownerToken) throw apiError(403, 'ownerLink');
  return job;
}

async function ownerView(ctx, job) {
  const tech = await getProfile(ctx, job.techId);
  return {
    jobId: job.jobId, pid: job.pid, status: job.status, createdAt: job.createdAt, ownerLang: job.ownerLang || 'en',
    product: { category: job.category, brand: job.brand, model: job.model, purchaseYear: job.purchaseYear, ageYears: job.ageYears },
    tech: publicProfile(tech),
    diagnosis: job.diagnosis ? { ...job.diagnosis, photoUrl: await photo(ctx, job.diagnosis.photoKey), voiceUrl: await photo(ctx, job.diagnosis.voiceNoteKey), quote: job.diagnosis.quote } : null,
    build: job.build || null,
    decision: job.decision || null,
    consent: job.consent ?? null,
    repair: job.repair ? { ...job.repair, afterPhotoUrl: await photo(ctx, job.repair.afterPhotoKey) } : null,
    warranty: job.warranty || null,
    verified: job.verified ?? null,
    followup: job.followup || null,
    decisionPending: job.status === 'awaiting_owner' ? job.decisionPending || null : null,
    canDecide: job.status === 'awaiting_owner' && !!job.taskToken && !job.decisionPending,
    decisionAudit: job.decisionAudit ? { option: job.decisionAudit.option, agreedAt: job.decisionAudit.agreedAt, channel: job.decisionAudit.channel } : null,
    journey: await journeyForJob(ctx, job),
    rewards: (await jobRewards(ctx, job.jobId)).map(rewardView),
    green: { linked: !!job.customerId, viaRequest: !!job.requestId, requestId: job.requestId || null },
    demo: !!job.demo,
  };
}

// The owner page sends its current language; remember it for SMS and links.
async function rememberLang(ctx, job, raw) {
  const lang = langOr(raw);
  if (!lang || lang === job.ownerLang) return job;
  await ctx.store.update(`JOB#${job.jobId}`, 'META', { set: { ownerLang: lang } });
  return { ...job, ownerLang: lang };
}

route('GET', '/public/owner/:jobId', 'public', async (ctx, { params, query }) => ownerView(ctx, await rememberLang(ctx, await ownerJob(ctx, params.jobId, query.t), query.lang)));

// The owner's choice. Both an option AND an explicit agreement to proceed with it are required (body.agree === true);
// body.consent is the separate, optional consent to share anonymous data. The agreed terms are snapshotted for audit.
route('POST', '/public/owner/:jobId/decision', 'public', async (ctx, { params, body, query }) => {
  const job = await rememberLang(ctx, await ownerJob(ctx, params.jobId, body.t), body.lang ?? query.lang);
  if (job.status !== 'awaiting_owner' || !job.taskToken || job.decisionPending) throw apiError(409, 'alreadyChosen');
  // "decline" = none of the options: nothing is repaired, sold, harvested or recycled; the product stays the owner's.
  const chosen = body.option === 'decline' ? { id: 'decline', terms: { ownership: 'stays', next: 'decline' } } : job.build?.options?.find((o) => o.id === body.option);
  if (!chosen) throw apiError(400, 'pickOption');
  if (body.agree !== true) throw apiError(400, 'agreeFirst');
  const consent = body.consent === true;
  const at = iso(ctx.now());
  const decisionAudit = {
    option: chosen.id, agreedAt: at, channel: job.requestId ? 'customer_request' : 'owner_link', lang: langOr(body.lang ?? query.lang) || job.ownerLang || 'en',
    dataConsent: consent, recommended: job.build.recommended, techSuggests: job.diagnosis?.techSuggests || null,
    fair: job.build.fair || null, terms: chosen.terms || null, cost: chosen.cost ?? null, payout: chosen.payout ?? null,
  };
  try {
    await ctx.store.update(`JOB#${job.jobId}`, 'META', { set: { consent, decisionPending: { option: chosen.id, at, agreed: true }, decisionAudit }, append: { timeline: [timelineEntry(at, 'event.ownerAgreed', { opt: { opt: chosen.id } }, 'decision')] } }, { and: [{ eq: { status: 'awaiting_owner' } }, { missing: ['decisionPending'] }] });
  } catch (e) {
    if (e.code === 'ConditionFailed') throw apiError(409, 'alreadyChosen');
    throw e;
  }
  try {
    await ctx.svc.workflow.sendSuccess(job.taskToken, { option: chosen.id, consent });
  } catch (e) {
    await ctx.store.update(`JOB#${job.jobId}`, 'META', { remove: ['decisionPending', 'decisionAudit'] });
    throw apiError(409, 'choiceExpired');
  }
  return ownerView(ctx, await getJob(ctx, job.jobId));
});

/**
 * Verified reuse: a harvested part from someone's product was handed over (seller recorded it) and the repair it
 * went into is confirmed working by that repair's owner. The reward goes to the job the part came from.
 */
async function awardPartReuse(ctx, job) {
  if (job.repair?.partSource !== 'reused' || !job.repair.partId) return;
  const part = await ctx.store.get(`PART#${job.repair.partId}`, 'META');
  if (!part?.soldAt || !part.sourceJob) return;
  const source = await ctx.store.get(`JOB#${part.sourceJob}`, 'META');
  if (!source) return;
  await award(ctx, source, 'reuse', part.partId, { installedIn: job.jobId, handoverAt: part.soldAt, confirmedAt: iso(ctx.now()) });
}

route('POST', '/public/owner/:jobId/confirm', 'public', async (ctx, { params, body, query }) => {
  const job = await rememberLang(ctx, await ownerJob(ctx, params.jobId, body.t), body.lang ?? query.lang);
  if (job.status !== 'repaired') throw apiError(409, 'notComplete');
  if (job.verified !== null && job.verified !== undefined) return ownerView(ctx, job);
  const working = body.working === true;
  const at = iso(ctx.now());
  // Exactly once, even when two confirmations race: only the first sets verifiedAt.
  try {
    await ctx.store.update(`JOB#${job.jobId}`, 'META', { set: { verifiedAt: at } }, { missing: ['verifiedAt'] });
  } catch (e) {
    if (e.code === 'ConditionFailed') return ownerView(ctx, await getJob(ctx, job.jobId));
    throw e;
  }
  await jobTimeline(ctx, job.jobId, { key: working ? 'event.ownerConfirmedWorks' : 'event.ownerSaysNotWorking' }, working ? 'done' : 'warning', { verified: working });
  await ctx.store.update(`USER#${job.techId}`, 'PROFILE', { add: { trust: working ? 3 : -5, verifiedJobs: working ? 1 : 0 } });
  await passportEvent(ctx, job.pid, { kind: 'verified', key: working ? 'event.repairVerified' : 'event.repairNotFixed', jobId: job.jobId });
  await notifyUser(ctx, job.techId, { key: working ? 'notif.ownerConfirmed' : 'notif.ownerNotWorking', params: { jobId: job.jobId }, link: `#/t/job/${job.jobId}` });
  if (working) {
    const fresh = await getJob(ctx, job.jobId);
    await award(ctx, fresh, 'repair', job.jobId, { ownerConfirmedAt: at, partSource: job.repair?.partSource || 'new' });
    await awardPartReuse(ctx, fresh);
  }
  return ownerView(ctx, await getJob(ctx, job.jobId));
});

route('POST', '/public/owner/:jobId/followup', 'public', async (ctx, { params, body, query }) => {
  const job = await rememberLang(ctx, await ownerJob(ctx, params.jobId, body.t), body.lang ?? query.lang);
  if (!job.followup?.due || job.followup.answered) throw apiError(409, 'noCheckin');
  const working = body.working === true;
  const at = iso(ctx.now());
  try {
    await ctx.store.update(`JOB#${job.jobId}`, 'META', { set: { followupAnsweredAt: at } }, { missing: ['followupAnsweredAt'] });
  } catch (e) {
    if (e.code === 'ConditionFailed') throw apiError(409, 'noCheckin');
    throw e;
  }
  await jobTimeline(ctx, job.jobId, { key: working ? 'event.followupWorking' : 'event.followupStopped' }, working ? 'done' : 'warning', { followup: { ...job.followup, answered: true, working, answeredAt: at } });
  await passportEvent(ctx, job.pid, { kind: 'followup', key: working ? 'event.stillWorking30' : 'event.stoppedWithin30', jobId: job.jobId });
  await ctx.store.update('IMPACT', 'GLOBAL', { add: working ? { repairsHolding: 1 } : { repairsFailedEarly: 1 } });
  await notifyUser(ctx, job.techId, { key: working ? 'notif.followupWorking' : 'notif.followupStopped', params: { jobId: job.jobId }, link: `#/t/job/${job.jobId}` });
  if (working && job.verified === true) await award(ctx, await getJob(ctx, job.jobId), 'followup', job.jobId, { answeredAt: at });
  return ownerView(ctx, await getJob(ctx, job.jobId));
});

/**
 * Save this job's verified rewards in a Customer Green Passport, or open the one it is already in.
 * - Request jobs: only the customer holds this owner link, so the passport link is returned.
 * - Walk-in jobs: the first claim links the job (to the passport remembered in this browser, or a new one).
 *   Once linked, the passport link is returned only with that passport's own credential, so a link holder
 *   cannot read the customer's other products.
 */
route('POST', '/public/owner/:jobId/green', 'public', async (ctx, { params, body }) => {
  const job = await ownerJob(ctx, params.jobId, body.t);
  const mine = await existingCustomer(ctx, body.green);
  if (job.customerId) {
    if (job.requestId || mine?.cid === job.customerId) {
      const c = await ctx.store.get(`CUSTOMER#${job.customerId}`, 'META');
      return { cid: c.cid, token: c.token, created: false };
    }
    throw apiError(409, 'greenClaimed');
  }
  const c = mine || (await createCustomer(ctx, { lang: job.ownerLang || 'en' }));
  await linkJob(ctx, job, c);
  return { cid: c.cid, token: c.token, created: !mine };
});

route('GET', '/public/market', 'public', async (ctx, { query }) => {
  let rows = await ctx.store.query({ index: 'GSI2', pk: 'LISTINGS#ACTIVE', desc: true });
  if (query.category) rows = rows.filter((l) => l.category === query.category);
  return { listings: await Promise.all(rows.map(async (l) => ({ ...strip(l), photoUrl: await photo(ctx, l.photoKey), areaName: areaName(l.area) }))) };
});

route('GET', '/public/market/:id', 'public', async (ctx, { params }) => {
  const l = await ctx.store.get(`LISTING#${params.id}`, 'META');
  if (!l) throw apiError(404, 'listingGone');
  const events = await ctx.store.query({ pk: `PASSPORT#${l.pid}`, skPrefix: 'EV#', desc: true });
  const refurb = await getProfile(ctx, l.refurbisherId);
  return { listing: { ...strip(l), photoUrl: await photo(ctx, l.photoKey), areaName: areaName(l.area) }, events: events.map(strip), refurbisher: publicProfile(refurb) };
});

route('POST', '/public/market/:id/interest', 'public', async (ctx, { params, body }) => {
  requireFields(body, ['name', 'phone']);
  const phone = normalizePhone(body.phone);
  if (phone.length !== 10) throw apiError(400, 'phone10');
  const l = await ctx.store.get(`LISTING#${params.id}`, 'META');
  if (!l || l.status !== 'ACTIVE') throw apiError(404, 'listingGone');
  const at = iso(ctx.now());
  await ctx.store.put({ PK: `LISTING#${l.listingId}`, SK: `LEAD#${at}`, type: 'lead', name: String(body.name).slice(0, 60), phone, message: String(body.message || '').slice(0, 300), at });
  await ctx.store.update(`LISTING#${l.listingId}`, 'META', { add: { leads: 1 } });
  await notifyUser(ctx, l.refurbisherId, { key: 'notif.buyerInterest', params: { title: l.title, name: String(body.name).slice(0, 40), phone }, link: '#/r' });
  return { ok: true };
});

route('GET', '/public/scores', 'public', async (ctx, { query }) => {
  const brands = await ctx.store.query({ pk: 'BRANDS' });
  const out = [];
  for (const b of brands) {
    const models = await ctx.store.query({ pk: `BRAND#${b.brand}`, skPrefix: 'MODEL#' });
    for (const m of models) {
      if ((query.category && m.category !== query.category) || !(m.n > 0)) continue;
      const total = await ctx.store.get(`AGG#${b.brand}#${m.model}`, 'TOTAL');
      const comps = await ctx.store.query({ pk: `AGG#${b.brand}#${m.model}`, skPrefix: 'COMP#' });
      out.push({ brand: b.brand, model: m.model, category: m.category, ...modelScores(total, comps) });
    }
  }
  return { models: out, minSample: MIN_SAMPLE };
});

route('GET', '/public/rates', 'public', async () => ({
  rates: Object.entries(CATEGORIES).map(([id, c]) => ({ category: id, en: c.en, ratePerKg: c.scrapRate })),
  note: 'Reference rates for this demo, paid by registered recyclers per kg.',
}));

// ───────────────────────────── Account ─────────────────────────────

route('GET', '/api/me', 'self', async (ctx, _i, me) => ({ profile: strip(me) }));

route('PUT', '/api/me', 'self', async (ctx, { body }, me) => {
  const set = {};
  if (body.name !== undefined) set.name = String(body.name).trim().slice(0, 60);
  if (body.phone !== undefined) set.phone = normalizePhone(body.phone);
  if (body.shop !== undefined) set.shop = String(body.shop).trim().slice(0, 80);
  if (body.pincode !== undefined) {
    const pin = String(body.pincode).replace(/\D/g, '');
    if (pin.length !== 6) throw apiError(400, 'pincode6');
    set.pincode = pin;
    set.area = areaOf(pin);
  }
  if (Array.isArray(body.categories)) set.categories = body.categories.filter((c) => CATEGORIES[c]);
  if (me.role === 'recycler') {
    if (body.orgType !== undefined) {
      if (!['recycler', 'refurbisher', 'both'].includes(body.orgType)) throw apiError(400, 'orgType');
      set.orgType = body.orgType;
    }
    if (body.regNo !== undefined) set.regNo = String(body.regNo).trim().slice(0, 40);
  }
  if (me.role === 'brand' && body.brandId !== undefined && me.status !== 'active') set.brandId = String(body.brandId).slice(0, 40);
  const next = { ...me, ...set };
  set.complete = !!(next.name && next.pincode && (next.role !== 'recycler' || (next.orgType && next.regNo)) && (next.role !== 'brand' || next.brandId));
  Object.assign(set, profileIndex(next));
  const p = await ctx.store.update(`USER#${me.userId}`, 'PROFILE', { set });
  return { profile: strip(p) };
});

route('GET', '/api/notifications', 'self', async (ctx, _i, me) => {
  const rows = await ctx.store.query({ pk: `USER#${me.userId}`, skPrefix: 'NOTIF#', desc: true, limit: 40 });
  return { notifications: rows.map((r) => ({ ...strip(r), id: r.SK })), unread: rows.filter((r) => !r.read).length };
});

route('POST', '/api/notifications/read', 'self', async (ctx, _i, me) => {
  const rows = await ctx.store.query({ pk: `USER#${me.userId}`, skPrefix: 'NOTIF#', desc: true, limit: 40 });
  for (const r of rows.filter((x) => !x.read)) await ctx.store.update(r.PK, r.SK, { set: { read: true } });
  return { ok: true };
});

route('POST', '/api/uploads', 'any', async (ctx, { body }, me) => {
  const type = String(body.contentType || 'image/jpeg').split(';')[0];
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' };
  if (!EXT[type]) throw apiError(400, 'uploadType');
  const ext = EXT[type];
  const key = `uploads/${me.userId}/${iso(ctx.now()).slice(0, 10)}/${randomString(10)}.${ext}`;
  return { key, url: await ctx.svc.files.presignPut(key, type), contentType: type };
});

// ───────────────────────────── Technician: Repair Desk ─────────────────────────────

const TECH = ['technician'];

route('GET', '/api/jobs', TECH, async (ctx, _i, me) => {
  const rows = await ctx.store.query({ index: 'GSI1', pk: `TECH#${me.userId}`, desc: true, limit: 100 });
  return { jobs: rows.map((j) => ({ jobId: j.jobId, pid: j.pid, status: j.status, category: j.category, brand: j.brand, model: j.model, ownerName: j.ownerName, createdAt: j.createdAt, updatedAt: j.updatedAt, decision: j.decision, component: j.diagnosis?.component, demo: !!j.demo })) };
});

/**
 * Open a job card (and passport). Used by POST /api/jobs (walk-in) and POST /api/requests/:id/job (customer request).
 * extra: { requestId, customerId } for a request. The owner token of a request job is never returned to the technician.
 */
async function createJob(ctx, me, body, extra = {}) {
  requireFields(body, ['category', 'brand', 'model', 'purchaseYear', 'ownerPhone']);
  const cat = catOf(body.category);
  const y = yearNow(ctx);
  const purchaseYear = clampNumber(body.purchaseYear, y - 30, y, 'purchaseYear');
  const ownerPhone = normalizePhone(body.ownerPhone);
  if (ownerPhone.length !== 10) throw apiError(400, 'ownerPhone10');
  const ownerLang = body.ownerLang == null || body.ownerLang === '' ? 'en' : langOr(body.ownerLang);
  if (!ownerLang) throw apiError(400, 'badLang');
  const brand = String(body.brand).trim().slice(0, 40);
  const model = String(body.model).trim().toUpperCase().slice(0, 30);
  const listed = (BRANDS[brand]?.models[body.category] || []).includes(model) || !!(await ctx.store.get('CATALOG', `MODEL#${body.category}#${brand}#${model}`));
  if (!listed) {
    await ctx.store.put({ PK: 'CATALOG', SK: `PENDING#${body.category}#${brand}#${model}`, type: 'pending_model', category: body.category, brand, model, labelPhotoKey: body.labelPhotoKey || null, by: me.userId, at: iso(ctx.now()) });
  }
  const pincode = String(body.pincode || me.pincode || '').replace(/\D/g, '');
  const area = areaOf(pincode);
  const ageYears = Math.max(0, Math.round((y - purchaseYear + 0.5) * 10) / 10);
  const ownerHash = await sha256(`pn:${ownerPhone}`);
  let existing = [];
  let passport = null;
  if (body.pid) {
    // Scanned QR tag: attach the job to that exact product.
    passport = await getPassport(ctx, String(body.pid).toUpperCase());
    if (passport.category !== body.category) throw apiError(400, 'tagWrongCategory');
    if (['recycled', 'harvested'].includes(passport.status)) throw apiError(409, 'alreadyRecycled');
    if (passport.GSI1PK !== `OWNER#${ownerHash}`) await ctx.store.update(passport.PK, passport.SK, { set: { GSI1PK: `OWNER#${ownerHash}`, GSI1SK: `${passport.brand}#${passport.model}#${passport.pid}` } });
    existing = [passport];
  } else {
    // Reuse the passport if this owner already has this model on Punarnava.
    existing = await ctx.store.query({ index: 'GSI1', pk: `OWNER#${ownerHash}`, skPrefix: `${brand}#${model}` });
    passport = existing.find((p) => !body.serial || !p.serial || p.serial === body.serial) || null;
  }
  const at = iso(ctx.now());
  if (!passport) {
    const pid = newId('P', 8);
    passport = {
      PK: `PASSPORT#${pid}`, SK: 'META', type: 'passport', pid, category: body.category, brand, model, purchaseYear,
      serial: body.serial ? String(body.serial).slice(0, 40) : null, labelPhotoKey: body.labelPhotoKey || null,
      status: 'in_use', repairs: 0, createdAt: at, GSI1PK: `OWNER#${ownerHash}`, GSI1SK: `${brand}#${model}#${pid}`,
    };
    await ctx.store.put(passport, { notExists: true });
    await passportEvent(ctx, pid, { kind: 'created', key: 'event.passportCreated', params: { shop: me.shop || me.name }, by: me.userId });
  }
  const jobId = newId('J', 6);
  const warrantyLikely = ageYears < cat.warrantyYears;
  const job = {
    PK: `JOB#${jobId}`, SK: 'META', type: 'job', jobId, pid: passport.pid, techId: me.userId, status: warrantyLikely && body.continueUnderWarranty !== true ? 'warranty_check' : 'new',
    category: body.category, brand: passport?.brand || brand, model: passport?.model || model, modelListed: listed || !!body.pid, purchaseYear, ageYears, pincode, area,
    ownerName: String(body.ownerName || '').trim().slice(0, 60), ownerPhone, ownerLang, ownerToken: secretToken(), consent: null,
    warrantyLikely, createdAt: at, updatedAt: at, timeline: [timelineEntry(at, extra.requestId ? 'event.jobFromRequest' : 'event.jobCreated', extra.requestId ? { id: extra.requestId } : {})],
    requestId: extra.requestId || null, customerId: extra.customerId || null,
    GSI1PK: `TECH#${me.userId}`, GSI1SK: at,
  };
  if (warrantyLikely) job.timeline.push(timelineEntry(at, 'event.warrantyWarning', { age: ageYears, years: cat.warrantyYears }, 'warning'));
  await ctx.store.put(job);
  await ctx.store.update(`USER#${me.userId}`, 'PROFILE', { add: { jobs: 1 } });
  return { job: techJob(job), passport: strip(passport), reusedPassport: existing.length > 0 };
}

/** A job as its technician may see it. Request jobs hide the owner token: only the customer decides. */
function techJob(job) {
  const out = { ...strip(job), taskToken: undefined, repairToken: undefined };
  if (job.requestId) out.ownerToken = undefined;
  return out;
}

route('POST', '/api/jobs', TECH, async (ctx, { body }, me) => createJob(ctx, me, body));

route('POST', '/api/jobs/:id/continue', TECH, async (ctx, { params, body }, me) => {
  const job = await myJob(ctx, params.id, me);
  if (job.status !== 'warranty_check') throw apiError(409, 'notWarrantyCheck');
  if (body.referToWarranty) {
    await jobTimeline(ctx, job.jobId, { key: 'event.warrantyReferral' }, 'info', { status: 'warranty_referral' });
    return { job: techJob(await getJob(ctx, job.jobId)) };
  }
  await jobTimeline(ctx, job.jobId, { key: 'event.continueHere' }, 'info', { status: 'new' });
  return { job: techJob(await getJob(ctx, job.jobId)) };
});

async function myJob(ctx, jobId, me) {
  const job = await getJob(ctx, jobId);
  if (job.techId !== me.userId && !me.isAdmin) throw apiError(403, 'otherTechJob');
  return job;
}

route('GET', '/api/jobs/:id', TECH, async (ctx, { params }, me) => {
  const job = await myJob(ctx, params.id, me);
  const reserved = (await partsReservedBy(ctx, me.userId))
    .filter((p) => ['RESERVED', 'SOLD'].includes(p.status) && p.category === job.category && p.component === job.diagnosis?.component);
  return {
    job: { ...techJob(job), hasOwnerToken: !!job.taskToken },
    photos: { diagnosis: await photo(ctx, job.diagnosis?.photoKey), after: await photo(ctx, job.repair?.afterPhotoKey), voice: await photo(ctx, job.diagnosis?.voiceNoteKey) },
    reservedParts: reserved.map(strip),
    passport: strip(await getPassport(ctx, job.pid)),
  };
});

route('POST', '/api/jobs/:id/diagnosis', TECH, async (ctx, { params, body }, me) => {
  const job = await myJob(ctx, params.id, me);
  if (job.status !== 'new') throw apiError(409, 'alreadyDiagnosed');
  requireFields(body, ['component', 'severity', 'spare', 'photoKey']);
  compOf(job.category, body.component);
  const causes = (Array.isArray(body.causes) ? body.causes : []).filter((c) => CAUSES[c]);
  if (!causes.length || causes.length > 3) throw apiError(400, 'pickCauses');
  if (!SEVERITY[body.severity]) throw apiError(400, 'pickSeverity');
  if (!SPARE[body.spare]) throw apiError(400, 'pickSpare');
  const barrier = BARRIERS[body.barrier] ? body.barrier : 'none';
  const parts = clampNumber(body.quote?.parts ?? 0, 0, 500000, 'partsCost');
  const labour = clampNumber(body.quote?.labour ?? 0, 0, 100000, 'labourCost');
  const voiceNoteKey = typeof body.voiceNoteKey === 'string' && body.voiceNoteKey.startsWith(`uploads/${me.userId}/`) ? body.voiceNoteKey : null;
  // Recorded for the owner to see. Neither changes the fair range or Punarnava's recommendation (decision.js).
  const offerWarrantyDays = clampNumber(body.offerWarrantyDays ?? 0, 0, MAX_OFFER_WARRANTY_DAYS, 'warrantyDays');
  const techSuggests = ['repair_new', 'repair_reused', 'sell', 'harvest', 'recycle'].includes(body.techSuggests) ? body.techSuggests : null;
  const diagnosis = { component: body.component, causes, severity: body.severity, spare: body.spare, barrier, photoKey: body.photoKey, voiceNoteKey, quote: { parts, labour }, offerWarrantyDays, techSuggests, note: String(body.note || '').slice(0, 300), at: iso(ctx.now()) };
  const noteLang = langOr(body.noteLang);
  if (diagnosis.note && noteLang) diagnosis.noteLang = noteLang;
  await jobTimeline(ctx, job.jobId, { key: 'event.diagnosed', params: { comp: { comp: [job.category, body.component] } } }, 'info', { diagnosis, status: 'diagnosed' });
  await ctx.store.update(`USER#${me.userId}`, 'PROFILE', { add: { trust: 2 } });
  await ctx.svc.events.emit('diagnosis.recorded', { jobId: job.jobId, category: job.category, component: body.component });
  const executionId = await ctx.svc.workflow.start({ jobId: job.jobId });
  await ctx.store.update(`JOB#${job.jobId}`, 'META', { set: { executionId } });
  return { job: techJob(await getJob(ctx, job.jobId)), ownerToken: job.requestId ? undefined : job.ownerToken };
});

route('POST', '/api/jobs/:id/complete', TECH, async (ctx, { params, body }, me) => {
  const job = await myJob(ctx, params.id, me);
  if (job.status !== 'repairing' || !job.repairToken) throw apiError(409, 'notRepairing');
  const partSource = body.partSource === 'reused' ? 'reused' : 'new';
  const amount = clampNumber(body.amount ?? 0, 0, 500000, 'amount');
  const warrantyDays = clampNumber(body.warrantyDays ?? 0, 0, 365, 'warrantyDays');
  let partId = null;
  if (partSource === 'reused') {
    requireFields(body, ['partId']);
    const part = await ctx.store.get(`PART#${body.partId}`, 'META');
    if (!part || part.reservedBy !== me.userId || !['RESERVED', 'SOLD'].includes(part.status)) throw apiError(409, 'reserveFirst');
    await ctx.store.update(`PART#${part.partId}`, 'META', { set: { status: 'INSTALLED', installedInJob: job.jobId, installedInPid: job.pid, installedAt: iso(ctx.now()), ...partIndex({ ...part, status: 'INSTALLED' }) } }, { eq: { reservedBy: me.userId } });
    await ctx.svc.scheduler.cancel(`pn-resv-${part.partId}`);
    await passportEvent(ctx, part.sourcePid, { kind: 'part_reused', key: 'event.partReused', params: { comp: { comp: [part.category, part.component] }, partId: part.partId }, partId: part.partId });
    partId = part.partId;
  }
  await ctx.svc.workflow.sendSuccess(job.repairToken, { partSource, partId, amount, warrantyDays, afterPhotoKey: body.afterPhotoKey || null });
  return { job: techJob(await getJob(ctx, job.jobId)) };
});

// ───────────────────────────── Inventory: products a technician or refurbisher holds ─────────────────────────────

route('GET', '/api/inventory', ['technician', 'recycler'], async (ctx, _i, me) => {
  const rows = await ctx.store.query({ index: 'GSI2', pk: `HOLDER#${me.userId}`, desc: true });
  return { products: rows.map(strip) };
});

async function heldPassport(ctx, pid, me) {
  const p = await getPassport(ctx, pid);
  if (p.holderId !== me.userId && !me.isAdmin) throw apiError(403, 'notHolder');
  return p;
}

async function relatedJob(ctx, p) {
  const evs = await ctx.store.query({ pk: `PASSPORT#${p.pid}`, skPrefix: 'EV#', desc: true });
  const jobId = evs.find((e) => e.jobId)?.jobId;
  return jobId ? ctx.store.get(`JOB#${jobId}`, 'META') : null;
}

route('POST', '/api/passports/:pid/harvest', ['technician', 'recycler'], async (ctx, { params, body }, me) => {
  const p = await heldPassport(ctx, params.pid, me);
  const cat = catOf(p.category);
  const list = Array.isArray(body.parts) ? body.parts : [];
  if (!list.length) throw apiError(400, 'markPart');
  const job = await relatedJob(ctx, p);
  const area = job?.area || me.area || '';
  const listed = [];
  const pickupItems = [];
  for (const entry of list) {
    const comp = cat.components.find((c) => c.id === entry.component);
    if (!comp) continue;
    if (comp.hazardous) { pickupItems.push(pickupItem('pickup.part', { comp: { comp: [p.category, comp.id] } }, { hazardous: true, estKg: comp.kg })); continue; }
    if (entry.condition === 'dead' || !comp.harvest) { pickupItems.push(pickupItem('pickup.deadPart', { comp: { comp: [p.category, comp.id] } }, { hazardous: false, estKg: comp.kg })); continue; }
    const price = clampNumber(entry.price ?? comp.harvest, 0, 200000, 'partPrice');
    const partId = newId('PT', 6);
    const at = iso(ctx.now());
    const part = {
      PK: `PART#${partId}`, SK: 'META', type: 'part', partId, category: p.category, component: comp.id, brand: p.brand, model: p.model,
      sourcePid: p.pid, sourceJob: job?.jobId || null, condition: entry.condition === 'working' ? 'working' : 'untested',
      price, kg: comp.kg, photoKey: entry.photoKey || null, sellerId: me.userId, sellerName: me.shop || me.name, area, status: 'LISTED', createdAt: at,
      GSI1PK: `SELLER#${me.userId}`, GSI1SK: at,
    };
    Object.assign(part, partIndex(part));
    await ctx.store.put(part);
    listed.push(strip(part));
    await passportEvent(ctx, p.pid, { kind: 'harvest', key: 'event.harvested', params: { comp: { comp: [p.category, comp.id] }, cond: { msg: `cond.${part.condition}` }, partId }, partId });
  }
  const used = new Set(list.map((x) => x.component));
  for (const comp of cat.components.filter((c) => c.hazardous && !used.has(c.id))) pickupItems.push(pickupItem('pickup.part', { comp: { comp: [p.category, comp.id] } }, { hazardous: true, estKg: comp.kg }));
  const partsKg = listed.reduce((s, x) => s + x.kg, 0);
  pickupItems.push(pickupItem('pickup.remainder', { cat: { cat: p.category } }, { hazardous: false, estKg: Math.max(0.1, Math.round((cat.kg - partsKg - pickupItems.reduce((s, i) => s + i.estKg, 0)) * 10) / 10) }));
  await setHolder(ctx, p.pid, null, 'harvested');
  const pickup = await createPickup(ctx, { pid: p.pid, jobId: job?.jobId, category: p.category, items: pickupItems, area, requestedBy: me.userId });
  for (const part of listed) await ctx.svc.events.emit('part.listed', part);
  if (job && ['awaiting_harvest', 'sold'].includes(job.status)) await jobTimeline(ctx, job.jobId, { key: 'event.harvestDone', params: { n: listed.length, pickupId: pickup.pickupId } }, 'done', { status: 'harvested' });
  return { parts: listed, pickup: strip(pickup) };
});

route('POST', '/api/passports/:pid/transfer', ['technician'], async (ctx, { params, body }, me) => {
  const p = await heldPassport(ctx, params.pid, me);
  requireFields(body, ['refurbisherId']);
  const r = await getProfile(ctx, body.refurbisherId);
  if (!r || r.role !== 'recycler' || r.status !== 'active' || !['refurbisher', 'both'].includes(r.orgType)) throw apiError(400, 'pickRefurbisher');
  await setHolder(ctx, p.pid, r.userId, 'with_refurbisher');
  await passportEvent(ctx, p.pid, { kind: 'transfer', key: 'event.transferred', params: { name: r.name, regNo: r.regNo || '' }, by: me.userId });
  const job = await relatedJob(ctx, p);
  if (job && job.status === 'sold') await jobTimeline(ctx, job.jobId, { key: 'event.sentToRefurbisher', params: { name: r.name } }, 'done', { status: 'with_refurbisher' });
  await notifyUser(ctx, r.userId, { key: 'notif.incomingProduct', params: { brand: p.brand, model: p.model, from: me.shop || me.name }, link: '#/r' });
  return { ok: true };
});

route('POST', '/api/passports/:pid/recycle', ['technician', 'recycler'], async (ctx, { params }, me) => {
  const p = await heldPassport(ctx, params.pid, me);
  const cat = catOf(p.category);
  const job = await relatedJob(ctx, p);
  await setHolder(ctx, p.pid, null, 'recycling');
  const pickup = await createPickup(ctx, {
    pid: p.pid, jobId: job?.jobId, category: p.category, area: job?.area || me.area || '', requestedBy: me.userId, wholeProduct: true,
    items: [pickupItem('pickup.whole', { cat: { cat: p.category }, brand: p.brand, model: p.model }, { hazardous: cat.components.some((c) => c.hazardous), estKg: cat.kg })],
  });
  if (job && ['sold', 'awaiting_harvest'].includes(job.status)) await jobTimeline(ctx, job.jobId, { key: 'event.sentForRecycling', params: { pickupId: pickup.pickupId } }, 'done', { status: 'recycling' });
  return { pickup: strip(pickup) };
});

// ───────────────────────────── Parts Exchange ─────────────────────────────

route('GET', '/api/parts/search', TECH, async (ctx, { query }, me) => {
  requireFields(query, ['category', 'component']);
  compOf(query.category, query.component);
  const area = query.area === 'all' ? '' : query.area || me.area;
  const parts = await searchParts(ctx, { category: query.category, component: query.component, brand: query.brand, model: query.model, area, excludeSeller: me.userId });
  const filtered = query.area === 'all' ? parts : parts.filter((p) => !area || p.area === area || query.area === 'any');
  return { parts: await Promise.all(filtered.slice(0, 40).map(async (p) => ({ ...strip(p), photoUrl: await photo(ctx, p.photoKey), areaName: areaName(p.area) }))), area };
});

route('GET', '/api/parts/mine', TECH, async (ctx, _i, me) => {
  const selling = await ctx.store.query({ index: 'GSI1', pk: `SELLER#${me.userId}`, desc: true });
  const buying = await partsReservedBy(ctx, me.userId);
  return {
    selling: await Promise.all(selling.map(async (p) => ({ ...strip(p), photoUrl: await photo(ctx, p.photoKey), areaName: areaName(p.area) }))),
    buying: await Promise.all(buying.map(async (p) => ({ ...strip(p), photoUrl: await photo(ctx, p.photoKey), areaName: areaName(p.area) }))),
  };
});

route('POST', '/api/parts/:id/reserve', TECH, async (ctx, { params }, me) => {
  const part = await ctx.store.get(`PART#${params.id}`, 'META');
  if (!part) throw apiError(404, 'partGone');
  if (part.sellerId === me.userId) throw apiError(400, 'ownPart');
  const p = await reservePart(ctx, params.id, me.userId);
  await ctx.store.update(`PART#${params.id}`, 'META', { set: { buyerName: me.shop || me.name } });
  await notifyUser(ctx, part.sellerId, { key: 'notif.partReserved', params: { partId: part.partId, buyer: me.shop || me.name, comp: { comp: [part.category, part.component] } }, link: '#/parts' });
  return { part: strip({ ...p, status: 'RESERVED' }) };
});

route('POST', '/api/parts/:id/handover', TECH, async (ctx, { params }, me) => {
  const part = await ctx.store.get(`PART#${params.id}`, 'META');
  if (!part || part.sellerId !== me.userId) throw apiError(403, 'sellerOnly');
  if (part.status !== 'RESERVED') throw apiError(409, 'notReserved');
  await ctx.store.update(`PART#${part.partId}`, 'META', { set: { status: 'SOLD', soldAt: iso(ctx.now()), ...partIndex({ ...part, status: 'SOLD' }) } }, { eq: { status: 'RESERVED' } });
  await ctx.svc.scheduler.cancel(`pn-resv-${part.partId}`);
  await ctx.svc.events.emit('part.sold', { partId: part.partId, price: part.price, sellerId: me.userId });
  await notifyUser(ctx, part.reservedBy, { key: 'notif.partHandedOver', params: { partId: part.partId }, link: '#/t' });
  return { ok: true };
});

route('POST', '/api/parts/:id/release', TECH, async (ctx, { params }, me) => {
  const part = await ctx.store.get(`PART#${params.id}`, 'META');
  if (!part || part.status !== 'RESERVED' || (part.reservedBy !== me.userId && part.sellerId !== me.userId)) throw apiError(409, 'nothingToRelease');
  await ctx.store.update(`PART#${part.partId}`, 'META', { set: { status: 'LISTED', reservedBy: null, reservedUntil: 0, buyerName: null, ...partIndex({ ...part, status: 'LISTED' }) } });
  await ctx.store.delete(`USER#${part.reservedBy}`, `RESV#${part.partId}`);
  await ctx.svc.scheduler.cancel(`pn-resv-${part.partId}`);
  return { ok: true };
});

route('GET', '/api/searches', TECH, async (ctx, _i, me) => ({ searches: (await ctx.store.query({ pk: `USER#${me.userId}`, skPrefix: 'SEARCH#' })).map(strip) }));

route('POST', '/api/searches', TECH, async (ctx, { body }, me) => {
  requireFields(body, ['category', 'component']);
  compOf(body.category, body.component);
  const id = randomString(6);
  const s = { PK: `USER#${me.userId}`, SK: `SEARCH#${id}`, type: 'search', searchId: id, userId: me.userId, category: body.category, component: body.component, brand: body.brand || '', model: body.model || '', area: body.area === 'all' ? '' : body.area || me.area || '', createdAt: iso(ctx.now()), GSI2PK: `SEARCH#${body.category}#${body.component}`, GSI2SK: `${me.userId}#${id}` };
  await ctx.store.put(s);
  return { search: strip(s) };
});

route('DELETE', '/api/searches/:id', TECH, async (ctx, { params }, me) => {
  await ctx.store.delete(`USER#${me.userId}`, `SEARCH#${params.id}`);
  return { ok: true };
});

// ───────────────────────────── Kabadi Connect ─────────────────────────────

route('GET', '/api/recyclers', 'any', async (ctx, { query }) => {
  const rows = await usersByRole(ctx, 'recycler');
  const type = query.type;
  return { recyclers: rows.filter((r) => !type || r.orgType === type || r.orgType === 'both').map(publicProfile) };
});

route('GET', '/api/pickups/open', ['collector'], async (ctx, { query }, me) => {
  const prefix = query.area === 'all' ? '' : me.area || '';
  const rows = await ctx.store.query({ index: 'GSI2', pk: 'PICKUPS#OPEN', skPrefix: prefix });
  return { pickups: rows.map((p) => ({ ...strip(p), areaName: areaName(p.area) })), area: prefix };
});

route('GET', '/api/pickups/mine', ['collector'], async (ctx, _i, me) => {
  const rows = await ctx.store.query({ index: 'GSI1', pk: `COLLECTOR#${me.userId}`, desc: true });
  return { pickups: await Promise.all(rows.map(async (p) => ({ ...strip(p), areaName: areaName(p.area), photoUrl: await photo(ctx, p.photoKey) }))) };
});

route('GET', '/api/pickups/requested', ['technician', 'recycler'], async (ctx, _i, me) => {
  const ptrs = await ctx.store.query({ pk: `USER#${me.userId}`, skPrefix: 'PICKUP#', desc: true, limit: 50 });
  const out = [];
  for (const x of ptrs) {
    const p = await ctx.store.get(`PICKUP#${x.pickupId}`, 'META');
    if (p) out.push({ ...strip(p), areaName: areaName(p.area) });
  }
  return { pickups: out };
});

async function getPickup(ctx, id) {
  const p = await ctx.store.get(`PICKUP#${id}`, 'META');
  if (!p) throw apiError(404, 'noPickup', { id });
  return p;
}

route('POST', '/api/pickups/:id/accept', ['collector'], async (ctx, { params }, me) => {
  const p = await getPickup(ctx, params.id);
  try {
    await ctx.store.update(`PICKUP#${p.pickupId}`, 'META', { set: { status: 'ACCEPTED', collectorId: me.userId, collectorName: me.name, acceptedAt: iso(ctx.now()), GSI2PK: 'PICKUPS#ACCEPTED', GSI1PK: `COLLECTOR#${me.userId}`, GSI1SK: iso(ctx.now()) } }, { eq: { status: 'OPEN' } });
  } catch (e) {
    if (e.code === 'ConditionFailed') throw apiError(409, 'pickupTaken');
    throw e;
  }
  await notifyUser(ctx, p.requestedBy, { key: 'notif.pickupAccepted', params: { pickupId: p.pickupId, name: me.name }, link: '#/inventory' });
  return { ok: true };
});

route('POST', '/api/pickups/:id/collect', ['collector'], async (ctx, { params, body }, me) => {
  const p = await getPickup(ctx, params.id);
  if (p.collectorId !== me.userId || p.status !== 'ACCEPTED') throw apiError(409, 'acceptFirst');
  const weightKg = clampNumber(body.weightKg, 0.01, 2000, 'weight');
  requireFields(body, ['photoKey']);
  const missing = p.gates.filter((g) => body.gates?.[g] !== true);
  if (missing.length) throw apiError(400, 'gatesMissing', { gate: { gate: missing[0] }, count: missing.length });
  await ctx.store.update(`PICKUP#${p.pickupId}`, 'META', { set: { status: 'COLLECTED', weightKg, photoKey: body.photoKey, gatesDone: body.gates, collectedAt: iso(ctx.now()), GSI2PK: 'PICKUPS#COLLECTED' } });
  if (p.pid) await passportEvent(ctx, p.pid, { kind: 'collected', key: 'event.collected', params: { name: me.name, kg: { kg: weightKg } } });
  if (p.jobId) await notifyJobCustomer(ctx, await ctx.store.get(`JOB#${p.jobId}`, 'META'), { key: 'cnotif.collected', params: { kg: { kg: weightKg } } });
  return { ok: true };
});

route('POST', '/api/pickups/:id/deliver', ['collector'], async (ctx, { params, body }, me) => {
  const p = await getPickup(ctx, params.id);
  if (p.collectorId !== me.userId || p.status !== 'COLLECTED') throw apiError(409, 'collectFirst');
  const r = await getProfile(ctx, body.recyclerId);
  if (!r || r.role !== 'recycler' || r.status !== 'active' || !['recycler', 'both'].includes(r.orgType)) throw apiError(400, 'pickRecycler');
  await ctx.store.update(`PICKUP#${p.pickupId}`, 'META', { set: { status: 'DELIVERED', recyclerId: r.userId, recyclerName: r.name, deliveredAt: iso(ctx.now()), GSI2PK: `INCOMING#${r.userId}`, GSI2SK: iso(ctx.now()) } });
  await notifyUser(ctx, r.userId, { key: 'notif.deliveryWaiting', params: { kg: { kg: p.weightKg }, name: me.name }, link: '#/r' });
  return { ok: true };
});

route('GET', '/api/recycler/incoming', ['recycler'], async (ctx, _i, me) => {
  const rows = await ctx.store.query({ index: 'GSI2', pk: `INCOMING#${me.userId}`, desc: true });
  return { pickups: await Promise.all(rows.map(async (p) => ({ ...strip(p), photoUrl: await photo(ctx, p.photoKey) }))) };
});

route('POST', '/api/pickups/:id/confirm', ['recycler'], async (ctx, { params, body }, me) => {
  const p = await getPickup(ctx, params.id);
  if (p.recyclerId !== me.userId || p.status !== 'DELIVERED') throw apiError(409, 'notYourDelivery');
  if (!me.regNo) throw apiError(400, 'regNoFirst');
  const weightKg = clampNumber(body.weightKg ?? p.weightKg, 0.01, 2000, 'weight');
  const payout = Math.round(weightKg * p.rate);
  try {
    await ctx.store.update(`PICKUP#${p.pickupId}`, 'META', { set: { status: 'CONFIRMED', confirmedWeightKg: weightKg, payout, regNo: me.regNo, confirmedAt: iso(ctx.now()), GSI2PK: 'PICKUPS#CONFIRMED', GSI2SK: iso(ctx.now()) } }, { eq: { status: 'DELIVERED', recyclerId: me.userId } });
  } catch (e) {
    if (e.code === 'ConditionFailed') throw apiError(409, 'notYourDelivery');
    throw e;
  }
  if (p.pid) {
    await passportEvent(ctx, p.pid, { kind: 'recycled', key: 'event.recycledReceived', params: { name: me.name, regNo: me.regNo, kg: { kg: weightKg } } });
    if (p.wholeProduct) await ctx.store.update(`PASSPORT#${p.pid}`, 'META', { set: { status: 'recycled' } });
  }
  if (p.jobId) {
    const job = await ctx.store.get(`JOB#${p.jobId}`, 'META');
    if (job && job.status === 'recycling') await jobTimeline(ctx, job.jobId, { key: 'event.recycledJob', params: { name: me.name, regNo: me.regNo } }, 'done', { status: 'recycled' });
  }
  // Verified recycling: a registered recycler (CPCB registration on file) accepted it, with weight and the collector's photo.
  if (p.jobId) {
    const job = await ctx.store.get(`JOB#${p.jobId}`, 'META');
    if (job && p.photoKey) {
      await award(ctx, job, 'recycle', p.pickupId, { weightKg, regNo: me.regNo, recycler: me.name, photo: true, wholeProduct: !!p.wholeProduct });
      await notifyJobCustomer(ctx, job, { key: 'cnotif.recycled', params: { kg: { kg: weightKg }, name: me.name, regNo: me.regNo } });
    }
  }
  await ctx.svc.events.emit('handoff.confirmed', { pickupId: p.pickupId, weightKg, payout, collectorId: p.collectorId });
  await notifyUser(ctx, p.collectorId, { key: 'notif.payout', params: { money: { money: payout }, pickupId: p.pickupId, name: me.name, kg: { kg: weightKg }, rate: { money: p.rate } }, link: '#/c' });
  await notifyUser(ctx, p.requestedBy, { key: 'notif.pickupRecycled', params: { pickupId: p.pickupId }, link: '#/inventory' });
  return { ok: true, payout };
});

// ───────────────────────────── ReLife Marketplace ─────────────────────────────

// Labels: MSG['check.<id>']; data_wiped is a GATE.
const RESALE_CHECKS = ['tested', 'safety', 'cleaned'];

route('POST', '/api/listings', ['recycler'], async (ctx, { body }, me) => {
  if (!['refurbisher', 'both'].includes(me.orgType)) throw apiError(403, 'refurbOnly');
  requireFields(body, ['pid', 'price', 'photoKey']);
  const p = await heldPassport(ctx, body.pid, me);
  const checks = body.checklist || {};
  const needed = [...RESALE_CHECKS, ...(['smartphone', 'laptop'].includes(p.category) ? ['data_wiped'] : [])];
  const missing = needed.filter((k) => checks[k] !== true);
  if (missing.length) throw apiError(400, 'checklistMissing', { item: RESALE_CHECKS.includes(missing[0]) ? { msg: `check.${missing[0]}` } : { gate: missing[0] }, count: missing.length });
  const listingId = newId('L', 6);
  const at = iso(ctx.now());
  const cat = catOf(p.category);
  const listing = {
    PK: `LISTING#${listingId}`, SK: 'META', type: 'listing', listingId, pid: p.pid, refurbisherId: me.userId, refurbisherName: me.name,
    title: String(body.title || `${p.brand} ${p.model} ${cat.en.toLowerCase()}`).slice(0, 80), titleCustom: !!body.title, price: clampNumber(body.price, 1, 500000, 'price'),
    warrantyMonths: clampNumber(body.warrantyMonths ?? 3, 0, 24, 'warrantyMonths'), checklist: checks, photoKey: body.photoKey,
    category: p.category, brand: p.brand, model: p.model, purchaseYear: p.purchaseYear, repairs: p.repairs || 0, area: me.area || '', status: 'ACTIVE', leads: 0, createdAt: at,
    GSI1PK: `REFURB#${me.userId}`, GSI1SK: at, GSI2PK: 'LISTINGS#ACTIVE', GSI2SK: at,
  };
  await ctx.store.put(listing);
  await ctx.store.update(`PASSPORT#${p.pid}`, 'META', { set: { status: 'listed', listingId } });
  await passportEvent(ctx, p.pid, { kind: 'listed', key: 'event.listed', params: { name: me.name, regNo: me.regNo || '', months: listing.warrantyMonths } });
  return { listing: strip(listing) };
});

route('GET', '/api/listings/mine', ['recycler'], async (ctx, _i, me) => {
  const rows = await ctx.store.query({ index: 'GSI1', pk: `REFURB#${me.userId}`, desc: true });
  const out = [];
  for (const l of rows) {
    const leads = await ctx.store.query({ pk: `LISTING#${l.listingId}`, skPrefix: 'LEAD#', desc: true });
    out.push({ ...strip(l), photoUrl: await photo(ctx, l.photoKey), leadList: leads.map(strip) });
  }
  return { listings: out };
});

route('POST', '/api/listings/:id/sold', ['recycler'], async (ctx, { params, body }, me) => {
  const l = await ctx.store.get(`LISTING#${params.id}`, 'META');
  if (!l || l.refurbisherId !== me.userId) throw apiError(403, 'notYourListing');
  if (l.status !== 'ACTIVE') throw apiError(409, 'listingClosed');
  try {
    await ctx.store.update(`LISTING#${l.listingId}`, 'META', { set: { status: 'SOLD', soldAt: iso(ctx.now()), GSI2PK: 'LISTINGS#SOLD' } }, { eq: { status: 'ACTIVE' } });
  } catch (e) {
    if (e.code === 'ConditionFailed') throw apiError(409, 'listingClosed');
    throw e;
  }
  const set = { status: 'in_use', listingId: null };
  const buyerPhone = normalizePhone(body.buyerPhone);
  if (buyerPhone.length === 10) {
    const h = await sha256(`pn:${buyerPhone}`);
    Object.assign(set, { GSI1PK: `OWNER#${h}`, GSI1SK: `${l.brand}#${l.model}#${l.pid}` });
  }
  await ctx.store.update(`PASSPORT#${l.pid}`, 'META', { set, remove: ['GSI2PK', 'GSI2SK', 'holderId'] });
  await passportEvent(ctx, l.pid, { kind: 'resold', key: 'event.resold', params: { months: l.warrantyMonths } });
  // Verified resale by a registered refurbisher: reward the owner who chose to sell this product.
  const sellJob = await sellingJob(ctx, l.pid);
  if (sellJob) {
    await award(ctx, sellJob, 'resale', l.listingId, { refurbisher: me.name, regNo: me.regNo || '', warrantyMonths: l.warrantyMonths });
    await notifyJobCustomer(ctx, sellJob, { key: 'cnotif.resold', params: { months: l.warrantyMonths } });
  }
  await ctx.svc.events.emit('listing.sold', { listingId: l.listingId, kg: catOf(l.category).kg, price: l.price });
  return { ok: true };
});

/** The job in which the owner chose to sell this product (most recent decision on the passport). */
async function sellingJob(ctx, pid) {
  const evs = await ctx.store.query({ pk: `PASSPORT#${pid}`, skPrefix: 'EV#', desc: true });
  for (const e of evs.filter((x) => x.kind === 'decision' && x.jobId)) {
    const j = await ctx.store.get(`JOB#${e.jobId}`, 'META');
    if (j?.decision?.option === 'sell') return j;
  }
  return null;
}

// ───────────────────────────── Component Intelligence ─────────────────────────────

function brandFor(me, query) {
  if (me.isAdmin) return query.brand;
  if (!me.brandId) throw apiError(403, 'noBrandLink');
  return me.brandId;
}

route('GET', '/api/insights/brands', ['brand'], async (ctx, _i, me) => {
  if (!me.isAdmin) return { brands: [{ brand: me.brandId }] };
  return { brands: (await ctx.store.query({ pk: 'BRANDS' })).filter((b) => b.n > 0).map(strip) };
});

route('GET', '/api/insights/models', ['brand'], async (ctx, { query }, me) => {
  const brand = brandFor(me, query);
  if (!brand) throw apiError(400, 'pickBrand');
  const models = await ctx.store.query({ pk: `BRAND#${brand}`, skPrefix: 'MODEL#' });
  const alerts = await ctx.store.query({ pk: `ALERTS#${brand}`, desc: true });
  return { brand, models: models.filter((m) => (m.n || 0) > 0).map(strip), alerts: alerts.map(strip), minSample: MIN_SAMPLE };
});

route('GET', '/api/insights/report', ['brand'], async (ctx, { query }, me) => {
  const brand = brandFor(me, query);
  requireFields(query, ['model']);
  const total = await ctx.store.get(`AGG#${brand}#${query.model}`, 'TOTAL');
  if (!total) throw apiError(404, 'noReportData', { brand, model: query.model });
  const comps = await ctx.store.query({ pk: `AGG#${brand}#${query.model}`, skPrefix: 'COMP#' });
  const alerts = (await ctx.store.query({ pk: `ALERTS#${brand}`, desc: true })).filter((a) => a.model === query.model).map(strip);
  const lastRun = strip(await ctx.store.get('SYSTEM', 'ANOMALY_LAST'));
  return { report: buildModelReport(total, comps, alerts), detector: lastRun };
});

// Downloadable PDF report. Scope is enforced here: a brand user only ever gets their own brand (brandFor),
// and a model must belong to that brand. Built from anonymous aggregates only (report.js).
route('GET', '/api/insights/pdf', ['brand'], async (ctx, { query }, me) => {
  const brand = brandFor(me, query);
  if (!brand) throw apiError(400, 'pickBrand');
  const from = query.from ? String(query.from) : null;
  const to = query.to ? String(query.to) : null;
  if ((from && !validMonth(from)) || (to && !validMonth(to)) || (from && to && from > to)) throw apiError(400, 'badPeriod');
  const known = await ctx.store.query({ pk: `BRAND#${brand}`, skPrefix: 'MODEL#' });
  let list = [];
  if (query.model) {
    const model = String(query.model).toUpperCase().slice(0, 30);
    const row = known.find((m) => m.model === model);
    const category = row?.category || Object.entries(BRANDS[brand]?.models || {}).find(([, ms]) => ms.includes(model))?.[0];
    if (!category) throw apiError(404, 'noReportData', { brand, model });
    list = [{ model, category }];
  } else if (query.category) {
    catOf(query.category);
    const names = new Set([...known.filter((m) => m.category === query.category).map((m) => m.model), ...catalogModels(brand, query.category)]);
    list = [...names].map((model) => ({ model, category: query.category }));
  } else {
    list = known.map((m) => ({ model: m.model, category: m.category }));
  }
  const models = [];
  for (const m of list) {
    const pk = `AGG#${brand}#${m.model}`;
    models.push({
      ...m,
      total: await ctx.store.get(pk, 'TOTAL'),
      comps: await ctx.store.query({ pk, skPrefix: 'COMP#' }),
      alerts: (await ctx.store.query({ pk: `ALERTS#${brand}`, desc: true })).filter((a) => a.model === m.model).map(strip),
    });
  }
  const generatedAt = iso(ctx.now());
  const filters = { model: query.model ? String(query.model).toUpperCase() : null, category: query.category || null, from, to };
  const { doc, facts } = buildReportDoc({ brand, models, filters, generatedAt, detector: strip(await ctx.store.get('SYSTEM', 'ANOMALY_LAST')) });
  const bytes = renderPdf(doc);
  ctx.svc.metrics?.emit?.('brandReports', 1);
  return { filename: reportFilename({ brand, model: filters.model, category: filters.category, generatedAt }), contentType: 'application/pdf', size: bytes.length, base64: toBase64(bytes), facts };
});

// ───────────────────────────── Admin ─────────────────────────────

const ADMIN = ['admin'];

route('GET', '/api/admin/overview', ADMIN, async (ctx) => {
  const pending = [...(await ctx.store.query({ index: 'GSI1', pk: 'ROLE#recycler', skPrefix: 'pending#' })), ...(await ctx.store.query({ index: 'GSI1', pk: 'ROLE#brand', skPrefix: 'pending#' }))];
  const pendingModels = await ctx.store.query({ pk: 'CATALOG', skPrefix: 'PENDING#' });
  return {
    pending: pending.map(strip),
    pendingModels: pendingModels.map(strip),
    impact: strip(await ctx.store.get('IMPACT', 'GLOBAL')) || {},
    seed: strip(await ctx.store.get('SYSTEM', 'SEED_LAST')),
    anomaly: strip(await ctx.store.get('SYSTEM', 'ANOMALY_LAST')),
    mlConfigured: !!ctx.svc.ml.configured,
    outbox: ctx.state?.outbox?.slice(0, 15) || null,
  };
});

route('POST', '/api/admin/approve', ADMIN, async (ctx, { body }) => {
  requireFields(body, ['userId']);
  const p = await getProfile(ctx, body.userId);
  if (!p) throw apiError(404, 'noUser');
  const next = { ...p, status: 'active' };
  await ctx.store.update(p.PK, p.SK, { set: { status: 'active', ...profileIndex(next) } });
  await notifyUser(ctx, p.userId, { key: 'notif.approved', link: '#/' });
  return { ok: true };
});

route('POST', '/api/admin/catalog/model', ADMIN, async (ctx, { body }) => {
  requireFields(body, ['category', 'brand', 'model']);
  catOf(body.category);
  const model = String(body.model).toUpperCase();
  await ctx.store.put({ PK: 'CATALOG', SK: `MODEL#${body.category}#${body.brand}#${model}`, type: 'model', category: body.category, brand: body.brand, model });
  await ctx.store.delete('CATALOG', `PENDING#${body.category}#${body.brand}#${model}`);
  return { ok: true };
});

route('GET', '/api/admin/users', ADMIN, async (ctx) => {
  const out = [];
  for (const role of SIGNUP_ROLES) out.push(...(await ctx.store.query({ index: 'GSI1', pk: `ROLE#${role}` })));
  return { users: out.map((p) => ({ userId: p.userId, name: p.name, email: p.email || '', role: p.role, status: p.status, area: p.area || '', brandId: p.brandId || '', shop: p.shop || '', trust: p.trust, jobs: p.jobs || 0, createdAt: p.createdAt })) };
});

route('POST', '/api/admin/users/status', ADMIN, async (ctx, { body }, me) => {
  requireFields(body, ['userId', 'status']);
  if (!['active', 'suspended'].includes(body.status)) throw apiError(400, 'badStatus');
  if (body.userId === me.userId) throw apiError(400, 'selfSuspend');
  const p = await getProfile(ctx, body.userId);
  if (!p) throw apiError(404, 'noUser');
  await ctx.store.update(p.PK, p.SK, { set: { status: body.status, ...profileIndex({ ...p, status: body.status }) } });
  if (ctx.svc.users) await ctx.svc.users.setEnabled(p.userId, body.status === 'active');
  await notifyUser(ctx, p.userId, { key: body.status === 'active' ? 'notif.reactivated' : 'notif.suspended' });
  return { ok: true };
});

route('POST', '/api/admin/seed', ADMIN, async (ctx, { body }) => ({ result: await ctx.svc.async.invoke('seed', { count: body.count ?? 6000 }, { wait: false }) }));

route('POST', '/api/admin/anomaly', ADMIN, async (ctx) => ({ result: await ctx.svc.async.invoke('anomaly', {}, { wait: true }) }));

// Cloud read-aloud and voice typing (core/speech.js).
for (const [method, pattern, access, fn] of speechRoutes({ ownerJob })) route(method, pattern, access, fn);
// Customer requests, technician matching, journey and Green Passport (core/requests.js).
for (const [method, pattern, access, fn] of requestRoutes({ createJob, techJob })) route(method, pattern, access, fn);
// Search (OpenSearch or store fallback, core/search.js) and the grounded assistant (core/assist.js).
for (const [method, pattern, access, fn] of [...searchRoutes(), ...assistRoutes()]) route(method, pattern, access, fn);

export { routes, OPTION_TEXT, maskPhone };
