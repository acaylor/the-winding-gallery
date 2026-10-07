# Visual fidelity pass

Based on PR 24 (`0d333ad`), developed on `codex/visual-fidelity-pass`.
The review stretch is the causeway around 128–160 m, viewed with `?auto&s=140`.
The same reusable surfaces, geometry, and lighting apply throughout the gallery.

## Visible changes

- Continuous fitted limestone flagstones, staggered cross-joints, centre wear,
  and recessed mortar replace the disconnected slabs over fine cobblestones.
- Corbelled foundations connect the arch and waygate piers to the causeway.
- Three distinct fractured island footprints/profiles replace concentric rings.
  Broad planes, edge bevels, and weighted normals give them readable surfaces.
- Pines gain irregular branch tiers, secondary twigs, directional needles,
  and small dark inner crowns that keep foliage visible at walking distances.
- Locally generated limestone color/roughness maps separate porous stone and worn
  grains. The Blender studios and browser use the same exported material inputs.
- Film grain is removed; sky dithering, vignette, bloom, contact occlusion,
  moonlight, and fill are retuned. Lantern flicker preserves the intended halo
  opacity rather than replacing it every frame.
- Near islands cast shadows. Frame ornaments use one four-instance batch per
  photo, with rotations instead of unsupported negative instance scales.

## Verification

- All 32 existing tests passed (`node --test`).
- The package-install test passed again after adding both limestone texture
  routes to its packaged-asset assertions.
- `node --check public/main.js` and `git diff --check` passed.
- Rebuilt the changed GLBs, editable Blender sources, and studio previews using
  Blender 5.2.2. Inspected the resulting studios and browser captures.
- Chromium at 1280 × 800: default and low-quality views loaded all photographs,
  1,344 flagstones, 56 frame corners, and fitted roots with finite coordinates.
  No JavaScript or WebGL console errors in either quality mode.
- The smallest paving up-axis component was 0.9963: the slabs remain upright
  on the sampled sloping/bending path. A full path basis fixes the roll observed
  in the first integration capture.
- Low-quality photo inspection and return to walking completed successfully.
- Deliberately blocked all seven `gallery-*.glb` requests: procedural/scanned
  fallbacks remained usable, photographs loaded, and geometry stayed finite.
  The seven expected failed-request console messages were the only errors.

## Asset budgets

Sizes include embedded textures; triangles below are per asset or variant,
not multiplied by scene instances, shadows, or postprocessing passes.

| Asset | Size | Triangles |
| --- | ---: | ---: |
| Arch | 918 KiB | 4,644 |
| Waygate | 960 KiB | 5,940 |
| Paving kit | 780 KiB | Curbs 92–96; flags 92–100 |
| Island kit | 794 KiB | Near 402–476; far 112–132 |
| Pine kit | 1,831 KiB | Near 15,258–15,880; far 3,106–3,214, including roots |
| Frame corner | 29 KiB, unchanged | 644; four per photo |
| Standalone limestone maps | 615 KiB | Two 512 × 512 images |

Paving uses five instance batches per segment: three curbs and two flags.
Corners use one draw per photo instead of four. Shared prototype geometry and
materials survive segment disposal; only per-segment buffers and fitted roots
are disposed. Low quality disables shadows and uses shorter LOD distances.

## Captured rendering cost and limits

At the same default-quality camera (`s=140`), with the full frame's shadow and
composer passes counted:

| Capture | Draw calls | Submitted triangles |
| --- | ---: | ---: |
| PR 24 | 1,464 | 3,263,381 |
| Fidelity pass | 1,368 | 3,268,981 |

The final low-quality view at `s=40&yaw=35` recorded 489 calls and 549,114
triangles. These are single-view diagnostics, not a hardware FPS benchmark.
The software renderer used for capture cannot establish target-device speed.
Light flicker, bobbing, visibility, and scenery distribution vary; changed curb
placement also changes the seeded scenery downstream. Do not interpret this as
a controlled benchmark of one isolated rendering change.

The larger embedded surface textures increase download size. Far pines preserve
canopy coverage, but nearby foliage still has a substantial triangle cost. The
three island designs remain a limited kit; this pass establishes a more coherent
scene and does not claim photorealism or exhaustive performance validation.

## Review artifacts

The PR comparison images are committed as
`assets/blender/gallery-before-preview.png` and
`assets/blender/gallery-fidelity-preview.png`. Both use the walking camera at
140 m and a 1280 × 800 viewport.

Untracked browser outputs are in `.playwright-cli/`:

- `comparison.html`: slider between the matching PR 24 and final walking views.
- `before-path.png`, `path-final.png`: default-quality camera at 140 m.
- `low-final.png`: low-quality island/lantern view at 40 m.
- `inspect.png`: photo inspection close-up.
- `fallback.png`: deliberately blocked-asset fallback.
- Corresponding JSON scene diagnostics and `capture.mjs` capture harness.

The normal site screenshots remain generated at deployment time rather than
being committed. Rebuild instructions and asset provenance are in `ASSETS.md`.
