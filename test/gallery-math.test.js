import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEP, curvature, pathHeight, makePathState, extendPath,
  seededRand, mod, romanize,
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

test('extendPath is incremental — extending twice equals extending once', () => {
  const twice = makePathState();
  extendPath(twice, 100);
  extendPath(twice, 400);
  const once = makePathState();
  extendPath(once, 400);
  assert.deepEqual(twice.pts, once.pts.slice(0, twice.pts.length));
});
