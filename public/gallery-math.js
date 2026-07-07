// Pure logic for The Winding Gallery — no DOM, no three.js.
// Shared by the browser app (public/main.js) and the Node test suite.

export const STEP = 0.5; // metres between path samples

// Curvature of the walker's heading (radians per metre). Gentle overlapping
// sines: the path wanders forever but can never turn tightly enough to knot.
export function curvature(s) {
  return 0.028 * Math.sin(s * 0.021 + 1.3) + 0.019 * Math.sin(s * 0.0093 + 4.1);
}

// Height of the causeway: a slow endless climb with rolling swells.
export function pathHeight(s) {
  return s * 0.02 + 1.4 * Math.sin(s * 0.023 + 2.0) + 0.6 * Math.sin(s * 0.061);
}

// Integrate the winding path out to arc-length `toS`, appending [x, y, z]
// sample triples to state.pts. State carries the heading and cursor so the
// path can be extended forever, incrementally.
export function makePathState() {
  return { pts: [], heading: 0, x: 0, z: 0 };
}
export function extendPath(state, toS) {
  while (state.pts.length * STEP <= toS + 4) {
    const s = state.pts.length * STEP;
    state.pts.push([state.x, pathHeight(s), state.z]);
    state.heading += curvature(s) * STEP;
    state.x += Math.sin(state.heading) * STEP;
    state.z -= Math.cos(state.heading) * STEP;
  }
  return state;
}

// Deterministic per-segment PRNG (mulberry32-style).
export function seededRand(seed) {
  let t = seed + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// True mathematical modulo (JS % is a remainder and goes negative).
export function mod(n, m) {
  return ((n % m) + m) % m;
}

// Each segment hangs one plate at its midpoint.
export function plateS(segIdx, segLen) {
  return segIdx * segLen + segLen / 2;
}

// The segment index of the first plate strictly ahead of the walker
// (beyond `margin` metres), for the Keeper's Tour to fly to next.
export function nextPlateIndex(currentS, segLen, margin = 2) {
  return Math.max(0, Math.floor((currentS + margin - segLen / 2) / segLen) + 1);
}

// ── wings ───────────────────────────────────────────────────────────
// Subdirectories become "wings" of the gallery: contiguous stretches of
// the one endless path, each announced by a carved waygate.

// Group a wing-annotated photo list into contiguous wings, preserving
// first-appearance wing order. Returns { photos, wings } where photos is
// the reordered flat list and wings is [{ name, start, count }] with
// `start` the plate index of the wing's first photo.
export function groupWings(list) {
  const order = [];
  const byWing = new Map();
  for (const photo of list) {
    const wing = photo.wing ?? '';
    if (!byWing.has(wing)) {
      byWing.set(wing, []);
      order.push(wing);
    }
    byWing.get(wing).push(photo);
  }
  const photos = [];
  const wings = [];
  for (const name of order) {
    const group = byWing.get(name);
    wings.push({ name, start: photos.length, count: group.length });
    photos.push(...group);
  }
  return { photos, wings };
}

// The wing a plate belongs to.
export function wingOfPlate(wings, plateIdx) {
  let found = null;
  for (const w of wings) {
    if (plateIdx >= w.start) found = w;
    else break;
  }
  return found;
}

// If this path segment hangs the first plate of a wing, return that wing
// (a waygate is built there) — including the wrap where the cycle begins
// again. Null when the segment is mid-wing or there is only one wing.
export function waygateWing(segIdx, photoCount, wings) {
  if (wings.length < 2 || photoCount === 0) return null;
  const plateIdx = mod(segIdx, photoCount);
  return wings.find((w) => w.start === plateIdx) ?? null;
}

// The first segment index at (or beyond) `margin` metres ahead of the
// walker whose plate is `plateIdx` — where the Wayfarer's Map teleports.
export function segForPlateAhead(currentS, plateIdx, photoCount, segLen, margin = 2) {
  const base = nextPlateIndex(currentS, segLen, margin);
  return base + mod(plateIdx - base, photoCount);
}

// Roman numerals, as is proper for a wizard's collection.
export function romanize(n) {
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, r] of table) while (n >= v) { out += r; n -= v; }
  return out || 'I';
}
