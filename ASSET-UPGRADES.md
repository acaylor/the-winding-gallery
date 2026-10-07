# Asset quality checklist

The checklist below records the original PR 24 implementation. The subsequent
fidelity pass replaces its island/pine geometry, paving arrangement, surface
materials, and budgets. Current details and validation are in `ASSETS.md` and
`VISUAL-FIDELITY.md`.

## 1. Arches and waygates — completed

- [x] Create Blender sources and GLBs with separate stone courses, beveled edges,
      open joints, subtle wear, and restrained brass ornament matching the plinth.
- [x] Replace runtime arch/gate geometry while retaining load-failure fallbacks.
- [x] Preserve path clearance, wing names on both faces, lights, and shared resources.
- [x] Review a studio preview and the gallery under its night lighting.
- [x] Verify exports, packaging, and existing tests; document rebuild instructions.

Validation: studio and browser review (default and low quality); 32 tests passed,
plus updated package-install coverage for both GLBs. Arch: 3,996 triangles /
360 KiB; waygate: 5,292 triangles / 403 KiB; three material groups each.
Existing Three.js deprecation warnings remain in the browser.

## 2. Curbs and paving — completed

- [x] Model several worn curb variants with rounded corners and irregular outlines.
- [x] Add selective raised flagstones without disrupting the winding path.
- [x] Match stone scale and materials to the architectural props.
- [x] Check repetition, walking clearance, and rendering cost in the gallery.

Validation: studio and browser review at default/low quality, plus a blocked-GLB
fallback check. All 32 tests passed, including packaged paving delivery. The kit
is 281 KiB, with five shared 380-triangle meshes and one material. Each segment
uses five instanced batches (at most 12,160 triangles before shadow passes).
This verifies a bounded rendering cost; no cross-device FPS benchmark was run.

## 3. Mountain pines — completed

- [x] Create 3–5 windswept variants with distinct branch silhouettes and exposed roots.
- [x] Build airy needle clusters and simplified versions for distant trees.
- [x] Preserve deterministic placement and attach roots convincingly to islands.
- [x] Review silhouettes, foliage transparency, and performance at walking distance.

Validation: reviewed studio and gallery views at default/low quality and with
the GLB blocked to exercise fallback. Browser checks confirmed three variants,
35 independently fitted root meshes, finite root coordinates, and near/far
switching. Foliage uses opaque needle geometry, so no alpha sorting is required.
The compressed kit is 1.46 MiB; distant trees use roughly one-third of the
nearby triangle count. All 32 tests passed, including packaged asset delivery.
No cross-device FPS benchmark was run.

## 4. Floating islands — completed

- [x] Compare higher-resolution nearby rock textures against the existing 256 px maps.
- [x] Model distinctive island undersides, strata, and root attachment points as needed.
- [x] Preserve lightweight distant islands and shared geometry/materials.
- [x] Check visual improvement against download size and rendering cost.

Validation: studio and gallery review at default/low quality, plus scanned-rock
fallback with the new GLB blocked. The 450 KiB kit shares one material with
512 px color/normal maps tiled at 1.6 m, compared with the scans’ 256 px maps.
Layered undersides provide the clearest improvement at walking distance; fine
texture detail remains subtle in moonlight. Three variants use 2,046 triangles
nearby and 638 at distance. Browser checks verified 44 islands, detail switching,
and 30 fitted pine roots. All 32 tests passed, including packaged asset delivery.
No cross-device FPS benchmark was run.

## 5. Picture frames and existing props — completed

- [x] Add restrained frame corner ornaments and surface wear; preserve photo sizing.
- [x] Refine lantern/plinth metal roughness, recessed patina, and stone texture placement.
- [x] Review close-up photos for distracting reflections or ornament.

Validation: reviewed the refined prop studio and close gallery views under
normal and low-quality lighting. Browser checks verified 56 corner instances,
landscape/portrait/square molding dimensions, and blocked-asset fallback.
The 29 KiB inlay shares one material and geometry across frames (644 triangles
per corner, four corners per photo). Metal patina is exported as vertex colors;
no extra textures or lights are required. All 32 tests passed, including packaged
inlay delivery. No cross-device FPS benchmark was run.

## Acceptance for each priority

- [x] Compare in the actual moonlight and lantern light at normal walking distance.
- [x] Keep editable Blender sources and reproducible export instructions.
- [x] Check GLB size, shared resources, shadows, and low-quality mode.
