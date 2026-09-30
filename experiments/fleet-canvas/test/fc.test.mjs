// fleet-canvas pins — every number asserted here is MEASURED by run.mjs on
// the committed fixture (snowball-queue NEXT section, 2026-10-01 ~04:20).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEntries, encodeCanvas, canonicalRows, decodeStreamToText, ROW } from "../src/encode.mjs";
import { makeTermScorer, termHitRows, hitCodes, coverageRuns, recallAtK } from "../src/query.mjs";
import { sectionSeries, firstFlagWealth, TRUE_BOUNDARIES } from "../src/drift.mjs";
import { mortonEncode } from "../../../src/index.mjs";

const text = readFileSync(new URL("../fixtures/queue-next-2026-10-01.md", import.meta.url), "utf8");
const entries = parseEntries(text);
const { glyphs, stats, totalRows } = encodeCanvas(entries);
const codes = {
  concat: glyphs.map((g) => (((g.x << 14) | (g.y << 6) | g.z) >>> 0)),
  morton: glyphs.map((g) => mortonEncode(g.x, g.y, g.z)),
};
const QUERIES = [["jev", ["jev"]], ["push-bridge", ["push"]]];
function measure(terms) {
  const hitRows = termHitRows(glyphs, terms);
  const hits = new Set();
  for (const g of glyphs) if (hitRows.has(`${g.entry}:${g.row}`)) hits.add(`${g.entry}:${g.row}:${g.col}`);
  const scores = makeTermScorer(hitRows)(glyphs);
  return { hitRows, hits, scores };
}

test("FC.1 text<->substrate roundtrip is lossless on the 7-bit ASCII subset", () => {
  const asciiFold = (t) => [...t].map((ch) => { const cp = ch.codePointAt(0); return cp > 0x7F ? String.fromCharCode(cp & 0x7F) : ch; }).join("");
  const canonicalAll = entries.flatMap((e) => canonicalRows(e.lines)).join("\n");
  const canonicalAscii = canonicalAll.split("\n").filter((r) => r.length > 0).map(asciiFold).join("\n");
  assert.equal(decodeStreamToText(glyphs), canonicalAscii);
  assert.ok(stats.nonAscii > 0, "fixture exercises the documented non-ASCII fold (cp & 0x7F)");
  assert.equal(stats.yWraps, 0);
  assert.equal(stats.zWraps, 0);
});

test("FC.2 Morton gathers hit clusters: fewer runs than concat at every window", () => {
  for (const [, terms] of QUERIES) {
    const { hits } = measure(terms);
    for (const w of [8, 128, 2048]) {
      const c = coverageRuns(hitCodes(glyphs, hits, codes.concat).map((h) => ({ code: h.code })), w);
      const m = coverageRuns(hitCodes(glyphs, hits, codes.morton).map((h) => ({ code: h.code })), w);
      assert.ok(m.runs < c.runs, `w=${w}: morton ${m.runs} < concat ${c.runs}`);
    }
  }
});

test("FC.3 measured tradeoff: Morton precision-dominates at K>=1024, F1-dominates at K=4096; concat wins small-budget raw recall (reported, not pinned)", () => {
  for (const [, terms] of QUERIES) {
    const { hits, scores } = measure(terms);
    for (const w of [512, 8192]) {
      const c1 = recallAtK(glyphs, scores, hits, "concat", { K: 1024, window: w });
      const m1 = recallAtK(glyphs, scores, hits, "morton", { K: 1024, window: w });
      assert.ok(m1.precision >= c1.precision, `${terms} K=1024 w=${w}: precision ${m1.precision.toFixed(4)} >= ${c1.precision.toFixed(4)}`);
      const c4 = recallAtK(glyphs, scores, hits, "concat", { K: 4096, window: w });
      const m4 = recallAtK(glyphs, scores, hits, "morton", { K: 4096, window: w });
      assert.ok(m4.f1 >= c4.f1, `${terms} K=4096 w=${w}: F1 ${m4.f1.toFixed(4)} >= ${c4.f1.toFixed(4)}`);
      // small-budget raw-recall harvest: concat column slices can out-recall
      // Morton blocks (MEASURED). Reported, not asserted — that IS the finding.
      console.log(`  ${terms} w=${w} K=256 recall concat=${recallAtK(glyphs, scores, hits, "concat", { K: 256, window: w }).recall.toFixed(4)} morton=${recallAtK(glyphs, scores, hits, "morton", { K: 256, window: w }).recall.toFixed(4)}`);
    }
  }
});

test("FC.4 structural flatness: concat acceptance is window-invariant (column slices have no 2D structure); Morton responds to window", () => {
  for (const [, terms] of QUERIES) {
    const { hits, scores } = measure(terms);
    const c512 = recallAtK(glyphs, scores, hits, "concat", { K: 1024, window: 512 });
    const c131k = recallAtK(glyphs, scores, hits, "concat", { K: 1024, window: 131072 });
    assert.deepEqual([c131k.recall, c131k.precision], [c512.recall, c512.precision]);
    const m512 = recallAtK(glyphs, scores, hits, "morton", { K: 1024, window: 512 });
    const m131k = recallAtK(glyphs, scores, hits, "morton", { K: 1024, window: 131072 });
    assert.notDeepEqual([m131k.recall, m131k.precision], [m512.recall, m512.precision]);
  }
});

test("FC.5 e-gate wealth alarm lands within 3 entries of a labeled topic boundary", () => {
  const { hitRows } = measure(["jev"]);
  const series = sectionSeries(glyphs, makeTermScorer(hitRows)(glyphs), entries.length);
  const fl = firstFlagWealth(series, { calibN: 3, threshold: 20 });
  assert.ok(fl.flaggedAt >= 0, "alarm fired");
  const nearest = TRUE_BOUNDARIES.reduce((best, b) => Math.abs(b.at - fl.flaggedAt) < Math.abs(best.at - fl.flaggedAt) ? b : best);
  assert.ok(Math.abs(nearest.at - fl.flaggedAt) <= 3, `flag ${fl.flaggedAt} near boundary ${nearest.at}`);
});

test("FC.6 run count is monotone non-increasing in window (Morton octave ladder)", () => {
  const { hits } = measure(["jev"]);
  let prev = Infinity;
  for (const w of [8, 128, 2048]) {
    const m = coverageRuns(hitCodes(glyphs, hits, codes.morton).map((h) => ({ code: h.code })), w);
    assert.ok(m.runs <= prev, `runs ${m.runs} <= ${prev} at w=${w}`);
    prev = m.runs;
  }
});
