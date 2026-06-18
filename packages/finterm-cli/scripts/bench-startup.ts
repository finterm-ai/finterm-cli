#!/usr/bin/env tsx
/**
 * Startup benchmark gate: spawn the shipped binary repeatedly and fail if the
 * p50 wall-clock time exceeds the threshold.
 *
 * Default threshold is 200ms (CI machines are slower than dev laptops; the
 * local target is 150ms). Override with BENCH_STARTUP_MAX_MS. See
 * plan-2026-06-12-finterm-cli-performance-and-quality.md (P2a).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const RUNS = 12;
const WARMUP_RUNS = 3;
const DEFAULT_MAX_P50_MS = 200;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(packageRoot, 'dist', 'bin-bootstrap.cjs');

function benchCommand(args: readonly string[]): { p50: number; min: number; max: number } {
  const times: number[] = [];
  for (let i = 0; i < RUNS + WARMUP_RUNS; i++) {
    const start = performance.now();
    const result = spawnSync(process.execPath, [binPath, ...args], { stdio: 'pipe' });
    const elapsed = performance.now() - start;
    if (result.status !== 0) {
      console.error(`bench run failed (exit ${result.status}): ${result.stderr?.toString()}`);
      process.exit(1);
    }
    if (i >= WARMUP_RUNS) {
      times.push(elapsed);
    }
  }
  times.sort((a, b) => a - b);
  return {
    p50: times[Math.floor(times.length / 2)]!,
    min: times[0]!,
    max: times[times.length - 1]!,
  };
}

function main(): void {
  if (!existsSync(binPath)) {
    console.error(`Missing ${binPath} — run \`pnpm build\` first.`);
    process.exit(1);
  }

  const maxP50 = Number(process.env.BENCH_STARTUP_MAX_MS ?? DEFAULT_MAX_P50_MS);

  let failed = false;
  for (const args of [['--version'], ['--help']] as const) {
    const { p50, min, max } = benchCommand(args);
    const verdict = p50 <= maxP50 ? 'ok' : `FAIL (> ${maxP50}ms)`;
    console.log(
      `finterm ${args.join(' ')}: p50=${p50.toFixed(0)}ms min=${min.toFixed(0)}ms max=${max.toFixed(0)}ms — ${verdict}`
    );
    if (p50 > maxP50) {
      failed = true;
    }
  }

  if (failed) {
    console.error(
      `Startup regression: p50 over ${maxP50}ms. Check for new eager imports ` +
        `(tests/startup-graph guards the module list) before raising the threshold.`
    );
    process.exit(1);
  }
}

main();
