/**
 * Resolve the bundled `dist/` directory (where `docs/` ships) for every
 * doc-serving command (`skill`, `docs`, `prime`, `resources`, `setup`).
 *
 * Resolution order matters for installed correctness (fin-pc0e):
 *
 * 1. This module's own location — in the built package this code lives in a
 *    chunk at `dist/`, so `import.meta.url` is authoritative regardless of how
 *    the process was launched.
 * 2. The script path (`process.argv[1]`), raw and then realpathed — a global
 *    npm install invokes the CLI through a bin symlink
 *    (`.../bin/finterm -> .../dist/bin-bootstrap.cjs`), so the symlink must be
 *    resolved before its directory can be recognized as `dist`.
 * 3. A cwd-relative repo path, so source runs (tsx) keep working in dev.
 */

import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function isDistDir(dir: string): boolean {
  return dir.endsWith('/dist') || dir.endsWith('\\dist');
}

/** realpathSync that returns null instead of throwing (path may not exist). */
function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

export function getDistDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  if (isDistDir(moduleDir)) {
    return moduleDir;
  }

  const scriptPath = process.argv[1] || '';
  const candidates = scriptPath ? [scriptPath, safeRealpath(scriptPath)] : [];
  for (const candidate of candidates) {
    if (candidate && isDistDir(dirname(candidate))) {
      return dirname(candidate);
    }
  }

  return join(process.cwd(), 'packages', 'finterm-cli', 'dist');
}
