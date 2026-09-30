# glyphtensor

32-bit packed glyph tokens for the self-rendering text substrate — the data
block IS the layout. A glyph is one u32:

```
 bits 31..10      bits 9..3      bits 2..0
[spatial 22 bits] [char 7 bits]  [style 3 bits]
```

Two spatial layouts ship side by side, both pinned:

- **`morton` (default)** — true bit-interleaved Z-order. A 2×2×2 spatial
  block occupies ONE contiguous 8-code run. This is the layout the
  block-scoped reranker in `glyphtensor-bridge` assumes.
- **`spec` (compatibility)** — the captain's original shader decoded
  `x = (code>>14)&0xFF; y = (code>>6)&0xFF; z = code&0x3F`, which is field
  concatenation, **not** Morton interleaving. A single y-step jumps 64 codes
  — no Z-order locality. Kept byte-compatible with the spec vector; the
  WGSL source (`src/shader.mjs`) selects via a `layout_concat` uniform.

## Layout (v0.1)

- `src/index.mjs` — pack/unpack (both layouts), pure-Morton encode/decode,
  JS mirror of the WGSL projection (`projectToken`/`projectStream`).
- `src/shader.mjs` — the WGSL compute source, both decode paths.
- `test/gt.test.mjs` — 7 pins: field placement, spec-vector byte-exactness,
  roundtrips, range discipline (out-of-range throws), the Morton-locality
  finding made executable, projection parity vs hand-computed shader math.

```
node --test test/gt.test.mjs   # 7/7
```

## Honest marks

- All numbers MEASURED via the node:test suite on this host.
- The WGSL source is reference text — not yet compile-validated (naga/tint
  is Lane A Phase 1 in `sprinter-onboarding/ROADMAP.md`).
- Canvas bound today: 256×256×64 (the spec's 512×512×128 goal needs 24
  spatial bits; the 22-bit field is a format constraint, flagged not hidden).

## Siblings

`glyphtensor-bridge` (PyTorch bridge + zero-copy audit), `tev-mesh`
(TEV1 decision-model feedback loop), `sprinter-onboarding` (fleet docs).
Casey's `substrate-foundation` (11-opcode cell graph) and `voxelglyph`
(Syzygy luma encoding) are different layers — see their repos.
