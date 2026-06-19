#!/usr/bin/env tsx
/**
 * Smoke-test the pre-publish local install path.
 *
 * The package is linked into a temporary prefix to verify the locally built binary.
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

/** Environment value that disables forced ANSI color in subprocess output. */
const FORCE_COLOR_DISABLED = '0';

/** Environment value that enables the conventional no-color flag. */
const NO_COLOR_ENABLED = '1';

const REQUIRED_HELP_COMMANDS = [
  'auth',
  'setup',
  'skill',
  'docs',
  'bundle',
  'tool',
  'dataroom',
] as const;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface RunOptions {
  env?: NodeJS.ProcessEnv;
  stdio?: SpawnSyncOptions['stdio'];
}

interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Run a subprocess from the package root and fail with stdout/stderr context.
 */
function run(command: string, args: readonly string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: FORCE_COLOR_DISABLED,
      NO_COLOR: NO_COLOR_ENABLED,
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

/**
 * Build the package, link it into a temporary npm prefix, and verify top-level help.
 */
function main(): void {
  const tempRoot = mkdtempSync(join(tmpdir(), 'finterm-local-install-smoke-'));
  const prefix = join(tempRoot, 'prefix');
  const home = join(tempRoot, 'home');
  const binDir = join(prefix, 'bin');
  const packageWorkspaceRoot = resolve(packageRoot, '../..');
  const repoRoot = resolve(packageRoot, '../../..');
  const toolPath = [
    join(packageRoot, 'node_modules', '.bin'),
    join(packageWorkspaceRoot, 'node_modules', '.bin'),
    join(repoRoot, 'node_modules', '.bin'),
    process.env.PATH ?? '',
  ].join(delimiter);

  mkdirSync(prefix, { recursive: true });
  mkdirSync(join(prefix, 'lib'), { recursive: true });
  mkdirSync(home, { recursive: true });

  try {
    const baseEnv: NodeJS.ProcessEnv = {
      HOME: home,
      PATH: toolPath,
    };

    run('tsc', ['-p', 'tsconfig.json', '--noEmit'], { env: baseEnv, stdio: 'inherit' });
    run('tsdown', [], { env: baseEnv, stdio: 'inherit' });
    run(process.execPath, ['scripts/copy-docs.mjs', 'postbuild'], {
      env: baseEnv,
      stdio: 'inherit',
    });
    run('npm', ['link', packageRoot, '--prefix', prefix], { env: baseEnv, stdio: 'inherit' });

    const fintermBin = join(binDir, 'finterm');
    if (!existsSync(fintermBin)) {
      throw new Error(`Expected linked finterm binary at ${fintermBin}`);
    }

    const help = run('finterm', ['--help'], {
      env: {
        HOME: home,
        PATH: `${binDir}${delimiter}${toolPath}`,
      },
    }).stdout;

    for (const command of REQUIRED_HELP_COMMANDS) {
      const pattern = new RegExp(`\\b${command}\\b`);
      if (!pattern.test(help)) {
        throw new Error(`Expected finterm --help to include '${command}' command`);
      }
    }

    console.log(`Local install smoke passed: PATH="${binDir}${delimiter}$PATH" finterm --help`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Local install smoke failed: ${message}`);
  process.exit(EXIT_FAILURE);
}
