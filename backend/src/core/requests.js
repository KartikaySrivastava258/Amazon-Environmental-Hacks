// Customer repair requests → technician matching (explicit request/accept) → job, plus the circular journey
// tracker and the Customer Green Passport routes. Registered by api.js like speechRoutes.
//
// Privacy rules enforced here:
//   - Matched technicians see the request without the customer's name, phone or pincode (area name only).
//   - Only the technician who ACCEPTS sees contact details, and only because the customer consented to sharing.
//   - Jobs created from a request never return the owner token to the technician: the customer opens their
//     options from their own request link, so the technician cannot choose for them.
import { CATEGORIES, areaOf, areaName, category as catOf } from './catalog.js';
import { getProfile, getJob, notifyUser, usersByRole } from './records.js';
import { iso, newId, secretToken, normalizePhone, requireFields, apiError, randomString, langOr, format } from './util.js';
import { rateLimit } from './speech.js';
import {
  REWARD_RULES, publicRules, summarize, customerByLink, createCustomer, existingCustomer, linkJob, customerJobs,
  customerRewards, jobRewards, notifyCustomer,
} from './rewards.js';

export const SYMPTOMS = ['not_starting', 'no_power', 'noise', 'leak', 'overheating', 'error_code', 'physical_damage', 'not_cooling', 'other'];
export const AGE_BANDS = { '0-1': 0.5, '1-3': 2, '3-5': 4, '5-10': 7, '10+': 12, unknown: null };
export const CONTACT = ['call', 'whatsapp', 'sms'];
export const MAX_MATCHES = 5;
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const REQUEST_PHOTO_PREFIX = 'uploads/req/';

const strip = (item) => {
  if (!item) return item;
  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...rest } = item;
  return rest;
};
const ipWho = (ip) => `ip:${ip || 'unknown'}`;
const LIMITS = { matchPerIp: 30, createPerIp: 5, uploadPerIp: 10 };
const limits = (ctx) => ({ ...LIMITS, ...(ctx.config?.requests || {}) });

// ── Matching (pure) ──

/**
 * Rank technicians for a request. Rules, in order:
 *   1. active technician with a complete profile and a pincode (usersByRole only returns active ones)
 *   2. same area (first 3 pincode digits) or a nearby area (same first 2 digits); others are not suggested
 *   3. lists this product category, or lists no categories at all (a general shop)
 * Score: area, then category expertise, then trust and owner-verified repairs. Each reason is returned so the
 * customer can see why a technician is suggested. Availability is NOT known: the technician must accept.
 */
export function matchTechnicians({ category, pincode }, techs) {
  const area = areaOf(pincode);
  const out = [];
  for (const t of techs) {
    if (t.role !== 'technician' || t.status !== 'active' || !t.pincode) continue;
    const same = t.area === area;
    const near = !same && String(t.pincode).slice(0, 2) === String(pincode).slice(0, 2);
    if (!same && !near) continue;
    const cats = Array.isArray(t.categories) ? t.categories : [];
    const knows = cats.includes(category);
    if (!knows && cats.length) continue;
    const trust = Number(t.trust) || 0;
    const verified = Number(t.verifiedJobs) || 0;
    const reasons = [
      knows ? { key: 'match.category', params: { cat: { cat: category } } } : { key: 'match.general', params: {} },
      same ? { key: 'match.sameArea', params: { area: { area } } } : { key: 'match.nearArea', params: { area: { area: t.area } } },
      { key: 'match.trust', params: { n: trust } },
      ...(verified ? [{ key: 'match.verified', params: { n: verified } }] : []),
    ];
    out.push({
      userId: t.userId, name: t.name, shop: t.shop || '', area: t.area, areaName: areaName(t.area), trust, verifiedJobs: verified,
      score: (same ? 100 : 40) + (knows ? 50 : 0) + Math.min(trust, 100) / 2 + Math.min(verified, 20), reasons,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_MATCHES);
}

async function matchesFor(ctx, category, pincode) {
  return matchTechnicians({ category, pincode }, await usersByRole(ctx, 'technician'));
}

// ── Journey (pure over loaded records) ──

const STAGES = ['submitted', 'assigned', 'diagnosis', 'decision', 'progress', 'verified'];

/**
 * The circular journey of one request/job. Each stage: { id, state: done|current|todo|stopped|problem, at, key, params }.
 * A recycling journey is only "verified" once the registered recycler confirms receipt (pickup CONFIRMED);
 * a repair only once the owner confirms it works. Verified outcomes are the same events that write rewards.
 */
export function journeyOf({ request = null, job = null, pickups = [], rewards = [] }) {
  const s = Object.fromEntries(STAGES.map((id) => [id, { id, state: 'todo', at: null, key: null, params: {} }]));
  const set = (id, state, at = null, key = null, params = {}) => Object.assign(s[id], { state, at, key, params });
  if (request) set('submitted', 'done', request.createdAt, 'journey.d.request');
  else if (job) set('submitted', 'done', job.createdAt, 'journey.d.walkIn');
  if (request?.status === 'cancelled') set('assigned', 'stopped', request.cancelledAt, 'journey.d.cancelled');
  else if (request?.status === 'no_match') set('assigned', 'stopped', request.updatedAt, 'journey.d.noMatch');
  else if (request?.assignedTech) set('assigned', 'done', request.assignedAt, 'journey.d.assigned', { shop: request.assignedShop || '' });
  else if (job) set('assigned', 'done', job.createdAt, 'journey.d.walkInTech');
  else if (request) set('assigned', 'current', null, 'journey.d.waitingTech');
  const option = job?.decision?.option;
  if (job) {
    if (job.diagnosis) set('diagnosis', 'done', job.diagnosis.at, 'journey.d.diagnosed', { comp: { comp: [job.category, job.diagnosis.component] } });
    else if (['warranty_referral'].includes(job.status)) set('diagnosis', 'stopped', job.updatedAt, 'journey.d.warranty');
    else if (s.assigned.state === 'done') set('diagnosis', 'current', null, 'journey.d.inspecting');
    if (job.decision) set('decision', 'done', job.decision.at, 'journey.d.chose', { opt: { opt: option } });
    else if (job.status === 'no_decision') set('decision', 'stopped', job.updatedAt, 'journey.d.noDecision');
    else if (job.status === 'awaiting_owner') set('decision', 'current', null, 'journey.d.yourChoice');
  }
  const has = (kind) => rewards.find((r) => r.kind === kind);
  const steps = [];
  if (option) {
    if (option.startsWith('repair')) {
      if (job.repair) set('progress', 'done', job.repair.at, option === 'repair_reused' ? 'journey.d.repairedReused' : 'journey.d.repairedNew');
      else if (job.status === 'repair_overdue') set('progress', 'stopped', job.updatedAt, 'journey.d.overdue');
      else set('progress', 'current', null, 'journey.d.repairing');
      if (job.verified === true) set('verified', 'done', job.verifiedAt || job.updatedAt, 'journey.d.works');
      else if (job.verified === false) set('verified', 'problem', job.verifiedAt || job.updatedAt, 'journey.d.notWorking');
      else if (job.repair) set('verified', 'current', null, 'journey.d.confirmWorks');
    } else if (option === 'recycle' || option === 'harvest') {
      const p = pickups.find((x) => x.wholeProduct) || pickups[0];
      if (option === 'harvest') {
        if (['harvested'].includes(job.status) || p) set('progress', 'done', p?.createdAt || job.updatedAt, 'journey.d.harvested');
        else set('progress', 'current', null, 'journey.d.harvesting');
      }
      if (p) {
        steps.push({ id: 'pickupRequested', state: 'done', at: p.createdAt, params: { kg: { kg: p.estKg } } });
        const order = ['OPEN', 'ACCEPTED', 'COLLECTED', 'DELIVERED', 'CONFIRMED'];
        const at = order.indexOf(p.status);
        steps.push({ id: 'collectorAccepted', state: at >= 1 ? 'done' : at === 0 ? 'current' : 'todo', at: p.acceptedAt || null });
        steps.push({ id: 'collected', state: at >= 2 ? 'done' : at === 1 ? 'current' : 'todo', at: p.collectedAt || null, params: at >= 2 ? { kg: { kg: p.weightKg } } : {} });
        steps.push({ id: 'delivered', state: at >= 3 ? 'done' : at === 2 ? 'current' : 'todo', at: p.deliveredAt || null });
        steps.push({ id: 'recyclerConfirmed', state: at >= 4 ? 'done' : at === 3 ? 'current' : 'todo', at: p.confirmedAt || null, params: at >= 4 ? { kg: { kg: p.confirmedWeightKg }, regNo: p.regNo || '' } : {} });
        if (option === 'recycle') set('progress', at >= 4 ? 'done' : 'current', at >= 4 ? p.confirmedAt : null, 'journey.d.recycling');
      } else if (option === 'recycle') set('progress', 'current', null, 'journey.d.recycling');
      const rec = has('recycle');
      const reuse = has('reuse');
      if (rec) set('verified', 'done', rec.at, 'journey.d.recycled', { kg: { kg: rec.evidence?.weightKg }, regNo: rec.evidence?.regNo || '' });
      else if (option === 'harvest' && reuse) set('verified', 'done', reuse.at, 'journey.d.partReused');
      else if (p) set('verified', 'todo', null, 'journey.d.awaitRecycler');
    } else if (option === 'decline') {
      set('progress', 'stopped', job.decision.at, 'journey.d.declined');
    } else if (option === 'sell') {
      const listed = ['with_refurbisher', 'recycling', 'recycled', 'harvested'].includes(job.status);
      set('progress', listed ? 'done' : 'current', listed ? job.updatedAt : null, listed ? 'journey.d.withRefurbisher' : 'journey.d.withTech');
      const resale = has('resale');
      if (resale) set('verified', 'done', resale.at, 'journey.d.resold');
    }
  }
  const first = STAGES.find((id) => s[id].state === 'current');
  return { stages: STAGES.map((id) => s[id]), recycling: steps, current: first || null, verified: s.verified.state === 'done' };
}

export async function jobPickups(ctx, jobId) {
  const ptrs = await ctx.store.query({ pk: `JOB#${jobId}`, skPrefix: 'PICKUP#' });
  const out = [];
  for (const x of ptrs) {
    const p = await ctx.store.get(`PICKUP#${x.pickupId}`, 'META');
    if (p) out.push(p);
  }
  return out;
}

export async function journeyForJob(ctx, job, request = null) {
  if (!request && job?.requestId) request = await ctx.store.get(`REQUEST#${job.requestId}`, 'META');
  return journeyOf({ request, job, pickups: job ? await jobPickups(ctx, job.jobId) : [], rewards: job ? await jobRewards(ctx, job.jobId) : [] });
}

/** A reward row as the owner/customer sees it (no internal keys). */
export const rewardView = (r) => ({ kind: r.kind, ref: r.ref, points: r.points, jobId: r.jobId, pid: r.pid, at: r.at, key: r.key, params: r.params, text: r.text, evidence: r.evidence || {}, demo: !!r.demo });

// ── Request records ──

async function getRequest(ctx, rid) {
  const r = /^R-[A-Z0-9]{6}$/.test(String(rid || '')) ? await ctx.store.get(`REQUEST#${rid}`, 'META') : null;
  if (!r) throw apiError(404, 'noRequest', { id: String(rid || '').slice(0, 12) });
  return r;
}
async function requestByLink(ctx, rid, t) {
  const r = await getRequest(ctx, rid);
  if (!t || typeof t !== 'string' || t !== r.token) throw apiError(403, 'requestLink');
  return r;
}
const reqEntry = (at, key, params = {}, kind = 'info') => ({ at, key, params, text: format(key, params, 'en'), kind });
async function reqTimeline(ctx, rid, key, params, set = {}, cond = undefined, kind = 'info') {
  const at = iso(ctx.now());
  return ctx.store.update(`REQUEST#${rid}`, 'META', { set: { ...set, updatedAt: at }, append: { timeline: [reqEntry(at, key, params, kind)] } }, cond);
}

/** What a matched (not yet assigned) technician may see: no name, phone or pincode. */
async function redacted(ctx, r) {
  return {
    requestId: r.requestId, status: r.status, category: r.category, brand: r.brand, model: r.model, ageBand: r.ageBand,
    description: r.description, descLang: r.descLang, symptoms: r.symptoms, lang: r.lang, area: r.area, areaName: areaName(r.area),
    contactMethod: r.contactMethod, createdAt: r.createdAt, photoUrl: r.photoKey ? await ctx.svc.files.presignGet(r.photoKey) : null,
  };
}
/** What the assigned technician sees: the redacted request plus the contact details the customer consented to share. */
async function forAssigned(ctx, r) {
  return { ...(await redacted(ctx, r)), name: r.name, phone: r.phone, pincode: r.pincode, jobId: r.jobId || null, assignedAt: r.assignedAt };
}

async function customerView(ctx, r) {
  const job = r.jobId ? await ctx.store.get(`JOB#${r.jobId}`, 'META') : null;
  const assigned = r.assignedTech ? await getProfile(ctx, r.assignedTech) : null;
  const customer = r.customerId ? await ctx.store.get(`CUSTOMER#${r.customerId}`, 'META') : null;
  const notes = r.customerId ? await ctx.store.query({ pk: `CUSTOMER#${r.customerId}`, skPrefix: 'NOTIF#', desc: true, limit: 20 }) : [];
  return {
    request: {
      requestId: r.requestId, status: r.status, category: r.category, brand: r.brand, model: r.model, ageBand: r.ageBand, description: r.description, descLang: r.descLang,
      symptoms: r.symptoms, area: r.area, areaName: areaName(r.area), contactMethod: r.contactMethod, lang: r.lang, createdAt: r.createdAt, consent: r.consent,
      photoUrl: r.photoKey ? await ctx.svc.files.presignGet(r.photoKey) : null, timeline: r.timeline || [],
    },
    offered: (r.offered || []).map((o) => ({ ...o, state: r.assignedTech === o.userId ? 'assigned' : (r.declinedBy || []).includes(o.userId) ? 'declined' : r.status === 'open' ? 'waiting' : 'closed' })),
    assigned: assigned ? { shop: assigned.shop || '', name: assigned.name, area: assigned.area, areaName: areaName(assigned.area), trust: assigned.trust, verifiedJobs: assigned.verifiedJobs || 0 } : null,
    job: job ? { jobId: job.jobId, pid: job.pid, status: job.status, ownerPath: `#/o/${job.jobId}/${job.ownerToken}`, ownerLang: job.ownerLang, demo: !!job.demo } : null,
    demo: !!r.demo,
    journey: await journeyForJob(ctx, job, r),
    green: customer ? { cid: customer.cid, token: customer.token } : null,
    notifications: notes.map((n) => ({ ...strip(n), id: n.SK })),
  };
}

const offerRows = (ctx, rid, ids) => Promise.all(ids.map((uid) => ctx.store.put({ PK: `USER#${uid}`, SK: `OFFER#${rid}`, type: 'request_offer', requestId: rid, at: iso(ctx.now()) })));

// ── Creating a request (public form, or a signed-in customer) ──

async function createRequest(ctx, body, ip, signedInCustomer = null) {
  requireFields(body, ['category', 'pincode', 'phone', 'contactMethod']);
  catOf(body.category);
  if (body.consent !== true) throw apiError(400, 'requestConsent');
  const pin = String(body.pincode).replace(/\D/g, '');
  if (pin.length !== 6) throw apiError(400, 'pincode6');
  const phone = normalizePhone(body.phone);
  if (phone.length !== 10) throw apiError(400, 'phone10');
  if (!CONTACT.includes(body.contactMethod)) throw apiError(400, 'contactMethod');
  const lang = body.lang == null || body.lang === '' ? 'en' : langOr(body.lang);
  if (!lang) throw apiError(400, 'badLang');
  const description = String(body.description || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 600);
  const symptoms = [...new Set((Array.isArray(body.symptoms) ? body.symptoms : []).filter((x) => SYMPTOMS.includes(x)))];
  if (description.length < 10 && !symptoms.length) throw apiError(400, 'describeProblem');
  const ageBand = Object.hasOwn(AGE_BANDS, body.ageBand) ? body.ageBand : 'unknown';
  const photoKey = typeof body.photoKey === 'string' && body.photoKey.startsWith(REQUEST_PHOTO_PREFIX) && !body.photoKey.includes('..') ? body.photoKey : null;
  const area = areaOf(pin);
  const matches = await matchesFor(ctx, body.category, pin);
  const chosen = Array.isArray(body.techIds) ? body.techIds.filter((id) => matches.some((m) => m.userId === id)) : matches.map((m) => m.userId);
  if (!chosen.length) throw apiError(400, matches.length ? 'pickTechnician' : 'noTechNearby');
  await rateLimit(ctx, ipWho(ip), 'rq-create', limits(ctx).createPerIp);
  const customer = signedInCustomer || (await existingCustomer(ctx, body.green)) || (await createCustomer(ctx, { lang }));
  const at = iso(ctx.now());
  const rid = newId('R', 6);
  const offered = matches.filter((m) => chosen.includes(m.userId)).map(({ score, ...m }) => m);
  const req = {
    PK: `REQUEST#${rid}`, SK: 'META', type: 'request', requestId: rid, token: secretToken(), customerId: customer.cid,
    intent: ['repair', 'sell', 'recycle'].includes(body.intent) ? body.intent : 'repair',
    category: body.category, brand: String(body.brand || '').trim().slice(0, 40), model: String(body.model || '').trim().toUpperCase().slice(0, 30),
    ageBand, description, descLang: langOr(body.descLang) || lang, symptoms, photoKey, pincode: pin, area,
    contactMethod: body.contactMethod, phone, name: String(body.name || '').trim().slice(0, 60), lang,
    consent: { share: true, at, text: format('consent.request', {}, 'en') },
    status: 'open', offered, declinedBy: [], assignedTech: null, jobId: null, createdAt: at, updatedAt: at,
    timeline: [reqEntry(at, 'event.requestSubmitted', { n: offered.length })],
  };
  await ctx.store.put(req, { notExists: true });
  await ctx.store.put({ PK: `CUSTOMER#${customer.cid}`, SK: `REQ#${rid}`, type: 'customer_request', requestId: rid, at });
  await offerRows(ctx, rid, chosen);
  for (const uid of chosen) {
    await notifyUser(ctx, uid, { key: 'notif.repairRequest', params: { cat: { cat: req.category }, area: { area } }, link: '#/t/requests' });
  }
  ctx.svc.metrics?.emit?.('repairRequests', 1);
  return { requestId: rid, token: req.token, green: { cid: customer.cid, token: customer.token }, offered: offered.length };
  }

// ── Routes ──

export function requestRoutes({ createJob, techJob }) {
  const R = [];
  const route = (method, pattern, access, fn) => R.push([method, pattern, access, fn]);
  const TECH = ['technician'];

  route('GET', '/public/rewards/rules', 'public', async () => publicRules());

  // Preview of matched technicians, before anything is stored or shared.
  route('POST', '/public/requests/match', 'public', async (ctx, { body, ip }) => {
    requireFields(body, ['category', 'pincode']);
    catOf(body.category);
    const pin = String(body.pincode).replace(/\D/g, '');
    if (pin.length !== 6) throw apiError(400, 'pincode6');
    await rateLimit(ctx, ipWho(ip), 'rq-match', limits(ctx).matchPerIp);
    const techs = await matchesFor(ctx, body.category, pin);
    return { technicians: techs.map(({ score, ...x }) => x), area: areaOf(pin), areaName: areaName(areaOf(pin)), availability: 'request' };
  });

  // Optional photo for a request (no account): presigned PUT under uploads/req/, rate-limited per IP.
  route('POST', '/public/requests/uploads', 'public', async (ctx, { body, ip }) => {
    const type = String(body.contentType || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_EXT[type]) throw apiError(400, 'uploadType');
    await rateLimit(ctx, ipWho(ip), 'rq-upload', limits(ctx).uploadPerIp);
    const key = `${REQUEST_PHOTO_PREFIX}${iso(ctx.now()).slice(0, 10)}/${randomString(12)}.${IMAGE_EXT[type]}`;
    return { key, url: await ctx.svc.files.presignPut(key, type), contentType: type };
  });

  route('POST', '/public/requests', 'public', async (ctx, { body, ip }) => createRequest(ctx, body, ip));

  route('GET', '/public/requests/:id', 'public', async (ctx, { params, query }) => customerView(ctx, await requestByLink(ctx, params.id, query.t)));

  route('POST', '/public/requests/:id/cancel', 'public', async (ctx, { params, body }) => {
    const r = await requestByLink(ctx, params.id, body.t);
    if (!['open', 'assigned', 'no_match'].includes(r.status)) throw apiError(409, 'requestClosed');
    try {
      await reqTimeline(ctx, r.requestId, 'event.requestCancelled', {}, { status: 'cancelled', cancelledAt: iso(ctx.now()) }, { eq: { status: r.status } }, 'warning');
    } catch (e) {
      if (e.code === 'ConditionFailed') throw apiError(409, 'requestClosed');
      throw e;
    }
    for (const o of r.offered || []) await ctx.store.delete(`USER#${o.userId}`, `OFFER#${r.requestId}`);
    if (r.assignedTech) await notifyUser(ctx, r.assignedTech, { key: 'notif.requestCancelled', params: { id: r.requestId }, link: '#/t/requests' });
    return customerView(ctx, await getRequest(ctx, r.requestId));
  });

  // ── Technician side ──

  route('GET', '/api/requests', TECH, async (ctx, _i, me) => {
    const offers = [];
    for (const x of await ctx.store.query({ pk: `USER#${me.userId}`, skPrefix: 'OFFER#', desc: true })) {
      const r = await ctx.store.get(`REQUEST#${x.requestId}`, 'META');
      if (!r) continue;
      if (r.assignedTech === me.userId) continue;
      if (r.status === 'open' && !(r.declinedBy || []).includes(me.userId)) offers.push(await redacted(ctx, r));
    }
    const assigned = [];
    for (const x of await ctx.store.query({ pk: `USER#${me.userId}`, skPrefix: 'REQ#', desc: true })) {
      const r = await ctx.store.get(`REQUEST#${x.requestId}`, 'META');
      if (r && r.assignedTech === me.userId) assigned.push(await forAssigned(ctx, r));
    }
    return { offers, assigned };
  });

  route('GET', '/api/requests/:id', TECH, async (ctx, { params }, me) => {
    const r = await getRequest(ctx, params.id);
    if (r.assignedTech === me.userId) return { request: await forAssigned(ctx, r), assigned: true };
    if ((r.offered || []).some((o) => o.userId === me.userId) && r.status === 'open') return { request: await redacted(ctx, r), assigned: false };
    throw apiError(403, 'notOffered');
  });

  route('POST', '/api/requests/:id/accept', TECH, async (ctx, { params }, me) => {
    const r = await getRequest(ctx, params.id);
    if (!(r.offered || []).some((o) => o.userId === me.userId) || (r.declinedBy || []).includes(me.userId)) throw apiError(403, 'notOffered');
    if (r.status !== 'open') throw apiError(409, r.assignedTech ? 'requestTaken' : 'requestClosed');
    const at = iso(ctx.now());
    try {
      await reqTimeline(ctx, r.requestId, 'event.requestAccepted', { shop: me.shop || me.name }, { status: 'assigned', assignedTech: me.userId, assignedShop: me.shop || me.name, assignedAt: at }, { eq: { status: 'open' } }, 'done');
    } catch (e) {
      if (e.code === 'ConditionFailed') throw apiError(409, 'requestTaken');
      throw e;
    }
    await ctx.store.put({ PK: `USER#${me.userId}`, SK: `REQ#${r.requestId}`, type: 'request_assigned', requestId: r.requestId, at });
    for (const o of r.offered) await ctx.store.delete(`USER#${o.userId}`, `OFFER#${r.requestId}`);
    for (const o of r.offered.filter((x) => x.userId !== me.userId && !(r.declinedBy || []).includes(x.userId))) {
      await notifyUser(ctx, o.userId, { key: 'notif.requestTaken', params: { id: r.requestId }, link: '#/t/requests' });
    }
    await notifyCustomer(ctx, r.customerId, { key: 'cnotif.assigned', params: { shop: me.shop || me.name, how: { msg: `contact.${r.contactMethod}` } } });
    if (ctx.config.enableSms && r.phone) {
      await ctx.svc.notify.sms(r.phone, format('sms.requestAccepted', { shop: me.shop || me.name, link: `${ctx.config.appUrl || ''}/?lang=${r.lang}#/req/${r.requestId}/${r.token}` }, r.lang));
    }
    return { request: await forAssigned(ctx, await getRequest(ctx, r.requestId)) };
  });

  route('POST', '/api/requests/:id/decline', TECH, async (ctx, { params }, me) => {
    const r = await getRequest(ctx, params.id);
    if (!(r.offered || []).some((o) => o.userId === me.userId)) throw apiError(403, 'notOffered');
    if (r.status !== 'open') throw apiError(409, 'requestClosed');
    if ((r.declinedBy || []).includes(me.userId)) return { ok: true };
    const declined = [...(r.declinedBy || []), me.userId];
    const allDeclined = r.offered.every((o) => declined.includes(o.userId));
    try {
      await ctx.store.update(`REQUEST#${r.requestId}`, 'META', { set: { declinedBy: declined, updatedAt: iso(ctx.now()), ...(allDeclined ? { status: 'no_match' } : {}) }, ...(allDeclined ? { append: { timeline: [reqEntry(iso(ctx.now()), 'event.requestNoMatch', {}, 'warning')] } } : {}) }, { eq: { status: 'open' } });
    } catch (e) {
      if (e.code === 'ConditionFailed') throw apiError(409, 'requestClosed');
      throw e;
    }
    await ctx.store.delete(`USER#${me.userId}`, `OFFER#${r.requestId}`);
    if (allDeclined) await notifyCustomer(ctx, r.customerId, { key: 'cnotif.noMatch', params: {} });
    return { ok: true };
  });

  // The assigned technician opens the job card (the existing repair job) for this request.
  route('POST', '/api/requests/:id/job', TECH, async (ctx, { params, body }, me) => {
    const r = await getRequest(ctx, params.id);
    if (r.assignedTech !== me.userId) throw apiError(403, 'notAssigned');
    if (r.status !== 'assigned' || r.jobId) throw apiError(409, 'requestHasJob');
    const out = await createJob(ctx, me, {
      category: r.category, brand: body.brand || r.brand, model: body.model || r.model, purchaseYear: body.purchaseYear, serial: body.serial, pid: body.pid,
      ownerPhone: r.phone, ownerName: r.name, ownerLang: r.lang, pincode: r.pincode, labelPhotoKey: body.labelPhotoKey, continueUnderWarranty: body.continueUnderWarranty,
    }, { requestId: r.requestId, customerId: r.customerId });
    try {
      await reqTimeline(ctx, r.requestId, 'event.requestJob', { jobId: out.job.jobId }, { status: 'job_created', jobId: out.job.jobId }, { eq: { status: 'assigned' } }, 'done');
    } catch (e) {
      if (e.code === 'ConditionFailed') throw apiError(409, 'requestHasJob');
      throw e;
    }
    const job = await getJob(ctx, out.job.jobId);
    if (r.customerId) await linkJob(ctx, job, { cid: r.customerId });
    return { ...out, job: techJob(await getJob(ctx, job.jobId)) };
  });

  // ── Customer Green Passport (private link) ──

  route('GET', '/public/green/:cid', 'public', async (ctx, { params, query }) => {
    const c = await customerByLink(ctx, params.cid, query.t);
    const rewards = await customerRewards(ctx, c.cid);
    const jobs = [];
    for (const x of await customerJobs(ctx, c.cid)) {
      const j = await ctx.store.get(`JOB#${x.jobId}`, 'META');
      if (j) jobs.push({ jobId: j.jobId, pid: j.pid, category: j.category, brand: j.brand, model: j.model, status: j.status, createdAt: j.createdAt, ownerPath: `#/o/${j.jobId}/${j.ownerToken}`, ownerLang: j.ownerLang, demo: !!j.demo });
    }
    const requests = [];
    for (const x of await ctx.store.query({ pk: `CUSTOMER#${c.cid}`, skPrefix: 'REQ#', desc: true })) {
      const r = await ctx.store.get(`REQUEST#${x.requestId}`, 'META');
      if (r) requests.push({ requestId: r.requestId, status: r.status, category: r.category, createdAt: r.createdAt, path: `#/req/${r.requestId}/${r.token}` });
    }
    const notes = await ctx.store.query({ pk: `CUSTOMER#${c.cid}`, skPrefix: 'NOTIF#', desc: true, limit: 30 });
    return {
      cid: c.cid, since: c.createdAt, summary: summarize(rewards), rewards: rewards.map(rewardView), rules: publicRules(),
      jobs: jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), requests,
      notifications: notes.map((n) => ({ ...strip(n), id: n.SK })), unread: notes.filter((n) => !n.read).length,
    };
  });

  route('POST', '/public/green/:cid/read', 'public', async (ctx, { params, body }) => {
    const c = await customerByLink(ctx, params.cid, body.t);
    const rows = await ctx.store.query({ pk: `CUSTOMER#${c.cid}`, skPrefix: 'NOTIF#', desc: true, limit: 30 });
    for (const n of rows.filter((x) => !x.read)) await ctx.store.update(n.PK, n.SK, { set: { read: true } });
    return { ok: true };
  });

  // ── Signed-in customers: the same request flow, linked to their own Green Passport ──
  route('GET', '/api/customer/home', ['customer'], async (ctx, _i, me) => {
    const c = await customerFor(ctx, me);
    const rewards = await customerRewards(ctx, c.cid);
    const requests = [];
    for (const x of await ctx.store.query({ pk: `CUSTOMER#${c.cid}`, skPrefix: 'REQ#', desc: true })) {
      const r = await ctx.store.get(`REQUEST#${x.requestId}`, 'META');
      if (r) requests.push({ requestId: r.requestId, status: r.status, intent: r.intent || 'repair', category: r.category, brand: r.brand, model: r.model, createdAt: r.createdAt, path: `#/req/${r.requestId}/${r.token}`, jobId: r.jobId || null, demo: !!r.demo });
    }
    const jobs = [];
    for (const x of await customerJobs(ctx, c.cid)) {
      const j = await ctx.store.get(`JOB#${x.jobId}`, 'META');
      if (!j) continue;
      const journey = await journeyForJob(ctx, j);
      jobs.push({ jobId: j.jobId, pid: j.pid, category: j.category, brand: j.brand, model: j.model, status: j.status, createdAt: j.createdAt, ownerPath: `#/o/${j.jobId}/${j.ownerToken}`, ownerLang: j.ownerLang, needsYou: (j.status === 'awaiting_owner' && !!j.taskToken && !j.decisionPending) || (j.status === 'repaired' && (j.verified == null || (j.followup?.due && !j.followup?.answered))), current: journey.current, verified: journey.verified, demo: !!j.demo });
    }
    const notes = await ctx.store.query({ pk: `CUSTOMER#${c.cid}`, skPrefix: 'NOTIF#', desc: true, limit: 15 });
    return {
      green: { cid: c.cid, token: c.token, path: `#/g/${c.cid}/${c.token}`, summary: summarize(rewards) },
      requests, jobs: jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), notifications: notes.map((n) => ({ ...strip(n), id: n.SK })),
      profile: { name: me.name, phone: me.phone || '', pincode: me.pincode || '', lang: me.lang || '' },
    };
  });

  route('POST', '/api/customer/requests', ['customer'], async (ctx, { body, ip }, me) => {
    const c = await customerFor(ctx, me);
    return createRequest(ctx, { ...body, phone: body.phone || me.phone, name: body.name || me.name, pincode: body.pincode || me.pincode, lang: body.lang || me.lang }, ip, c);
  });

  return R;
}

/** The customer's Green Passport, created and linked to their account on first use (once, even under races). */
async function customerFor(ctx, me) {
  if (me.customerId) {
    const c = await ctx.store.get(`CUSTOMER#${me.customerId}`, 'META');
    if (c) return c;
  }
  const c = await createCustomer(ctx, { lang: me.lang || 'en' });
  try {
    await ctx.store.update(`USER#${me.userId}`, 'PROFILE', { set: { customerId: c.cid } }, { missing: ['customerId'] });
  } catch (e) {
    if (e.code !== 'ConditionFailed') throw e;
    const p = await getProfile(ctx, me.userId);
    return ctx.store.get(`CUSTOMER#${p.customerId}`, 'META');
  }
  await ctx.store.update(`CUSTOMER#${c.cid}`, 'META', { set: { userId: me.userId } });
  return { ...c, userId: me.userId };
}

export { REWARD_RULES };
