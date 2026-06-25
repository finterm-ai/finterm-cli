#!/usr/bin/env node

/**
 * Generate the CLI's tool-definition module from the package's committed `.api.md`
 * files. The public CLI repo is self-contained: this script never reads fintool or
 * any private repository checkout.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFileSync } from 'atomically';
import prettier from 'prettier';
import { parse as parseYaml } from 'yaml';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(packageRoot, 'src', 'api');
const definitionsModulePath = join(apiDir, 'toolDefinitions.generated.ts');
const checkOnly = process.argv.includes('--check');

function apiMdFiles(dir) {
  if (!existsSync(dir)) {
    throw new Error(`Missing API docs directory: ${dir}`);
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith('.api.md'))
    .sort();
}

/** Parse the `definition` block out of one `.api.md` file's YAML frontmatter. */
function apiDocDefinition(path) {
  const text = readFileSync(path, 'utf8');
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!match) {
    throw new Error(`${path} is missing YAML frontmatter`);
  }
  const frontmatter = parseYaml(match[1] ?? '');
  return frontmatter?.definition;
}

function readDefinitionEntry(file) {
  const definition = apiDocDefinition(join(apiDir, file));
  if (!definition || definition.publication_state === 'unpublished') {
    return null;
  }

  const fields = ['tool_id', 'title', 'summary', 'publication_state'];
  for (const field of fields) {
    if (typeof definition[field] !== 'string' || definition[field].length === 0) {
      throw new Error(`${file} is missing definition.${field}`);
    }
  }

  return {
    id: definition.tool_id,
    title: definition.title,
    summary: definition.summary,
  };
}

async function buildToolDefinitionsModule(files) {
  const entries = [];
  const seen = new Set();

  for (const file of files) {
    const entry = readDefinitionEntry(file);
    if (!entry) {
      continue;
    }
    if (seen.has(entry.id)) {
      throw new Error(`Duplicate API definition for tool id: ${entry.id}`);
    }
    seen.add(entry.id);
    entries.push(entry);
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));

  const lines = [
    '/**',
    ' * GENERATED - do not edit. Source of truth:',
    ' *   packages/finterm-cli/src/api/<tool>.api.md (definition.title / .summary)',
    ' *',
    ' * Canonical tool titles and summaries mirrored from the committed `.api.md`',
    ' * definitions so CLI help and generated docs read one description per tool.',
    ' */',
    '',
    'export interface FintermToolDefinition {',
    '  readonly title: string;',
    '  readonly summary: string;',
    '}',
    '',
    'export const FINTERM_TOOL_DEFINITIONS: Record<string, FintermToolDefinition> = {',
  ];

  for (const entry of entries) {
    lines.push(`  ${entry.id}: {`);
    lines.push(`    title: ${JSON.stringify(entry.title)},`);
    lines.push(`    summary: ${JSON.stringify(entry.summary)},`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');

  const config = (await prettier.resolveConfig(definitionsModulePath)) ?? {};
  return prettier.format(lines.join('\n'), { ...config, parser: 'typescript' });
}

const files = apiMdFiles(apiDir);
if (files.length === 0) {
  throw new Error(`No .api.md files found in ${apiDir}`);
}

const definitionsModule = await buildToolDefinitionsModule(files);
const committedModule = existsSync(definitionsModulePath)
  ? readFileSync(definitionsModulePath, 'utf8')
  : null;
const moduleDrift = committedModule !== definitionsModule;

if (!checkOnly) {
  mkdirSync(apiDir, { recursive: true });
  writeFileSync(definitionsModulePath, definitionsModule);
  console.log(`Wrote ${relative(packageRoot, definitionsModulePath)}`);
} else if (moduleDrift) {
  console.error(`${relative(packageRoot, definitionsModulePath)} is out of sync with .api.md.`);
  console.error('Run `pnpm --filter @finterm-ai/cli api:sync` to refresh it.');
  process.exit(1);
} else {
  console.log(`API tool definitions are in sync (${files.length} files).`);
}
