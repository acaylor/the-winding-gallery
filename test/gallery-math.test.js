import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEP, curvature, pathHeight, makePathState, extendPath,
  seededRand, mod, romanize, plateS, nextPlateIndex,
  groupWings, wingOfPlate, waygateWing, segForPlateAhead,
} from '../public/gallery-math.js';

test('romanize renders wizardly plate numbers', () => {
  assert.equal(romanize(1), 'I');
  assert.equal(romanize(4), 'IV');
  assert.equal(romanize(9), 'IX');
  assert.equal(romanize(14), 'XIV');
  assert.equal(romanize(42), 'XLII');
  assert.equal(romanize(90), 'XC');
  assert.equal(romanize(214), 'CCXIV');
  assert.equal(romanize(1987), 'MCMLXXXVII');
  assert.equal(romanize(0), 'I', 'plate zero still gets a plaque');
});

test('mod is a true modulo, including negatives', () => {
  assert.equal(mod(7, 3), 1);
  assert.equal(mod(-1, 8), 7);
  assert.equal(mod(-16, 8), 0);
  assert.equal(mod(0, 5), 0);
});

test('seededRand is deterministic and stays in [0, 1)', () => {
  const a = seededRand(123), b = seededRand(123), c = seededRand(124);
  const seqA = Array.from({ length: 50 }, a);
  const seqB = Array.from({ length: 50 }, b);
  assert.deepEqual(seqA, seqB, 'same seed, same sequence');
  assert.notDeepEqual(seqA, Array.from({ length: 50 }, c), 'different seed differs');
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test('curvature stays gentle enough that the path can never knot', () => {
  // max |curvature| bounds the turn rate; the path is ~5.6 m wide, so we
  // need a minimum turn radius comfortably above ~3 m.
  for (let s = 0; s < 20000; s += 0.25) {
    assert.ok(Math.abs(curvature(s)) < 0.05, `curvature at s=${s}`);
  }
});

test('the path climbs forever', () => {
  // pathHeight = 0.02·s ± 2 m of swell: over a long stretch it must rise
  assert.ok(pathHeight(10000) > pathHeight(0) + 150);
});

test('extendPath integrates a continuous, finite, ever-growing path', () => {
  const state = makePathState();
  extendPath(state, 5000);
  const pts = state.pts;
  assert.ok(pts.length >= 5000 / STEP, 'enough samples');
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0, z0] = pts[i - 1];
    const [x1, y1, z1] = pts[i];
    for (const v of pts[i]) assert.ok(Number.isFinite(v), `finite at ${i}`);
    const horiz = Math.hypot(x1 - x0, z1 - z0);
    assert.ok(Math.abs(horiz - STEP) < 1e-9, `uniform step at ${i}`);
    assert.ok(Math.abs(y1 - y0) < 0.1, `no vertical cliffs at ${i}`);
  }
});

test('nextPlateIndex always picks the first plate strictly ahead', () => {
  const L = 16;
  assert.equal(plateS(0, L), 8);
  assert.equal(plateS(3, L), 56);
  // from the path start, the first plate (segment 0, s=8) is ahead
  assert.equal(nextPlateIndex(0, L), 0);
  // standing at a plate, the tour must move on to the next one
  assert.equal(nextPlateIndex(plateS(0, L), L), 1);
  assert.equal(nextPlateIndex(plateS(5, L), L), 6);
  // just short of a plate (within the margin) still counts as "reached"
  assert.equal(nextPlateIndex(plateS(2, L) - 1, L, 2), 3);
  // the invariant, swept along the path
  for (let s = 0; s < 500; s += 0.7) {
    const k = nextPlateIndex(s, L);
    assert.ok(plateS(k, L) > s + 2 - 1e-9, `plate ${k} ahead of s=${s}`);
    assert.ok(k === 0 || plateS(k - 1, L) <= s + 2, `no skipped plate at s=${s}`);
  }
});

test('groupWings makes contiguous wings in first-appearance order', () => {
  const scattered = [
    { name: 'a', wing: '' },
    { name: 'b', wing: 'alps' },
    { name: 'c', wing: '' },      // root photo scattered after a dir
    { name: 'd', wing: 'coast' },
    { name: 'e', wing: 'alps' },
  ];
  const { photos, wings } = groupWings(scattered);
  assert.deepEqual(photos.map((p) => p.name), ['a', 'c', 'b', 'e', 'd']);
  assert.deepEqual(wings, [
    { name: '', start: 0, count: 2 },
    { name: 'alps', start: 2, count: 2 },
    { name: 'coast', start: 4, count: 1 },
  ]);
});

test('wingOfPlate finds the wing that owns a plate', () => {
  const wings = [
    { name: '', start: 0, count: 2 },
    { name: 'alps', start: 2, count: 3 },
    { name: 'coast', start: 5, count: 1 },
  ];
  assert.equal(wingOfPlate(wings, 0).name, '');
  assert.equal(wingOfPlate(wings, 1).name, '');
  assert.equal(wingOfPlate(wings, 2).name, 'alps');
  assert.equal(wingOfPlate(wings, 4).name, 'alps');
  assert.equal(wingOfPlate(wings, 5).name, 'coast');
});

test('waygateWing marks wing starts, including the cycle wrap', () => {
  const wings = [
    { name: '', start: 0, count: 2 },
    { name: 'alps', start: 2, count: 3 },
  ];
  const N = 5;
  assert.equal(waygateWing(0, N, wings).name, '', 'gate where the gallery begins');
  assert.equal(waygateWing(2, N, wings).name, 'alps');
  assert.equal(waygateWing(1, N, wings), null);
  assert.equal(waygateWing(3, N, wings), null);
  // second cycle: the same gates recur
  assert.equal(waygateWing(5, N, wings).name, '');
  assert.equal(waygateWing(7, N, wings).name, 'alps');
  // a single wing needs no gates
  assert.equal(waygateWing(0, 3, [{ name: '', start: 0, count: 3 }]), null);
});

test('segForPlateAhead lands on the right plate, always ahead', () => {
  const L = 16, N = 8;
  for (let s = 0; s < 600; s += 3.3) {
    for (let plate = 0; plate < N; plate++) {
      const idx = segForPlateAhead(s, plate, N, L);
      assert.equal(mod(idx, N), plate, `plate identity at s=${s}`);
      assert.ok(plateS(idx, L) > s, `ahead of walker at s=${s}`);
      assert.ok(plateS(idx, L) - s <= N * L + L, `within one cycle at s=${s}`);
    }
  }
});

test('extendPath is incremental — extending twice equals extending once', () => {
  const twice = makePathState();
  extendPath(twice, 100);
  extendPath(twice, 400);
  const once = makePathState();
  extendPath(once, 400);
  assert.deepEqual(twice.pts, once.pts.slice(0, twice.pts.length));
});
