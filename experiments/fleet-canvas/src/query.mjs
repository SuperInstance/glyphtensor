// Query + retrieval measurement. Ground truth = lines containing the query
// term (case-insensitive). Two layout-dependent measures, both MEASURED:
//
//   M1 coverageRuns — sort hit glyphs by their layout's spatial code; the
//      90%-coverage run count = how many contiguous runs (gap > window) the
//      hits cluster into. Morton should gather a topic block into few runs;
//      concat scatters it (y-step = 64 codes per GT.5).
//
//   M2 recall@K — adjacency-window selection: walk glyphs in score order,
//      accept a glyph if it lies within ±window of an already-accepted
//      SPATIAL CODE, until budget K. Locality-aware pruning should capture
//      co-clustered true hits cheaper under Morton.

// Term index: rows containing the LITERAL term (case-insensitive). Two
// scorers, both honest:
//   makeTermScorer — row-level: 4.0 iff the glyph sits in a hit row, else
//     1.0. This is the v2 scorer; v1 used a term-CHARACTER set ({j,e,v} ≈
//     the whole English alphabet in density) which conflated char frequency
//     with term presence — the fleet-canvas README preserves that lineage.
//   makeCharScorer — v1, kept for the record; NOT used in measurements.
export function termHitRows(glyphs, terms) {
  const tset = terms.map((t) => t.toLowerCase());
  const rows = new Map();
  for (const g of glyphs) {
    const key = `${g.entry}:${g.row}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(g);
  }
  const hit = new Set();
  for (const [key, gs] of rows) {
    gs.sort((a, b) => a.col - b.col);
    const text = gs.map((g) => String.fromCharCode(g.char)).join("").toLowerCase();
    if (tset.some((t) => text.includes(t))) hit.add(key);
  }
  return hit;
}

export function makeTermScorer(hitRows) {
  return (glyphs) => glyphs.map((g) => (hitRows.has(`${g.entry}:${g.row}`) ? 4.0 : 1.0));
}

export function makeCharScorer(terms) {
  const tset = new Set(terms.join("").toLowerCase());
  return (glyphs) => glyphs.map((g) => {
    const c = String.fromCharCode(g.char).toLowerCase();
    return tset.has(c) ? 4.0 : 1.0;
  });
}

export function hitSet(glyphs, terms) {
  const tset = terms.map((t) => t.toLowerCase());
  const lines = new Map(); // "entry:row" → text
  for (const g of glyphs) {
    const key = `${g.entry}:${g.row}`;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(g);
  }
  const hitRows = new Set();
  for (const [key, gs] of lines) {
    gs.sort((a, b) => a.col - b.col);
    const text = gs.map((g) => String.fromCharCode(g.char)).join("").toLowerCase();
    if (tset.some((t) => text.includes(t))) {
      // a row hit marks its glyphs (not substrings — char-level substrate
      // has no token index; this is the honest ground truth)
      for (const g of gs) hitRows.add(`${g.entry}:${g.row}:${g.col}`);
    }
  }
  return new Set([...hitRows].filter(Boolean));
}

export function hitCodes(glyphs, hits, codes) {
  // codes: parallel array of spatial codes per glyph (per layout)
  const out = [];
  glyphs.forEach((g, i) => {
    if (hits.has(`${g.entry}:${g.row}:${g.col}`)) out.push({ code: codes[i], i });
  });
  return out.sort((a, b) => a.code - b.code);
}

export function coverageRuns(sortedHitCodes, window = 8) {
  if (sortedHitCodes.length === 0) return { runs: 0, covered: 0, maxGap: 0 };
  let runs = 1, covered = 1, maxGap = 0;
  for (let k = 1; k < sortedHitCodes.length; k++) {
    const gap = sortedHitCodes[k].code - sortedHitCodes[k - 1].code;
    maxGap = Math.max(maxGap, gap);
    if (gap > window) runs++;
    else covered++;
  }
  return { runs, covered, maxGap, total: sortedHitCodes.length };
}

// Octave note (MEASURED, run.mjs): Morton interleaves from the LSB, so a
// window covers octave bands of columns — w=32 → ±3-col quads (chain breaks
// quad→quad, Δ220 measured), w=512 → 8-col groups, w=8192 → 16-col groups.
// Concat intra-row Δ is ALWAYS 16384 (x sits at bit 14): no window < 16384
// ever merges a row. Grid windows are the predeclared octave ladder.
// M2 v4.1 — PLANE-RESPECTING, LAYOUT-NATIVE run segmentation. Two v3/v4
// lessons fused: (1) runs must live inside one z-plane (z = document/topic
// axis; low-6-bit z-adjacency fused unrelated topics into mega-runs in v3);
// (2) the plane code must be the LAYOUT'S OWN 2D code (v4 used one shared
// planeCode and erased the contrast — M2 went identical, caught by pins).
// concat plane = (x<<8)|y: x-major, Δx=1 -> 256, Δy=1 -> 1  => runs are
// tall thin column slices. morton plane = bit-interleaved (x,y): 2D octave
// blocks. Segment at plane change or gap > window; score runs by max glyph
// score; accept whole runs to budget K. This is the reranker contract:
// "isolate top structural blocks and score them as one."
import { mortonEncode as morton2D } from "../../../src/index.mjs";

const PLANE = {
  concat: (x, y) => (x << 8) | y,
  morton: (x, y) => morton2D(x, y, 0),
};

export function recallAtK(glyphs, scores, hits, layout, { K = 1024, window = 8192 } = {}) {
  const planeCode = (g) => PLANE[layout](g.x, g.y);
  const order = glyphs.map((_, i) => i).sort((a, b) => {
    const ga = glyphs[a], gb = glyphs[b];
    return ga.z - gb.z || planeCode(ga) - planeCode(gb);
  });
  const runs = [];
  let cur = [order[0]];
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1], curi = order[k];
    const cross = glyphs[prev].z !== glyphs[curi].z;
    const gap = planeCode(glyphs[curi]) - planeCode(glyphs[prev]);
    if (cross || gap > window) { runs.push(cur); cur = []; }
    cur.push(curi);
  }
  runs.push(cur);
  const runScore = runs.map((r) => Math.max(...r.map((i) => scores[i])));
  const byScore = runs.map((r, ri) => [runScore[ri], ri]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const accepted = [];
  for (const [, ri] of byScore) {
    if (accepted.length >= K) break;
    accepted.push(...runs[ri]);
  }
  const accSet = new Set(accepted);
  let hit = 0;
  for (const i of accSet) {
    const g = glyphs[i];
    if (hits.has(`${g.entry}:${g.row}:${g.col}`)) hit++;
  }
  const totalHits = hits.size;
  const recall = totalHits ? hit / totalHits : 0;
  const precision = accSet.size ? hit / accSet.size : 0;
  return {
    recall, precision,
    f1: recall + precision > 0 ? 2 * recall * precision / (recall + precision) : 0,
    accepted: accSet.size, hitsAccepted: hit, totalHits,
  };
};
