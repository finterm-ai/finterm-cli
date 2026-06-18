#!/usr/bin/env tsx
/**
 * Smoke-test the real publish artifact: pack a tarball and install it globally
 * into a temporary prefix, exactly as an end user's `npm install -g finterm` would.
 *
 * Unlike local-install-smoke.ts (npm link, which never resolves the dependency
 * manifest), a tarball install fails loudly on unpublishable dependencies
 * (private `workspace:^` packages) and on bundle leaks that import packages
 * missing from the manifest. This is the red/green gate for npm publish
 * readiness. See plan-2026-06-12-finterm-cli-performance-and-quality.md (P1a).
 */

import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Process exit code used by subprocesses when they complete successfully. */
const EXIT_SUCCESS = 0;

/** Process exit code used when the smoke test itself fails. */
const EXIT_FAILURE = 1;

/** Commands that must appear in the installed binary's --help output. */
const REQUIRED_HELP_COMMANDS = ['auth', 'setup', 'skill', 'bundle', 'tool', 'docs'] as const;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface RunOptions {
  env?: NodeJS.ProcessEnv;
  stdio?: SpawnSyncOptions['stdio'];
  cwd?: string;
}

interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Run a subprocess and fail with stdout/stderr context.
 */
function run(command: string, args: readonly string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
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

/**
 * Build, pack, globally install the tarball into a temp prefix, and verify the
 * installed binary works end-to-end.
 */
function main(): void {
  const tempRoot = mkdtempSync(join(tmpdir(), 'finterm-pack-install-smoke-'));
  const prefix = join(tempRoot, 'prefix');
  const home = join(tempRoot, 'home');
  const packDir = join(tempRoot, 'pack');
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
  mkdirSync(packDir, { recursive: true });

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

    // pnpm pack rewrites workspace:^ deps to concrete semver, like publish does.
    run('pnpm', ['pack', '--out', join(packDir, 'finterm.tgz')], {
      env: baseEnv,
      stdio: 'inherit',
    });
    const tarballs = readdirSync(packDir).filter((f) => f.endsWith('.tgz'));
    if (tarballs.length !== 1) {
      throw new Error(`Expected exactly one tarball in ${packDir}, found: ${tarballs.join(', ')}`);
    }
    const tarball = join(packDir, tarballs[0]!);

    // The end-user install path. --ignore-scripts per supply-chain policy; any
    // unresolvable dependency (private workspace package) fails here.
    run('npm', ['install', '-g', tarball, '--ignore-scripts', '--prefix', prefix], {
      env: baseEnv,
      stdio: 'inherit',
    });

    const fintermBin = join(binDir, 'finterm');
    if (!existsSync(fintermBin)) {
      throw new Error(`Expected installed finterm binary at ${fintermBin}`);
    }

    // Run the installed binary with ONLY the temp prefix on PATH ahead of system
    // dirs — no repo node_modules — so bundle leaks surface as MODULE_NOT_FOUND.
    const installedEnv: NodeJS.ProcessEnv = {
      HOME: home,
      PATH: `${binDir}${delimiter}${dirname(process.execPath)}${delimiter}/usr/bin:/bin`,
    };

    const version = run(fintermBin, ['--version'], { env: installedEnv }).stdout.trim();
    if (!/^\d+\.\d+\.\d+/.test(version)) {
      throw new Error(`Expected a semver from finterm --version, got: ${version}`);
    }

    const help = run(fintermBin, ['--help'], { env: installedEnv }).stdout;
    for (const command of REQUIRED_HELP_COMMANDS) {
      const pattern = new RegExp(`\\b${command}\\b`);
      if (!pattern.test(help)) {
        throw new Error(`Expected finterm --help to include '${command}' command`);
      }
    }

    // One command per group beyond help: docs (agent guidance), point tools,
    // and Dataroom command discovery, all network-free.
    run(fintermBin, ['docs'], { env: installedEnv });
    run(fintermBin, ['tool', 'financial-statements', '--help'], { env: installedEnv });
    run(fintermBin, ['dataroom', 'info', '--help'], { env: installedEnv });

    console.log(`Pack install smoke passed: ${tarballs[0]} installs and runs from a clean prefix`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Pack install smoke failed: ${message}`);
  process.exit(EXIT_FAILURE);
}
