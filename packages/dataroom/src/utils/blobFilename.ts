/**
 * Blob filename generation utilities.
 *
 * Generates self-describing filenames in the format:
 * {source}_{type}_{identifier}_{hash12}.{ext}
 *
 * @packageDocumentation
 */

import { basename } from 'node:path';

import { hash12 } from './hash.js';
import { extractDomain } from './urlNormalize.js';
import type { BlobEntry } from '../types.js';

/**
 * Maximum length for filename components (excluding extension).
 * Keeps filenames reasonable while preserving readability.
 */
const MAX_COMPONENT_LENGTH = 30;

/**
 * Maximum total filename length (excluding extension).
 */
const MAX_FILENAME_LENGTH = 80;

const KNOWN_CODEC_SUFFIXES = ['.gz', '.zst', '.br'] as const;

function splitCodecSuffix(filename: string): { logical: string } {
  for (const suffix of KNOWN_CODEC_SUFFIXES) {
    if (filename.endsWith(suffix)) {
      return { logical: filename.slice(0, -suffix.length) };
    }
  }
  return { logical: filename };
}

/**
 * Sanitize a string for use in filenames.
 * - Converts to lowercase
 * - Replaces non-alphanumeric chars with underscores
 * - Collapses multiple underscores
 * - Removes leading/trailing underscores
 * - Truncates to max length
 *
 * @param str - String to sanitize
 * @param maxLength - Maximum length (default: MAX_COMPONENT_LENGTH)
 * @returns Sanitized string safe for filenames
 *
 * @example
 * ```typescript
 * sanitizeForFilename('User Name (Admin)')
 * // => 'user_name_admin'
 *
 * sanitizeForFilename('Report-2025-Q4')
 * // => 'report_2025_q4'
 * ```
 */
export function sanitizeForFilename(str: string, maxLength: number = MAX_COMPONENT_LENGTH): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with underscore
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, '') // Remove leading/trailing underscores
    .slice(0, maxLength);
}

/**
 * Options for generating blob filenames.
 */
export interface BlobFilenameOptions {
  /** Source identifier (e.g., 'api', 'github', 'web') */
  source: string;
  /** Type or category (e.g., 'records', 'repos', 'page') */
  type?: string;
  /** Specific identifier (e.g., 'item_2025', 'octocat') */
  identifier?: string;
  /** Content or URL to hash for uniqueness */
  content: string | Buffer;
  /** File extension (without dot, e.g., 'json', 'html') */
  extension: string;
}

/**
 * Generate a self-describing blob filename.
 *
 * Format: {source}_{type}_{identifier}_{hash12}.{ext}
 *
 * @param options - Filename generation options
 * @returns Generated filename
 *
 * @example
 * ```typescript
 * generateBlobFilename({
 *   source: 'api',
 *   type: 'records',
 *   identifier: 'item_2025',
 *   content: jsonData,
 *   extension: 'json'
 * })
 * // => 'api_records_item_2025_a3b4c5d6e7f8.json'
 *
 * generateBlobFilename({
 *   source: 'web',
 *   type: 'page',
 *   identifier: 'docs_example_com',
 *   content: htmlContent,
 *   extension: 'html'
 * })
 * // => 'web_page_docs_example_com_e7f8g9h0i1j2.html'
 * ```
 */
export function generateBlobFilename(options: BlobFilenameOptions): string {
  const { source, type, identifier, content, extension } = options;

  // Build components
  const components: string[] = [sanitizeForFilename(source)];

  if (type) {
    components.push(sanitizeForFilename(type));
  }

  if (identifier) {
    components.push(sanitizeForFilename(identifier));
  }

  // Add hash for uniqueness
  const contentHash = hash12(content);
  components.push(contentHash);

  // Join and truncate if needed
  let basename = components.join('_');
  if (basename.length > MAX_FILENAME_LENGTH) {
    // Keep hash at the end, truncate middle parts
    const hashLen = contentHash.length;
    const availableLen = MAX_FILENAME_LENGTH - hashLen - 1; // -1 for underscore before hash
    const prefix = components.slice(0, -1).join('_').slice(0, availableLen);
    basename = `${prefix}_${contentHash}`;
  }

  return `${basename}.${extension}`;
}

/**
 * Generate a blob filename for a URL fetch.
 *
 * @param url - Original URL
 * @param content - Fetched content
 * @param extension - File extension
 * @returns Generated filename
 *
 * @example
 * ```typescript
 * generateUrlBlobFilename('https://docs.example.com/api.html', htmlContent, 'html')
 * // => 'web_docs_example_com_a3b4c5d6e7f8.html'
 * ```
 */
export function generateUrlBlobFilename(
  url: string,
  content: string | Buffer,
  extension: string
): string {
  const domain = extractDomain(url);

  return generateBlobFilename({
    source: 'web',
    identifier: domain,
    content,
    extension,
  });
}

/**
 * Generate a blob filename for an API response.
 *
 * @param provider - API provider (e.g., 'api', 'github')
 * @param endpoint - API endpoint (e.g., 'records', 'repos')
 * @param identifier - Specific identifier (e.g., 'item_2025')
 * @param content - API response content
 * @param extension - File extension (default: 'json')
 * @returns Generated filename
 *
 * @example
 * ```typescript
 * generateApiBlobFilename('api', 'records', 'item_2025', jsonData)
 * // => 'api_records_item_2025_a3b4c5d6e7f8.json'
 * ```
 */
export function generateApiBlobFilename(
  provider: string,
  endpoint: string,
  identifier: string,
  content: string | Buffer,
  extension: string = 'json'
): string {
  return generateBlobFilename({
    source: provider,
    type: endpoint,
    identifier,
    content,
    extension,
  });
}

/**
 * Logical blob filename (the index key) for a blob entry.
 *
 * The index is keyed on the logical filename, while `entry.path` may carry a
 * codec suffix (e.g. `foo.html.gz`). The suffix is stripped only when
 * `entry.encoding` is set, so a blob that legitimately ends in a codec
 * extension but is stored raw (e.g. a downloaded `archive.gz`, encoding absent)
 * keeps its full name.
 *
 * @param entry - Blob entry (needs `path` and `encoding`)
 * @returns Logical filename without the `blobs/` prefix or codec suffix
 */
export function logicalBlobFilename(entry: Pick<BlobEntry, 'path' | 'encoding'>): string {
  const base = basename(entry.path);
  return entry.encoding ? splitCodecSuffix(base).logical : base;
}

/**
 * Extract extension from a filename or content type.
 *
 * @param filename - Filename or path
 * @returns Extension without dot, or empty string if none
 */
export function extractExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return '';
  }
  return filename.slice(lastDot + 1).toLowerCase();
}
