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

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// Directory Operations
// =============================================================================

/**
 * Ensure a directory exists, creating it recursively if needed.
 *
 * @param dirPath - Path to the directory
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Check if a file or directory exists.
 *
 * @param filePath - Path to check
 * @returns True if the path exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Atomic File Writing
// =============================================================================

/**
 * Write content to a file atomically.
 *
 * This writes to a temporary file first, then renames it to the target path.
 * This prevents partial/corrupted files if the process crashes mid-write.
 *
 * @param filePath - Path to write to
 * @param content - Content to write
 * @param options - Write options
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  options: WriteOptions = { overwrite: true }
): Promise<void> {
  const { overwrite } = options;

  // Check if file exists when overwrite is disabled
  if (!overwrite && (await fileExists(filePath))) {
    throw new Error(`File already exists and overwrite is disabled: ${filePath}`);
  }

  // Ensure parent directory exists
  const dir = path.dirname(filePath);
  await ensureDirectory(dir);

  // Write atomically using the atomically library
  await writeFileAtomically(filePath, content);
}

// =============================================================================
// JSON File Writing
// =============================================================================

/**
 * Write data as a JSON file.
 *
 * @param filePath - Path to write to
 * @param data - Data to serialize as JSON
 * @param options - Write options
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

// =============================================================================
// YAML File Writing
// =============================================================================

/**
 * Write data as a YAML file.
 *
 * @param filePath - Path to write to
 * @param data - Data to serialize as YAML
 * @param options - Write options
 */
export async function writeYamlFile(
  filePath: string,
  data: unknown,
  options: WriteOptions = { overwrite: true }
): Promise<void> {
  const content = yaml.stringify(data);

  await writeFileAtomic(filePath, content, options);
}
