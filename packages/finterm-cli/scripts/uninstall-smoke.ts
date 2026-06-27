#!/usr/bin/env tsx
/**
 * Verify the package can be removed cleanly from an npm global prefix.
 */

import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Process exit code used by subprocesses when they complete successfully. */
const EXIT_SUCCESS = 0;

/** Process exit code used when the smoke test itself fails. */
const EXIT_FAILURE = 1;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const builtBin = join(packageRoot, 'dist', 'bin-bootstrap.cjs');

interface RunOptions {
  env?: NodeJS.ProcessEnv;
  stdio?: SpawnSyncOptions['stdio'];
}

interface RunResult {
  stdout: string;
  stderr: string;
}

function run(command: string, args: readonly string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      ...options.env,
    },
    stdio: options.stdio ?? 'pipe',
  });

  if (result.status !== EXIT_SUCCESS) {
    const details = [
      `Command failed: ${[command, ...args].join(' ')}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ]
      .filter(Boolean)
      .join('\n\n');
    throw new Error(details);
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function main(): void {
  if (!existsSync(builtBin)) {
    throw new Error(`Expected built binary at ${builtBin}. Run pnpm build before test:uninstall.`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'finterm-uninstall-smoke-'));
  const prefix = join(tempRoot, 'prefix');
  const home = join(tempRoot, 'home');
  const binDir = join(prefix, 'bin');
  const installedPackageDir = join(prefix, 'lib', 'node_modules', '@finterm-ai', 'cli');
  const fintermBin = join(binDir, 'finterm');

  mkdirSync(prefix, { recursive: true });
  mkdirSync(join(prefix, 'lib'), { recursive: true });
  mkdirSync(home, { recursive: true });

  try {
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      PATH: `${binDir}${delimiter}${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
    };

    run('npm', ['link', packageRoot, '--prefix', prefix], { env, stdio: 'inherit' });
    if (!existsSync(fintermBin)) {
      throw new Error(`Expected linked finterm binary at ${fintermBin}`);
    }

    const version = run(fintermBin, ['--version'], { env }).stdout.trim();
    if (!/^\d+\.\d+\.\d+/.test(version)) {
      throw new Error(`Expected a semver from finterm --version, got: ${version}`);
    }

    run('npm', ['uninstall', '-g', '@finterm-ai/cli', '--prefix', prefix], {
      env,
      stdio: 'inherit',
    });

    if (existsSync(fintermBin)) {
      throw new Error(`Expected finterm binary to be removed from ${fintermBin}`);
    }
    if (existsSync(installedPackageDir)) {
      throw new Error(
        `Expected installed package directory to be removed from ${installedPackageDir}`
      );
    }

    console.log('Uninstall smoke passed: @finterm-ai/cli unlinks cleanly from a temp prefix');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Uninstall smoke failed: ${message}`);
  process.exit(EXIT_FAILURE);
}
