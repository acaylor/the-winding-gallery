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
import { once } from 'node:events';

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

    const cli = path.join(tmp, 'node_modules', 'the-winding-gallery', 'bin', 'cli.js');
    const child = spawn(process.execPath, [cli, photoDir, '--port=0'], {
      cwd: tmp, stdio: 'pipe',
    });
    try {
      const base = await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error('CLI did not start within 10s')), 10_000);
        const fail = (err) => { clearTimeout(timeout); reject(err); };
        child.once('error', fail);
        child.once('exit', (code) => fail(new Error(`CLI exited before readiness: ${code}`)));
        child.stdout.on('data', (chunk) => {
          output += chunk;
          const match = output.match(/http:\/\/localhost:(\d+)/);
          if (match) {
            clearTimeout(timeout);
            resolve(`http://127.0.0.1:${match[1]}`);
          }
        });
      });

      const photos = await (await fetch(`${base}/api/photos`)).json();
      assert.equal(photos.photos.length, 1, 'scans the given directory');

      for (const p of [
        '/', '/main.js', '/gallery-math.js',
        '/vendor/three/three.module.js',
        '/vendor/three/three.core.js',
        '/vendor/three-addons/loaders/GLTFLoader.js',
        '/assets/lantern-slim.glb',
        '/assets/gallery-arch.glb',
        '/assets/gallery-waygate.glb',
        '/assets/gallery-paving.glb',
        '/assets/gallery-pines.glb',
        '/assets/gallery-islands.glb',
        '/assets/gallery-frame-corner.glb',
        '/assets/paving-color.jpg',
      ]) {
        const res = await fetch(`${base}${p}`);
        assert.equal(res.status, 200, `${p} serves from the installed package`);
        await res.arrayBuffer();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
