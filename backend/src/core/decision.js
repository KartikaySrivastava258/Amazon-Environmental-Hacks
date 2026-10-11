// Decision engine. Pure functions: same code runs in Lambda, browser demo and tests.
// The fair range comes from reference values, never from the technician.
import { category, component, brandTier } from './catalog.js';

const round50 = (n) => Math.max(0, Math.round(n / 50) * 50);
const range = (mid, lo = 0.85, hi = 1.15) => ({ low: round50(mid * lo), high: round50(mid * hi), mid: round50(mid) });

// Repair is recommended when it costs at most this share of a comparable new product
// and the product is younger than its typical lifespan. Tunable assumption.
export const REPAIR_SHARE_LIMIT = 0.5;

export function fairRepairRange({ categoryId, componentId, brand, severity }) {
  const cat = category(categoryId);
  const comp = component(categoryId, componentId);
  const tier = brandTier(brand);
  const parts = severity === 'repair_in_place' ? 0 : comp.cost * tier;
  return range(parts + cat.labour);
}

export function residualShare(categoryId, ageYears) {
  const cat = category(categoryId);
  return Math.max(0.1, 1 - Number(ageYears || 0) / cat.lifespan);
}

export function sellAsIsValue({ categoryId, brand, ageYears, repairMid }) {
  const cat = category(categoryId);
  const working = cat.newPrice * brandTier(brand) * residualShare(categoryId, ageYears) * 0.6;
  return working - repairMid * 1.15; // buyer still has to fix it, plus a margin
}

export function harvestValue({ categoryId, brand, failedComponent }) {
  const cat = category(categoryId);
  const tier = brandTier(brand);
  const partsValue = cat.components
    .filter((x) => x.id !== failedComponent && !x.hazardous)
    .reduce((s, x) => s + x.harvest * tier * 0.8, 0);
  return partsValue + scrapValue(categoryId) * 0.5;
}

export function scrapValue(categoryId) {
  const cat = category(categoryId);
  return cat.kg * cat.scrapRate;
}

export function lifeGainYears(categoryId, ageYears) {
  const cat = category(categoryId);
  const left = Math.max(0, cat.lifespan - Number(ageYears || 0));
  return Math.max(0.5, Math.round(left * 0.7 * 2) / 2);
}

// Offered warranty and the technician's own suggestion are recorded on the diagnosis, but they never change
// the fair range or Punarnava's recommendation (those come from reference values only).
export const MAX_OFFER_WARRANTY_DAYS = 365;

export function quoteCheck(quoteTotal, fair) {
  if (!(quoteTotal > 0)) return { status: 'none' };
  if (quoteTotal > fair.high) {
    return { status: 'above', percent: Math.round(((quoteTotal - fair.high) / fair.high) * 100) };
  }
  if (quoteTotal < fair.low) return { status: 'below' };
  return { status: 'within' };
}

/**
 * Build the owner's options.
 * job: { category, brand, model, ageYears, diagnosis: { component, severity, spare, quote: {parts, labour} } }
 * reusedPart: best compatible listed part nearby or null ({ partId, price, compatibility, sellerArea })
 */
export function buildOptions(job, reusedPart = null) {
  const { category: categoryId, brand, ageYears } = job;
  const d = job.diagnosis;
  const cat = category(categoryId);
  const comp = component(categoryId, d.component);
  const tier = brandTier(brand);
  const newPrice = round50(cat.newPrice * tier);
  const fair = fairRepairRange({ categoryId, componentId: d.component, brand, severity: d.severity });
  const quoteTotal = Number(d.quote?.parts || 0) + Number(d.quote?.labour || 0);
  const quote = quoteCheck(quoteTotal, fair);
  const gain = lifeGainYears(categoryId, ageYears);
  const options = [];
  const unsafe = d.severity === 'unsafe';
  const spareMissing = d.spare === 'none' && d.severity === 'replace_part';

  const offer = Math.max(0, Math.min(MAX_OFFER_WARRANTY_DAYS, Math.round(Number(d.offerWarrantyDays) || 0)));
  const warrantyDays = offer > 0 ? offer : null;

  if (!unsafe && !spareMissing) {
    const cost = quoteTotal > 0 ? quoteTotal : fair.mid;
    options.push({
      id: 'repair_new',
      cost,
      fair,
      quote,
      lifeGainYears: gain,
      kgKeptInUse: cat.kg,
      outcome: 'keeps_in_use',
      terms: {
        payer: 'owner', payee: 'technician', estimate: !(quoteTotal > 0),
        lines: quoteTotal > 0
          ? [{ key: 'parts', amount: Number(d.quote?.parts || 0) }, { key: 'labour', amount: Number(d.quote?.labour || 0) }]
          : [{ key: 'fairEstimate', amount: fair.mid }],
        total: cost, ownership: 'stays', part: 'new', warrantyDays, material: 'kept_in_use', kg: cat.kg,
        costPerYear: Math.round(cost / gain), newPrice, next: 'repair',
      },
    });
  }
  if (!unsafe && reusedPart && d.severity === 'replace_part') {
    const partPrice = Number(reusedPart.price) || 0;
    const cost = round50(partPrice + cat.labour);
    const life = Math.max(0.5, gain - 0.5);
    const lines = [{ key: 'reusedPart', amount: partPrice }, { key: 'labour', amount: cat.labour }];
    if (cost !== partPrice + cat.labour) lines.push({ key: 'rounding', amount: cost - partPrice - cat.labour });
    options.push({
      id: 'repair_reused',
      cost,
      fair: range(cost, 0.95, 1.05),
      partId: reusedPart.partId,
      compatibility: reusedPart.compatibility,
      lifeGainYears: life,
      kgKeptInUse: cat.kg,
      partKgReused: comp.kg,
      outcome: 'reuses_part',
      terms: {
        payer: 'owner', payee: 'technician', estimate: false, lines, total: cost, ownership: 'stays', part: 'reused',
        partId: reusedPart.partId, compatibility: reusedPart.compatibility, warrantyDays, material: 'part_reused', kg: cat.kg, partKg: comp.kg,
        costPerYear: Math.round(cost / life), newPrice, next: 'repair',
      },
    });
  }
  const repairMid = Math.min(...options.filter((o) => o.id.startsWith('repair')).map((o) => o.cost), fair.mid);
  const workingValue = cat.newPrice * brandTier(brand) * residualShare(categoryId, ageYears) * 0.6;
  const repairDeduction = (unsafe ? newPrice : repairMid) * 1.15;
  const sell = Math.max(sellAsIsValue({ categoryId, brand, ageYears, repairMid: unsafe ? newPrice : repairMid }), 0);
  const harvest = harvestValue({ categoryId, brand, failedComponent: d.component });
  const scrap = scrapValue(categoryId);
  const partsValue = harvest - scrap * 0.5;
  if (!unsafe && sell > harvest) {
    const payout = range(sell);
    options.push({
      id: 'sell', payout, outcome: 'reuses_product', kgKeptInUse: cat.kg,
      terms: {
        payer: 'technician', payee: 'owner', estimate: true,
        lines: [{ key: 'workingValue', amount: round50(workingValue) }, { key: 'repairDeduction', amount: -round50(repairDeduction) }],
        total: payout, ownership: 'to_technician', part: null, warrantyDays: null, material: 'product_reused', kg: cat.kg, next: 'sell',
      },
    });
  }
  const harvestPayout = range(harvest);
  options.push({
    id: 'harvest', payout: harvestPayout, outcome: 'reuses_parts',
    terms: {
      payer: 'technician', payee: 'owner', estimate: true,
      lines: [{ key: 'partsValue', amount: round50(partsValue) }, { key: 'scrapShare', amount: round50(scrap * 0.5) }],
      total: harvestPayout, ownership: 'to_technician', part: null, warrantyDays: null, material: 'parts_harvested', kg: cat.kg, next: 'harvest',
    },
  });
  const recyclePayout = range(scrap);
  options.push({
    id: 'recycle', payout: recyclePayout, outcome: 'recycles_safely', kgToRecycler: cat.kg,
    terms: {
      // The registered recycler pays the collector per kg at the published rate; Punarnava does not pay the owner.
      payer: 'recycler', payee: 'collector', estimate: true,
      lines: [{ key: 'material', amount: round50(scrap), kg: cat.kg, rate: cat.scrapRate }],
      total: recyclePayout, ownership: 'to_recycler', part: null, warrantyDays: null, material: 'recycled', kg: cat.kg, next: 'recycle',
    },
  });

  const age = Number(ageYears || 0);
  const repairs = options.filter((o) => o.id.startsWith('repair'));
  const cheapestRepair = repairs.sort((a, b) => a.cost - b.cost)[0];
  let recommended;
  let reason;
  if (cheapestRepair && cheapestRepair.cost <= REPAIR_SHARE_LIMIT * newPrice && age < cat.lifespan) {
    recommended = cheapestRepair.id;
    reason = 'repair_worth_it';
  } else if (options.find((o) => o.id === 'sell')) {
    recommended = 'sell';
    reason = cheapestRepair ? 'repair_too_costly' : 'no_repair_possible';
  } else if (harvest > scrap * 0.6) {
    recommended = 'harvest';
    reason = unsafe ? 'unsafe' : 'parts_still_useful';
  } else {
    recommended = 'recycle';
    reason = 'nothing_reusable';
  }
  for (const o of options) o.recommended = o.id === recommended;
  // Waste hierarchy order: repair, reuse, recycle
  const order = ['repair_reused', 'repair_new', 'sell', 'harvest', 'recycle'];
  options.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { options, recommended, reason, newPrice, fair, quote, spareMissing, unsafe };
}
