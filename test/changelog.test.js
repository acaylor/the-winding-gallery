import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractNotes } from '../scripts/changelog-notes.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO, 'scripts', 'changelog-notes.js');
const changelog = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');

test('the real CHANGELOG.md has non-empty sections for every published release', () => {
  for (const v of ['0.1.0', '0.2.0']) {
    const notes = extractNotes(changelog, v);
    assert.ok(notes && notes.length > 100, `[${v}] section present and substantial`);
    assert.ok(!notes.includes('## ['), `[${v}] section does not bleed into the next`);
  }
});

test('prerelease versions read the Unreleased section', () => {
  const notes = extractNotes(changelog, '0.3.0-rc.1');
  assert.ok(notes.length > 0);
  assert.ok(!notes.includes('[0.2.0]'), 'stops before the released sections');
});

test('a stable version missing from the changelog is a hard failure', () => {
  assert.equal(extractNotes(changelog, '9.9.9'), null);
  const r = (() => {
    try {
      execFileSync(process.execPath, [SCRIPT, '9.9.9'], { stdio: 'pipe' });
      return 0;
    } catch (e) {
      return e.status;
    }
  })();
  assert.equal(r, 1, 'CLI exits 1 so the publish workflow stops');
});

test('an empty Unreleased section still yields prerelease stub notes', () => {
  const md = '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- x\n';
  const notes = extractNotes(md, '1.1.0-rc.1');
  assert.match(notes, /Prerelease `1\.1\.0-rc\.1`/);
});

test('the CLI prints a version section and strips a leading v', () => {
  const out = execFileSync(process.execPath, [SCRIPT, 'v0.2.0'], { encoding: 'utf8' });
  assert.match(out, /Keeper's Tour/);
  assert.match(out, /### Fixed/);
});
