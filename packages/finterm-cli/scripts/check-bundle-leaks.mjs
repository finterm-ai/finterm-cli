#!/usr/bin/env node
/**
 * Post-build bundle guard (allowlist-only).
 *
 * Verifies the shipped output stays within the public runtime surface:
 *   1. Every bare import/require specifier in the dist artifacts is a relative
 *      path, a node: builtin, or a known public runtime dependency. Bundling
 *      can miss a subpath import and ship a specifier that does not resolve for
 *      a plain-node consumer; this catches any unexpected bare specifier
 *      without enumerating disallowed ones.
 *   2. No file in the npm pack dry-run contains a generic credential shape
 *      (AWS/GitHub/OpenAI keys or a PEM private key).
 *
 * On success it prints a single summary line.
 */

import { isBuiltin } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '..');
const distDir = join(packageRoot, 'dist');
const repoRoot = resolve(packageRoot, '../..');

// Known public runtime dependencies that may legitimately appear as bare
// specifiers in bundled output (the package's own deps plus public transitive
// deps that bundling pulls in by value).
const BASE_ALLOWED_SPECIFIERS = [
  'commander',
  'picocolors',
  'marked',
  'marked-terminal',
  'yaml',
  'atomically',
  'open',
  'undici',
  'zod',
  'slugify',
  'cli-highlight',
  'chalk',
  'color-convert',
];

// Generic credential shapes. Pattern-only by design.
const SECRET_PATTERNS = [
  { label: 'AWS access key id', regex: /AKIA[0-9A-Z]{16}/ },
  { label: 'GitHub token', regex: /gh[pousr]_[0-9A-Za-z]{20,}/ },
  { label: 'OpenAI-style API key', regex: /sk-[A-Za-z0-9]{20,}/ },
  { label: 'PEM private key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const TEXT_FILE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.d.cts',
  '.d.mts',
  '.js',
  '.json',
  '.md',
  '.mdx',
  '.mjs',
  '.mts',
  '.ts',
  '.txt',
  '.yml',
  '.yaml',
]);

// Bare specifier in `from "x"`, `import("x")`, or `require("x")` (either quote).
const SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(["'])([^"']+)\1/g;

function repoRelative(path) {
  return relative(repoRoot, path).split('\\').join('/');
}

function extensionOf(path) {
  for (const ext of ['.d.cts', '.d.mts']) {
    if (path.endsWith(ext)) {
      return ext;
    }
  }
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
}

/** Package name of a bare specifier (handles scoped names and subpaths). */
function packageNameOf(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

function isRelative(specifier) {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

function loadAllowedSpecifiers() {
  const allowed = new Set(BASE_ALLOWED_SPECIFIERS);
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    allowed.add(name);
  }
  return allowed;
}

function packedFiles() {
  const npmCacheDir = mkdtempSync(join(tmpdir(), 'finterm-npm-pack-'));
  try {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: packageRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: npmCacheDir,
      },
    });
    const parsed = JSON.parse(output);
    const files = parsed[0]?.files;
    if (!Array.isArray(files)) {
      throw new Error('Could not read npm pack dry-run file list.');
    }
    return files.map((file) => ({ packPath: file.path, absPath: join(packageRoot, file.path) }));
  } finally {
    rmSync(npmCacheDir, { recursive: true, force: true });
  }
}

function scanSecrets(files, label) {
  const leaks = [];
  for (const file of files) {
    if (!TEXT_FILE_EXTENSIONS.has(extensionOf(file))) {
      continue;
    }
    const content = readFileSync(file, 'utf8');
    for (const { label: patternLabel, regex } of SECRET_PATTERNS) {
      if (regex.test(content)) {
        leaks.push(`${label}:${repoRelative(file)}: matches ${patternLabel} pattern`);
      }
    }
  }
  return leaks;
}

const allowedSpecifiers = loadAllowedSpecifiers();

// 1. Every bare specifier in dist artifacts must be allowed.
const artifacts = readdirSync(distDir).filter(
  (name) => (name.endsWith('.mjs') || name.endsWith('.cjs')) && !name.endsWith('.map')
);

const importLeaks = [];
for (const name of artifacts) {
  const content = readFileSync(join(distDir, name), 'utf8');
  const seen = new Set();
  for (const match of content.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[2];
    if (isRelative(specifier) || isBuiltin(specifier)) {
      continue;
    }
    if (allowedSpecifiers.has(packageNameOf(specifier))) {
      continue;
    }
    const key = `${name}::${specifier}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    importLeaks.push(`${name}: unexpected bare import "${specifier}"`);
  }
}

if (importLeaks.length > 0) {
  console.error('Bundle leak: dist output imports specifiers outside the public allowlist:');
  for (const leak of importLeaks) {
    console.error(`  ${leak}`);
  }
  console.error(
    'Add the dependency to package.json, or bundle it via noExternal in tsdown.config.ts.'
  );
  process.exit(1);
}

// 2. npm pack content carries no credential-shaped strings. The published file
// set itself is governed by the package.json "files" allowlist; this scans the
// shipped content, not file types.
const packed = packedFiles();
const packSecretLeaks = scanSecrets(
  packed.map((file) => file.absPath),
  'npm-pack'
);

if (packSecretLeaks.length > 0) {
  console.error('Public artifact issues:');
  for (const issue of packSecretLeaks) {
    console.error(`  ${issue}`);
  }
  process.exit(1);
}

console.log(
  `No bundle leaks in ${artifacts.length} dist artifacts; npm pack ships ${packed.length} clean files.`
);
