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

/** Default maximum filename length (excluding path) */
export const DEFAULT_MAX_LENGTH = 128;

/** Characters to remove during slugification */
const REMOVE_REGEX = /[*+~.()'"!:@#$%^&=]/g;

/**
 * Convert a string to a filesystem-safe slug: lowercased, spaces to hyphens,
 * special characters removed, and unicode folded to ASCII.
 */
export function slugify(text: string): string {
  if (!text) return '';

  return slugifyLib(text, {
    lower: true,
    strict: true,
    remove: REMOVE_REGEX,
  });
}

/**
 * Truncate a string to a maximum length, preserving any trailing extension so
 * the result stays a usable filename rather than losing its suffix.
 */
export function truncateToLength(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }

  const extMatch = /\.[a-zA-Z0-9]+$/.exec(text);
  const extension = extMatch ? extMatch[0] : '';
  const extLength = extension.length;

  const availableLength = maxLength - extLength;
  if (availableLength <= 0) {
    return text.slice(0, maxLength);
  }

  const namePortion = text.slice(0, text.length - extLength);
  return namePortion.slice(0, availableLength) + extension;
}

/**
 * Generate a UTC timestamp string for filenames in `YYYYMMDD-HHMMSS` form, so
 * names sort chronologically and stay consistent across time zones.
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
 * Generate a short random suffix to disambiguate files created within the same
 * second, where the timestamp alone would collide.
 */
function generateRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Options controlling generated filenames */
export interface FilenameOptions {
  /** Maximum total length of filename (default: 128) */
  maxLength?: number;
  /** Prefix to add before timestamp */
  prefix?: string;
}

/**
 * Generate a filename of the form `[prefix-]YYYYMMDD-HHMMSS-name.ext`, slugifying
 * the name (and prefix) and truncating to fit `maxLength`.
 */
export function generateFilename(
  name: string,
  extension = 'json',
  options: FilenameOptions = {}
): string {
  const { maxLength = DEFAULT_MAX_LENGTH, prefix } = options;

  const timestamp = generateTimestamp();
  const sluggedName = slugify(name) || 'output';

  const parts: string[] = [];
  if (prefix) {
    parts.push(slugify(prefix));
  }
  parts.push(timestamp);
  parts.push(sluggedName);

  const baseName = parts.join('-');
  const fullName = `${baseName}.${extension}`;

  return truncateToLength(fullName, maxLength);
}

/**
 * Like {@link generateFilename} but appends a random suffix
 * (`YYYYMMDD-HHMMSS-name-suffix.ext`) to avoid collisions when many files are
 * created within the same second.
 */
export function generateUniqueFilename(
  name: string,
  extension = 'json',
  options: FilenameOptions = {}
): string {
  const { maxLength = DEFAULT_MAX_LENGTH, prefix } = options;

  const timestamp = generateTimestamp();
  const suffix = generateRandomSuffix();
  const sluggedName = slugify(name) || 'output';

  const parts: string[] = [];
  if (prefix) {
    parts.push(slugify(prefix));
  }
  parts.push(timestamp);
  parts.push(sluggedName);
  parts.push(suffix);

  const baseName = parts.join('-');
  const fullName = `${baseName}.${extension}`;

  return truncateToLength(fullName, maxLength);
}
