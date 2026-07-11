import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(testDir, '..', '..');

const databasePackages = ['lmdb', 'better-sqlite3', 'sqlite3', 'duckdb'];
const removedCoreEntries = [
  'DataRoom.ts',
  'DataLibrary.ts',
  'store',
  'cli',
  'browser',
  'codec',
  'upgrade.ts',
  'migrations.ts',
  'formatWarnings.ts',
];

describe('dataroom core boundary', () => {
  it('keeps database adapters out of runtime package dependencies', async () => {
    const packageJson = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
      bin?: Record<string, string>;
    };
    const runtimeDeps = Object.keys(packageJson.dependencies ?? {});

    expect(runtimeDeps).not.toEqual(expect.arrayContaining(databasePackages));
    expect(packageJson.exports).not.toHaveProperty('./legacy');
    expect(packageJson.exports).not.toHaveProperty('./cli');
    expect(packageJson.bin).toBeUndefined();
  });

  it('keeps root and profile:file modules independent from database adapters', async () => {
    const [indexSource, fileProfileSource] = await Promise.all([
      readFile(join(packageDir, 'src', 'index.ts'), 'utf-8'),
      readFile(join(packageDir, 'src', 'fileProfile.ts'), 'utf-8'),
    ]);

    for (const source of [indexSource, fileProfileSource]) {
      expect(source).not.toMatch(/from ['"]\.\/DataRoom\.js['"]/);
      expect(source).not.toMatch(/from ['"]\.\/DataLibrary\.js['"]/);
      expect(source).not.toMatch(/from ['"]\.\/store\//);
      expect(source).not.toMatch(/import\(['"]lmdb['"]\)/);
    }
    expect(indexSource).not.toMatch(/FILES_INDEX_PATH|BLOBS_INDEX_PATH|RELATIONSHIPS_INDEX_PATH/);
  });

  it('does not keep the old adapter implementation in the core source tree', async () => {
    const entries = await readdir(join(packageDir, 'src'));
    expect(entries).not.toEqual(expect.arrayContaining(removedCoreEntries));
  });
});
