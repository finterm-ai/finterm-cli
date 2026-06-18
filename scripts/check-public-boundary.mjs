#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const selfPath = normalize(relative(root, fileURLToPath(import.meta.url)));
const scannerAllowlist = new Set([selfPath, 'packages/finterm-cli/scripts/check-bundle-leaks.mjs']);

const publishedApiDocs = [
  'financial_statements.api.md',
  'insider_trades.api.md',
  'institutional_holdings.api.md',
  'options_overview.api.md',
  'options_sentiment.api.md',
  'sec_filing_diff.api.md',
  'sec_filing_fetch.api.md',
  'sec_filings_search.api.md',
  'ticker_sentiment.api.md',
].sort();

const forbiddenPaths = [
  '.tool.md',
  'packages/fintool',
  'packages/fintool-cli',
  'packages/dataroom-lmdb',
  'src/cli/forms',
  'src/cli/commands/cache.ts',
  'src/cli/commands/dev.ts',
  'src/cli/commands/form.ts',
  'src/cli/commands/reports.ts',
  'src/cli/commands/research.ts',
  'src/cli/lib/research',
  'src/lib/__mocks__',
];

const forbiddenText = [
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

for (const file of files) {
  const rel = normalize(relative(root, file));
  if (scannerAllowlist.has(rel)) {
    continue;
  }
  for (const forbiddenPath of forbiddenPaths) {
    if (rel.includes(forbiddenPath)) {
      violations.push(`${rel}: forbidden path fragment "${forbiddenPath}"`);
    }
  }
  if (!isTextFile(file)) {
    continue;
  }
  const text = readFileSync(file, 'utf8');
  const lowerText = text.toLowerCase();
  for (const term of forbiddenText) {
    if (lowerText.includes(term.toLowerCase())) {
      violations.push(`${rel}: forbidden text "${term}"`);
    }
  }
}

const apiDir = join(root, 'packages/finterm-cli/src/api');
const apiDocs = readdirSync(apiDir)
  .filter((file) => file.endsWith('.api.md'))
  .sort();
if (JSON.stringify(apiDocs) !== JSON.stringify(publishedApiDocs)) {
  violations.push(
    `published API docs mismatch: expected ${publishedApiDocs.join(', ')}, got ${apiDocs.join(', ')}`
  );
}
for (const apiDoc of apiDocs) {
  const state = readPublicationState(join(apiDir, apiDoc));
  if (state !== 'published') {
    violations.push(`packages/finterm-cli/src/api/${apiDoc}: publication_state is ${state}`);
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
