// Step Functions task logic for one repair job. See statemachine/repair-job.asl.json.
// BuildOptions → WaitForOwnerDecision (token) → ApplyDecision → [repair: WaitForRepair (token) → CompleteRepair]
import { CATEGORIES, component as compOf, monthOf } from './catalog-ext.js';
import { buildOptions } from './decision.js';
import { getJob, jobTimeline, passportEvent, searchParts, reservePart, createPickup, setHolder, notifyUser } from './records.js';
import { iso, maskPhone, format, ownerUrl } from './util.js';
import { MSG } from './messages.js';
import { notifyJobCustomer } from './rewards.js';

// English option labels, kept for older importers. Translations live in MSG['opt.<id>'].
const OPTION_TEXT = Object.fromEntries(['repair_new', 'repair_reused', 'sell', 'harvest', 'recycle'].map((id) => [id, MSG[`opt.${id}`][0]]));
export { OPTION_TEXT };

const minutes = (m) => m * 60 * 1000;

export async function handle(ctx, event) {
  const fn = TASKS[event.task];
  if (!fn) throw new Error(`Unknown workflow task ${event.task}`);
  return fn(ctx, event);
}

const TASKS = {
  async buildOptions(ctx, { jobId }) {
    const job = await getJob(ctx, jobId);
    const d = job.diagnosis;
    let best = null;
    if (d.severity === 'replace_part') {
      const parts = await searchParts(ctx, { category: job.category, component: d.component, brand: job.brand, model: job.model, area: job.area, excludeSeller: job.techId });
      if (parts[0]) best = { partId: parts[0].partId, price: parts[0].price, compatibility: parts[0].compatibility, sellerArea: parts[0].area };
    }
    const build = buildOptions(job, best);
    await jobTimeline(ctx, jobId, { key: 'event.optionsReady' }, 'system', { build, status: 'awaiting_owner' });
    return { recommended: build.recommended };
  },

  async notifyOwner(ctx, { jobId, taskToken }) {
    const job = await getJob(ctx, jobId);
    await jobTimeline(ctx, jobId, { key: 'event.optionsSent', params: { phone: maskPhone(job.ownerPhone) } }, 'system', { taskToken, ownerNotifiedAt: iso(ctx.now()) });
    const remindMs = ctx.config.demoMode ? minutes(ctx.config.reminderMinutes) : 24 * 3600 * 1000;
    await ctx.svc.scheduler.at(`pn-rem-${jobId}`, ctx.now() + remindMs, { type: 'reminder', jobId });
    if (ctx.config.enableSms && job.ownerPhone) {
      await ctx.svc.notify.sms(job.ownerPhone, format('sms.optionsReady', { cat: { cat: job.category }, link: ownerUrl(ctx.config.appUrl, job) }, job.ownerLang));
    }
    await notifyUser(ctx, job.techId, { key: 'notif.optionsReady', params: { jobId: job.jobId }, link: `#/t/job/${jobId}` });
    await notifyJobCustomer(ctx, job, { key: 'cnotif.optionsReady', params: { cat: { cat: job.category } } });
    return {};
  },

  async applyDecision(ctx, { jobId, decision }) {
    const job = await getJob(ctx, jobId);
    const option = decision?.option;
    await ctx.svc.scheduler.cancel(`pn-rem-${jobId}`);
    const set = { decision: { option, at: iso(ctx.now()) }, taskToken: null, consent: !!decision?.consent, decisionPending: null };
    let status;
    if (option === 'repair_new' || option === 'repair_reused') {
      status = 'repairing';
      if (option === 'repair_reused') {
        const opt = job.build.options.find((o) => o.id === 'repair_reused');
        try {
          await reservePart(ctx, opt.partId, job.techId, jobId);
          set.reservedPartId = opt.partId;
          await notifyUser(ctx, job.techId, { key: 'notif.partReservedForYou', params: { partId: opt.partId }, link: '#/parts' });
        } catch (e) {
          set.reservedPartId = null;
          await notifyUser(ctx, job.techId, { key: 'notif.partTaken', params: { partId: opt.partId }, link: '#/parts' });
        }
      }
    } else if (option === 'sell') {
      status = 'sold';
      await setHolder(ctx, job.pid, job.techId, 'with_technician');
    } else if (option === 'harvest') {
      status = 'awaiting_harvest';
      await setHolder(ctx, job.pid, job.techId, 'with_technician');
    } else if (option === 'recycle') {
      status = 'recycling';
      const cat = CATEGORIES[job.category];
      const params = { cat: { cat: job.category }, brand: job.brand, model: job.model };
      await setHolder(ctx, job.pid, null, 'recycling');
      await createPickup(ctx, {
        pid: job.pid, jobId, category: job.category, area: job.area, requestedBy: job.techId, wholeProduct: true,
        items: [{ label: format('pickup.whole', params, 'en'), key: 'pickup.whole', params, hazardous: cat.components.some((c) => c.hazardous), estKg: cat.kg }],
      });
    } else if (option === 'decline') {
      status = 'owner_declined'; // the owner keeps the product; nothing proceeds
    } else {
      throw new Error(`Unknown option ${option}`);
    }
    await jobTimeline(ctx, jobId, { key: 'event.ownerChose', params: { opt: { opt: option } } }, 'decision', { ...set, status });
    await passportEvent(ctx, job.pid, { kind: 'decision', key: 'event.ownerChose', params: { opt: { opt: option } }, jobId });
    const d = job.diagnosis;
    await ctx.svc.events.emit('job.decided', {
      jobId, consent: !!decision?.consent, option,
      record: {
        brand: job.brand, model: job.model, category: job.category, component: d.component, causes: d.causes,
        ageYears: job.ageYears, area: job.area, month: monthOf(ctx.now()), spare: d.spare, barrier: d.barrier || 'none', severity: d.severity,
        abandoned: !String(option).startsWith('repair') && (d.spare === 'none' || (d.barrier && d.barrier !== 'none')),
        synthetic: !!job.demo, // labelled demo journeys count with synthetic data, never as real records
      },
    });
    await notifyUser(ctx, job.techId, { key: 'notif.ownerChose', params: { jobId: job.jobId, opt: { opt: option }, next: { msg: `next.${option}` } }, link: `#/t/job/${jobId}` });
    return { status };
  },

  async registerRepair(ctx, { jobId, taskToken }) {
    await ctx.store.update(`JOB#${jobId}`, 'META', { set: { repairToken: taskToken } });
    return {};
  },

  async completeRepair(ctx, { jobId, repair }) {
    const job = await getJob(ctx, jobId);
    const cat = CATEGORIES[job.category];
    const comp = compOf(job.category, job.diagnosis.component);
    const warrantyDays = Number(repair.warrantyDays || 0);
    const warranty = warrantyDays > 0 ? { days: warrantyDays, until: iso(ctx.now() + warrantyDays * 86400000) } : null;
    const reused = repair.partSource === 'reused';
    await jobTimeline(ctx, jobId, reused ? { key: 'event.repairedReused', params: { partId: repair.partId } } : { key: 'event.repairedNew' }, 'done', {
      status: 'repaired', repair: { ...repair, at: iso(ctx.now()) }, warranty, repairToken: null, verified: null,
    });
    await ctx.store.update(`PASSPORT#${job.pid}`, 'META', { set: { status: 'in_use' }, add: { repairs: 1 } });
    await passportEvent(ctx, job.pid, {
      kind: 'repair', jobId, partId: repair.partId || null,
      key: reused ? 'event.partReplacedReused' : 'event.partReplacedNew',
      params: { comp: { comp: [job.category, comp.id] }, partId: repair.partId || '', warranty: warranty ? { msg: 'event.warrantySuffix', params: { days: warrantyDays } } : '' },
    });
    const fuMs = ctx.config.demoMode ? minutes(ctx.config.followupMinutes) : 30 * 86400000;
    await ctx.svc.scheduler.at(`pn-fu-${jobId}`, ctx.now() + fuMs, { type: 'followup', jobId });
    await ctx.svc.events.emit('repair.completed', { jobId, category: job.category, kg: cat.kg, amount: Number(repair.amount || 0), partSource: repair.partSource });
    if (repair.partSource === 'reused') await ctx.svc.events.emit('part.installed', { partId: repair.partId, jobId, kg: comp.kg });
    if (ctx.config.enableSms && job.ownerPhone) {
      await ctx.svc.notify.sms(job.ownerPhone, format('sms.confirmWorking', { cat: { cat: job.category }, link: ownerUrl(ctx.config.appUrl, job) }, job.ownerLang));
    }
    await notifyJobCustomer(ctx, job, { key: 'cnotif.repairDone', params: { cat: { cat: job.category } } });
    return {};
  },

  async closeNoDecision(ctx, { jobId }) {
    const job = await getJob(ctx, jobId);
    await ctx.svc.scheduler.cancel(`pn-rem-${jobId}`);
    await jobTimeline(ctx, jobId, { key: 'event.noDecision' }, 'warning', { status: 'no_decision', taskToken: null });
    await notifyUser(ctx, job.techId, { key: 'notif.noDecision', params: { jobId: job.jobId }, link: `#/t/job/${jobId}` });
    return {};
  },

  async closeRepairTimeout(ctx, { jobId }) {
    const job = await getJob(ctx, jobId);
    await jobTimeline(ctx, jobId, { key: 'event.repairOverdue' }, 'warning', { status: 'repair_overdue', repairToken: null });
    await notifyUser(ctx, job.techId, { key: 'notif.repairOverdue', params: { jobId: job.jobId }, link: `#/t/job/${jobId}` });
    return {};
  },
};
