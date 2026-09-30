// WGSL reference for the glyphtensor→latent projection pass.
// Two decode paths selected by a compile-time layout flag: the spec's
// original concat decode (x in top bits — NO Z-order locality, kept for
// compatibility with the captain's spec vector) and the true-Morton
// decode (bit-interleaved, spatially local). The JS mirror in
// src/index.mjs pins the math; this file is the device-side source of
// truth for ports.

export const SHADER_SRC = /* wgsl */ `
struct SubstrateParams {
  canvas_scale: f32,
  embedding_dim: u32,
  total_active_glyphs: u32,
  layout_concat: u32, // 1 = spec-concat [x8|y8|z6], 0 = true Morton Z-order
};

@group(0) @binding(0) var<storage, read> GlyphtensorStream: array<u32>;
@group(0) @binding(1) var<storage, read> GlyphSymbolMatrix: array<f32>; // [128 x Dim]
@group(0) @binding(2) var<storage, read_write> SharedLatentOutput: array<f32>;
@group(0) @binding(3) var<uniform> params: SubstrateParams;

fn decode_concat(code: u32) -> vec3<f32> {
  return vec3<f32>(
    f32((code >> 14u) & 0xFFu),
    f32((code >> 6u) & 0xFFu),
    f32(code & 0x3Fu)
  );
}

// true Morton: bit planes interleaved x0 y0 z0 x1 y1 z1 ... (z has 6
// planes; x,y contribute 2 extra planes on top)
fn decode_morton(code: u32) -> vec3<f32> {
  var x = 0u; var y = 0u; var z = 0u;
  for (var i = 0u; i < 6u; i = i + 1u) {
    x = x | (((code >> (3u * i + 2u)) & 1u) << i);
    y = y | (((code >> (3u * i + 1u)) & 1u) << i);
    z = z | (((code >> (3u * i)) & 1u) << i);
  }
  for (var i = 6u; i < 8u; i = i + 1u) {
    x = x | (((code >> (18u + 2u * (i - 6u) + 1u)) & 1u) << i);
    y = y | (((code >> (18u + 2u * (i - 6u))) & 1u) << i);
  }
  return vec3<f32>(f32(x), f32(y), f32(z));
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let glyph_idx = global_id.x;
  if (glyph_idx >= params.total_active_glyphs) { return; }

  let token = GlyphtensorStream[glyph_idx];
  let style_flags = token & 0x7u;
  let character_id = (token >> 3u) & 0x7Fu;
  let spatial_map = token >> 10u;

  var pos: vec3<f32>;
  if (params.layout_concat == 1u) { pos = decode_concat(spatial_map); }
  else { pos = decode_morton(spatial_map); }
  pos = pos * params.canvas_scale;

  let memory_stride_offset = glyph_idx * params.embedding_dim;
  let symbol_lookup_base = character_id * params.embedding_dim;

  for (var i = 0u; i < params.embedding_dim; i = i + 1u) {
    let base_weight = GlyphSymbolMatrix[symbol_lookup_base + i];
    var spatial_bias = pos.x;
    if (i % 3u == 1u) { spatial_bias = pos.y; }
    else if (i % 3u == 2u) { spatial_bias = pos.z; }
    let telemetry_scale = 1.0 + (f32(style_flags) * 0.05);
    SharedLatentOutput[memory_stride_offset + i] = (base_weight + spatial_bias) * telemetry_scale;
  }
}
`;
