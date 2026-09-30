// fleet-canvas runner — all numbers printed are MEASURED on the fixture.
// v2 (2026-10-01 ~04:30): term-scorer fixed (v1 char-set scorer conflated
// {j,e,v} with term presence — lineage in README), M1/M2 grids predeclared,
// drift series on row-substring density.
// Usage: node experiments/fleet-canvas/run.mjs
import { readFileSync } from "node:fs";
import { parseEntries, encodeCanvas, canonicalRows, decodeStreamToText, ROW } from "./src/encode.mjs";
import { makeTermScorer, termHitRows, hitCodes, coverageRuns, recallAtK } from "./src/query.mjs";
import { sectionSeries, firstFlagWealth, TRUE_BOUNDARIES } from "./src/drift.mjs";
import { mortonEncode } from "../../src/index.mjs";

const text = readFileSync(new URL("./fixtures/queue-next-2026-10-01.md", import.meta.url), "utf8");
const entries = parseEntries(text);
const { glyphs, stats, totalRows } = encodeCanvas(entries);
const codes = {
  concat: glyphs.map((g) => (((g.x << 14) | (g.y << 6) | g.z) >>> 0)),
  morton: glyphs.map((g) => mortonEncode(g.x, g.y, g.z)),
};

console.log("=== fleet-canvas v2: snowball-queue NEXT as glyphtensor canvas (MEASURED) ===");
console.log(`entries=${entries.length} glyphs=${glyphs.length} rows=${totalRows}`);
console.log(`nonAscii=${stats.nonAscii} yWraps=${stats.yWraps} zWraps=${stats.zWraps}`);

// --- FC.1 roundtrip: glyph stream is lossless over NON-EMPTY canonical
// rows (empty cells carry no glyph — renderer state, not token data) -------
const asciiFold = (t) => [...t].map((ch) => { const cp = ch.codePointAt(0); return cp > 0x7F ? String.fromCharCode(cp & 0x7F) : ch; }).join("");
const canonicalAll = entries.flatMap((e) => canonicalRows(e.lines)).join("\n");
const canonicalNonEmptyAscii = canonicalAll.split("\n").filter((r) => r.length > 0).map(asciiFold).join("\n");
const decoded = decodeStreamToText(glyphs);
const emptyRows = canonicalAll.split("\n").filter((r) => r.length === 0).length;
const longLines = entries.flatMap((e) => e.lines).filter((l) => l.length > ROW).length;
console.log(`FC.1 decoded==ascii(canonicalNonEmpty): ${decoded === canonicalNonEmptyAscii} (emptyRows=${emptyRows} longLines=${longLines} wrap=${ROW} nonAscii=${stats.nonAscii} folded-deterministically)`);

// --- M1/M2 retrieval, two real fleet queries (grids predeclared) ---------
for (const [qname, terms] of [["Q1 jev", ["jev"]], ["Q2 push-bridge", ["push"]]]) {
  const hitRows = termHitRows(glyphs, terms);
  const hits = new Set();
  for (const g of glyphs) if (hitRows.has(`${g.entry}:${g.row}`)) hits.add(`${g.entry}:${g.row}:${g.col}`);
  const score = makeTermScorer(hitRows);
  const scores = score(glyphs);
  console.log(`\n--- ${qname}: terms=[${terms}] hitRows=${hitRows.size} hitGlyphs=${hits.size} ---`);
  for (const window of [8, 128, 2048]) {
    const line = [];
    for (const layout of ["concat", "morton"]) {
      const hc = hitCodes(glyphs, hits, codes[layout]);
      const cov = coverageRuns(hc.map((h) => ({ code: h.code })), window);
      line.push(`${layout}:runs=${cov.runs}/${cov.total}`);
    }
    console.log(`M1 w=${String(window).padStart(3)}  ${line.join("  ")}`);
  }
  console.log("M2 run-based recall@K + precision@K (concat vs morton):");
  for (const K of [256, 1024, 4096]) {
    for (const window of [512, 8192, 131072]) {
      const row = { K, window };
      for (const layout of ["concat", "morton"]) {
        const r = recallAtK(glyphs, scores, hits, layout, { K, window });
        row[layout] = `${r.recall.toFixed(4)}/${r.precision.toFixed(4)}`;
      }
      console.log(`  K=${String(K).padStart(4)} w=${String(window).padStart(6)}  concat r/p=${row.concat}  morton r/p=${row.morton}`);
    }
  }
}

// --- drift: JEV row-density series (real term presence) -------------------
const jevRows = termHitRows(glyphs, ["jev"]);
const jevScores = makeTermScorer(jevRows)(glyphs);
const series = sectionSeries(glyphs, jevScores, entries.length);
const fl = firstFlagWealth(series, { calibN: 3, threshold: 20 });
console.log(`\n--- drift: JEV row-density, calibN=3 thresh=20, event-triggered checks (HEURISTIC e) ---`);
console.log("series:", series.map((v) => +v.toFixed(3)).join(" "));
console.log(`firstFlag(wealth) at entry ${fl.flaggedAt} W=${fl.W ? fl.W.toFixed(2) : "n/a"} checks=[${fl.checks}]`);
console.log("wealth:", fl.wealth.map((w) => +w.toFixed(2)).join(" "));
console.log("true boundaries:", TRUE_BOUNDARIES.map((b) => `${b.at}`).join(" "));
if (fl.flaggedAt >= 0) {
  const nearest = TRUE_BOUNDARIES.reduce((best, b) => Math.abs(b.at - fl.flaggedAt) < Math.abs(best.at - fl.flaggedAt) ? b : best);
  console.log(`nearest true boundary: ${nearest.at} "${nearest.label}" — distance ${Math.abs(nearest.at - fl.flaggedAt)} entries`);
} else console.log("no flag — series did not cross threshold");
