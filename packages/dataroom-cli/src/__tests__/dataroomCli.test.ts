import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDataroomCommand } from '../index.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'dataroom-cli-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

async function createFixtureRoom(): Promise<string> {
  const roomPath = join(tempDir, 'room');
  await mkdir(join(roomPath, 'files', 'reports'), { recursive: true });
  await writeFile(
    join(roomPath, 'dataroom.yml'),
    [
      'format: DR/0.3',
      'type: dataroom',
      'name: meta',
      'profile: file',
      'capabilities:',
      '  catalog: none',
      '  frontmatter_format: 0.3.0',
      '',
    ].join('\n'),
    'utf-8'
  );
  await writeFile(
    join(roomPath, 'files', 'reports', 'meta.md'),
    [
      '---',
      'kind: report',
      'schema: research-note',
      'title: Meta report',
      'tags:',
      '  - revenue',
      '---',
      '# META research',
      'Revenue grew.',
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
    ['dataroom:', '  kind: facts', '  tags:', '    - structured', ''].join('\n'),
    'utf-8'
  );
  return roomPath;
}

describe('dataroom file-profile command', () => {
  it('exposes only file-backed read verbs', () => {
    const command = buildDataroomCommand();

    expect(command.commands.map((subcommand) => subcommand.name())).toEqual([
      'files',
      'search',
      'read',
      'list',
      'info',
    ]);
  });

  it('lists, searches, and reads a DR/0.3 profile:file room', async () => {
    const roomPath = await createFixtureRoom();
    const logs: string[] = [];
    const writes: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    const command = buildDataroomCommand();
    await command.parseAsync(['node', 'dataroom', 'files', roomPath]);
    await command.parseAsync(['node', 'dataroom', 'search', roomPath, 'grew']);
    await command.parseAsync(['node', 'dataroom', 'read', roomPath, 'file:reports/meta.md']);

    expect(logs.join('\n')).toContain('file:reports/meta.md');
    expect(logs.join('\n')).toContain('Revenue grew.');
    expect(writes.join('')).toContain('# META research');
  });

  it('filters file-backed searches by metadata facets', async () => {
    const roomPath = await createFixtureRoom();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });

    const command = buildDataroomCommand();
    await command.parseAsync([
      'node',
      'dataroom',
      'search',
      roomPath,
      'grew',
      '--facet',
      'tags=structured',
      '--json',
    ]);

    const parsed = JSON.parse(logs.join('\n')) as {
      ok: boolean;
      matches: { path: string }[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.matches).toEqual([]);
  });
});
