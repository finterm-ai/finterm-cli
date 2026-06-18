#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(packageRoot, '..', '..');
const repoRoot = resolve(workspaceRoot, '..');
const extraBinDirs = [
  resolve(packageRoot, 'node_modules', '.bin'),
  resolve(workspaceRoot, 'node_modules', '.bin'),
  resolve(repoRoot, 'node_modules', '.bin'),
].filter(existsSync);

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/workspace-bin.mjs <command> [...args]');
  process.exit(2);
}

const result = spawnSync(command, args, {
  cwd: packageRoot,
  env: {
    ...process.env,
    PATH: [...extraBinDirs, process.env.PATH ?? ''].join(delimiter),
  },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
