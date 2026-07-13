#!/usr/bin/env node

/**
 * Print the GitHub Release notes for a version: the body of the matching "## X.Y.Z"
 * section of the repo-root CHANGELOG.md, heading line omitted (the release title
 * already carries the version).
 *
 * Usage: node scripts/extract-changelog.mjs <version> [changelog-path]
 *
 * Invoked by .github/workflows/release.yml twice: in the publish job as a pre-publish
 * guard (a tagged version with no changelog section fails before anything uploads to
 * npm), and in the github-release job to build the release body. Exits non-zero when
 * the section is missing or empty: every release ships written notes; there is no
 * generic "Release vX.Y.Z" fallback body.
 *
 * The extraction logic is exported and unit-tested (tests/extract-changelog.test.ts)
 * rather than inlined in workflow shell, so it can be run and debugged locally.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Repo-root CHANGELOG.md, resolved from this script's location so cwd never matters.
const DEFAULT_CHANGELOG = join(__dirname, '..', '..', '..', 'CHANGELOG.md');

/**
 * Return the notes under the `## <version>` heading: every line after the heading up
 * to (but not including) the next `## <digit...>` heading, surrounding blank lines
 * trimmed. Returns null when the heading is not found, and an empty string when the
 * heading exists but has no notes under it.
 *
 * The heading is matched literally (not as a regex), so the dots in a version cannot
 * match arbitrary characters and prerelease ids like `1.0.0-rc.1` need no escaping.
 */
export function extractChangelogSection(changelog, version) {
  const heading = `## ${version}`;
  const lines = changelog.split(/\r?\n/);

  const start = lines.findIndex((line) => line.trimEnd() === heading);
  if (start === -1) return null;

  const collected = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## [0-9]/.test(lines[i] ?? '')) break;
    collected.push(lines[i] ?? '');
  }
  while (collected.length > 0 && (collected[0] ?? '').trim() === '') {
    collected.shift();
  }
  while (collected.length > 0 && (collected[collected.length - 1] ?? '').trim() === '') {
    collected.pop();
  }
  return collected.join('\n');
}

function main(argv) {
  const [version, changelogPath = DEFAULT_CHANGELOG] = argv;
  if (!version) {
    console.error('Usage: extract-changelog.mjs <version> [changelog-path]');
    process.exit(2);
  }
  const section = extractChangelogSection(readFileSync(changelogPath, 'utf-8'), version);
  if (section === null || section === '') {
    console.error(
      `No "## ${version}" section with notes in ${changelogPath}; ` +
        `write the CHANGELOG entry before releasing.`
    );
    process.exit(1);
  }
  process.stdout.write(section + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
