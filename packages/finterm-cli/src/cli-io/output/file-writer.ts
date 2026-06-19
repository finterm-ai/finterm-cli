/**
 * File writer with atomic writes.
 *
 * Uses the 'atomically' library to prevent partial/corrupted files
 * if the process crashes mid-write. Writes to a temp file first,
 * then renames atomically to the final path.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { writeFile as writeFileAtomically } from 'atomically';
import * as yaml from 'yaml';

/** Options for file writing operations */
export interface WriteOptions {
  /** Whether to overwrite existing files (default: true) */
  overwrite: boolean;
}

/** Options for JSON file writing */
export interface JsonWriteOptions extends WriteOptions {
  /** Write compact JSON without indentation (default: false) */
  compact: boolean;
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Check if a file or directory exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write content to a file atomically (temp file then rename), creating the
 * parent directory if needed. Honors `overwrite: false` by failing rather than
 * clobbering an existing file.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  options: WriteOptions = { overwrite: true }
): Promise<void> {
  const { overwrite } = options;

  if (!overwrite && (await fileExists(filePath))) {
    throw new Error(`File already exists and overwrite is disabled: ${filePath}`);
  }

  const dir = path.dirname(filePath);
  await ensureDirectory(dir);

  await writeFileAtomically(filePath, content);
}

/**
 * Write data as a JSON file (pretty-printed unless `compact` is set).
 */
export async function writeJsonFile(
  filePath: string,
  data: unknown,
  options: JsonWriteOptions = { overwrite: true, compact: false }
): Promise<void> {
  const { compact, ...writeOptions } = options;

  const content = compact ? JSON.stringify(data) : JSON.stringify(data, null, 2);

  await writeFileAtomic(filePath, content, writeOptions);
}

/**
 * Write data as a YAML file.
 */
export async function writeYamlFile(
  filePath: string,
  data: unknown,
  options: WriteOptions = { overwrite: true }
): Promise<void> {
  const content = yaml.stringify(data);

  await writeFileAtomic(filePath, content, options);
}
