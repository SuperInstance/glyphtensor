# fleet-canvas — the fleet's own ops log as a Self-Rendering Text Substrate

MEASURED experiment (2026-10-01). The fixture is REAL fleet data: the NEXT
section of `memory/snowball-queue.md` (29 entries, 26,479 glyphs, 130 rows
at the canonical 256-col wrap, 82 non-ASCII chars folded by the documented
`cp & 0x7F` rule). No synthetic corpora.

Run: `node experiments/fleet-canvas/run.mjs` — Pins:
`node --test experiments/fleet-canvas/test/fc.test.mjs` (FC.1–FC.6, 6/6).

## Arms

- **FC.1 losslessness** — text↔substrate roundtrip is byte-exact on the
  7-bit ASCII subset (28 rows exceed 256 cols and wrap — canonical, not a
  loss; 3 empty rows carry no glyph by construction).
- **FC.2/FC.6 coverage (M1)** — Morton gathers term-hit clusters into 3–4×
  fewer contiguous runs than concat at every window (e.g. "jev": 103 vs 404
  runs at w=2048). Run count is monotone in window.
- **FC.3/FC.4 block reranking (M2)** — plane-respecting, layout-native run
  segmentation, budgeted whole-run acceptance. MEASURED tradeoff:
  - Morton 2D blocks **precision-dominate** at K≥1024 (both queries).
  - Morton **F1-dominates** at K=4096 (both queries).
  - concat column slices **harvest more raw recall at small budgets** for
    broadcast terms — reported, not hidden.
  - concat acceptance is **window-invariant** (no 2D structure to expose);
    Morton responds to window. Layout = workload choice.
- **FC.5 topic-drift e-gate** — JEV row-density series per entry, one-sided
  high rank-e, event-triggered wealth e-process (calibN=3, checks only where
  density > baseline, W*=e_t, alarm W≥20). Flagged at entry 16, W=32.77 —
  **1 entry from the hand-labeled boundary** (15, edge-watch merge-drain
  chronicle). HEURISTIC-e (per-canvas calibration; iid external draws would
  be needed for exact validity).

## Version lineage (each version taught one real thing)

1. **v1** — character-set scorer `{j,e,v}` + adjacency walk: conflated char
   frequency with term presence ('e' is everywhere) → degenerate.
2. **v2** — term-index scorer + two-sided per-check gate: gate provably
   can't fire (NC=3 caps e≈1.87); adjacency windows too fine (Morton is
   octave-nested: quad-to-quad Δ=220 MEASURED, chain breaks).
3. **v3** — run-based acceptance + wealth gate: code adjacency chains
   across z (low 6 bits, Δz=1), fusing unrelated topic blocks into
   mega-runs; wealth died on baseline e=0.
4. **v4.0** — plane-respecting runs… but one shared planeCode erased the
   layout contrast entirely (M2 identical — caught by pins).
5. **v4.1** — layout-native plane codes: concat = `(x<<8)|y` column slices,
   Morton = interleaved 2D blocks. All current numbers above.

## Honest marks

Every number in this directory is MEASURED on the committed fixture, with
grids predeclared per arm and revisions disclosed in-place. The e-gate is
HEURISTIC-e. The drift boundary labels are hand-labeled from the queue's
own entry text (distance-1 agreement, not a fitted threshold).
