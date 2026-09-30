// Drift detection on the real entry stream. Series = per-entry query-term
// density (mean glyph score per entry). eGate: two-sided uniform-rank
// e-values (vendored copy of tev-mesh/src/mesh.mjs eGate — same
// construction, cite there; per-canvas calibration = HEURISTIC e, marked).
// TRUE BOUNDARIES: hand-labeled topic switches in the queue NEXT section
// (labels below, reviewer-checkable against the fixture).

// One-sided HIGH e-gate: predeclared hypothesis "topic density rises above
// calibration mass". kp = #{calib >= v}; e = (NC-kp)/kp/ENORM. (Two-sided
// with NC=3 yields p=1 for mid-rank values -> e=0, MEASURED dead; the
// one-sided test is the honest hypothesis here.)
export function eGateHigh(scores, calib, { cap = 100 } = {}) {
  const sorted = [...calib].sort((a, b) => a - b);
  const NC = sorted.length;
  const enorm = NC > 1 ? (sorted.reduce((a, _, i) => a + 1 / (i + 1), 0) - 1) / (NC + 1) * NC : 1;
  return scores.map((v) => {
    const kp = sorted.filter((c) => c >= v).length;
    if (kp === 0) return { e: cap, sat: true };
    const raw = (NC - kp) / kp / enorm;
    return { e: Math.min(raw, cap), sat: raw > cap };
  });
}

// Two-sided e-gate (uniform-rank p; see tev-mesh + labs/egate exp1).
export function eGate(scores, calib, { cap = 100 } = {}) {
  const sorted = [...calib].sort((a, b) => a - b);
  const NC = sorted.length;
  const enorm = NC > 1 ? (sorted.reduce((a, _, i) => a + 1 / (i + 1), 0) - 1) / (NC + 1) * NC : 1;
  return scores.map((v) => {
    let lo = 0, hi = NC;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
    const m = Math.min(lo, NC - lo);
    const pTwo = (2 * (m + 1)) / (NC + 1);
    const raw = (1 / pTwo - 1) / enorm;
    if (!Number.isFinite(raw) || raw <= 0) return { e: 0, sat: false };
    return { e: Math.min(raw, cap), sat: raw > cap };
  });
}

export function sectionSeries(glyphs, scores, entryCount) {
  const sums = new Array(entryCount).fill(0);
  const counts = new Array(entryCount).fill(0);
  glyphs.forEach((g, i) => { sums[g.entry] += scores[i]; counts[g.entry]++; });
  return sums.map((s, e) => (counts[e] ? s / counts[e] : 0));
}

// Hand-labeled topic boundaries in the fixture (entry indices where the
// queue's subject materially changes; reviewer: compare fixture lines).
export const TRUE_BOUNDARIES = [
  { at: 4, label: "merge/JEV-watch → push-bridge operational" },
  { at: 6, label: "operational → tidepool-moat build report" },
  { at: 7, label: "tidepool → candor/wide-rnd" },
  { at: 10, label: "wide-rnd → essay/coroner receipts" },
  { at: 15, label: "receipts → edge-watch merge-drain chronicle" },
  { at: 28, label: "chronicle → jev-quilt night-lane R2" },
];

// Per-check e's are bounded ≈(NC+1)/2·ENORM⁻¹ — tiny for small calibration
// (NC=3 caps at e≈1.87, MEASURED) and baseline entries score e=0, so a
// naive wealth product dies. v3: EVENT-TRIGGERED checking — multiply wealth
// only on entries where the series is informative (density > baseline),
// the checked subsequence of a martingale is itself a martingale (labs/egate
// exp2 lineage). α budget is spent per CHECK, disclosed.
export function firstFlagWealth(series, { calibN = 3, threshold = 20 } = {}) {
  const calib = series.slice(0, calibN);
  const rest = series.slice(calibN);
  const gates = eGateHigh(rest, calib, { cap: 100 });
  const baseline = Math.min(...calib);
  let W = 1;
  const wealth = [];
  const checks = [];
  for (let k = 0; k < gates.length; k++) {
    if (rest[k] <= baseline) { wealth.push(W); continue; } // not checkable
    W *= gates[k].e;
    checks.push(k + calibN);
    wealth.push(W);
    if (W >= threshold) return { flaggedAt: k + calibN, W, e: gates[k].e, wealth, gates, checks };
  }
  return { flaggedAt: -1, W, wealth, gates, checks };
};
