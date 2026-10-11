// Component Intelligence. Pure functions over aggregate items.
// Never compares brands by raw counts (market-share bias): only within-model shares,
// age at failure, causes, regions and repairability barriers.
import { CATEGORIES, CAUSES, AGE_BANDS, AGE_BAND_MID, MIN_SAMPLE, ageBand, areaName } from './catalog.js';
import { format } from './messages.js';

export const aggPk = (brand, model) => `AGG#${brand}#${model}`;

/** Turn one consented repair record into counter updates. */
export function aggregateDelta(r) {
  const syn = r.synthetic ? 1 : 0;
  const pk = aggPk(r.brand, r.model);
  const comp = { n: 1, n_syn: syn };
  for (const cause of r.causes?.length ? r.causes : ['unknown']) comp[`c_${cause}`] = (comp[`c_${cause}`] || 0) + 1;
  comp[`a_${ageBand(r.ageYears)}`] = 1;
  if (r.area) comp[`r_${r.area}`] = 1;
  if (r.month) comp[`m_${r.month}`] = 1;
  if (r.spare === 'none') comp.spare_none = 1;
  if (r.abandoned) comp.abandoned = 1;
  if (r.barrier && r.barrier !== 'none') comp[`b_${r.barrier}`] = 1;
  if (r.severity) comp[`s_${r.severity}`] = 1; // real records only; the synthetic generator does not set severity
  const ids = { brand: r.brand, model: r.model, category: r.category };
  return [
    { pk, sk: 'TOTAL', set: ids, add: { n: 1, n_syn: syn } },
    { pk, sk: `COMP#${r.component}`, set: { ...ids, component: r.component }, add: comp },
    { pk: `BRAND#${r.brand}`, sk: `MODEL#${r.model}`, set: ids, add: { n: 1, n_syn: syn } },
    { pk: 'BRANDS', sk: r.brand, set: { brand: r.brand }, add: { n: 1 } },
  ];
}

/** Merge many deltas in memory (used by the synthetic seeder). */
export function mergeDeltas(deltas) {
  const map = new Map();
  for (const d of deltas) {
    const k = `${d.pk}||${d.sk}`;
    const cur = map.get(k) || { pk: d.pk, sk: d.sk, set: {}, add: {} };
    Object.assign(cur.set, d.set);
    for (const [a, v] of Object.entries(d.add)) cur.add[a] = (cur.add[a] || 0) + v;
    map.set(k, cur);
  }
  return [...map.values()];
}

const pick = (item, prefix) =>
  Object.entries(item)
    .filter(([k, v]) => k.startsWith(prefix) && typeof v === 'number')
    .map(([k, v]) => [k.slice(prefix.length), v]);

function medianBand(item) {
  const counts = AGE_BANDS.map((b) => item[`a_${b}`] || 0);
  const total = counts.reduce((s, x) => s + x, 0);
  if (!total) return null;
  let cum = 0;
  for (let i = 0; i < AGE_BANDS.length; i++) {
    cum += counts[i];
    if (cum >= total / 2) return AGE_BANDS[i];
  }
  return AGE_BANDS.at(-1);
}

export function componentStats(item, modelTotal) {
  const n = item.n || 0;
  const share = (x) => (n ? x / n : 0);
  const causes = pick(item, 'c_').map(([cause, v]) => ({ cause, n: v, share: share(v) })).sort((a, b) => b.n - a.n);
  const ages = Object.fromEntries(AGE_BANDS.map((b) => [b, share(item[`a_${b}`] || 0)]));
  const regions = pick(item, 'r_').map(([area, v]) => ({ area, name: areaName(area), n: v, share: share(v) })).sort((a, b) => b.n - a.n);
  const barriers = pick(item, 'b_').map(([barrier, v]) => ({ barrier, n: v, share: share(v) })).sort((a, b) => b.n - a.n);
  const months = pick(item, 'm_').sort((a, b) => a[0].localeCompare(b[0]));
  const severity = pick(item, 's_').map(([sev, v]) => ({ severity: sev, n: v })).sort((a, b) => b.n - a.n);
  const real = n - (item.n_syn || 0);
  return {
    component: item.component,
    n,
    syntheticShare: share(item.n_syn || 0),
    share: modelTotal ? n / modelTotal : 0,
    causes,
    ages,
    medianBand: medianBand(item),
    earlyShare: (ages['0-1'] || 0) + (ages['1-2'] || 0),
    regions,
    spareNoneShare: share(item.spare_none || 0),
    abandonedShare: share(item.abandoned || 0),
    barriers,
    months,
    severity, // counts over real records with a recorded severity
    realN: real,
    sufficient: n >= MIN_SAMPLE,
  };
}

const causeShare = (s, cause) => s.causes.find((c) => c.cause === cause)?.share || 0;

// Pattern → design action. Plain rules, so every recommendation is explainable.
// Text lives in MSG['rule.<id>.action'] / MSG['rule.<id>.why']; params(s) fills the why-sentence.
const gluedShare = (s) => s.barriers.find((b) => b.barrier === 'glued_or_sealed')?.share || 0;
export const RULES = [
  { id: 'surge', test: (s) => causeShare(s, 'voltage_surge') >= 0.4, params: (s) => ({ share: pct(causeShare(s, 'voltage_surge')), n: s.n }) },
  { id: 'defect', test: (s) => causeShare(s, 'manufacturing_defect') >= 0.3 && s.earlyShare >= 0.5, params: (s) => ({ share: pct(causeShare(s, 'manufacturing_defect')), early: pct(s.earlyShare) }) },
  { id: 'hard_water', test: (s) => causeShare(s, 'hard_water') >= 0.4, params: (s) => ({ share: pct(causeShare(s, 'hard_water')) }) },
  { id: 'heat', test: (s) => causeShare(s, 'heat') >= 0.4, params: (s) => ({ share: pct(causeShare(s, 'heat')) }) },
  { id: 'water', test: (s) => causeShare(s, 'water_ingress') >= 0.4, params: (s) => ({ share: pct(causeShare(s, 'water_ingress')) }) },
  { id: 'dust', test: (s) => causeShare(s, 'dust') >= 0.4, params: (s) => ({ share: pct(causeShare(s, 'dust')) }) },
  { id: 'spares', test: (s) => s.spareNoneShare >= 0.25, params: (s) => ({ share: pct(s.spareNoneShare) }) },
  { id: 'disassembly', test: (s) => gluedShare(s) >= 0.2 || s.abandonedShare >= 0.25, params: (s) => ({ share: pct(Math.max(s.abandonedShare, gluedShare(s))) }) },
];

function pct(x) {
  return `${Math.round(x * 100)}%`;
}

// English label, for SNS and fallbacks only.
export function componentLabel(categoryId, compId) {
  return CATEGORIES[categoryId]?.components.find((c) => c.id === compId)?.en || compId;
}

export function buildModelReport(total, compItems, alerts = []) {
  const n = total?.n || 0;
  const categoryId = total?.category;
  const comps = compItems.map((it) => componentStats(it, n)).sort((a, b) => b.n - a.n);
  // Model-wide regional mix, to spot components that are over-represented in an area.
  const modelRegions = {};
  for (const it of compItems) for (const [a, v] of pick(it, 'r_')) modelRegions[a] = (modelRegions[a] || 0) + v;
  const recommendations = [];
  const hotspots = [];
  for (const s of comps) {
    if (!s.sufficient) continue;
    for (const r of RULES) {
      if (!r.test(s)) continue;
      const params = { comp: { comp: [categoryId, s.component] }, ...r.params(s) };
      recommendations.push({ rule: r.id, component: s.component, params, action: format(`rule.${r.id}.action`, params, 'en'), why: format(`rule.${r.id}.why`, params, 'en'), n: s.n });
    }
    for (const reg of s.regions.slice(0, 3)) {
      const base = (modelRegions[reg.area] || 0) / n;
      if (reg.n >= 8 && base > 0 && reg.share / base >= 1.8) {
        hotspots.push({ component: s.component, area: reg.area, name: reg.name, ratio: Math.round((reg.share / base) * 10) / 10, n: reg.n });
      }
    }
  }
  return {
    brand: total?.brand,
    model: total?.model,
    category: categoryId,
    n,
    syntheticShare: n ? (total.n_syn || 0) / n : 0,
    sufficient: n >= MIN_SAMPLE,
    minSample: MIN_SAMPLE,
    components: comps,
    recommendations,
    hotspots: hotspots.sort((a, b) => b.ratio - a.ratio).slice(0, 6),
    alerts,
  };
}

/** Public 1–5 ratings. Early estimates from repair logs, labelled as such in the UI. */
export function modelScores(total, compItems) {
  const n = total?.n || 0;
  if (n < MIN_SAMPLE) return { n, sufficient: false };
  const cat = CATEGORIES[total.category];
  let ageSum = 0, ageN = 0, blocked = 0;
  for (const it of compItems) {
    for (const b of AGE_BANDS) {
      const v = it[`a_${b}`] || 0;
      ageSum += AGE_BAND_MID[b] * v;
      ageN += v;
    }
    const barrierN = pick(it, 'b_').reduce((s, [, v]) => s + v, 0);
    blocked += Math.max(it.spare_none || 0, it.abandoned || 0, barrierN);
  }
  const meanAge = ageN ? ageSum / ageN : 0;
  const r = meanAge / cat.lifespan;
  const durability = r >= 0.6 ? 5 : r >= 0.45 ? 4 : r >= 0.3 ? 3 : r >= 0.15 ? 2 : 1;
  const u = blocked / n;
  const repairability = u < 0.1 ? 5 : u < 0.2 ? 4 : u < 0.3 ? 3 : u < 0.45 ? 2 : 1;
  const top = [...compItems].sort((a, b) => (b.n || 0) - (a.n || 0))[0];
  return {
    n,
    sufficient: true,
    syntheticShare: (total.n_syn || 0) / n,
    durability,
    repairability,
    meanAgeAtFailure: Math.round(meanAge * 10) / 10,
    blockedShare: u,
    topFailure: top ? { component: top.component, share: (top.n || 0) / n } : null,
  };
}

export const causeLabel = (id) => CAUSES[id]?.en || id;
