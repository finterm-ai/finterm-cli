/**
 * The `finterm` dev launcher: everything `bin/finterm` does except start.
 *
 * NOT the published entry: package.json `bin` stays `dist/bin-bootstrap.cjs`, because
 * npm ships a built artifact with no source tree to fall back to. This is for working
 * inside the repo, where there is one.
 *
 * It exists because neither existing dev path is both fast and fresh. `pnpm finterm`
 * used to run tsx against src, always current but paying the transform every time;
 * `pnpm finterm:bin` rebuilds before every invocation. This runs the bundle when no
 * bundled source is newer than it, and falls back to tsx when something is.
 *
 * Both branches run in this process: the bundle is imported directly, and tsx is
 * registered through its programmatic API rather than exec'd, so dispatch costs no
 * second Node startup either way. `FINTERM_FORCE_TSX=1` pins the source path.
 *
 * This module holds the logic so tests can import it without starting a CLI;
 * `bin/finterm` imports it and starts unconditionally, which keeps the entry correct
 * however it is reached — direct path, symlink, or `.bin` shim.
 */

import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.join(here, '..');
const PACKAGES_DIR = path.join(PKG_DIR, '..');
const DIST_BIN = path.join(PKG_DIR, 'dist', 'bin.mjs');
const SRC_BIN = path.join(PKG_DIR, 'src', 'cli', 'bin.ts');

// Every workspace package tsdown bundles into dist — kept in sync with
// tsdown.config.ts `workspaceNoExternal`. An edit to any of them changes the bundle,
// so each must invalidate it.
const BUNDLED_PACKAGE_DIRS = [
  PKG_DIR,
  path.join(PACKAGES_DIR, 'dataroom'),
  path.join(PACKAGES_DIR, 'dataroom-cli'),
];

/**
 * Whether any `.ts` under `dir` is newer than `mtimeMs`.
 *
 * Returns on the first hit rather than walking the whole tree, and treats an unreadable
 * path as newer, so a checkout it cannot verify falls back to source rather than running
 * a bundle on faith.
 */
export function hasSourceNewerThan(dir, mtimeMs) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasSourceNewerThan(full, mtimeMs)) {
        return true;
      }
      continue;
    }
    if (!entry.name.endsWith('.ts')) {
      continue;
    }
    try {
      if (fs.statSync(full).mtimeMs > mtimeMs) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

/** Whether the bundle exists and no source in any bundled package is newer than it. */
export function distIsFresh(distBin = DIST_BIN, sourceDirs = BUNDLED_PACKAGE_DIRS) {
  let builtAt;
  try {
    builtAt = fs.statSync(distBin).mtimeMs;
  } catch {
    return false;
  }
  return sourceDirs.every((dir) => !hasSourceNewerThan(path.join(dir, 'src'), builtAt));
}

export async function startCli() {
  // Before the bundle is imported, so its compiled bytecode is cached for later runs.
  try {
    module.enableCompileCache?.();
  } catch {
    // Caching is an optimization, not a requirement.
  }

  const useDist = process.env['FINTERM_FORCE_TSX'] !== '1' && distIsFresh();
  if (!useDist) {
    const { register } = await import('tsx/esm/api');
    register();
  }
  await import(pathToFileURL(useDist ? DIST_BIN : SRC_BIN).href);
}
