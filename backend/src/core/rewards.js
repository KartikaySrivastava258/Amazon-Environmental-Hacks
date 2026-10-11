// Customer Green Passport: verified rewards, badges and the customer's private record.
//
// Rules (all in this file, shown to customers by GET /public/green/rules):
//   - Points are recognition only. They are not money and carry no financial benefit.
//   - A reward is written only by the server, inside the handler of a VERIFIED workflow event
//     (owner confirmation, registered-recycler confirmation, registered-refurbisher sale). Nobody can submit one.
//   - Each reward has a unique key per job (JOB#<jobId> / REWARD#<kind>#<ref>) written with a conditional put,
//     so retries and concurrent requests award it once.
//   - Rewards live on the job. A customer's totals are the sum over the jobs linked to their Green Passport,
//     so a job linked later still counts its earlier verified rewards, and totals can never drift from the ledger.
import { iso, newId, secretToken, apiError, format, randomString } from './util.js';
import { CATEGORIES } from './catalog.js';

export const REWARD_RULES = {
  repair: { points: 20, evidence: 'ownerConfirmed' }, // repair completed and owner-confirmed working
  reuse: { points: 30, evidence: 'handoverAndInstall' }, // a working part from your product was handed over and installed elsewhere
  resale: { points: 30, evidence: 'refurbisherSale' }, // your product was refurbished and sold by a registered refurbisher
  recycle: { points: 40, evidence: 'recyclerReceipt' }, // a registered recycler accepted the delivery with weight and photo evidence
  followup: { points: 5, evidence: 'followupConfirmed' }, // bonus: still working at the 30-day check
};

// Circular Champion: this many points, or this many different kinds of verified contribution.
export const CHAMPION = { points: 100, kinds: 3 };
const CONTRIB_KINDS = ['repair', 'reuse', 'resale', 'recycle'];

export const BADGES = [
  { id: 'repair_champion', test: (s) => s.byKind.repair > 0 },
  { id: 'second_life', test: (s) => s.byKind.reuse > 0 || s.byKind.resale > 0 },
  { id: 'responsible_recycler', test: (s) => s.byKind.recycle > 0 },
  { id: 'circular_champion', test: (s) => s.points >= CHAMPION.points || CONTRIB_KINDS.filter((k) => s.byKind[k] > 0).length >= CHAMPION.kinds },
];

/** Totals and badges from a list of reward rows. Pure. */
export function summarize(rewards) {
  const byKind = Object.fromEntries(Object.keys(REWARD_RULES).map((k) => [k, 0]));
  let points = 0;
  let recycledKg = 0;
  let keptKg = 0;
  for (const r of rewards) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    points += Number(r.points) || 0;
    if (r.kind === 'recycle') recycledKg += Number(r.evidence?.weightKg) || 0;
    if (r.kind === 'repair' || r.kind === 'resale') keptKg += CATEGORIES[r.category]?.kg || 0;
  }
  const s = { points, byKind };
  const badges = BADGES.filter((b) => b.test(s)).map((b) => b.id);
  const next = BADGES.find((b) => !badges.includes(b.id))?.id || null;
  return {
    points,
    byKind,
    badges,
    nextBadge: next,
    championProgress: { points: Math.min(points, CHAMPION.points), of: CHAMPION.points, kinds: CONTRIB_KINDS.filter((k) => byKind[k] > 0).length, ofKinds: CHAMPION.kinds },
    impact: {
      productsKeptInUse: byKind.repair + byKind.resale,
      partsReused: byKind.reuse,
      recycledKgMeasured: Math.round(recycledKg * 10) / 10, // weighed by the registered recycler
      keptInUseKgEstimate: Math.round(keptKg * 10) / 10, // reference weights in catalog.js, an estimate
    },
  };
}

export const publicRules = () => ({
  rules: Object.entries(REWARD_RULES).map(([kind, r]) => ({ kind, points: r.points, evidence: r.evidence })),
  badges: BADGES.map((b) => b.id),
  champion: CHAMPION,
});

// ── Customer record ──

export async function getCustomer(ctx, cid) {
  if (!/^C-[A-Z0-9]{8}$/.test(String(cid || ''))) return null;
  return ctx.store.get(`CUSTOMER#${cid}`, 'META');
}

/** The customer for a private link, or 403. Tokens are compared in full; the cid alone grants nothing. */
export async function customerByLink(ctx, cid, token) {
  const c = await getCustomer(ctx, cid);
  if (!c || !token || typeof token !== 'string' || token !== c.token) throw apiError(403, 'greenLink');
  return c;
}

/** Create a new Green Passport. Returns the record, including the secret token (shown once, in the link). */
export async function createCustomer(ctx, { lang = 'en' } = {}) {
  const c = { PK: '', SK: 'META', type: 'customer', cid: newId('C', 8), token: secretToken(), lang, createdAt: iso(ctx.now()) };
  c.PK = `CUSTOMER#${c.cid}`;
  await ctx.store.put(c, { notExists: true });
  return c;
}

/** A valid existing passport from { cid, t } the browser remembered, else null. Never throws. */
export async function existingCustomer(ctx, cred) {
  if (!cred || typeof cred !== 'object') return null;
  const c = await getCustomer(ctx, cred.cid);
  return c && typeof cred.t === 'string' && cred.t === c.token ? c : null;
}

/**
 * Link a job to a customer, once. A job already linked to a different passport stays where it is
 * (409 greenClaimed), so nobody can move someone else's verified rewards.
 */
export async function linkJob(ctx, job, customer) {
  if (job.customerId && job.customerId !== customer.cid) throw apiError(409, 'greenClaimed');
  if (!job.customerId) {
    try {
      await ctx.store.update(`JOB#${job.jobId}`, 'META', { set: { customerId: customer.cid } }, { or: [{ missing: ['customerId'] }, { eq: { customerId: null } }] });
    } catch (e) {
      if (e.code === 'ConditionFailed') throw apiError(409, 'greenClaimed');
      throw e;
    }
  }
  await ctx.store.put({ PK: `CUSTOMER#${customer.cid}`, SK: `JOB#${job.jobId}`, type: 'customer_job', jobId: job.jobId, pid: job.pid, at: iso(ctx.now()) });
}

export async function customerJobs(ctx, cid) {
  return ctx.store.query({ pk: `CUSTOMER#${cid}`, skPrefix: 'JOB#' });
}

export async function jobRewards(ctx, jobId) {
  return ctx.store.query({ pk: `JOB#${jobId}`, skPrefix: 'REWARD#' });
}

export async function customerRewards(ctx, cid) {
  const out = [];
  for (const j of await customerJobs(ctx, cid)) out.push(...(await jobRewards(ctx, j.jobId)));
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** In-app notification for a customer (same shape as notifyUser, kept under the customer's record). */
export async function notifyCustomer(ctx, cid, { key, params = {}, link = '' }) {
  if (!cid) return;
  const at = iso(ctx.now());
  const row = { type: 'notification', key, params, title: format(`${key}.title`, params, 'en'), body: format(`${key}.body`, params, 'en'), link, read: false, at };
  await ctx.store.put({ PK: `CUSTOMER#${cid}`, SK: `NOTIF#${at}#${randomString(4)}`, ...row });
  // A signed-in customer account linked to this passport also gets it in the normal in-app inbox.
  const c = await ctx.store.get(`CUSTOMER#${cid}`, 'META');
  if (c?.userId) await ctx.store.put({ PK: `USER#${c.userId}`, SK: `NOTIF#${at}#${randomString(4)}`, ...row, link: link || '#/my' });
}

/** Notify the job's customer, if the job is linked to a Green Passport. */
export async function notifyJobCustomer(ctx, job, msg) {
  if (job?.customerId) await notifyCustomer(ctx, job.customerId, msg);
}

/**
 * Award a verified reward on a job, exactly once. Call ONLY from the handler of a verified event.
 * kind: a REWARD_RULES key; ref: what makes it unique (job, part, pickup or listing ID); evidence: what verified it.
 * Returns the reward row, or null if it was already awarded.
 */
export async function award(ctx, job, kind, ref, evidence = {}) {
  const rule = REWARD_RULES[kind];
  if (!rule || !job?.jobId || !ref) throw new Error(`Bad reward ${kind}/${ref}`);
  const params = { cat: { cat: job.category }, brand: job.brand, model: job.model, ref };
  const row = {
    PK: `JOB#${job.jobId}`, SK: `REWARD#${kind}#${ref}`, type: 'reward', kind, ref, points: rule.points,
    jobId: job.jobId, pid: job.pid, category: job.category, evidence, at: iso(ctx.now()), demo: !!job.demo,
    key: `reward.${kind}`, params, text: format(`reward.${kind}`, params, 'en'),
  };
  let before = null;
  if (job.customerId) before = summarize(await customerRewards(ctx, job.customerId));
  try {
    await ctx.store.put(row, { notExists: true });
  } catch (e) {
    if (e.code === 'ConditionFailed') return null; // already awarded: a retry or a concurrent request
    throw e;
  }
  ctx.svc.metrics?.emit?.('rewardsAwarded', 1);
  if (job.customerId) {
    const after = summarize(await customerRewards(ctx, job.customerId));
    await notifyCustomer(ctx, job.customerId, { key: 'cnotif.reward', params: { points: rule.points, why: { msg: `reward.${kind}`, params } } });
    for (const b of after.badges.filter((x) => !before.badges.includes(x))) await notifyCustomer(ctx, job.customerId, { key: 'cnotif.badge', params: { badge: { msg: `badge.${b}` } } });
  }
  return row;
}
