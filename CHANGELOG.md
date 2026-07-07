# Changelog

All notable changes to The Winding Gallery are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The publish workflow reads this file to populate GitHub release notes:
stable tags require a matching version section; prerelease tags publish
whatever stands in **Unreleased**.

## [Unreleased]

### Added

- **Wings & Waygates** — subfolders become *wings* of the gallery. Each
  wing's photographs hang together on the path, and a stone waygate
  carved with the wing's name (gold on both faces, flame-lit pillars)
  marks where it begins. The HUD shows the wing you are walking; the
  plate panel names the wing a photograph belongs to.
- **The Wayfarer's Map** — press `M`: every wing listed with its plate
  count and a *you are here* mark. Choosing one fades the night and sets
  you down just before that wing's waygate, facing down the path.
- `/api/photos` now returns `wing` per photo and a `wings` summary;
  photos are grouped so each subfolder is contiguous on the path.
- Wing helpers (`groupWings`, `wingOfPlate`, `waygateWing`,
  `segForPlateAhead`) in `gallery-math.js`, unit-tested.
- `MILESTONES.md` — a chronicle of the project's development and the
  lessons each stage taught.
- `ARCHITECTURE.md` — the tech stack and how the pieces fit together.
- This changelog, wired into the publish workflow: release notes on
  GitHub are now populated from the matching section here.

## [0.2.0] - 2026-07-06

### Added

- **The Keeper's Tour** — press `T` (or visit `?tour`) and a glowing wisp
  leads a self-playing exhibition: it drifts ahead to the next plate, the
  view flies in and beholds the photograph for a few seconds with its
  plaque panel shown, then glides on, forever. Any movement key, click,
  scroll or `Esc` hands the path back to the walker. Pair `?auto&tour`
  for a kiosk or TV slideshow.
- A tour badge in the HUD while the keeper leads, and `T` added to the
  control hints.
- Plate-targeting helpers `plateS` / `nextPlateIndex` in
  `gallery-math.js`, unit-tested — including the invariant that the tour
  never re-targets the plate it is standing at.
- A packed-tarball regression test: `npm pack` the real package, install
  it into a fresh prefix, boot the installed CLI and assert every
  endpoint serves (`test/install.test.js`).

### Fixed

- **three.js served 404 in real npm installs.** npm hoists `three` to a
  sibling `node_modules`, so the server's hardcoded
  `ROOT/node_modules/three` path only worked inside the dev repo — every
  npm-installed gallery was a black screen. Caught by the `0.2.0-rc.1`
  prerelease; the server now locates three via Node module resolution
  (`createRequire().resolve()`).

### Changed

- The publish workflow routes prerelease versions (`x.y.z-*`) to the
  npm **`next`** dist-tag; stable versions go to `latest`.

## [0.1.0] - 2026-07-06

### Added

- The gallery itself: point the server at any directory of photographs
  and walk an endless, gently climbing cobblestone causeway adrift in a
  night sky — every image a gold-framed plate on its own plinth with a
  brass plaque, numbered in Roman numerals, lit by lanterns and
  fireflies.
- First-person controls (pointer lock + WASD, `Shift` to hurry), scroll
  gliding, and **behold** mode (`E`/click): the view flies up close and a
  parchment panel names the plate.
- A zero-dependency Node server with recursive photo scanning,
  path-traversal-safe streaming, and three.js served straight from
  `node_modules` — no build step.
- Procedurally generated world: winding path integrated from overlapping
  sine curvatures (provably never knots), segment streaming with full
  geometry/texture disposal, reference-counted photo textures downscaled
  off-thread to 2048 px.
- Real CC0 assets: ambientCG cobblestone/rock/bark PBR textures and the
  Khronos lantern model, slimmed from 9.6 MB to 271 KB (`ASSETS.md`).
- Sample-plate conjurer: eight procedural landscapes written by a
  dependency-free PNG encoder (`npm run samples`).
- `winding-gallery` CLI, test suite on `node --test`, CI across Node
  versions, npm publishing via OIDC trusted publishing, and the official
  site on GitHub Pages.

[Unreleased]: https://github.com/acaylor/the-winding-gallery/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/acaylor/the-winding-gallery/compare/a125076...v0.2.0
[0.1.0]: https://github.com/acaylor/the-winding-gallery/commits/a125076
