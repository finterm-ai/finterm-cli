#!/usr/bin/env node
/**
 * Post-build guard: fail the build if any dist artifact imports a private
 * workspace package at runtime.
 *
 * tsdown's `noExternal` bare strings can silently miss subpath imports, which
 * once shipped a binary that resolved raw workspace TypeScript at runtime. The
 * regexes in tsdown.config.ts fix it; this guard keeps it fixed. See
 * plan-2026-06-12-finterm-cli-performance-and-quality.md (P1b).
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '..');
const distDir = join(packageRoot, 'dist');
const repoRoot = resolve(packageRoot, '../..');

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

/** Package names that must never appear as runtime imports in shipped output. */
const FORBIDDEN_IMPORT_PATTERN =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](@arena\/[^"']*|@finterm\/dataroom-lmdb(?:\/[^"']*)?|@finterm\/dataroom-cli(?:\/[^"']*)?|dataroom(?:\/[^"']*)?)["']/g;

const FORBIDDEN_TEXT_TERMS = [
  '@arena/',
  '@finterm/dataroom-lmdb',
  'ai-trade-arena',
  'dxdt-labs',
  'finterm-main',
  '@ai-sdk/',
  'markform',
  'model-pricing',
  'monocart-coverage-reports',
  'tryscript',
  'llm-pricing',
  '@finterm/reports',
  'packages/reports',
  'backtest',
  'backtesting',
  'ticker_data',
  'stock_prices_current',
  'stock_prices_historical',
  'technical_indicators',
  'earnings_reports',
  'earnings_guidance',
  'earnings_calendar',
  'financial_ratios',
  'options_prices',
  'financial_news',
  'global_news_search',
  'sec_company_facts',
  'short_interest',
  'short_volume',
  'FINTOOL_',
  'packages/fintool',
  'tool definition layer',
];
const FORBIDDEN_TEXT_PATTERNS = [/fin-[0-9a-z]{4,}/i];

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

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(child));
    } else {
      files.push(child);
    }
  }
  return files;
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
    return files.map((file) => join(packageRoot, file.path));
  } finally {
    rmSync(npmCacheDir, { recursive: true, force: true });
  }
}

function scanForbiddenText(files, label) {
  const leaks = [];
  for (const file of files) {
    if (!TEXT_FILE_EXTENSIONS.has(extensionOf(file))) {
      continue;
    }
    const content = readFileSync(file, 'utf8');
    const lowerContent = content.toLowerCase();
    for (const term of FORBIDDEN_TEXT_TERMS) {
      if (lowerContent.includes(term.toLowerCase())) {
        leaks.push(`${label}:${repoRelative(file)}: contains forbidden text "${term}"`);
      }
    }
    for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
      if (pattern.test(content)) {
        leaks.push(`${label}:${repoRelative(file)}: contains forbidden pattern ${pattern}`);
      }
    }
  }
  return leaks;
}

const artifacts = readdirSync(distDir).filter(
  (name) => (name.endsWith('.mjs') || name.endsWith('.cjs')) && !name.endsWith('.map')
);

const leaks = [];
for (const name of artifacts) {
  const content = readFileSync(join(distDir, name), 'utf8');
  for (const match of content.matchAll(FORBIDDEN_IMPORT_PATTERN)) {
    leaks.push(`${name}: imports "${match[1]}"`);
  }
}

if (leaks.length > 0) {
  console.error('Bundle leak: dist output imports private workspace packages at runtime:');
  for (const leak of leaks) {
    console.error(`  ${leak}`);
  }
  console.error('Fix the noExternal config in tsdown.config.ts (use subpath regexes).');
  process.exit(1);
}

const packLeaks = scanForbiddenText(packedFiles(), 'npm-pack');
const docsPublicDir = join(repoRoot, 'docs-public');
const docsPublicFiles = existsSync(docsPublicDir) ? walkFiles(docsPublicDir) : [];
const docsLeaks = scanForbiddenText(docsPublicFiles, 'docs-public');

if (packLeaks.length > 0 || docsLeaks.length > 0) {
  console.error('Public artifact text leaks:');
  for (const leak of [...packLeaks, ...docsLeaks]) {
    console.error(`  ${leak}`);
  }
  process.exit(1);
}

console.log(
  `No bundle leaks in ${artifacts.length} dist artifacts; npm pack and docs-public text are clean.`
);
