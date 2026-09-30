// glyphtensor pins — FAIL-first suite.
// GT.1 field layout, GT.2 spec-vector byte-exactness, GT.3 roundtrips,
// GT.4 range discipline, GT.5 Morton locality (the finding, made
// executable), GT.6 projection mirror parity.
import test from "node:test";
import assert from "node:assert/strict";
import {
  pack, unpack, packSpec, unpackSpec, mortonEncode, mortonDecode,
  concatEncode, projectToken, PackError,
} from "../src/index.mjs";
import { SHADER_SRC } from "../src/shader.mjs";

test("GT.1 field layout: style | char | spatial at the spec'd bit offsets", () => {
  const t = pack({ x: 0, y: 0, z: 0, char: 0, style: 0 });
  assert.equal(t, 0);
  const t2 = packSpec({ x: 1, y: 0, z: 0, char: 0, style: 0 });
  assert.equal(t2, 1 << 24, "spec concat: x sits at bit 24 of the token (spatial bit 14)");
  const t3 = packSpec({ x: 0, y: 0, z: 1, char: 0, style: 0 });
  assert.equal(t3, 1 << 10, "z=1 at spatial bit 0 → token bit 10");
  const t4 = packSpec({ x: 0, y: 0, z: 0, char: 1, style: 0 });
  assert.equal(t4, 1 << 3, "char at bits 3–9");
  const t5 = packSpec({ x: 0, y: 0, z: 0, char: 0, style: 1 });
  assert.equal(t5, 1, "style at bits 0–2");
});

test("GT.2 spec decode vector: the shader's exact example path", () => {
  // hand-computed against the spec WGSL: token = (x<<14|y<<6|z)<<10 | char<<3 | style
  const g = { x: 200, y: 100, z: 40, char: 65, style: 5 }; // 'A'
  const tok = packSpec(g);
  assert.equal(tok, (((200 << 14) | (100 << 6) | 40) << 10 | (65 << 3) | 5) >>> 0);
  assert.deepEqual(unpackSpec(tok), g);
  assert.ok(tok > 0 && tok <= 0xffffffff, "fits u32");
});

test("GT.3 roundtrips: both layouts, edge coordinates", () => {
  const cases = [
    { x: 0, y: 0, z: 0, char: 0, style: 0 },
    { x: 255, y: 255, z: 63, char: 127, style: 7 },
    { x: 173, y: 84, z: 31, char: 65, style: 3 },
  ];
  for (const g of cases) {
    assert.deepEqual(unpack(pack(g, "morton"), "morton"), g);
    assert.deepEqual(unpackSpec(packSpec(g)), g);
  }
  // morton encode/decode pure roundtrip across a lattice slice
  for (let x = 0; x < 256; x += 17)
    for (let y = 0; y < 256; y += 29)
      for (let z = 0; z < 64; z += 7)
        assert.deepEqual(mortonDecode(mortonEncode(x, y, z)), { x, y, z });
});

test("GT.4 range discipline: out-of-range fields throw, no silent wrap", () => {
  assert.throws(() => pack({ x: 256, y: 0, z: 0 }), PackError);
  assert.throws(() => pack({ x: 0, y: 0, z: 64 }), PackError);
  assert.throws(() => pack({ x: 0, y: 0, z: 0, char: 128 }), PackError);
  assert.throws(() => pack({ x: 0, y: 0, z: 0, char: 0, style: 8 }), PackError);
  assert.throws(() => pack({ x: -1, y: 0, z: 0 }), PackError);
});

test("GT.5 Morton locality: neighbors stay close in linear order (the finding)", () => {
  // two cells 1 step apart in y: concat jumps 64 codes; morton keeps ≤ 2x gap
  const aC = concatEncode(10, 20, 5), bC = concatEncode(10, 21, 5);
  const aM = mortonEncode(10, 20, 5), bM = mortonEncode(10, 21, 5);
  assert.equal(Math.abs(bC - aC), 64, "concat: every y-step = 64 codes (no locality)");
  assert.ok(Math.abs(bM - aM) <= 8, `morton: y-step = ${Math.abs(bM - aM)} codes`);
  // 2x2x2 block occupies a contiguous morton run of 8 — the property the
  // block-scoped reranker relies on
  const run = [];
  for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1])
    run.push(mortonEncode(40 + dx, 40 + dy, 10 + dz));
  run.sort((p, q) => p - q);
  assert.equal(run[7] - run[0], 7, "2×2×2 block is ONE contiguous 8-code run in Morton");
});

test("GT.6 projection mirror parity: hand-computed shader math", () => {
  const dim = 4;
  const sym = new Float64Array(128 * dim).fill(0);
  sym[65 * dim + 0] = 0.5; sym[65 * dim + 1] = -0.25; sym[65 * dim + 2] = 1.0; sym[65 * dim + 3] = 2.0;
  const tok = packSpec({ x: 4, y: 8, z: 2, char: 65, style: 2 });
  const out = projectToken(tok, sym, dim, 1, "concat");
  const scale = 1 + 2 * 0.05; // 1.10
  assert.ok(Math.abs(out[0] - (0.5 + 4) * scale) < 1e-12, "i%3==0 → x bias");
  assert.ok(Math.abs(out[1] - (-0.25 + 8) * scale) < 1e-12, "i%3==1 → y bias");
  assert.ok(Math.abs(out[2] - (1.0 + 2) * scale) < 1e-12, "i%3==2 → z bias");
  assert.ok(Math.abs(out[3] - (2.0 + 4) * scale) < 1e-12, "wraps to x");
});

test("GT.7 the WGSL source declares both decode paths and pins the finding", () => {
  assert.ok(SHADER_SRC.includes("decode_morton") && SHADER_SRC.includes("decode_concat"));
  assert.ok(SHADER_SRC.includes("layout_concat"), "compile-time layout flag present");
});
