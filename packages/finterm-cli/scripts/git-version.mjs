/**
 * Dynamic version string from git state.
 *
 * Format: <package-version>+g<commit>[-dirty]
 * Examples:
 *   0.0.1+g1a2b3c4       - Clean release from commit 1a2b3c4
 *   0.0.1+g1a2b3c4-dirty - Uncommitted changes present
 *
 * Falls back to DEV_VERSION env var (for pnpm dev script) or package.json version.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Get version from git state or fallback sources.
 */
export function getGitVersion() {
  // Check for dev override first (allows pnpm dev to show current version)
  if (process.env.FINTERM_DEV_VERSION) {
    return process.env.FINTERM_DEV_VERSION;
  }

  try {
    // Get package.json version as base
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const baseVersion = pkg.version || '0.0.0';

    // Get git commit (short hash)
    const commit = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Check for dirty state
    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const dirty = status.length > 0 ? '-dirty' : '';

    return `${baseVersion}+g${commit}${dirty}`;
  } catch {
    // Fallback: read version from package.json only
    try {
      const pkgPath = join(__dirname, '..', 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0-unknown';
    }
  }
}

// When run directly, print the version
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(getGitVersion());
}
