import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { FINTERM_TOOL_IDS } from '../toolIds.js';
import { FINTERM_TOOL_DEFINITIONS } from '../toolDefinitions.generated.js';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function apiMdFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.api.md'))
    .sort();
}

interface ApiDocFrontmatter {
  definition?: {
    tool_id?: string;
    title?: string;
    summary?: string;
    publication_state?: string;
    examples?: { command?: string }[];
  };
}

function apiDocFrontmatter(path: string): ApiDocFrontmatter {
  const text = readFileSync(path, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) {
    throw new Error(`${path} is missing YAML frontmatter`);
  }
  return parseYaml(match[1] ?? '') as ApiDocFrontmatter;
}

function advertisedToolCommandIds(path: string): string[] {
  const frontmatter = apiDocFrontmatter(path);
  if (!frontmatter.definition) {
    throw new Error(`${path} is missing definition frontmatter`);
  }

  const ids: string[] = [];
  for (const example of frontmatter.definition.examples ?? []) {
    const command = example.command ?? '';
    for (const match of command.matchAll(/\bfinterm\s+tool\s+([a-z0-9_]+)/g)) {
      ids.push(match[1]!);
    }
  }
  return ids;
}

function apiDocToolId(path: string): string {
  const frontmatter = apiDocFrontmatter(path);
  const toolId = frontmatter.definition?.tool_id;
  if (!toolId) {
    throw new Error(`${path} is missing definition.tool_id frontmatter`);
  }
  return toolId;
}

function publishedApiMdFiles(dir: string): string[] {
  return apiMdFiles(dir).filter(
    (file) => apiDocFrontmatter(join(dir, file)).definition?.publication_state === 'published'
  );
}

describe('committed finterm API docs', () => {
  it('advertises only registered finterm tool commands', () => {
    const advertised = new Set<string>();
    for (const file of publishedApiMdFiles(apiDir)) {
      for (const id of advertisedToolCommandIds(join(apiDir, file))) {
        advertised.add(id);
      }
    }

    expect([...advertised].sort()).toEqual([...(FINTERM_TOOL_IDS as readonly string[])].sort());
  });

  it('marks exactly the first-release API docs as published', () => {
    const publishedToolIds = publishedApiMdFiles(apiDir).map((file) =>
      apiDocToolId(join(apiDir, file))
    );

    expect(publishedToolIds.sort()).toEqual([...(FINTERM_TOOL_IDS as readonly string[])].sort());
  });

  it('has a committed API doc for every registered finterm tool command', () => {
    const publishedToolIds = new Set(
      publishedApiMdFiles(apiDir).map((file) => file.slice(0, -'.api.md'.length))
    );

    for (const id of FINTERM_TOOL_IDS) {
      expect(publishedToolIds.has(id), `${id} should have a published .api.md doc`).toBe(true);
    }
  });

  it('mirrors the .api.md title and summary into FINTERM_TOOL_DEFINITIONS', () => {
    for (const file of publishedApiMdFiles(apiDir)) {
      const definition = apiDocFrontmatter(join(apiDir, file)).definition;
      if (!definition?.tool_id) {
        throw new Error(`${file} is missing definition.tool_id`);
      }

      const generated = FINTERM_TOOL_DEFINITIONS[definition.tool_id];
      expect(generated, `${definition.tool_id} missing from FINTERM_TOOL_DEFINITIONS`).toEqual({
        title: definition.title,
        summary: definition.summary,
      });
    }
  });
});
