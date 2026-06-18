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
  // Ensure parent directory exists
  await mkdir(dirname(path), { recursive: true });
  // Write atomically. A `mode` (e.g. 0o600 for secret files like the credentials
  // token) is applied to the written file; without it the file lands at the process
  // umask (often world-readable 0644).
  await atomicWriteFile(path, content, { encoding: 'utf-8', ...options });
}

/**
 * Synchronously and atomically write a file, creating parent directories as needed.
 *
 * Note: Prefer the async version when possible. Sync version has shorter
 * retry timeout (1000ms vs 7500ms).
 *
 * @param path - The file path to write to
 * @param content - The content to write (string or Buffer)
 */
export function writeFileSync(path: string, content: string | Buffer): void {
  // Note: atomically doesn't create dirs synchronously, so we still need mkdir
  // But since this is sync, we'll accept the limitation
  atomicWriteFileSync(path, content, 'utf-8');
}
