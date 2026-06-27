#!/usr/bin/env tsx

/**
 * Emit the committed `src/api/toolCommandSpec.generated.json` from the live
 * `finterm tool` Commander tree.
 *
 * Usage:
 *   tsx scripts/generate-command-spec.mjs
 *   tsx scripts/generate-command-spec.mjs --check
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFileSync } from 'atomically';
import prettier from 'prettier';

import { createToolCommand } from '../src/cli/commands/tool.js';
import { extractToolCommandSpecs } from '../src/cli/commands/tool-command-spec.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(packageRoot, 'src', 'api', 'toolCommandSpec.generated.json');
const checkOnly = process.argv.includes('--check');

async function formatCommandSpecJson(specs) {
  const config = (await prettier.resolveConfig(outPath)) ?? {};
  return prettier.format(`${JSON.stringify(specs, null, 2)}\n`, { ...config, parser: 'json' });
}

const specs = extractToolCommandSpecs(createToolCommand({ experimental: true }));
const content = await formatCommandSpecJson(specs);
const committed = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;

if (!checkOnly) {
  writeFileSync(outPath, content);
  console.log(`Wrote ${relative(packageRoot, outPath)} (${specs.length} tools)`);
} else if (committed !== content) {
  console.error(`${relative(packageRoot, outPath)} is out of sync with the CLI command tree.`);
  console.error('Run `pnpm --filter @finterm-ai/cli spec:sync` to refresh it.');
  process.exit(1);
} else {
  console.log(`Command spec is in sync (${specs.length} tools).`);
}
