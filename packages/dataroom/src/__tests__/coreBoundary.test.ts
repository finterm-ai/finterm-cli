import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(testDir, '..', '..');

const nativeDatabasePackages = ['lmdb', 'better-sqlite3', 'sqlite3', 'duckdb'];

describe('database-free dataroom core', () => {
  it('declares no native database dependencies', async () => {
    const packageJson = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
      bin?: Record<string, string>;
    };
    const runtimeDeps = Object.keys(packageJson.dependencies ?? {});

    for (const nativeDatabase of nativeDatabasePackages) {
      expect(runtimeDeps).not.toContain(nativeDatabase);
    }
    expect(packageJson.exports).not.toHaveProperty('./legacy');
    expect(packageJson.exports).not.toHaveProperty('./cli');
    expect(packageJson.bin).toBeUndefined();
  });

  it('root and profile:file modules import no database', async () => {
    const [indexSource, fileProfileSource] = await Promise.all([
      readFile(join(packageDir, 'src', 'index.ts'), 'utf-8'),
      readFile(join(packageDir, 'src', 'fileProfile.ts'), 'utf-8'),
    ]);

    for (const source of [indexSource, fileProfileSource]) {
      expect(source).not.toMatch(/import\(['"]lmdb['"]\)/);
    }
    expect(indexSource).not.toMatch(/FILES_INDEX_PATH|BLOBS_INDEX_PATH|RELATIONSHIPS_INDEX_PATH/);
  });
});
