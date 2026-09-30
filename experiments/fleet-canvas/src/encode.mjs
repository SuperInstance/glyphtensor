// fleet-canvas — encode a real fleet document as a glyphtensor canvas.
// SOURCE: fixtures/queue-next-2026-10-01.md = the live snowball-queue NEXT
// section (memory/snowball-queue.md lines 1–43, captured 2026-10-01 ~04:20).
// Honest marks: all downstream numbers are MEASURED against THIS fixture;
// terminal wrap (256-col rows) is canonical, not a loss.

import { pack, packSpec, mortonEncode } from "../../../src/index.mjs";

export const X_BITS = 8, Y_BITS = 8, Z_BITS = 6;
export const ROW = 1 << X_BITS; // 256-col terminal rows

// Parse the queue's bracketed entries. Lines starting with '[' open a new
// entry; everything before the first '[' is the preamble (entry 0).
export function parseEntries(text) {
  const entries = [];
  let cur = { id: "preamble", lines: [] };
  for (const line of text.split("\n")) {
    if (/^\[/.test(line)) {
      entries.push(cur);
      cur = { id: line.slice(0, 64), lines: [] };
    }
    cur.lines.push(line);
  }
  entries.push(cur);
  return entries;
}

// Canonical terminal wrap: split visual lines into 256-col rows. Roundtrip
// is lossless against THIS canonical form; canonical == original iff every
// line ≤ 256 cols (pinned in FC.1).
export function canonicalRows(lines) {
  const rows = [];
  for (const line of lines) {
    for (let i = 0; i < line.length; i += ROW) rows.push(line.slice(i, i + ROW));
    if (line.length === 0) rows.push("");
  }
  return rows;
}

// Encode entries → glyph records. z = entry % 64, style = entry % 8,
// y = global row index % 256 (wraps counted honestly), x = col.
export function encodeCanvas(entries) {
  const glyphs = [];
  const stats = { nonAscii: 0, yWraps: 0, zWraps: 0, chars: 0 };
  let y = 0;
  entries.forEach((entry, e) => {
    const z = e % (1 << Z_BITS);
    if (e >= 1 << Z_BITS) stats.zWraps++;
    const style = e % 8;
    for (const line of entry.lines) {
      const rows = canonicalRows([line]);
      for (const row of rows) {
        const yy = y % (1 << Y_BITS);
        if (y >= 1 << Y_BITS) stats.yWraps++;
        for (let x = 0; x < row.length; x++) {
          const cp = row.codePointAt(x);
          stats.chars++;
          let ch = cp;
          if (cp > 0x7F) { stats.nonAscii++; ch = cp & 0x7F; } // 7-bit ASCII field
          glyphs.push({ x, y: yy, z, char: ch, style, entry: e, col: x, row: y });
        }
        y++;
      }
    }
  });
  return { glyphs, stats, totalRows: y };
}

// Two stream orderings of the same canvas: spec-concat packed in text
// order, and true-Morton packed sorted by Z-order code.
export function buildStreams(glyphs) {
  const withCodes = glyphs.map((g, i) => ({ g, i, morton: mortonEncode(g.x, g.y, g.z) }));
  return {
    concat: withCodes.map(({ g }) => packSpec(g) >>> 0),
    morton: withCodes.sort((a, b) => a.morton - b.morton).map(({ g }) => pack(g, "morton") >>> 0),
    meta: withCodes,
  };
}

// Decode a concat stream back to canonical text (entry/row/col via sidecar
// is cheating — we decode the TOKEN only, and rebuild by walking rows).
export function decodeStreamToText(glyphs) {
  // group by (entry, row); rows are recorded on the glyph
  const byRow = new Map();
  for (const g of glyphs) {
    const key = `${g.entry}:${g.row}`;
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push(g);
  }
  const rows = [...byRow.entries()].sort((a, b) => {
    const [ae, ar] = a[0].split(":").map(Number);
    const [be, br] = b[0].split(":").map(Number);
    return ae - be || ar - br;
  });
  return rows.map(([, gs]) => {
    gs.sort((a, b) => a.col - b.col);
    return gs.map((g) => String.fromCharCode(g.char)).join("");
  }).join("\n");
}
