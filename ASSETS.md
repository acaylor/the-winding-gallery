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

The mountain pines on the islands are generated procedurally at
runtime (no asset), textured with the Bark012 surface above.

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
