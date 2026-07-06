# Development Milestones

A chronicle of how The Winding Gallery came to be, and what each stage
taught. Newest at the bottom; the ledger of lessons is at the end.

## I · The Concept — 2026-07-05

> *"A fun and interactive 3D environment that is a dynamic photo gallery…
> load any directory full of photos that become the infinitely scaling
> gallery… fantasy themed."*

The vision: a **place, not a page**. A sibling of
[agent-hollow](https://github.com/acaylor/agent-hollow)'s cozy night
realm and isle-of-babel's endless library — an infinite, walkable,
moonlit causeway where every photograph in a directory hangs as a
gold-framed *plate* on its own plinth. Design pillars set on day one:

- **One command, no build step.** A tiny Node server; three.js as the
  only dependency, served straight from `node_modules`.
- **Endless by construction.** The path is generated ahead of the walker
  and dissolved behind, cycling the collection forever.
- **Committed aesthetic.** Deep indigo night, lantern gold (`#e0b64a`,
  borrowed from agent-hollow), fireflies, runes, Roman numerals.

## II · First Light — the world exists (2026-07-05)

The whole core in one sitting: winding-path math (a heading integrated
over overlapping sine curvatures — gentle enough that the path can never
knot), segment streaming, photo plates with true aspect ratios and canvas
plaques, behold mode with camera flights, scroll gliding, fireflies,
stars, a procedural sample-plate generator with a dependency-free PNG
encoder, and the entrance veil.

**Lessons this stage taught:**

- **Triangle winding is a silent failure.** The flagstone floor vanished
  because its indices wound clockwise — single-sided materials cull
  exactly one frame of debugging patience.
- **Async boot races are sneaky.** Segments built on the very first
  animation frame, before the photo list arrived — the first ~180 m of
  gallery had no frames at all. World-building now waits for the data.
- **Camera-facing sprites slice through tilted planes.** The "glow behind
  each plate" sprite intersected the photo at viewing angles, drawing a
  sharp haze seam. A plane parallel to the photo fixed it.
- **Headless Chrome suspends `requestAnimationFrame`** shortly after
  load. Screenshot flags can't see animation; the fix was a CDP harness
  that pumps frames via `Page.captureScreenshot` and reads app state
  through a `window.__winding()` hook — the testing pattern the project
  still uses.

## III · Real Stone — assets, tests, CI (2026-07-06)

The procedural look upgraded with real CC0 material: ambientCG
cobblestone/rock/bark PBR textures (downscaled to 0.5–1 MB total) and the
Khronos glTF lantern. Test suite (`node --test`), CI, MIT license, README
with screenshots, and the repo published to GitHub.

**Lessons:**

- **CC0 sources are automatable.** ambientCG has a direct download API;
  Khronos sample assets have stable raw URLs.
- **glTF-Transform is a 30× diet.** The lantern went 9.6 MB → 271 KB
  (512 px WebP textures) with one CLI call — vendorable in an npm
  package.
- **npm hoisting exists** (foreshadowing: see milestone VI).
- Path-traversal guards deserve tests with *encoded and malformed*
  escapes, not just `../`.

## IV · A Door to the World — site & trusted publishing (2026-07-06)

The official site — itself styled as a gallery, every screenshot a
gold-framed plate with an engraved plaque — deployed to GitHub Pages from
`docs/`. npm publishing switched to OIDC **trusted publishing**: no
tokens, provenance attested, tag-triggered.

**Lessons:**

- **A Pages site created via API can be born broken.** Deploys failed
  with "try again later" until the site was deleted and recreated.
- **Trusted publishing cannot create a package.** The very first version
  must be published manually; only then can the trusted publisher be
  configured on the package's settings page.
- npm requires CLI ≥ 11.5.1 for OIDC — runners need `npm i -g npm@latest`.

## V · Sharper Tools — pnpm & Node 24 LTS (2026-07-06)

Dependency audit (`three` was already current), GitHub Actions bumped
several majors (checkout v7, setup-node v6, Pages actions v5/v6), the
project moved to **pnpm 11**, and **Node 24 LTS** became the recommended
runtime (`.node-version`).

**Lessons:**

- **pnpm 11 requires Node ≥ 22.13** (it uses `node:sqlite`) — discovered
  by CI when the Node 20 matrix job died in the cache step. Node 20 was
  past EOL anyway; the floor moved to 22.
- The `packageManager` field lets `pnpm/action-setup` pin itself — one
  fewer version to repeat in workflows.
- pnpm's symlinked `node_modules` serves fine through the vendor routes —
  proven by the existing tests, no code change needed.

## VI · The Keeper's Tour & the release ritual — v0.2.0 (2026-07-06)

The first feature shipped through the full **PR → prerelease → release**
pipeline. A wisp-led, self-playing exhibition (`T` / `?tour`): travel →
behold → dwell → depart, forever; any key hands the path back. Publish
workflow learned dist-tag staging: `x.y.z-*` → `next`, stable → `latest`.

**Lessons — the milestone that justified the whole pipeline:**

- **The `0.2.0-rc.1` prerelease caught a real shipping bug**: npm hoists
  `three` to a sibling `node_modules`, so the server's hardcoded path
  404'd every `/vendor/three/*` request in real installs. Dev worked;
  the shipped package was a black screen. Fixed with
  `createRequire().resolve()`.
- **Test the artifact, not the repo.** A regression test now packs the
  actual tarball, installs it into a fresh prefix, boots the installed
  CLI and asserts every endpoint serves — verified to fail on the old
  code before the fix was accepted.
- **npm's metadata cache lies briefly.** Right after publishing,
  `npm i pkg@next` can still resolve the previous prerelease; install by
  exact version (or `--prefer-online`) when verifying.
- The release ritual, settled: branch → PR → tag `vX.Y.Z-rc.N` (staging
  on `next`) → verify the *installed* package → merge → tag `vX.Y.Z`.

## The Ledger of Lessons

1. Backface culling makes winding bugs look like missing geometry.
2. Never build the world before its data arrives.
3. Sprites billboard; glows that must hug a surface should be planes.
4. Headless browsers suspend rAF — drive frames via CDP and expose a
   state hook for tooling.
5. Asset pipelines can be one-liners: ambientCG API + glTF-Transform.
6. Trusted publishing needs a manual first publish and npm ≥ 11.5.1.
7. API-created Pages sites can need a delete-and-recreate.
8. Package-manager floors are real constraints: pnpm 11 ⇒ Node ≥ 22.13.
9. **Prereleases exist to catch what dev environments cannot** — npm
   hoisting broke the shipped package while the repo worked perfectly.
10. The only honest install test is installing the packed tarball.
