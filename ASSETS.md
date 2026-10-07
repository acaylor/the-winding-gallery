# Asset provenance

Third-party bundled assets are **CC0 1.0** (public domain) — no attribution required,
but gratefully given:

| Asset | Source | License |
| --- | --- | --- |
| `public/assets/paving-color.jpg`, `paving-normal.jpg`, `paving-ao.jpg`, `paving-rough.jpg` | [PavingStones131](https://ambientcg.com/view?id=PavingStones131) — [ambientCG](https://ambientcg.com) | CC0 1.0 |
| `public/assets/rock-color.jpg`, `rock-normal.jpg`, `rock-ao.jpg` | [Rock035](https://ambientcg.com/view?id=Rock035) — [ambientCG](https://ambientcg.com) | CC0 1.0 |
| `public/assets/bark-color.jpg`, `bark-normal.jpg` | [Bark012](https://ambientcg.com/view?id=Bark012) — [ambientCG](https://ambientcg.com) | CC0 1.0 |
| `public/assets/lantern-slim.glb` | [Lantern](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern) — Microsoft, via Khronos glTF Sample Assets | CC0 1.0 |
| `public/assets/isle-rock-1.glb` | [Rock 07](https://polyhaven.com/a/rock_07) — [Poly Haven](https://polyhaven.com) | CC0 1.0 |
| `public/assets/isle-rock-2.glb` | [Moon Rock 04](https://polyhaven.com/a/moon_rock_04) — [Poly Haven](https://polyhaven.com) | CC0 1.0 |
| `public/assets/isle-rock-3.glb` | [Moon Rock 01](https://polyhaven.com/a/moon_rock_01) — [Poly Haven](https://polyhaven.com) | CC0 1.0 |

Textures were downscaled (512–1024 px) and recompressed for the web; the
models were optimized with [glTF-Transform](https://gltf-transform.dev) —
the lantern to 512 px WebP textures (9.6 MB → 271 KB), the photoscanned
rocks simplified and compressed to 256 px WebP (≈ 2–6 MB → 60–112 KB
each, meshopt-encoded).

The mountain pines now use the original Blender kit described below. The
procedural trees remain as a load-failure fallback. Both use Bark012 above.

The sample photographs in `photos/` are generated procedurally by
`scripts/make-sample-photos.js` and are also CC0.

## Original Blender props

`keeper-lantern.glb` and `gallery-plinth.glb` are original project assets,
covered by the repository MIT license. The pedestal and lantern footing
reuse the CC0 Rock035 textures listed above. The gallery now loads these
props; the older Khronos lantern remains bundled for provenance.

Editable sources and a studio preview are in `assets/blender/`. Rebuild with:

```sh
blender -b --python scripts/build-gallery-assets.py
```

The script exports meter-scale, Y-up GLBs, merges meshes by material, saves
editable `.blend` files, and renders `props-preview.png`. The lantern light
center is `(0.74, 1.95, 0)` in the app. Clones share geometry and materials;
segment disposal must not dispose those shared resources. Load failures use
the existing procedural props. Source scenes are development files; only
`public/assets/` ships in the npm package.

## Shared limestone surface

`limestone-color.png` and `limestone-roughness.png` are local derivatives of the
CC0 Rock035 image. `scripts/gallery-stone.py` preserves the mineral field,
regrades its albedo to warm limestone, and derives varied roughness. Broad
periodic variation tiles without a seam. The existing Rock035 normal map supplies
fine relief. Each map is 512 × 512; the two PNGs total approximately 615 KiB.
The helper also supplies consistent metre-scale UV projection to the kits.

## Blender architecture and paving

The arch and waygate have individual beveled stone courses, recessed slate,
and restrained brass inlay. Three corbel courses under each pier reach inward to
2.5 m from the path centre, overlapping the 2.8 m half-width of the causeway.
They remain below walking level. Labels and lantern sockets retain their original
positions. Both kits use the shared limestone surface.

The paving kit contains `curb-1` through `curb-3` and `flagstone-1` through
`flagstone-2`. Flags are approximately .90 × .12 × .965 m in runtime X/Y/Z.
Six columns and sixteen rows cover each 16 m segment, with staggered cross-joints,
narrow gaps, worn centre tones, and shared geometry/materials. Two instance
batches draw all 96 flags. Three additional batches draw the curbs. The underlying
ribbon is a recessed mortar bed; a failed kit load retains the old textured path.
A full tangent/side/up basis keeps both flags and curbs upright on slopes.

Flags receive shadows but do not cast into every point-light cube; default quality
gets joint contact from GTAO. Curbs and architecture cast and receive shadows.
Segment cleanup disposes instance buffers, never the shared prototypes.

## Blender mountain pines and islands

The three pines have irregular branch tiers, secondary twigs, directional needle
sprays, and small dark rounded inner crowns that remain legible when needles
become subpixel. Near and far geometry share the same branch/crown locations.
Needles are opaque geometry: no alpha sorting, additional textures, or shader
extensions. Bark reuses the CC0 Bark012 maps. Only the 280-triangle root mesh is
copied and fitted per tree; the rest is shared. Detail switches at 55 m (30 m in
low quality) with 15% hysteresis. Trees and fitted roots follow island bobbing.

The island kit contains three separately shaped masses: a broad mesa, an extended
prow, and a squat buttress. Distinct footprints, shear directions, and fracture
profiles replace the previous shared ring stack. Small edge bevels and weighted
normals preserve broad rock planes. Far meshes are reduced from each actual near
mesh, keeping its silhouette. Detail switches at 70 m (35 m in low quality) with
15% hysteresis. Only near meshes cast shadows at default quality; all levels
receive them. Attachment raycasts always sample the near geometry. Scanned rocks
remain the horizon assets and load-failure fallback.

Preserve `pine-N-near-wood`, `pine-N-near-needles`, `pine-N-far-wood`,
`pine-N-far-needles`, `pine-N-roots`, `island-N-near`, and `island-N-far` names.
The loaders use those names to assemble shared detail levels.

## Frame inlays and existing props

`gallery-frame-corner.glb` is the original MIT-licensed brass leaf-and-diamond
inlay. Its geometry and material are shared. Four positive-scale, rotated
instances now draw all corners of each frame in **one draw call**, retaining
2,576 triangles per photo. Instance matrices and bounds update when the photo's
true dimensions arrive. Failed loading leaves the original molded frame.

Lantern and plinth source assets retain PR 24's patina vertex colors, material
roughness and stone UVs. Their GLBs are approximately 787 and 542 KiB respectively.
Lantern halo animation now scales the authored opacity instead of replacing it,
so the smaller default-quality halo survives flicker updates.

## Rebuild and inspect

Use Blender 5.2+ with its bundled MeshOptimizer exporter. Sources, studio scenes,
and refreshed previews are in `assets/blender/`; development sources do not ship
in the npm package. Rebuild the changed surface and kits in this order:

```sh
blender -b --python scripts/gallery-stone.py
blender -b --python scripts/build-gallery-architecture.py
blender -b --python scripts/build-gallery-paving.py
blender -b --python scripts/build-gallery-islands.py
blender -b --python scripts/build-gallery-pines.py
```

To rebuild the unchanged lantern, plinth, and frame-inlay assets:

```sh
blender -b --python scripts/build-gallery-assets.py
```

The review stretch is `?auto&s=140` (roughly 128–160 m), with
`?auto&s=40&yaw=35` providing a second view of the islands and lanterns.
Review both at default quality and with `&quality=low`. See `VISUAL-FIDELITY.md`
for validation, measured asset budgets, and limitations.
