# Architecture

How The Winding Gallery works, and why it is built the way it is.

## At a glance

```
 browser ──────────────────────────────────────────────────────────────┐
 │  public/main.js        the world: path, segments, plates, tour      │
 │  public/gallery-math.js pure math (also imported by the test suite) │
 │  three.js (ESM import map → /vendor/three/…)                        │
 └──────────────▲───────────────────────────────────────────────────────┘
                │ HTTP
 ┌──────────────┴───────────────────────────────────────────────────────┐
 │  server.js (node:http, zero dependencies)                            │
 │    /api/photos            recursive scan of the photo directory      │
 │    /photos/<path>         image streaming (traversal-safe)           │
 │    /vendor/three[-addons] three.js straight from node_modules        │
 │    /*                     static files from public/                  │
 └──────────────▲───────────────────────────────────────────────────────┘
                │ started by
        bin/cli.js  (`winding-gallery ~/Pictures --port=4173`)
```

**No build step.** The browser imports ES modules directly; an import map
points the bare `three` specifier at the server's vendor route. What you
edit is what runs.

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | Node ≥ 22 (24 LTS recommended, `.node-version`) | pnpm 11 needs ≥ 22.13; 24 is current LTS |
| Rendering | three.js r185 (only dependency) | WebGL scene graph; served from `node_modules`, resolved via `createRequire()` so npm hoisting can't break it |
| Server | `node:http`, hand-rolled routes | ~150 lines; no framework to version-manage |
| Package manager | pnpm 11 (`packageManager` field) | fast, strict, content-addressed store |
| Tests | `node --test` | zero test-framework dependencies |
| E2E harness | Chrome DevTools Protocol scripts | headless Chrome suspends rAF; CDP screenshot-pumping drives frames, `window.__winding()` exposes state |
| CI/CD | GitHub Actions | CI matrix (Node 22/24) · Pages deploy from `docs/` · tag-triggered npm publish |
| Publishing | npm **trusted publishing** (OIDC) | tokenless, provenance-attested; prereleases → `next`, stable → `latest`; release notes from `CHANGELOG.md` |
| Assets | CC0 only (`ASSETS.md`) | ambientCG PBR textures, Khronos lantern slimmed 9.6 MB → 271 KB via glTF-Transform |

## The server (`server.js`)

A library with a CLI wrapper (`bin/cli.js` → `startFromArgv()`), which is
what makes it testable: `createGalleryServer(photoDir)` returns an
unstarted `http.Server` the suite binds to an ephemeral port.

- **`scanPhotos`** walks the photo directory (≤ 6 levels, ≤ 5 000 images,
  dotfiles and `node_modules` skipped), natural-sorted, URL-encoding each
  relative path.
- **`safeJoin`** is the security boundary: decode, resolve against the
  root, require the result stays inside it. Handles encoded (`%2e%2e`)
  and malformed (`%zz`) escapes. Every file route goes through it.
- Vendor routes serve three.js from wherever Node resolution finds it —
  `path.dirname(createRequire(import.meta.url).resolve('three'))` — which
  survives npm's dependency hoisting in installed packages.

## The client world (`public/main.js`)

**The path** is not stored geometry but a *process*: a heading integrated
over overlapping sine curvatures (`gallery-math.js`), sampled every
0.5 m. Curvature amplitudes are bounded (unit-tested) so the minimum turn
radius always exceeds the path width — the causeway can wander forever
and never intersect itself. Height climbs ~2 m per 100 m with rolling
swells, so the horizon is never flat.

**Segment streaming.** The world exists only near the walker: every 16 m
segment (flagstone ribbon with per-vertex tinting and tiled UVs, curb
stones as an `InstancedMesh`, one plate, one lantern, occasional arches,
runes, drifting rock islets) is built ~170 m ahead and disposed ~40 m
behind. Everything a segment allocates is tracked in a `disposables`
list; shared geometries/materials/textures are never disposed.

**Plates.** Each segment hangs `photos[segIdx % photos.length]` — an
endless gallery from a finite collection, deterministic per segment.
Photos are fetched → `createImageBitmap` (decode off the main thread,
pre-flipped) → downscaled to ≤ 2048 px → reference-counted in a texture
cache keyed by URL; the count hitting zero disposes GPU memory. Frames
are rebuilt to each photo's true aspect; plaques are canvas textures.

**Modes.** One state variable drives the camera:
`walk` (pointer-lock WASD constrained to path coordinates `(s, lateral)`,
plus scroll-glide) → `flying` (eased flight to a plate) → `inspect`
(parchment panel) → `returning`. The **Keeper's Tour** is a second state
machine layered on top (`travel → behold → dwell → depart`) that reuses
those same transitions, with a wisp (emissive core + additive glow +
point light) leading the way. Any input hands control back.

**Lighting** is deliberately cheap: hemisphere + moon directional + one
flickering walker light + emissive/unlit materials for photos and glows.
No shadow maps; the night does the work.

## Testing strategy

Four rings, cheapest first:

1. **Pure units** (`gallery-math`, changelog extraction): invariants like
   "curvature can never knot the path" and "the tour never re-targets the
   plate it stands at".
2. **HTTP integration**: real server on an ephemeral port — API shape,
   mime types, traversal rejection, vendor routes.
3. **Packed-tarball install** (`test/install.test.js`): `npm pack` the
   real artifact, install into a fresh prefix, boot the installed CLI,
   assert every endpoint. Exists because rc.1 shipped a bug only real
   installs could show.
4. **CDP end-to-end** (scratchpad scripts, run against a live build):
   glide, behold/return, tour progression and cancellation, screenshots.

## Release pipeline

```
branch → PR (ci.yml: Node 22 + 24)
  └─ tag vX.Y.Z-rc.N  → publish.yml → npm dist-tag "next"   + GitHub prerelease
merge → main
  └─ tag vX.Y.Z       → publish.yml → npm dist-tag "latest" + GitHub release
```

`publish.yml` is the only workflow npm trusts (OIDC trusted publisher
pinned to this file). It installs with pnpm, tests, verifies the tag
matches `package.json`, extracts release notes from `CHANGELOG.md`
(`scripts/changelog-notes.js` — stable tags **fail the publish** if their
section is missing; prereleases use *Unreleased*), publishes with
provenance, then creates the GitHub release from those notes.
`pages.yml` deploys `docs/` to GitHub Pages on pushes to `main`.

## Repository layout

```
bin/cli.js                  CLI entry (`winding-gallery`)
server.js                   HTTP server library + argv bootstrap
public/                     the app (index.html, main.js, style.css)
public/gallery-math.js      pure logic shared with tests
public/assets/              vendored CC0 textures + lantern (ASSETS.md)
scripts/make-sample-photos  dependency-free PNG conjurer
scripts/changelog-notes.js  Keep-a-Changelog → release-notes extractor
test/                       node --test suite (units, HTTP, tarball, changelog)
docs/                       GitHub Pages site + screenshots
.github/workflows/          ci.yml · publish.yml · pages.yml
CHANGELOG.md                Keep a Changelog (drives release notes)
MILESTONES.md               development chronicle
```
