// Failure-spike detection. If a SageMaker Random Cut Forest endpoint is configured,
// its scores are used; otherwise a robust z-score (median/MAD) runs. The UI shows which.

export function monthKey(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function previousMonths(now, count) {
  const out = [];
  const d = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1));
  for (let i = count; i >= 1; i--) {
    const x = new Date(d);
    x.setUTCMonth(d.getUTCMonth() - i);
    out.push(monthKey(x));
  }
  return out; // oldest → most recent complete month
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Build the series (last 12 complete months) for one component aggregate item. */
export function seriesFor(item, now) {
  const months = previousMonths(now, 12);
  return months.map((m) => ({ month: m, count: item[`m_${m}`] || 0 }));
}

/** Feature rows for the RCF model: [count, baselineMedian, ratio]. */
export function features(series) {
  const counts = series.map((s) => s.count);
  const target = counts.at(-1);
  const base = counts.slice(0, -1);
  const med = median(base);
  return [target, med, med > 0 ? target / med : target];
}

export function robustScore(series) {
  const counts = series.map((s) => s.count);
  const target = counts.at(-1);
  const base = counts.slice(0, -1);
  const med = median(base);
  const mad = median(base.map((x) => Math.abs(x - med)));
  const z = (target - med) / (1.4826 * mad + 1);
  return { z: Math.round(z * 100) / 100, target, baseline: med };
}

export const Z_THRESHOLD = 3.5;
export const MIN_SPIKE_COUNT = 8;

/**
 * candidates: [{ brand, model, category, component, series }]
 * rcfScores: optional array aligned with candidates (SageMaker output), else null.
 */
export function detectSpikes(candidates, rcfScores = null) {
  const results = candidates.map((c, i) => {
    const r = robustScore(c.series);
    return { ...c, ...r, rcf: rcfScores ? rcfScores[i] : null };
  });
  let flagged;
  let detector;
  if (rcfScores && rcfScores.length === candidates.length) {
    detector = 'sagemaker_rcf';
    const xs = rcfScores.filter((x) => Number.isFinite(x));
    const mean = xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, xs.length));
    flagged = results.filter((r) => r.rcf > mean + 3 * sd && r.target >= MIN_SPIKE_COUNT && r.target > r.baseline);
  } else {
    detector = 'robust_z';
    flagged = results.filter((r) => r.z >= Z_THRESHOLD && r.target >= MIN_SPIKE_COUNT);
  }
  return { detector, checked: results.length, flagged };
}
