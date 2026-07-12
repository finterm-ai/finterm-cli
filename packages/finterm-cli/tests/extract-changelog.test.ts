/**
 * Tests for the release-notes extractor (scripts/extract-changelog.mjs), which
 * .github/workflows/release.yml uses to gate publishing on a written CHANGELOG entry
 * and to build the GitHub Release body.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractChangelogSection } from '../scripts/extract-changelog.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/extract-changelog.mjs', import.meta.url));
const REPO_CHANGELOG = fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url));

const CHANGELOG = [
  '# Changelog',
  '',
  '## 0.2.0',
  '',
  '### Fixes',
  '',
  '- First fix',
  '- Second fix',
  '',
  '### Improvements',
  '',
  '- One improvement',
  '',
  '## 0.1.30',
  '',
  '- Older notes',
  '',
  '## 0.1.0',
  '',
  '- First release',
  '',
].join('\n');

describe('extractChangelogSection', () => {
  it('returns the whole section body and stops before the next version heading', () => {
    const body = extractChangelogSection(CHANGELOG, '0.2.0');
    expect(body).toContain('### Fixes');
    expect(body).toContain('- First fix');
    expect(body).toContain('### Improvements');
    expect(body).toContain('- One improvement');
    expect(body).not.toContain('## 0.1.30');
    expect(body).not.toContain('- Older notes');
  });

  it('omits the version heading itself (the release title already carries it)', () => {
    const body = extractChangelogSection(CHANGELOG, '0.2.0');
    expect(body?.split('\n')[0]).toBe('### Fixes');
  });

  it('extracts a middle section bounded by the next version heading', () => {
    expect(extractChangelogSection(CHANGELOG, '0.1.30')).toBe('- Older notes');
  });

  it('extracts the last section in the file, trailing blank lines trimmed', () => {
    expect(extractChangelogSection(CHANGELOG, '0.1.0')).toBe('- First release');
  });

  it('returns null for a version that has no section', () => {
    expect(extractChangelogSection(CHANGELOG, '9.9.9')).toBeNull();
  });

  it('matches the heading literally so dots are not regex wildcards', () => {
    // "0x2y0" must not match the "## 0.2.0" heading.
    expect(extractChangelogSection(CHANGELOG, '0x2y0')).toBeNull();
  });

  it('handles prerelease version headings', () => {
    const prerelease = ['## 1.0.0-rc.1', '', '- Release candidate', ''].join('\n');
    expect(extractChangelogSection(prerelease, '1.0.0-rc.1')).toBe('- Release candidate');
  });

  it('handles CRLF line endings', () => {
    const crlf = CHANGELOG.replace(/\n/g, '\r\n');
    expect(extractChangelogSection(crlf, '0.1.0')).toBe('- First release');
  });

  it('returns an empty string for a heading with no notes under it', () => {
    const empty = ['## 2.0.0', '', '## 1.0.0', '', '- notes', ''].join('\n');
    expect(extractChangelogSection(empty, '2.0.0')).toBe('');
  });
});

// Exercise the CLI entry the release workflow actually runs (exit codes and streams),
// not just the exported function.
describe('extract-changelog.mjs (CLI)', () => {
  function run(args: string[], cwd?: string) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8', cwd });
  }

  function withTempChangelog(content: string, fn: (path: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'finterm-changelog-'));
    try {
      const changelog = join(dir, 'CHANGELOG.md');
      writeFileSync(changelog, content);
      fn(changelog);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('prints the notes for a version present in the changelog', () => {
    withTempChangelog('## 1.2.3\n\n- A change\n\n## 1.2.2\n\n- old\n', (changelog) => {
      const res = run(['1.2.3', changelog]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('- A change');
      expect(res.stdout).not.toContain('1.2.2');
    });
  });

  it('fails when the version has no changelog section', () => {
    withTempChangelog('## 1.0.0\n\n- only release\n', (changelog) => {
      const res = run(['9.9.9', changelog]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('No "## 9.9.9" section');
    });
  });

  it('fails when the version heading exists but has no notes', () => {
    withTempChangelog('## 2.0.0\n\n## 1.0.0\n\n- notes\n', (changelog) => {
      expect(run(['2.0.0', changelog]).status).toBe(1);
    });
  });

  it('fails with usage when no version is given', () => {
    const res = run([]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Usage:');
  });

  // The release workflow runs the script against the version being tagged. This pins
  // the repo invariant behind it: the version in package.json always has written
  // notes, so a release PR that bumps the version without a CHANGELOG entry fails CI
  // here instead of failing the release.
  it('finds notes for the current package.json version in the real CHANGELOG.md', () => {
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
    ) as { version: string };
    const res = run([version, REPO_CHANGELOG]);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).not.toBe('');
  });

  it('defaults to the repo-root CHANGELOG.md regardless of cwd', () => {
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
    ) as { version: string };
    const res = run([version], tmpdir());
    expect(res.status).toBe(0);
  });
});
