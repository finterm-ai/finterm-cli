import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  listFileProfileFiles,
  openFileProfileRoom,
  readFileProfileArtifact,
  searchFileProfileFiles,
} from '../fileProfile.js';
import { sha256 } from '../utils/hash.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'dataroom-file-profile-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function createFileProfileFixture(): Promise<string> {
  const roomPath = join(tempDir, 'room');
  await mkdir(join(roomPath, 'files', 'reports'), { recursive: true });
  await writeFile(
    join(roomPath, 'dataroom.yml'),
    [
      'format: DR/0.3',
      'type: dataroom',
      'name: launch-room',
      'profile: file',
      'capabilities:',
      '  catalog: none',
      '  frontmatter_format: 0.3.0',
      '',
    ].join('\n'),
    'utf-8'
  );
  await writeFile(
    join(roomPath, 'files', 'reports', 'overview.md'),
    [
      '---',
      'kind: report',
      'schema: launch-report',
      'title: Overview',
      'tags:',
      '  - launch',
      '---',
      '# Overview',
      'The launch room is file-backed.',
    ].join('\n'),
    'utf-8'
  );
  await writeFile(
    join(roomPath, 'files', 'reports', 'facts.json'),
    '{"company":"META"}\n',
    'utf-8'
  );
  await writeFile(
    join(roomPath, 'files', 'reports', 'facts.json.meta.yml'),
    ['dataroom:', '  kind: fact_sheet', '  title: Fact sheet', '  tags:', '    - facts', ''].join(
      '\n'
    ),
    'utf-8'
  );
  return roomPath;
}

describe('file-profile core', () => {
  it('opens and lists DR/0.3 profile:file rooms without database indexes', async () => {
    const room = await openFileProfileRoom(await createFileProfileFixture());

    const files = listFileProfileFiles(room);

    expect(room.metadata).toMatchObject({
      format: 'DR/0.3',
      name: 'launch-room',
      profile: 'file',
    });
    expect(files.map((file) => file.ref)).toEqual([
      'file:reports/facts.json',
      'file:reports/overview.md',
    ]);
    expect(files.find((file) => file.path === 'reports/facts.json')?.metadata).toMatchObject({
      kind: 'fact_sheet',
      title: 'Fact sheet',
      tags: ['facts'],
    });
    expect(files.find((file) => file.path === 'reports/overview.md')?.facets).toMatchObject({
      declaredKind: 'report',
      schemaId: 'launch-report',
      tags: ['launch'],
    });
  });

  it('refreshes cached file digests when files change', async () => {
    const roomPath = await createFileProfileFixture();
    const room = await openFileProfileRoom(roomPath);

    const first = listFileProfileFiles(room).find((file) => file.path === 'reports/facts.json');
    await writeFile(
      join(roomPath, 'files', 'reports', 'facts.json'),
      '{"company":"NVIDIA"}\n',
      'utf-8'
    );
    const second = listFileProfileFiles(room).find((file) => file.path === 'reports/facts.json');

    expect(first?.entry.digest).toBe(sha256('{"company":"META"}\n'));
    expect(second?.entry.digest).toBe(sha256('{"company":"NVIDIA"}\n'));
  });

  it('reads and searches regular files directly from files/', async () => {
    const room = await openFileProfileRoom(await createFileProfileFixture());

    const artifact = await readFileProfileArtifact(room, 'file:reports/overview.md');
    const matches = await searchFileProfileFiles(room, 'file-backed');

    expect(artifact.text).toContain('The launch room is file-backed.');
    expect(matches).toEqual([
      expect.objectContaining({
        ref: 'file:reports/overview.md',
        line: 9,
        snippet: 'The launch room is file-backed.',
      }),
    ]);
  });
});
