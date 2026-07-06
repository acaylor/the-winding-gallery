import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanPhotos, safeJoin, createGalleryServer, IMAGE_EXTS } from '../server.js';

// ── unit: safeJoin ──────────────────────────────────────────────────
test('safeJoin resolves inside the root', () => {
  assert.equal(safeJoin('/gallery', 'a/b.jpg'), path.resolve('/gallery/a/b.jpg'));
  assert.equal(safeJoin('/gallery', ''), '/gallery');
});

test('safeJoin blocks traversal, encoded traversal and bad escapes', () => {
  assert.equal(safeJoin('/gallery', '../secret'), null);
  assert.equal(safeJoin('/gallery', 'a/../../secret'), null);
  assert.equal(safeJoin('/gallery', '%2e%2e/secret'), null);
  assert.equal(safeJoin('/gallery', '%zz'), null, 'malformed escape must not throw');
});

// ── unit: scanPhotos ────────────────────────────────────────────────
test('scanPhotos finds images recursively, sorted, skipping noise', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winding-scan-'));
  fs.writeFileSync(path.join(dir, 'b-dusk.jpg'), 'x');
  fs.writeFileSync(path.join(dir, 'a-dawn.png'), 'x');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(dir, '.hidden.jpg'), 'x');
  fs.mkdirSync(path.join(dir, 'trip one'));
  fs.writeFileSync(path.join(dir, 'trip one', 'firth & fell.webp'), 'x');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'sneaky.jpg'), 'x');

  const photos = await scanPhotos(dir);
  assert.deepEqual(photos.map((p) => p.name), ['a-dawn', 'b-dusk', 'firth & fell']);
  const sub = photos.find((p) => p.name === 'firth & fell');
  assert.equal(sub.src, '/photos/trip%20one/firth%20%26%20fell.webp', 'src is URL-encoded');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scanPhotos of a missing directory is empty, not an error', async () => {
  assert.deepEqual(await scanPhotos('/no/such/directory'), []);
});

test('IMAGE_EXTS covers the formats browsers can hang', () => {
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']) {
    assert.ok(IMAGE_EXTS.has(ext), ext);
  }
  assert.ok(!IMAGE_EXTS.has('.heic'), 'HEIC cannot be decoded by browsers');
});

// ── integration: the HTTP server ────────────────────────────────────
let server, base, photoDir;

before(async () => {
  photoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winding-http-'));
  fs.writeFileSync(path.join(photoDir, 'plate.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  server = createGalleryServer(photoDir);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(photoDir, { recursive: true, force: true });
});

test('GET / serves the gallery page', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /The Winding Gallery/);
});

test('GET /api/photos lists the collection', async () => {
  const res = await fetch(`${base}/api/photos`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.dir, photoDir);
  assert.deepEqual(data.photos, [{ name: 'plate', src: '/photos/plate.png' }]);
});

test('GET /photos/<file> streams the image with its mime type', async () => {
  const res = await fetch(`${base}/photos/plate.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal((await res.arrayBuffer()).byteLength, 4);
});

test('path traversal is rejected', async () => {
  for (const evil of ['/photos/%2e%2e/%2e%2e/etc/passwd', '/photos/%2e%2e%2fserver.js']) {
    const res = await fetch(`${base}${evil}`);
    assert.ok(res.status === 403 || res.status === 404, `${evil} → ${res.status}`);
  }
});

test('vendored three.js and addons are served', async () => {
  for (const p of ['/vendor/three/three.module.js', '/vendor/three-addons/loaders/GLTFLoader.js']) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), /javascript/);
    await res.arrayBuffer();
  }
});

test('unknown files 404', async () => {
  assert.equal((await fetch(`${base}/no-such-page.html`)).status, 404);
});
