/**
 * Spawns the real `bin/finterm` entry, so it carries the integration suffix. The unit
 * half of the launcher's coverage (the freshness decision) is in launcher.test.ts.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const binPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'finterm');

const roots: string[] = [];

afterAll(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the entry starts the CLI however it is reached', () => {
  it('prints a version through a symlink, not silence', { timeout: 30_000 }, () => {
    // A silent exit 0 through a symlinked invocation is the failure mode this pins:
    // the entry must not decide it was "merely imported" based on how its path looks.
    const dir = mkdtempSync(join(tmpdir(), 'finterm-launcher-'));
    roots.push(dir);
    const link = join(dir, 'linked-finterm');
    symlinkSync(binPath, link);

    const result = spawnSync(process.execPath, [link, '--version'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe('');
  });

  it('starts from source when FINTERM_FORCE_TSX=1', { timeout: 30_000 }, () => {
    // The only automated run of the tsx branch: registration must resolve and the
    // source entry must load, or the mid-edit fallback is broken with no signal.
    const result = spawnSync(process.execPath, [binPath, '--version'], {
      encoding: 'utf8',
      env: { ...process.env, FINTERM_FORCE_TSX: '1' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe('');
  });
});
