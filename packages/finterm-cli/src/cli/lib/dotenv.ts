/**
 * Minimal, dependency-free `.env` loader used at CLI startup.
 *
 * A tiny in-repo parser (rather than the `dotenv` package) keeps the startup path free
 * of third-party code and gives full control over the walk-upward + first-value-wins
 * precedence the CLI relies on.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DOTENV_FILENAMES = ['.env.local', '.env'] as const;
const DOTENV_LINE = /^\s*(?:export\s+)?([\w.-]+)\s*(?:=|:)\s*(.*)?\s*$/;

/** Mutable environment map the loader writes into; `process.env` by default. */
export type DotenvTarget = Record<string, string | undefined>;

/**
 * Load `.env.local` and `.env` files from the current directory upward.
 *
 * First value wins: shell/CI environment variables keep precedence, then closer
 * dotenv files beat parent directories, and `.env.local` beats `.env`.
 */
export function loadDotenvFiles(
  startDir: string = process.cwd(),
  env: DotenvTarget = process.env
): void {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (true) {
    for (const filename of DOTENV_FILENAMES) {
      const filePath = path.join(dir, filename);
      if (existsSync(filePath)) {
        loadDotenvFile(filePath, env);
      }
    }

    if (dir === root) {
      return;
    }
    dir = path.dirname(dir);
  }
}

function loadDotenvFile(filePath: string, env: DotenvTarget): void {
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseDotenvLine(line);
    if (!parsed) {
      continue;
    }
    if (env[parsed.key] === undefined) {
      env[parsed.key] = parsed.value;
    }
  }
}

function parseDotenvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const match = DOTENV_LINE.exec(line);
  if (!match) {
    return null;
  }

  const key = match[1] ?? '';
  const rawValue = (match[2] ?? '').trim();
  if (!key) {
    return null;
  }

  return { key, value: parseDotenvValue(rawValue) };
}

function parseDotenvValue(rawValue: string): string {
  if (!rawValue) {
    return '';
  }

  const quote = rawValue[0];
  if (quote === '"' || quote === "'" || quote === '`') {
    const end = rawValue.lastIndexOf(quote);
    const value = end > 0 ? rawValue.slice(1, end) : rawValue.slice(1);
    return quote === '"' ? value.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : value;
  }

  return rawValue.replace(/\s+#.*$/, '').trim();
}
