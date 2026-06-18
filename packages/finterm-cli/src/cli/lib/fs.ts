/**
 * Shared file system utilities using atomic writes.
 *
 * Uses the `atomically` package to ensure file writes are atomic:
 * - Writes to a temp file first, then renames (no partial/corrupt files)
 * - Queues writes to the same path to prevent interference
 * - Auto-creates missing parent directories
 * - Retries on EMFILE/ENFILE/EAGAIN/EBUSY errors
 */

import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeFile as atomicWriteFile, writeFileSync as atomicWriteFileSync } from 'atomically';

/**
 * Check if a path exists.
 */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically write a file, creating parent directories as needed.
 *
 * @param path - The file path to write to
 * @param content - The content to write (string or Buffer)
 */
export async function writeFile(
  path: string,
  content: string | Buffer,
  options?: { mode?: number }
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // A `mode` (e.g. 0o600 for secret files like the credentials token) is applied
  // to the written file; without it the file lands at the process umask (often
  // world-readable 0644).
  await atomicWriteFile(path, content, { encoding: 'utf-8', ...options });
}

/**
 * Synchronously and atomically write a file.
 *
 * Prefer the async {@link writeFile} when possible: it creates parent directories
 * and retries transient errors for longer.
 *
 * @param path - The file path to write to
 * @param content - The content to write (string or Buffer)
 */
export function writeFileSync(path: string, content: string | Buffer): void {
  // Unlike the async path, this does not create missing parent directories:
  // `atomically` has no synchronous mkdir, so callers must ensure the dir exists.
  atomicWriteFileSync(path, content, 'utf-8');
}
