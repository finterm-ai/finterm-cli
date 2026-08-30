/**
 * The dev launcher decides whether to run the bundle or the source tree, and getting
 * that wrong is silent: a stale bundle runs code that has already been edited. Keeping
 * the decision in a module rather than a shell script is what makes it checkable.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- the launcher is plain JS with no declaration file.
import { distIsFresh, hasSourceNewerThan } from '../bin/launcher.mjs';

const roots: string[] = [];

function workspace(): { dir: string; distBin: string; srcDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'finterm-launcher-'));
  roots.push(dir);
  const srcDir = join(dir, 'src');
  mkdirSync(srcDir, { recursive: true });
  const distBin = join(dir, 'bin.mjs');
  writeFileSync(distBin, '');
  return { dir, distBin, srcDir };
}

/** Stamp a path at a fixed offset from now, so ordering is explicit rather than raced. */
function ageBy(file: string, secondsFromNow: number): void {
  const when = new Date(Date.now() + secondsFromNow * 1000);
  utimesSync(file, when, when);
}

afterAll(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('hasSourceNewerThan', () => {
  it('finds a newer .ts nested below the top level', () => {
    const { srcDir } = workspace();
    const nested = join(srcDir, 'cli', 'commands');
    mkdirSync(nested, { recursive: true });
    const file = join(nested, 'deep.ts');
    writeFileSync(file, '');
    ageBy(file, 0);

    expect(hasSourceNewerThan(srcDir, Date.now() - 60_000)).toBe(true);
  });

  it('ignores files that are not TypeScript', () => {
    const { srcDir } = workspace();
    writeFileSync(join(srcDir, 'notes.md'), '');
    ageBy(join(srcDir, 'notes.md'), 0);

    expect(hasSourceNewerThan(srcDir, Date.now() - 60_000)).toBe(false);
  });

  it('reports an unreadable directory as newer, so an unverifiable tree never runs a bundle', () => {
    expect(hasSourceNewerThan(join(tmpdir(), 'finterm-launcher-does-not-exist'), 0)).toBe(true);
  });
});

describe('distIsFresh', () => {
  it('is false when the bundle does not exist', () => {
    const { dir } = workspace();
    expect(distIsFresh(join(dir, 'missing.mjs'), [dir])).toBe(false);
  });

  it('is true when every source is older than the bundle', () => {
    const { dir, distBin, srcDir } = workspace();
    const file = join(srcDir, 'old.ts');
    writeFileSync(file, '');
    ageBy(file, -120);
    ageBy(distBin, 0);

    expect(distIsFresh(distBin, [dir])).toBe(true);
  });

  it('is false when any source is newer than the bundle', () => {
    const { dir, distBin, srcDir } = workspace();
    const file = join(srcDir, 'edited.ts');
    writeFileSync(file, '');
    ageBy(distBin, -120);
    ageBy(file, 0);

    expect(distIsFresh(distBin, [dir])).toBe(false);
  });

  it('checks every source root, not just the first', () => {
    // dataroom and dataroom-cli are bundled into dist, so editing them must
    // invalidate the bundle just as editing the CLI does.
    const cli = workspace();
    const sibling = workspace();
    writeFileSync(join(cli.srcDir, 'stable.ts'), '');
    ageBy(join(cli.srcDir, 'stable.ts'), -120);
    ageBy(cli.distBin, -60);
    const siblingFile = join(sibling.srcDir, 'edited.ts');
    writeFileSync(siblingFile, '');
    ageBy(siblingFile, 0);

    expect(distIsFresh(cli.distBin, [cli.dir])).toBe(true);
    expect(distIsFresh(cli.distBin, [cli.dir, sibling.dir])).toBe(false);
  });
});
