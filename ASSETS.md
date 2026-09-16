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

## Original Blender architecture

`gallery-arch.glb` and `gallery-waygate.glb` are original MIT-licensed project
assets using the CC0 Rock035 color and normal textures above. Editable sources,
a shared studio scene, and `architecture-preview.png` live in `assets/blender/`.

```sh
blender -b --python scripts/build-gallery-architecture.py
```

The arch has 19 separate beveled wedge stones, a raised keystone, and coursed
piers. The waygate uses coursed piers, a segmented lintel, slate inscription beds,
and brass fillets. Both export three meshes/materials, in meters with Y up and
the ground at zero. They span the local X axis; the approach face is +Z.
World-scale UVs keep the stone grain consistent across courses and bevels.

Runtime clones share geometry and materials and retain procedural load-failure
fallbacks. Wing names remain dynamic on both faces at y=4, z=±0.52; the existing
flames remain at x=±3.5, y=4.19. No additional lights are introduced.

The prioritized improvement checklist is in `ASSET-UPGRADES.md`.

## Original Blender paving kit

`gallery-paving.glb` contains three worn curb variants and two shallow flagstones,
using one shared limestone material with the CC0 Rock035 color/normal textures.
The original geometry is MIT licensed. Editable sources, the review scene, and
`paving-preview.png` are in `assets/blender/`.

```sh
blender -b --python scripts/build-gallery-paving.py
```

Keep mesh names `curb-1` through `curb-3` and `flagstone-1` through `flagstone-2`:
the loader uses those prefixes, bakes the exported transforms, and centers each
mesh once. Curbs are approximately 0.55 × 0.30 × 1.15 m (X/Y/Z in the app);
flagstones are 0.14 m thick and mostly embedded in the path shoulders. UVs use
the architecture's 1.6 m stone scale. The center of the winding path stays clear.

The 281 KiB GLB has five meshes at 380 triangles each. Each streamed segment
uses three curb batches and two flagstone batches (up to 20 curbs and 12 flags).
Instances share geometry, textures, and material; segment disposal releases only
their instance buffers. Added flags use a separate deterministic random stream.
If loading fails, the box curbs and original textured path remain available.


## Original Blender mountain pines

`gallery-pines.glb` contains three MIT-licensed pine designs: a leaning sentinel,
a low windswept tree, and a forked crown. The bark reuses the CC0 Bark012 images;
the needles use original geometry and vertex colors, with no foliage image or
alpha blending. Sources and a studio preview are in `assets/blender/`.

```sh
# Blender 5.2+ with its bundled MeshOptimizer exporter
blender -b --python scripts/build-gallery-pines.py
```

The script exports meter-scale Y-up geometry rooted at zero, then arranges the
editable `.blend` for inspection. Far meshes are hidden in the source/studio;
unhide them to inspect the simplified versions. Preserve the mesh names
`pine-N-near-wood`, `pine-N-near-needles`, `pine-N-far-wood`,
`pine-N-far-needles`, and `pine-N-roots` for N=1,2,3.

The meshopt-compressed GLB is approximately 1.46 MiB with two shared materials.
Each nearby tree renders 9,714–10,888 triangles including roots; distant trees
render 3,394–3,770. The app switches at 55 m (30 m in low quality), with 15%
hysteresis to prevent flickering between levels near the threshold. Both levels
preserve the same main branches and foliage cluster locations.

Only the 280-triangle root mesh is copied per tree. Its vertices are fitted by
raycasting against the island; roots over a broken edge curl downward. Trunks
and needles share geometry/materials across clones. Trees and their islands
retain synchronized bobbing. Tree design uses a separate seeded random stream,
so loading the asset or falling back does not change island placement. Segment
disposal releases fitted roots while preserving the shared prototypes.

## Original Blender floating islands

`gallery-islands.glb` contains three original MIT-licensed layered limestone
islands using the CC0 Rock035 color and normal images. The 512 px maps tile at
1.6 m in source space; island scaling also scales the grain. Broad top shelves
support the fitted pine roots, and hanging roots raycast onto the tapered base.

```sh
blender -b --python scripts/build-gallery-islands.py
```

Editable sources, studio scene, and `islands-preview.png` are in `assets/blender/`.
Preserve `island-N-near` and `island-N-far` names (N=1,2,3). The 450 KiB meshopt
GLB has one shared material; each variant uses 2,046 near or 638 far triangles.
Detail switches at 70 m (35 m in low quality) with 15% hysteresis. Terrain fitting
always samples the near mesh so attachments do not change with camera distance.
Clones share all island geometry/materials, which segment disposal preserves.
The original scans remain on the horizon and serve as load-failure fallbacks.

## Frame inlays and prop material refinement

`gallery-frame-corner.glb` is an original MIT-licensed brass leaf-and-diamond
inlay, built by `scripts/build-gallery-assets.py` alongside the lantern and
plinth. Its editable source is `assets/blender/gallery-frame-corner.blend`.
The 29 KiB kit uses one material and 644 triangles. Four shared clones add
2,576 triangles and four draw calls per photo frame. Inlays follow the corners
when photo dimensions arrive; their leaves run along the molding outside the
image. If loading fails, the molded frame remains without inlays.

The runtime molding keeps its existing dimensions and adds vertex shading for
darker grooves and lightly worn edges. A separate frame material reduces
metalness and environment reflections while retaining the shared roughness map.
Lantern/plinth bronze and brass now use roughness .48/.46 and exported vertex
colors for sheltered-face patina. Stone UVs use the same 1.6 m scale as the
architecture. No extra textures or lights are added. Rebuild with:

```sh
blender -b --python scripts/build-gallery-assets.py
```

The updated studio scene and `props-preview.png` show the refined prop materials.
`frames-gallery-preview.png` records the inlays in the gallery at low quality.
Lantern and plinth remain four and three material groups respectively, with
15,704 and 9,048 triangles; their GLBs are approximately 787 and 542 KiB.
