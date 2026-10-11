// Synthetic repair records for building and testing Component Intelligence.
// Patterns are planted on purpose so we can check the dashboard finds them.
// Everything produced here is flagged synthetic and labelled in the UI.
import { CATEGORIES, BRANDS, AREAS } from './catalog.js';
import { previousMonths } from './anomaly.js';

export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const weighted = (r, entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of entries) if ((x -= w) <= 0) return k;
  return entries.at(-1)[0];
};

// Planted patterns (documented in the blog's Part 4):
export const PLANTED = [
  { brand: 'Brand X', model: 'WM-7', component: 'control_board', note: 'voltage surge dominates' },
  { brand: 'Brand X', model: 'WM-7', component: 'door_lock', note: 'early failures, likely defect, spike last month' },
  { brand: 'Brand Y', model: 'RO-6', component: 'inlet_valve', note: 'hard water, concentrated in hard-water areas' },
  { brand: 'Brand Z', model: 'MG-750', component: 'coupler', note: 'spares often unavailable' },
  { brand: 'Brand Z', model: 'PH-A1', component: 'battery', note: 'glued battery, repairs abandoned' },
  { brand: 'Brand Y', model: 'CF-48', component: 'capacitor', note: 'heat-related' },
];

function causeMix(category, component, area) {
  const tags = AREAS[area]?.tags || [];
  const mix = [
    ['normal_wear', 30], ['voltage_surge', tags.includes('voltage') ? 14 : 7], ['physical_damage', 8],
    ['user_handling', 8], ['unknown', 6], ['manufacturing_defect', 4], ['dust', 5], ['heat', tags.includes('hot') ? 8 : 3],
  ];
  if (['washing_machine', 'ro_purifier'].includes(category)) mix.push(['water_ingress', 8], ['hard_water', tags.includes('hard_water') ? 14 : 3]);
  if (tags.includes('humid')) mix.push(['water_ingress', 6]);
  if (category === 'refrigerator' || category === 'washing_machine') mix.push(['rodent', 3]);
  return mix;
}

export function generateRecords({ count = 6000, seed = 7, now = Date.now() } = {}) {
  const r = rng(seed);
  const months = previousMonths(now, 12);
  const lastMonth = months.at(-1);
  const models = [];
  for (const [brand, b] of Object.entries(BRANDS)) {
    for (const [category, list] of Object.entries(b.models)) for (const model of list) models.push({ brand, category, model });
  }
  // Popularity differs per model (this is why we never rank brands by raw counts).
  const modelWeights = models.map((m, i) => [i, 1 + ((i * 37) % 5)]);
  const areas = Object.keys(AREAS);
  const records = [];
  for (let i = 0; i < count; i++) {
    const m = models[weighted(r, modelWeights)];
    const cat = CATEGORIES[m.category];
    const compWeights = cat.components.map((c, j) => [c.id, 10 - j]);
    // Boost planted components
    for (const p of PLANTED) {
      if (p.brand === m.brand && p.model === m.model) {
        const e = compWeights.find(([id]) => id === p.component);
        if (e) e[1] += 14;
      }
    }
    let component = weighted(r, compWeights);
    let area = areas[Math.floor(r() * areas.length)];
    let causes = [weighted(r, causeMix(m.category, component, area))];
    let ageYears = Math.round(r() * cat.lifespan * 0.8 * 10) / 10;
    let spare = r() < 0.12 ? 'none' : r() < 0.5 ? 'local' : 'brand';
    let barrier = r() < 0.06 ? 'proprietary_part' : 'none';
    let month = months[Math.floor(r() * months.length)];
    const key = `${m.brand}|${m.model}|${component}`;
    if (key === 'Brand X|WM-7|control_board' && r() < 0.62) causes = ['voltage_surge'];
    if (key === 'Brand X|WM-7|door_lock') {
      if (r() < 0.55) causes = ['manufacturing_defect'];
      ageYears = Math.round(r() * 2.2 * 10) / 10;
      if (r() < 0.3) month = lastMonth; // the spike
    }
    if (key === 'Brand Y|RO-6|inlet_valve') {
      const hard = areas.filter((a) => AREAS[a].tags.includes('hard_water'));
      if (r() < 0.6) area = hard[Math.floor(r() * hard.length)];
      if (r() < 0.6) causes = ['hard_water'];
    }
    if (key === 'Brand Z|MG-750|coupler' && r() < 0.45) spare = 'none';
    if (key === 'Brand Z|PH-A1|battery' && r() < 0.4) barrier = 'glued_or_sealed';
    if (key === 'Brand Y|CF-48|capacitor' && r() < 0.5) causes = ['heat'];
    if (r() < 0.15) causes.push(weighted(r, causeMix(m.category, component, area)));
    causes = [...new Set(causes)];
    const abandoned = spare === 'none' || barrier === 'glued_or_sealed' ? r() < 0.7 : r() < 0.05;
    records.push({ ...m, component, causes, ageYears, area, month, spare, barrier, abandoned, synthetic: true });
  }
  return records;
}
