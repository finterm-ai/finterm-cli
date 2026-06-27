import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import { createToolCommand } from './tool.js';
import { extractToolCommandSpecs } from './tool-command-spec.js';

const artifactPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'api',
  'toolCommandSpec.generated.json'
);

async function formatCommandSpecJson(specs: unknown): Promise<string> {
  const config = (await prettier.resolveConfig(artifactPath)) ?? {};
  return prettier.format(`${JSON.stringify(specs, null, 2)}\n`, { ...config, parser: 'json' });
}

describe('toolCommandSpec.generated.json drift gate', () => {
  it('matches the live finterm tool command tree byte-for-byte', async () => {
    const specs = extractToolCommandSpecs(createToolCommand({ experimental: true }));
    const expected = await formatCommandSpecJson(specs);
    expect(readFileSync(artifactPath, 'utf8')).toBe(expected);
  });
});
