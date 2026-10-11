// Asynchronous consumers: EventBridge → SQS → Lambda, scheduled jobs, analytics.
import { MIN_SAMPLE, compatibility } from './catalog.js';
import { aggregateDelta, mergeDeltas } from './insights.js';
import { seriesFor, features, detectSpikes } from './anomaly.js';
import { generateRecords } from './synthetic.js';
import { bumpImpact, getJob, jobTimeline, notifyUser, usersByRole, partIndex } from './records.js';
import { iso, format, ownerUrl } from './util.js';

export async function aggregate(ctx, { type, detail }) {
  if (type === 'job.decided') {
    if (detail.consent) {
      await ctx.store.batchUpdate(aggregateDelta(detail.record));
      await bumpImpact(ctx, { repairsLogged: 1 });
    } else {
      await bumpImpact(ctx, { decisionsWithoutConsent: 1 });
    }
  } else if (type === 'repair.completed') {
    await bumpImpact(ctx, { productsKeptInUse: 1, kgKeptInUse: detail.kg, earnings: detail.amount });
  } else if (type === 'part.installed') {
    await bumpImpact(ctx, { partsReused: 1, kgPartsReused: detail.kg });
  } else if (type === 'part.sold') {
    await bumpImpact(ctx, { earnings: detail.price });
  } else if (type === 'part.listed') {
    await bumpImpact(ctx, { partsHarvested: 1 });
  } else if (type === 'handoff.confirmed') {
    await bumpImpact(ctx, { kgToRecycler: detail.weightKg, earnings: detail.payout });
  } else if (type === 'listing.sold') {
    await bumpImpact(ctx, { productsKeptInUse: 1, kgKeptInUse: detail.kg, productsResold: 1 });
  }
}

export async function partMatcher(ctx, part) {
  const searches = await ctx.store.query({ index: 'GSI2', pk: `SEARCH#${part.category}#${part.component}` });
  for (const s of searches) {
    if (s.userId === part.sellerId) continue;
    if (s.brand && s.model && !compatibility(part, s.brand, s.model)) continue;
    if (s.area && s.area !== part.area) continue;
    const params = { comp: { comp: [part.category, part.component] }, brand: part.brand, model: part.model, money: { money: part.price }, cond: { msg: part.condition === 'working' ? 'cond.working' : 'cond.untested' } };
    await notifyUser(ctx, s.userId, { key: 'notif.partMatch', params, link: '#/parts' });
  }
  if (searches.length) await ctx.svc.notify.publish('Punarnava: part match', `${part.partId} matched ${searches.length} saved search(es)`);
}

export async function pickupDispatcher(ctx, pickup) {
  let collectors = await usersByRole(ctx, 'collector', pickup.area);
  if (!collectors.length) collectors = await usersByRole(ctx, 'collector');
  for (const c of collectors) {
    await notifyUser(ctx, c.userId, { key: 'notif.newPickup', params: { kg: { kg: pickup.estKg }, cat: { cat: pickup.category }, area: { area: pickup.area || '' } }, link: '#/c' });
  }
  await ctx.svc.notify.publish('Punarnava: pickup requested', `Pickup ${pickup.pickupId} (${pickup.estKg} kg) in area ${pickup.area}xxx. ${collectors.length} collector(s) notified.`);
}

export async function scheduled(ctx, payload) {
  if (payload.type === 'reservation_expiry') {
    const part = await ctx.store.get(`PART#${payload.partId}`, 'META');
    if (!part || part.status !== 'RESERVED' || part.reservedBy !== payload.userId || part.reservedUntil > ctx.now() + 1000) return;
    try {
      await ctx.store.update(part.PK, part.SK, { set: { status: 'LISTED', reservedBy: null, reservedUntil: 0, buyerName: null, ...partIndex({ ...part, status: 'LISTED' }) } }, { and: [{ eq: { status: 'RESERVED' } }, { eq: { reservedBy: payload.userId } }] });
    } catch (e) { if (e.code === 'ConditionFailed') return; throw e; }
    await ctx.store.delete(`USER#${payload.userId}`, `RESV#${part.partId}`);
    await notifyUser(ctx, payload.userId, { key: 'notif.reservationExpired', params: { comp: { comp: [part.category, part.component] }, partId: part.partId }, link: '#/parts' });
    await notifyUser(ctx, part.sellerId, { key: 'notif.relisted', params: { partId: part.partId }, link: '#/parts' });
    return;
  }
  if (payload.type === 'reminder') {
    const job = await getJob(ctx, payload.jobId);
    if (job.status !== 'awaiting_owner') return;
    await jobTimeline(ctx, job.jobId, { key: 'event.reminderSent' }, 'system', { reminderSent: true });
    await notifyUser(ctx, job.techId, { key: 'notif.ownerNotChosen', params: { jobId: job.jobId }, link: `#/t/job/${job.jobId}` });
    if (ctx.config.enableSms && job.ownerPhone) await ctx.svc.notify.sms(job.ownerPhone, format('sms.reminder', { link: ownerUrl(ctx.config.appUrl, job) }, job.ownerLang));
  } else if (payload.type === 'followup') {
    const job = await getJob(ctx, payload.jobId);
    if (job.status !== 'repaired' || job.followup?.answered) return;
    await jobTimeline(ctx, job.jobId, { key: 'event.followupSent' }, 'system', { followup: { due: true, answered: false, at: iso(ctx.now()) } });
    await notifyUser(ctx, job.techId, { key: 'notif.followupSent', params: { jobId: job.jobId }, link: `#/t/job/${job.jobId}` });
    if (ctx.config.enableSms && job.ownerPhone) await ctx.svc.notify.sms(job.ownerPhone, format('sms.followup', { link: ownerUrl(ctx.config.appUrl, job) }, job.ownerLang));
  }
}

async function allComponentAggregates(ctx) {
  const brands = await ctx.store.query({ pk: 'BRANDS' });
  const out = [];
  for (const b of brands) {
    const models = await ctx.store.query({ pk: `BRAND#${b.brand}`, skPrefix: 'MODEL#' });
    for (const m of models) {
      const comps = await ctx.store.query({ pk: `AGG#${b.brand}#${m.model}`, skPrefix: 'COMP#' });
      out.push(...comps);
    }
  }
  return out;
}

export async function anomaly(ctx) {
  const now = ctx.now();
  const comps = (await allComponentAggregates(ctx)).filter((c) => (c.n || 0) >= MIN_SAMPLE);
  const candidates = comps.map((c) => ({ brand: c.brand, model: c.model, category: c.category, component: c.component, series: seriesFor(c, now), synthetic: (c.n_syn || 0) / (c.n || 1) }));
  let rcf = null;
  if (ctx.svc.ml.configured && candidates.length) {
    try { rcf = await ctx.svc.ml.scoreRcf(candidates.map((c) => features(c.series))); } catch (e) { console.error('SageMaker scoring failed, using fallback', e); rcf = null; }
  }
  const result = detectSpikes(candidates, rcf);
  let created = 0;
  for (const f of result.flagged) {
    const month = f.series.at(-1).month;
    const params = { comp: { comp: [f.category, f.component] }, model: f.model, count: f.target, month, baseline: f.baseline };
    const alert = {
      PK: `ALERTS#${f.brand}`, SK: `${month}#${f.model}#${f.component}`, type: 'alert', brand: f.brand, model: f.model, category: f.category,
      component: f.component, month, count: f.target, baseline: f.baseline, z: f.z, rcf: f.rcf, detector: result.detector,
      synthetic: f.synthetic > 0.5, at: iso(now),
      key: 'alert.spike', params, message: format('alert.spike', params, 'en'),
    };
    try {
      await ctx.store.put(alert, { notExists: true });
      created++;
      const users = await usersByRole(ctx, 'brand', f.brand);
      for (const u of users) await notifyUser(ctx, u.userId, { key: 'notif.earlyWarning', params, link: `#/b/${encodeURIComponent(f.model)}` });
      await ctx.svc.notify.publish(`Punarnava early warning: ${f.brand} ${f.model}`, alert.message);
    } catch (e) {
      if (e.code !== 'ConditionFailed') throw e;
    }
  }
  if (created) await bumpImpact(ctx, { designIssuesFlagged: created });
  const summary = { detector: result.detector, checked: result.checked, flagged: result.flagged.length, newAlerts: created, at: iso(now) };
  await ctx.store.put({ PK: 'SYSTEM', SK: 'ANOMALY_LAST', ...summary });
  return summary;
}

// Loading synthetic data REPLACES the previous synthetic load (the generator is deterministic,
// so the old contribution is regenerated and subtracted). count = 0 removes synthetic data.
export async function seed(ctx, { count = 6000 } = {}) {
  const n = Number(count) === 0 ? 0 : Math.min(Math.max(Number(count) || 6000, 100), 20000);
  const prev = await ctx.store.get('SYSTEM', 'SEED_LAST');
  if (prev?.count && prev?.nowUsed) {
    const old = generateRecords({ count: prev.count, now: prev.nowUsed, seed: 7 });
    const neg = mergeDeltas(old.flatMap(aggregateDelta)).map((d) => ({ ...d, add: Object.fromEntries(Object.entries(d.add).map(([k, v]) => [k, -v])) }));
    await ctx.store.batchUpdate(neg);
    const brands = await ctx.store.query({ pk: 'BRANDS' });
    for (const b of brands) {
      for (const a of await ctx.store.query({ pk: `ALERTS#${b.brand}` })) if (a.synthetic) await ctx.store.delete(a.PK, a.SK);
    }
  }
  const nowUsed = ctx.now();
  let items = 0;
  if (n) {
    const merged = mergeDeltas(generateRecords({ count: n, now: nowUsed, seed: 7 }).flatMap(aggregateDelta));
    await ctx.store.batchUpdate(merged);
    items = merged.length;
  }
  const summary = { count: n, records: n, nowUsed, items, replaced: !!prev?.count, at: iso(nowUsed) };
  await ctx.store.update('SYSTEM', 'SEED_LAST', { set: summary, add: { runs: 1 } });
  return summary;
}
