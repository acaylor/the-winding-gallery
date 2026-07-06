// The prerelease pipeline once caught a bug unit tests missed: three.js is
// hoisted to a sibling node_modules when installed from npm, so hardcoded
// paths 404'd. This test packs the real tarball, installs it into a fresh
// prefix, boots the installed CLI, and walks the endpoints that matter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the packed tarball installs and serves the app end to end', { timeout: 120_000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'winding-install-'));
  try {
    const tarball = execFileSync('npm', ['pack', '--pack-destination', tmp], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split('\n').pop();
    execFileSync('npm', [
      'install', path.join(tmp, tarball),
      '--no-audit', '--no-fund', '--loglevel=error',
    ], { cwd: tmp, stdio: 'pipe' });

    const photoDir = path.join(tmp, 'plates');
    fs.mkdirSync(photoDir);
    fs.writeFileSync(path.join(photoDir, 'p.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const port = 4600 + Math.floor(Math.random() * 400);
    const cli = path.join(tmp, 'node_modules', 'the-winding-gallery', 'bin', 'cli.js');
    const child = spawn(process.execPath, [cli, photoDir, `--port=${port}`], {
      cwd: tmp, stdio: 'pipe',
    });
    try {
      // wait for the server to answer
      let up = false;
      for (let i = 0; i < 50 && !up; i++) {
        await new Promise((r) => setTimeout(r, 200));
        up = await fetch(`http://127.0.0.1:${port}/api/photos`).then((r) => r.ok, () => false);
      }
      assert.ok(up, 'installed CLI serves within 10s');

      const photos = await (await fetch(`http://127.0.0.1:${port}/api/photos`)).json();
      assert.equal(photos.photos.length, 1, 'scans the given directory');

      for (const p of [
        '/', '/main.js', '/gallery-math.js',
        '/vendor/three/three.module.js',
        '/vendor/three/three.core.js',
        '/vendor/three-addons/loaders/GLTFLoader.js',
        '/assets/lantern-slim.glb',
        '/assets/paving-color.jpg',
      ]) {
        const res = await fetch(`http://127.0.0.1:${port}${p}`);
        assert.equal(res.status, 200, `${p} serves from the installed package`);
        await res.arrayBuffer();
      }
    } finally {
      child.kill();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
