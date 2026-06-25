/* global __dirname, console, process */
/**
 * CLI bootstrap entry point (CommonJS).
 *
 * This file MUST be CommonJS so it executes before any ESM module loading.
 * It enables Node's compile cache for faster subsequent runs, then loads the real CLI.
 *
 * Why CJS? ESM static imports are resolved before module code runs, so calling
 * enableCompileCache() in an ESM file is "too late" - the heavy deps are already
 * being parsed. A CJS bootstrap lets us enable caching BEFORE the ESM import.
 */
'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MIN_NODE_VERSION = [22, 12, 0];

function isSupportedNodeVersion(version) {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < MIN_NODE_VERSION.length; index += 1) {
    const actual = parts[index] ?? 0;
    const required = MIN_NODE_VERSION[index];
    if (actual > required) return true;
    if (actual < required) return false;
  }
  return true;
}

if (!isSupportedNodeVersion(process.versions.node)) {
  console.error(`finterm requires Node.js >=22.12.0; current Node.js is ${process.versions.node}.`);
  console.error('Upgrade Node.js, then reinstall or rerun finterm.');
  process.exit(1);
}

// Enable compile cache BEFORE loading any ESM modules.
// This caches compiled bytecode on disk for faster subsequent runs.
// Available in Node 22.8.0+, gracefully ignored in older versions.
try {
  const mod = require('node:module');
  if (typeof mod.enableCompileCache === 'function') {
    mod.enableCompileCache();
  }
} catch {
  // Silently ignore - caching is an optimization, not required.
}

// Load the bundled CLI binary (ESM with all deps bundled for fast startup).
// bin.mjs runs runCli() as a side effect when imported. A load failure here
// (corrupt install, missing chunk) must surface as a clean error, not an
// UnhandledPromiseRejection dump.
const binPath = path.join(__dirname, 'bin.mjs');
import(pathToFileURL(binPath).href).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`finterm failed to start: ${message}`);
  console.error(
    'Reinstalling the package may fix a corrupt install: npm install -g @finterm-ai/cli'
  );
  process.exit(1);
});
