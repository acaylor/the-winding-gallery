// Extract release notes for a version from CHANGELOG.md (Keep a Changelog).
//
//   node scripts/changelog-notes.js 0.2.0            → the [0.2.0] section
//   node scripts/changelog-notes.js 0.3.0-rc.1       → the [Unreleased] section
//   node scripts/changelog-notes.js v0.2.0 other.md  → optional file override
//
// Stable versions REQUIRE a non-empty section (exit 1 otherwise) — the
// publish workflow runs this before `npm publish`, so a stable release
// cannot ship without its changelog entry. Prereleases fall back to a
// stub if Unreleased is empty.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function extractNotes(markdown, ver) {
  const isPrerelease = ver.includes('-');
  const heading = isPrerelease ? 'Unreleased' : ver;
  // section runs from its "## [heading]" line to the next "## [" or the link refs
  const re = new RegExp(
    `^## \\[${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[|(?![\\s\\S]))`,
    'm'
  );
  const m = markdown.match(re);
  const body = m ? m[1].trim() : '';
  if (!body) {
    if (isPrerelease) return `Prerelease \`${ver}\` — see the Unreleased section of CHANGELOG.md.`;
    return null;
  }
  return body;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = (process.argv[2] || '').replace(/^v/, '');
  const file = process.argv[3]
    || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md');

  if (!version) {
    console.error('usage: changelog-notes.js <version> [changelog-file]');
    process.exit(2);
  }
  const notes = extractNotes(fs.readFileSync(file, 'utf8'), version);
  if (notes === null) {
    console.error(
      `CHANGELOG.md has no non-empty "## [${version}]" section — ` +
      'add one before tagging a stable release.'
    );
    process.exit(1);
  }
  console.log(notes);
}
