#!/usr/bin/env node
/**
 * Public-boundary guard (allowlist-only).
 *
 * This check asserts what the public repo SHOULD contain rather than scanning
 * for a list of forbidden terms. It verifies:
 *   1. The shipped API doc set is exactly the expected published tools.
 *   2. No publishable (non-private) package manifest depends on a workspace
 *      package — published deps must resolve from the public registry.
 *   3. No file matches a generic credential shape (AWS/GitHub/OpenAI keys or a
 *      PEM private key block).
 *
 * On success it prints a single summary line; on failure it prints the
 * offending items and exits non-zero.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const selfPath = normalize(relative(root, fileURLToPath(import.meta.url)));

// The secret scan reads its own source and its sibling guard, both of which
// contain the credential-shape regexes as string literals. Skip them so the
// patterns that define the check do not trip the check.
const secretScanAllowlist = new Set([
  selfPath,
  'packages/finterm-cli/scripts/check-bundle-leaks.mjs',
]);

// Exactly these public tool docs must be present, each marked published.
const expectedApiDocs = [
  'financial_statements.api.md',
  'insider_trades.api.md',
  'institutional_holdings.api.md',
  'options_overview.api.md',
  'options_sentiment.api.md',
  'sec_filing_diff.api.md',
  'sec_filing_fetch.api.md',
  'sec_filings_search.api.md',
  'stock_prices_current.api.md',
  'technical_indicators.api.md',
  'ticker_data.api.md',
  'ticker_sentiment.api.md',
].sort();

// Generic credential shapes. Intentionally pattern-only: no project-specific
// vocabulary, so the check reveals nothing about what it is guarding against.
const secretPatterns = [
  { label: 'AWS access key id', regex: /AKIA[0-9A-Z]{16}/ },
  { label: 'GitHub token', regex: /gh[pousr]_[0-9A-Za-z]{20,}/ },
  { label: 'OpenAI-style API key', regex: /sk-[A-Za-z0-9]{20,}/ },
  { label: 'PEM private key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const textExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.txt',
  '.yml',
  '.yaml',
]);

function normalize(path) {
  return path.split('\\').join('/');
}

function walk(path) {
  if (!existsSync(path)) {
    return [];
  }
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    return [path];
  }
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (
      entry.name === '.git' ||
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'coverage'
    ) {
      continue;
    }
    files.push(...walk(join(path, entry.name)));
  }
  return files;
}

function isTextFile(path) {
  return textExtensions.has(extname(path));
}

function readPublicationState(path) {
  const text = readFileSync(path, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return match?.[1]?.match(/^\s*publication_state:\s*([a-z_]+)\s*$/m)?.[1] ?? null;
}

const files = walk(root);
const violations = [];

// 1. API doc set must match exactly, all published.
const apiDir = join(root, 'packages/finterm-cli/src/api');
const apiDocs = readdirSync(apiDir)
  .filter((file) => file.endsWith('.api.md'))
  .sort();
if (JSON.stringify(apiDocs) !== JSON.stringify(expectedApiDocs)) {
  violations.push(
    `published API docs mismatch: expected ${expectedApiDocs.join(', ')}, got ${apiDocs.join(', ')}`
  );
}
for (const apiDoc of apiDocs) {
  const state = readPublicationState(join(apiDir, apiDoc));
  if (state !== 'published') {
    violations.push(`packages/finterm-cli/src/api/${apiDoc}: publication_state is ${state}`);
  }
}

// 2. Publishable manifests must not depend on workspace packages.
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
for (const file of files) {
  if (normalize(file).split('/').pop() !== 'package.json') {
    continue;
  }
  const rel = normalize(relative(root, file));
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    violations.push(`${rel}: invalid JSON (${error.message})`);
    continue;
  }
  if (manifest.private === true) {
    // Private manifests are never published, so workspace links are expected.
    continue;
  }
  for (const field of dependencyFields) {
    const deps = manifest[field];
    if (!deps || typeof deps !== 'object') {
      continue;
    }
    for (const [name, value] of Object.entries(deps)) {
      if (typeof value === 'string' && value.startsWith('workspace:')) {
        violations.push(
          `${rel}: ${field}.${name} resolves to "${value}" (not a public registry version)`
        );
      }
    }
  }
}

// 3. Generic credential-shape scan over text files.
for (const file of files) {
  const rel = normalize(relative(root, file));
  if (secretScanAllowlist.has(rel) || !isTextFile(file)) {
    continue;
  }
  const text = readFileSync(file, 'utf8');
  for (const { label, regex } of secretPatterns) {
    if (regex.test(text)) {
      violations.push(`${rel}: matches ${label} pattern`);
    }
  }
}

if (violations.length > 0) {
  console.error('Public boundary violations:');
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}

console.log(`Public boundary clean (${files.length} files scanned).`);
