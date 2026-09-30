// glyphtensor — 32-bit spatial glyph tokens.
//
// Token layout (22 spatial | 7 char | 3 style), from the captain's
// Self-Rendering Text Substrate spec (2026-10-01):
//
//   bits  0–2  style flags (8 runtime highlights / attention zones)
//   bits  3–9  character id (7-bit ASCII, 128 symbols)
//   bits 10–31 spatial code
//
// VERIFIED FINDING (audit, kept): the spec's WGSL decode is
//   z = code & 0x3F; y = (code>>6)&0xFF; x = (code>>14)&0xFF
// which is FIELD CONCATENATION [x:8][y:8][z:6], not bit-interleaved
// Morton/Z-order. Concat gives NO spatial locality in linear order —
// every y-step jumps 64 slots, every x-step jumps 16384. True Morton
// interleaves bit planes (x0 y0 z0 x1 y1 z1 ...), preserving 2D/3D
// locality, which is the entire reason to use it (cache coherency,
// Z-order range queries, block-scoped reranking). Both layouts are
// implemented here; `pack`/`unpack` default to true Morton, and
// `packSpec`/`unpackSpec` reproduce the shader's concat form byte-for-
// byte. The WGSL in shader.mjs decodes whichever layout the header
// flag declares.

export const X_BITS = 8, Y_BITS = 8, Z_BITS = 6;
export const X_MAX = 1 << X_BITS, Y_MAX = 1 << Y_BITS, Z_MAX = 1 << Z_BITS;
export const CHAR_MAX = 128, STYLE_MAX = 8;

export class PackError extends Error {}

function checkRange(name, v, max) {
  if (!Number.isInteger(v) || v < 0 || v >= max)
    throw new PackError(`${name}=${v} out of range [0,${max})`);
}

// ---- true Morton (Z-order): interleave x,y bit planes for i<6 with z,
// then x,y planes 6..7. Linear order preserves spatial locality.
export function mortonEncode(x, y, z) {
  checkRange("x", x, X_MAX); checkRange("y", y, Y_MAX); checkRange("z", z, Z_MAX);
  let code = 0;
  for (let i = 0; i < Z_BITS; i++) {
    code |= ((x >>> i) & 1) << (3 * i + 2);
    code |= ((y >>> i) & 1) << (3 * i + 1);
    code |= ((z >>> i) & 1) << (3 * i);
  }
  for (let i = Z_BITS; i < X_BITS; i++) {
    code |= ((x >>> i) & 1) << (Z_BITS * 3 + 2 * (i - Z_BITS) + 1);
    code |= ((y >>> i) & 1) << (Z_BITS * 3 + 2 * (i - Z_BITS));
  }
  return code >>> 0;
}

export function mortonDecode(code) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < Z_BITS; i++) {
    x |= ((code >>> (3 * i + 2)) & 1) << i;
    y |= ((code >>> (3 * i + 1)) & 1) << i;
    z |= ((code >>> (3 * i)) & 1) << i;
  }
  for (let i = Z_BITS; i < X_BITS; i++) {
    x |= ((code >>> (Z_BITS * 3 + 2 * (i - Z_BITS) + 1)) & 1) << i;
    y |= ((code >>> (Z_BITS * 3 + 2 * (i - Z_BITS))) & 1) << i;
  }
  return { x, y, z };
}

// ---- spec-concat layout (what the original WGSL decode reads)
export function concatEncode(x, y, z) {
  checkRange("x", x, X_MAX); checkRange("y", y, Y_MAX); checkRange("z", z, Z_MAX);
  return ((x << 14) | (y << 6) | z) >>> 0;
}
export function concatDecode(code) {
  return { x: (code >>> 14) & 0xff, y: (code >>> 6) & 0xff, z: code & 0x3f };
}

const ENC = {
  morton: { enc: mortonEncode, dec: mortonDecode },
  concat: { enc: concatEncode, dec: concatDecode },
};

export function pack({ x = 0, y = 0, z = 0, char = 0, style = 0 }, layout = "morton") {
  checkRange("char", char, CHAR_MAX); checkRange("style", style, STYLE_MAX);
  const { enc } = ENC[layout] || (() => { throw new PackError(`unknown layout ${layout}`); })();
  return ((enc(x, y, z) << 10) | (char << 3) | style) >>> 0;
}

export function unpack(token, layout = "morton") {
  const { dec } = ENC[layout] || (() => { throw new PackError(`unknown layout ${layout}`); })();
  return {
    ...dec((token >>> 10) & 0x3fffff),
    char: (token >>> 3) & 0x7f,
    style: token & 0x7,
  };
}

export function packSpec(g) { return pack(g, "concat"); }
export function unpackSpec(t) { return unpack(t, "concat"); }

// ---- JS mirror of the WGSL projection shader (shader.mjs, glyphtensor
// projection). Kept line-for-line parallel so a pin here is a pin on the
// shader math. spatial bias by i%3, telemetry scale 1 + style*0.05.
export function projectToken(token, symbolMatrix, embeddingDim, canvasScale = 1, layout = "morton") {
  const g = unpack(token, layout);
  const out = new Float64Array(embeddingDim);
  const base = g.char * embeddingDim;
  const sx = g.x * canvasScale, sy = g.y * canvasScale, sz = g.z * canvasScale;
  const scale = 1 + g.style * 0.05;
  for (let i = 0; i < embeddingDim; i++) {
    let bias = sx;
    if (i % 3 === 1) bias = sy;
    else if (i % 3 === 2) bias = sz;
    out[i] = (symbolMatrix[base + i] + bias) * scale;
  }
  return out;
}

export function projectStream(tokens, symbolMatrix, embeddingDim, canvasScale = 1, layout = "morton") {
  const out = new Float64Array(tokens.length * embeddingDim);
  for (let k = 0; k < tokens.length; k++)
    out.set(projectToken(tokens[k], symbolMatrix, embeddingDim, canvasScale, layout), k * embeddingDim);
  return out;
}
