import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotFoundError } from '../errors.js';
import {
  buildFileProfileFile,
  listFileProfileFiles,
  openFileProfileRoom,
  readFileProfileArtifact,
} from '../fileProfile.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'dataroom-file-profile-symlink-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const SECRET_CONTENTS = 'TOP-SECRET-CONTENTS-SHOULD-NEVER-LEAK';

async function createRoomFixture(): Promise<string> {
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
    'utf-8',
  );
  await writeFile(
    join(roomPath, 'files', 'reports', 'overview.md'),
    ['# Overview', 'The launch room is file-backed.', ''].join('\n'),
    'utf-8',
  );
  return roomPath;
}

describe('file-profile symlink containment', () => {
  it('does not read a symlink escaping the room to a secret outside file', async () => {
    const roomPath = await createRoomFixture();

    // A secret file living outside the room entirely.
    const secretPath = join(tempDir, 'secret.txt');
    await writeFile(secretPath, SECRET_CONTENTS, 'utf-8');

    // A symlink planted inside the room's files dir that points at the secret.
    const linkPath = join(roomPath, 'files', 'reports', 'leak.txt');
    await symlink(secretPath, linkPath);

    const room = await openFileProfileRoom(roomPath);

    // Reading the symlinked artifact must be refused and must not return the
    // secret contents.
    await expect(readFileProfileArtifact(room, 'file:reports/leak.txt')).rejects.toBeInstanceOf(
      NotFoundError,
    );

    let leaked: string | undefined;
    try {
      const result = await readFileProfileArtifact(room, 'file:reports/leak.txt');
      leaked = result.text ?? result.buffer.toString('utf-8');
    } catch {
      leaked = undefined;
    }
    expect(leaked ?? '').not.toContain(SECRET_CONTENTS);

    // The symlink must not be enumerated as a regular room file either.
    const listed = listFileProfileFiles(room).map((file) => file.ref);
    expect(listed).not.toContain('file:reports/leak.txt');
  });

  it('buildFileProfileFile refuses an escaping symlink before reading it', async () => {
    const roomPath = await createRoomFixture();

    const secretPath = join(tempDir, 'secret.txt');
    await writeFile(secretPath, SECRET_CONTENTS, 'utf-8');
    await symlink(secretPath, join(roomPath, 'files', 'reports', 'leak.txt'));

    const room = await openFileProfileRoom(roomPath);

    // The exported descriptor builder must not leak the outside file's
    // existence, size, or digest — containment comes before any read.
    expect(buildFileProfileFile(room, 'reports/leak.txt')).toBeUndefined();
  });

  it('refuses artifacts reached through a symlinked parent directory', async () => {
    const roomPath = await createRoomFixture();

    const outsideDir = join(tempDir, 'outside');
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, 'secret.txt'), SECRET_CONTENTS, 'utf-8');
    await symlink(outsideDir, join(roomPath, 'files', 'linkdir'));

    const room = await openFileProfileRoom(roomPath);

    expect(buildFileProfileFile(room, 'linkdir/secret.txt')).toBeUndefined();
    await expect(readFileProfileArtifact(room, 'file:linkdir/secret.txt')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('still works when the room itself lives under a symlinked parent', async () => {
    const roomPath = await createRoomFixture();
    const linkedRoomPath = join(tempDir, 'room-link');
    await symlink(roomPath, linkedRoomPath);

    const room = await openFileProfileRoom(linkedRoomPath);
    const artifact = await readFileProfileArtifact(room, 'file:reports/overview.md');
    expect(artifact.text).toContain('The launch room is file-backed.');
  });

  it('still reads a legitimate regular file in the room', async () => {
    const roomPath = await createRoomFixture();

    // Plant the escaping symlink to confirm it does not affect normal reads.
    const secretPath = join(tempDir, 'secret.txt');
    await writeFile(secretPath, SECRET_CONTENTS, 'utf-8');
    await symlink(secretPath, join(roomPath, 'files', 'reports', 'leak.txt'));

    const room = await openFileProfileRoom(roomPath);

    const artifact = await readFileProfileArtifact(room, 'file:reports/overview.md');
    expect(artifact.text).toContain('The launch room is file-backed.');

    const listed = listFileProfileFiles(room).map((file) => file.ref);
    expect(listed).toContain('file:reports/overview.md');
  });
});
