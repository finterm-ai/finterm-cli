/**
 * Filename generator for CLI output files.
 *
 * Generates unique, filesystem-safe filenames with:
 * - Timestamp prefix for chronological sorting
 * - Slugified names for safety
 * - Truncation to avoid path length limits
 * - Optional uniqueness suffix
 */

import slugifyLib from 'slugify';

// =============================================================================
// Constants
// =============================================================================

/** Default maximum filename length (excluding path) */
export const DEFAULT_MAX_LENGTH = 128;

/** Characters to remove during slugification */
const REMOVE_REGEX = /[*+~.()'"!:@#$%^&=]/g;

// =============================================================================
// Slugification
// =============================================================================

/**
 * Convert a string to a filesystem-safe slug.
 *
 * - Converts to lowercase
 * - Replaces spaces with hyphens
 * - Removes special characters
 * - Handles unicode (converts to ASCII equivalents)
 */
export function slugify(text: string): string {
  if (!text) return '';

  return slugifyLib(text, {
    lower: true,
    strict: true,
    remove: REMOVE_REGEX,
  });
}

// =============================================================================
// Truncation
// =============================================================================

/**
 * Truncate a string to a maximum length.
 *
 * Preserves the end of the string if it contains an extension.
 */
export function truncateToLength(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Find extension if present
  const extMatch = /\.[a-zA-Z0-9]+$/.exec(text);
  const extension = extMatch ? extMatch[0] : '';
  const extLength = extension.length;

  // Calculate available length for name
  const availableLength = maxLength - extLength;
  if (availableLength <= 0) {
    return text.slice(0, maxLength);
  }

  // Truncate name portion and reattach extension
  const namePortion = text.slice(0, text.length - extLength);
  return namePortion.slice(0, availableLength) + extension;
}

// =============================================================================
// Timestamp Generation
// =============================================================================

/**
 * Generate a timestamp string for filenames.
 * Format: YYYYMMDD-HHMMSS
 */
function generateTimestamp(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Generate a short random suffix for uniqueness.
 */
function generateRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

// =============================================================================
// Filename Generation
// =============================================================================

export interface FilenameOptions {
  /** Maximum total length of filename (default: 128) */
  maxLength?: number;
  /** Prefix to add before timestamp */
  prefix?: string;
}

/**
 * Generate a filename with timestamp and slugified name.
 *
 * Format: [prefix-]YYYYMMDD-HHMMSS-name.ext
 *
 * @param name - The base name to include
 * @param extension - File extension (default: 'json')
 * @param options - Generation options
 * @returns Generated filename
 */
export function generateFilename(
  name: string,
  extension = 'json',
  options: FilenameOptions = {}
): string {
  const { maxLength = DEFAULT_MAX_LENGTH, prefix } = options;

  // Generate timestamp
  const timestamp = generateTimestamp();

  // Slugify and clean the name
  const sluggedName = slugify(name) || 'output';

  // Build filename parts
  const parts: string[] = [];
  if (prefix) {
    parts.push(slugify(prefix));
  }
  parts.push(timestamp);
  parts.push(sluggedName);

  // Join with hyphens and add extension
  const baseName = parts.join('-');
  const fullName = `${baseName}.${extension}`;

  // Truncate if necessary
  return truncateToLength(fullName, maxLength);
}

/**
 * Generate a unique filename with random suffix.
 *
 * Format: YYYYMMDD-HHMMSS-name-suffix.ext
 *
 * Use this when multiple files might be generated in quick succession.
 *
 * @param name - The base name to include
 * @param extension - File extension (default: 'json')
 * @param options - Generation options
 * @returns Generated unique filename
 */
export function generateUniqueFilename(
  name: string,
  extension = 'json',
  options: FilenameOptions = {}
): string {
  const { maxLength = DEFAULT_MAX_LENGTH, prefix } = options;

  // Generate timestamp and random suffix
  const timestamp = generateTimestamp();
  const suffix = generateRandomSuffix();

  // Slugify and clean the name
  const sluggedName = slugify(name) || 'output';

  // Build filename parts
  const parts: string[] = [];
  if (prefix) {
    parts.push(slugify(prefix));
  }
  parts.push(timestamp);
  parts.push(sluggedName);
  parts.push(suffix);

  // Join with hyphens and add extension
  const baseName = parts.join('-');
  const fullName = `${baseName}.${extension}`;

  // Truncate if necessary
  return truncateToLength(fullName, maxLength);
}
