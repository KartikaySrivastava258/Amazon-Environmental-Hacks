// Assistant for technicians (diagnosis hints, why an option is recommended) and brands (design suggestions).
//
// The rule-based answer is ALWAYS computed from domain data and returned. An agent (ctx.svc.agent: the local
// Strands Agents service) may add a short narrative. Agent output is accepted only if it passes validate():
// known IDs only, no number that is not in the tool data (no invented prices, shares or counts), and no safety
// or guarantee claims. Otherwise it is dropped and the reason is returned. Agents get the same TOOLS as data.
import { CATEGORIES, MIN_SAMPLE, GATES } from './catalog.js';
import { buildModelReport } from './insights.js';
import { getJob } from './records.js';
import { apiError, requireFields } from './util.js';

// ── Tools: pure reads of domain data, no personal data (no owner, phone, token, notes) ──
export const TOOLS = {
  async job_context(ctx, { jobId }, me) {
    const job = await getJob(ctx, jobId);
    if (me && job.techId !== me.userId && !me.isAdmin) throw apiError(403, 'otherTechJob');
    const d = job.diagnosis;
    return {
      jobId: job.jobId, category: job.category, brand: job.brand, model: job.model, ageYears: job.ageYears, status: job.status,
      diagnosis: d ? { component: d.component, causes: d.causes, severity: d.severity, spare: d.spare, barrier: d.barrier } : null,
    };
  },
  async catalog_components(ctx, { category }) {
    const cat = CATEGORIES[category];
    if (!cat) throw apiError(400, 'unknownCategory');
    return { category, lifespanYears: cat.lifespan, components: cat.components.map((c) => ({ id: c.id, name: c.en, hazardous: !!c.hazardous })), safetySteps: (cat.gates || []).map((g) => ({ id: g, name: GATES[g]?.en || g })) };
  },
  async model_failure_stats(ctx, { brand, model }) {
    const total = await ctx.store.get(`AGG#${brand}#${model}`, 'TOTAL');
    if (!total) return { brand, model, n: 0, sufficient: false, minSample: MIN_SAMPLE, components: [] };
    const r = buildModelReport(total, await ctx.store.query({ pk: `AGG#${brand}#${model}`, skPrefix: 'COMP#' }));
    return {
      brand, model, n: r.n, syntheticShare: Math.round(r.syntheticShare * 100) / 100, sufficient: r.sufficient, minSample: MIN_SAMPLE,
      components: r.components.slice(0, 8).map((c) => ({ component: c.component, n: c.n, sharePct: Math.round(c.share * 100), sufficient: c.sufficient, topCauses: c.causes.slice(0, 3).map((x) => ({ cause: x.cause, sharePct: Math.round(x.share * 100) })) })),
      recommendations: r.recommendations.map((x) => ({ rule: x.rule, component: x.component, params: x.params, action: x.action, why: x.why })),
    };
  },
  async repair_options(ctx, { jobId }, me) {
    const job = await getJob(ctx, jobId);
    if (me && job.techId !== me.userId && !me.isAdmin) throw apiError(403, 'otherTechJob');
    if (!job.build) throw apiError(409, 'noOptionsYet');
    return {
      recommended: job.build.recommended, reason: job.build.reason, newPrice: job.build.newPrice, fair: job.build.fair,
      options: job.build.options.map((o) => ({ id: o.id, cost: o.cost ?? null, payout: o.payout || null, lifeGainYears: o.lifeGainYears ?? null, material: o.terms?.material || o.outcome, ownership: o.terms?.ownership || null })),
    };
  },
};

// ── Rule-based answers (always available) ──
async function rulesDiagnosis(ctx, job) {
  const cat = await TOOLS.catalog_components(ctx, { category: job.category });
  const stats = await TOOLS.model_failure_stats(ctx, { brand: job.brand, model: job.model });
  const ranked = stats.sufficient
    ? stats.components.filter((c) => c.sufficient).slice(0, 3).map((c) => ({ component: c.component, key: 'assist.why.modelShare', params: { pct: c.sharePct, n: stats.n, model: job.model }, causes: c.topCauses.map((x) => x.cause) }))
    : [];
  const result = {
    basis: stats.sufficient ? 'model' : 'insufficient',
    suggestions: ranked,
    cautions: cat.components.filter((c) => c.hazardous).map((c) => ({ key: 'assist.caution.hazard', params: { comp: { comp: [job.category, c.id] } } })),
    synthetic: stats.syntheticShare > 0,
  };
  return { result, grounding: { job, cat, stats } };
}
async function rulesRecommendation(ctx, jobId, me) {
  const opts = await TOOLS.repair_options(ctx, { jobId }, me);
  return { result: { recommended: opts.recommended, reason: opts.reason, options: opts.options }, grounding: { opts } };
}
async function rulesDesign(ctx, brand, model) {
  const stats = await TOOLS.model_failure_stats(ctx, { brand, model });
  return {
    result: { basis: stats.sufficient ? 'model' : 'insufficient', n: stats.n, synthetic: stats.syntheticShare > 0, recommendations: stats.recommendations.map((r) => ({ rule: r.rule, component: r.component, params: r.params })) },
    grounding: { stats },
  };
}

// ── Validation of agent output ──
const SAFETY = /\b(guarantee[ds]?|certified|safe to (?:use|touch|open|handle)|no risk|risk[- ]free|100% safe)\b/i;
const toAscii = (s) => String(s).replace(/[०-९]/g, (c) => c.charCodeAt(0) - 0x966).replace(/[০-৯]/g, (c) => c.charCodeAt(0) - 0x9e6).replace(/[௦-௯]/g, (c) => c.charCodeAt(0) - 0xbe6);
/** Every number that appears anywhere in the grounding data (as written, rounded, and as a percentage). */
export function allowedNumbers(grounding) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      for (const x of [v, Math.round(v), Math.round(v * 10) / 10, Math.round(v * 100)]) out.add(String(x));
    } else if (typeof v === 'string') {
      for (const m of v.match(/\d+(?:\.\d+)?/g) || []) out.add(m);
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(grounding);
  for (const n of ['0', '1', '2', '3']) out.add(n); // list positions ("3 checks") carry no factual claim
  return out;
}
const numbersIn = (text) => (toAscii(text).replace(/(\d),(?=\d{2,3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) || []);

/**
 * Accept an agent narrative only if it is grounded. Returns { ok, narrative } or { ok: false, reason }.
 * Shape: { summary: string, items: [{ ref: string, text: string }] }; ref is a component, option or rule ID.
 */
export function validateNarrative(task, raw, grounding, refs) {
  let n = raw;
  if (typeof n === 'string') { try { n = JSON.parse(n); } catch { return { ok: false, reason: 'notJson' }; } }
  if (!n || typeof n !== 'object' || typeof n.summary !== 'string' || !Array.isArray(n.items)) return { ok: false, reason: 'badShape' };
  if (n.summary.length > 800 || n.items.length > 6) return { ok: false, reason: 'tooLong' };
  const items = [];
  for (const it of n.items) {
    if (!it || typeof it.ref !== 'string' || typeof it.text !== 'string' || it.text.length > 400) return { ok: false, reason: 'badShape' };
    if (!refs.has(it.ref)) return { ok: false, reason: 'unknownRef', detail: it.ref.slice(0, 40) };
    items.push({ ref: it.ref, text: it.text.trim() });
  }
  const allowed = allowedNumbers(grounding);
  for (const text of [n.summary, ...items.map((i) => i.text)]) {
    if (SAFETY.test(text)) return { ok: false, reason: 'safetyClaim' };
    const bad = numbersIn(text).find((x) => !allowed.has(x) && !allowed.has(String(Number(x))));
    if (bad) return { ok: false, reason: 'ungroundedNumber', detail: bad };
  }
  return { ok: true, narrative: { summary: n.summary.trim(), items } };
}

async function withAgent(ctx, task, input, rules, refs) {
  const base = { ...rules.result };
  if (!ctx.svc.agent?.enabled) return { source: 'rules', reason: 'agentOff', result: base };
  try {
    const out = await ctx.svc.agent.run({ task, input });
    const v = validateNarrative(task, out?.narrative ?? out, rules.grounding, refs);
    if (!v.ok) {
      ctx.svc.metrics?.emit?.('agentRejected', 1);
      return { source: 'rules', reason: 'agentRejected', rejected: v.reason, result: base };
    }
    return { source: 'agent', agent: { provider: out?.provider || ctx.svc.agent.provider || 'strands', model: out?.model || null }, narrative: v.narrative, result: base };
  } catch (e) {
    return { source: 'rules', reason: 'agentUnavailable', result: base };
  }
}

export function assistRoutes() {
  return [
    ['POST', '/api/assist/diagnosis', ['technician'], async (ctx, { body }, me) => {
      requireFields(body, ['jobId']);
      const job = await TOOLS.job_context(ctx, { jobId: body.jobId }, me);
      const rules = await rulesDiagnosis(ctx, job);
      const refs = new Set(CATEGORIES[job.category].components.map((c) => c.id));
      return withAgent(ctx, 'diagnosis', { jobId: job.jobId, lang: body.lang || 'en' }, rules, refs);
    }],
    ['POST', '/api/assist/recommendation', ['technician'], async (ctx, { body }, me) => {
      requireFields(body, ['jobId']);
      const rules = await rulesRecommendation(ctx, String(body.jobId), me);
      const refs = new Set(rules.result.options.map((o) => o.id));
      return withAgent(ctx, 'recommendation', { jobId: String(body.jobId), lang: body.lang || 'en' }, rules, refs);
    }],
    ['POST', '/api/assist/design', ['brand'], async (ctx, { body }, me) => {
      requireFields(body, ['model']);
      const brand = me.isAdmin && body.brand ? String(body.brand) : me.brandId;
      if (!brand) throw apiError(403, 'noBrandLink');
      const model = String(body.model).toUpperCase().slice(0, 30);
      const rules = await rulesDesign(ctx, brand, model);
      const refs = new Set([...rules.grounding.stats.components.map((c) => c.component), ...rules.result.recommendations.map((r) => r.rule)]);
      return withAgent(ctx, 'design', { brand, model, lang: body.lang || 'en' }, rules, refs);
    }],
  ];
}
