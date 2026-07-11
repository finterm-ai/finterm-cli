#!/usr/bin/env node
/**
 * Vendored dataroom package sync and drift gate.
 *
 * The `packages/dataroom` and `packages/dataroom-cli` source trees are
 * VENDORED: their canonical home is the private upstream monorepo, and this
 * repo takes them only via this script. Do not edit the vendored `src/` trees
 * here — open the change upstream and re-sync. See docs/VENDORING.md.
 *
 * Modes:
 *   node scripts/sync-dataroom.mjs --from <path-to-upstream-checkout>
 *     Copy the vendored `src/` trees byte-identical from a local upstream
 *     checkout, then record the upstream ref and per-package content hashes
 *     in vendor-manifest.json. Requires the upstream trees to be git-clean.
 *
 *   node scripts/sync-dataroom.mjs --check
 *     Recompute the content hashes of the vendored trees and fail if they
 *     deviate from vendor-manifest.json. Needs no access to the upstream;
 *     runs in `pnpm ci`, `precommit`, and the release flow.
 *
 * Scope is exactly the `src/` tree of each vendored package. Package
 * manifests, tsconfig, and test-runner configs are repo-specific and are NOT
 * synced; each repo owns its own harness.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const manifestPath = join(repoRoot, 'vendor-manifest.json');

/** Vendored packages, synced `src/`-tree-only. */
const VENDORED_PACKAGES = ['packages/dataroom', 'packages/dataroom-cli'];

const UPSTREAM_DIR_ENV = 'DATAROOM_UPSTREAM_DIR';

function fail(message) {
  console.error(`sync-dataroom: ${message}`);
  process.exit(1);
}

function walkRelative(dir) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else {
        files.push(relative(dir, full).split('\\').join('/'));
      }
    }
  };
  visit(dir);
  return files.sort();
}

function treeHash(dir) {
  const hash = createHash('sha256');
  for (const rel of walkRelative(dir)) {
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(join(dir, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function computeHashes(root) {
  const hashes = {};
  for (const pkg of VENDORED_PACKAGES) {
    const srcDir = join(root, pkg, 'src');
    if (!existsSync(srcDir)) {
      fail(`missing vendored tree: ${pkg}/src`);
    }
    hashes[pkg] = treeHash(srcDir);
  }
  return hashes;
}

function check() {
  if (!existsSync(manifestPath)) {
    fail('vendor-manifest.json is missing; run a sync first (see docs/VENDORING.md)');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const actual = computeHashes(repoRoot);
  const drifted = VENDORED_PACKAGES.filter(
    (pkg) => manifest.packages?.[pkg]?.treeHash !== actual[pkg]
  );
  if (drifted.length > 0) {
    console.error('sync-dataroom: vendored trees deviate from vendor-manifest.json:');
    for (const pkg of drifted) {
      console.error(`  ${pkg}/src`);
    }
    console.error(
      '\nVendored code must not be edited in this repo. Revert the local change,\n' +
        'or make the change upstream and re-run: pnpm dataroom:sync --from <upstream>.\n' +
        'See docs/VENDORING.md.'
    );
    process.exit(1);
  }
  console.log(
    `sync-dataroom: vendored trees match the manifest (upstream ref ${manifest.upstreamRef ?? 'unknown'}).`
  );
}

function sync(fromArg) {
  const from = fromArg ?? process.env[UPSTREAM_DIR_ENV];
  if (!from) {
    fail(`sync mode needs --from <path-to-upstream-checkout> (or ${UPSTREAM_DIR_ENV})`);
  }
  const upstream = resolve(from);
  for (const pkg of VENDORED_PACKAGES) {
    if (!existsSync(join(upstream, pkg, 'src'))) {
      fail(`upstream checkout has no ${pkg}/src: ${upstream}`);
    }
  }

  const srcPaths = VENDORED_PACKAGES.map((pkg) => join(pkg, 'src'));
  const dirty = execFileSync('git', ['-C', upstream, 'status', '--porcelain', '--', ...srcPaths], {
    encoding: 'utf8',
  }).trim();
  if (dirty.length > 0) {
    fail(`upstream vendored trees are not git-clean; commit upstream first:\n${dirty}`);
  }
  const upstreamRef = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

  for (const pkg of VENDORED_PACKAGES) {
    const target = join(repoRoot, pkg, 'src');
    rmSync(target, { recursive: true, force: true });
    cpSync(join(upstream, pkg, 'src'), target, { recursive: true });
  }

  const hashes = computeHashes(repoRoot);
  const manifest = {
    $comment:
      'Vendored-package manifest written by scripts/sync-dataroom.mjs. ' +
      'Do not edit by hand; do not edit the vendored src/ trees (docs/VENDORING.md).',
    upstreamRef,
    scope: 'src',
    packages: Object.fromEntries(VENDORED_PACKAGES.map((pkg) => [pkg, { treeHash: hashes[pkg] }])),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(
    `sync-dataroom: synced ${VENDORED_PACKAGES.join(', ')} at upstream ref ${upstreamRef}.`
  );
}

const args = process.argv.slice(2);
if (args.includes('--check')) {
  check();
} else {
  const fromIndex = args.indexOf('--from');
  sync(fromIndex === -1 ? undefined : args[fromIndex + 1]);
}
