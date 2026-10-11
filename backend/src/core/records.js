// Shared record helpers used by api, workflow and consumers.
import { CATEGORIES, compatibility, areaOf } from './catalog.js';
import { iso, newId, randomString, notifyUser, apiError, format } from './util.js';

export const profileKey = (userId) => ({ PK: `USER#${userId}`, SK: 'PROFILE' });

export async function getProfile(ctx, userId) {
  return ctx.store.get(`USER#${userId}`, 'PROFILE');
}

export function profileIndex(p) {
  const key = p.role === 'brand' ? p.brandId || '' : p.area || '';
  return { GSI1PK: `ROLE#${p.role}`, GSI1SK: `${p.status}#${key}#${p.userId}` };
}

export async function getJob(ctx, jobId) {
  const job = await ctx.store.get(`JOB#${jobId}`, 'META');
  if (!job) throw apiError(404, 'noJob', { id: jobId });
  return job;
}

export async function getPassport(ctx, pid) {
  const p = await ctx.store.get(`PASSPORT#${pid}`, 'META');
  if (!p) throw apiError(404, 'noPassport', { id: pid });
  return p;
}

// Stored messages are { key, params, text }; text is the English fallback (see messages.js).
const msgEntry = (key, params, text) => (key ? { key, params: params || {}, text: text ?? format(key, params || {}, 'en') } : { text });

export async function passportEvent(ctx, pid, { kind, text, key = null, params = null, jobId = null, partId = null, by = null }) {
  const at = iso(ctx.now());
  await ctx.store.put({ PK: `PASSPORT#${pid}`, SK: `EV#${at}#${randomString(4)}`, type: 'passport_event', kind, ...msgEntry(key, params, text), jobId, partId, by, at });
}

// text: an English string, or { key, params } to store a translatable entry.
export async function jobTimeline(ctx, jobId, text, kind = 'info', set = {}, msg = null) {
  const m = msg || (text && typeof text === 'object' ? text : null);
  const entry = { at: iso(ctx.now()), ...(m ? msgEntry(m.key, m.params, typeof text === 'string' ? text : undefined) : { text }), kind };
  return ctx.store.update(`JOB#${jobId}`, 'META', { set: { ...set, updatedAt: iso(ctx.now()) }, append: { timeline: [entry] } });
}
export const timelineEntry = (at, key, params = {}, kind = 'info') => ({ at, ...msgEntry(key, params), kind });

export async function bumpImpact(ctx, add) {
  await ctx.store.update('IMPACT', 'GLOBAL', { add, set: { updatedAt: iso(ctx.now()) } });
  for (const [k, v] of Object.entries(add)) ctx.svc.metrics.emit(k, v);
}

export function partIndex(part) {
  return { GSI2PK: `COMP#${part.category}#${part.component}`, GSI2SK: `${part.status}#${part.area}#${part.partId}` };
}

/** Find compatible harvested parts, nearest area first. */
export async function searchParts(ctx, { category, component, brand, model, area, excludeSeller }) {
  const pk = `COMP#${category}#${component}`;
  const listed = await ctx.store.query({ index: 'GSI2', pk, skPrefix: 'LISTED#' });
  const reserved = await ctx.store.query({ index: 'GSI2', pk, skPrefix: 'RESERVED#' });
  const now = ctx.now();
  const candidates = [...listed, ...reserved.filter((p) => p.reservedUntil < now)];
  const out = [];
  for (const p of candidates) {
    if (excludeSeller && p.sellerId === excludeSeller) continue;
    const compat = brand && model ? compatibility(p, brand, model) : 'unknown';
    if (!compat) continue;
    out.push({ ...p, compatibility: compat, sameArea: !!area && p.area === area });
  }
  const rank = { exact: 0, family: 1, universal: 2, unknown: 3 };
  out.sort((a, b) => (b.sameArea - a.sameArea) || (rank[a.compatibility] - rank[b.compatibility]) || (a.price - b.price));
  return out;
}

export async function reservePart(ctx, partId, userId, jobId = null) {
  const part = await ctx.store.get(`PART#${partId}`, 'META');
  if (!part) throw apiError(404, 'noPart', { id: partId });
  const until = ctx.now() + 24 * 3600 * 1000;
  try {
    const updated = await ctx.store.update(`PART#${partId}`, 'META',
      { set: { status: 'RESERVED', reservedBy: userId, reservedForJob: jobId, reservedUntil: until, ...partIndex({ ...part, status: 'RESERVED' }) } },
      { or: [{ eq: { status: 'LISTED' } }, { and: [{ eq: { status: 'RESERVED' } }, { lt: { reservedUntil: ctx.now() } }] }] });
    if (part.reservedBy && part.reservedBy !== userId) await ctx.store.delete(`USER#${part.reservedBy}`, `RESV#${partId}`);
    await ctx.store.put({ PK: `USER#${userId}`, SK: `RESV#${partId}`, type: 'reservation', partId, at: iso(ctx.now()) });
    await ctx.svc.scheduler.at(`pn-resv-${partId}`, until, { type: 'reservation_expiry', partId, userId });
    return updated;
  } catch (e) {
    if (e.code === 'ConditionFailed') throw apiError(409, 'partJustReserved');
    throw e;
  }
}

export async function createPickup(ctx, { pid, jobId = null, category, items, area, requestedBy, wholeProduct = false }) {
  const cat = CATEGORIES[category];
  const pickupId = newId('K', 6);
  const at = iso(ctx.now());
  const estKg = Math.round(items.reduce((s, i) => s + (i.estKg || 0), 0) * 10) / 10;
  const pickup = {
    PK: `PICKUP#${pickupId}`, SK: 'META', type: 'pickup', pickupId, pid, jobId, category, items, estKg, wholeProduct,
    area, requestedBy, status: 'OPEN', gates: cat.gates, gatesDone: {}, rate: cat.scrapRate, createdAt: at,
    GSI2PK: 'PICKUPS#OPEN', GSI2SK: `${area}#${at}`,
  };
  await ctx.store.put(pickup);
  await ctx.store.put({ PK: `USER#${requestedBy}`, SK: `PICKUP#${pickupId}`, type: 'pickup_pointer', pickupId, at });
  if (jobId) await ctx.store.put({ PK: `JOB#${jobId}`, SK: `PICKUP#${pickupId}`, type: 'pickup_pointer', pickupId, at });
  if (pid) await passportEvent(ctx, pid, { kind: 'pickup', key: 'event.pickupRequested', params: { pickupId, kg: { kg: estKg } }, jobId });
  await ctx.svc.events.emit('pickup.requested', { pickupId, area, category, estKg, requestedBy });
  return pickup;
}

export async function setHolder(ctx, pid, holderId, status) {
  const set = { status, holderId: holderId || null };
  if (holderId) set.GSI2PK = `HOLDER#${holderId}`, set.GSI2SK = iso(ctx.now());
  const ops = { set };
  if (!holderId) ops.remove = ['GSI2PK', 'GSI2SK'];
  return ctx.store.update(`PASSPORT#${pid}`, 'META', ops);
}

export async function usersByRole(ctx, role, keyPrefix = '') {
  return ctx.store.query({ index: 'GSI1', pk: `ROLE#${role}`, skPrefix: `active#${keyPrefix}` });
}

export { notifyUser, areaOf };

export async function partsReservedBy(ctx, userId) {
  const ptrs = await ctx.store.query({ pk: `USER#${userId}`, skPrefix: 'RESV#', desc: true });
  const parts = [];
  for (const x of ptrs) {
    const p = await ctx.store.get(`PART#${x.partId}`, 'META');
    if (p && p.reservedBy === userId) parts.push(p);
  }
  return parts;
}
