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

test('release headings match exactly and stop at the next release', () => {
  const md = '## [1x2x3]\nWrong release\n\n## [1.2.3] - 2026-01-01\nCorrect release\n\n## [1.2.2]\nOlder release\n';
  assert.equal(extractNotes(md, '1.2.3'), 'Correct release');
  assert.equal(extractNotes('## [1x2x3]\nWrong release\n', '1.2.3'), null);
});

test('prereleases use Unreleased and exclude reference definitions', () => {
  const md = '## [Unreleased]\nNew changes\n\n[Unreleased]: https://example.com/compare\n';
  assert.equal(extractNotes(md, '1.2.3-rc.1'), 'New changes');
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
