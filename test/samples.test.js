import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'make-sample-photos.js'
);

test('make-sample-photos conjures valid PNG plates', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'winding-samples-'));
  execFileSync(process.execPath, [SCRIPT, out], { stdio: 'pipe' });

  const files = fs.readdirSync(out).filter((f) => f.endsWith('.png'));
  assert.equal(files.length, 8, 'eight plates');

  for (const f of files) {
    const buf = fs.readFileSync(path.join(out, f));
    // PNG signature
    assert.deepEqual(
      [...buf.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${f} signature`
    );
    // IHDR: 1400×900, 8-bit truecolor
    assert.equal(buf.toString('ascii', 12, 16), 'IHDR');
    assert.equal(buf.readUInt32BE(16), 1400, `${f} width`);
    assert.equal(buf.readUInt32BE(20), 900, `${f} height`);
    assert.equal(buf[24], 8, `${f} bit depth`);
    assert.equal(buf[25], 2, `${f} truecolor`);
    // IDAT inflates to exactly h × (1 + w×3) filtered bytes
    const idatStart = buf.indexOf('IDAT', 12, 'ascii');
    const idatLen = buf.readUInt32BE(idatStart - 4);
    const raw = zlib.inflateSync(buf.subarray(idatStart + 4, idatStart + 4 + idatLen));
    assert.equal(raw.length, 900 * (1 + 1400 * 3), `${f} scanlines`);
    // ends with IEND
    assert.equal(buf.toString('ascii', buf.length - 8, buf.length - 4), 'IEND');
  }
  fs.rmSync(out, { recursive: true, force: true });
});
