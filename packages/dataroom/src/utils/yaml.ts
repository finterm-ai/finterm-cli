/**
 * YAML utilities with key ordering support.
 *
 * Uses the `yaml` package for parsing and serialization,
 * with helpers for consistent key ordering in output.
 *
 * @packageDocumentation
 */

import * as yaml from 'yaml';

import type { BlobCompressionConfig, CodecChoice } from '../types.js';

/**
 * Key ordering for dataroom.yml files.
 * Follows the "metadata first, then configuration" pattern.
 */
export const DATAROOM_KEY_ORDER = [
  'format',
  'type',
  'name',
  'profile',
  'title',
  'description',
  'capabilities',
  'blob_compression',
] as const;

/**
 * Key ordering for datalib.yml files.
 */
export const DATALIB_KEY_ORDER = [
  'format',
  'type',
  'name',
  'title',
  'description',
  'blob_compression',
  'blob_layers',
  'rooms',
] as const;

/**
 * Options for YAML serialization.
 */
export interface YamlStringifyOptions {
  /** Key ordering (keys not in array appear after ordered keys, alphabetically) */
  keyOrder?: readonly string[];
  /** Line width for wrapping. Default: 80 */
  lineWidth?: number;
  /** Use block style for strings. Default: true */
  blockQuote?: boolean;
  /** Include YAML header (---). Default: false */
  includeHeader?: boolean;
}

const DEFAULT_OPTIONS: Required<YamlStringifyOptions> = {
  keyOrder: [],
  lineWidth: 80,
  blockQuote: true,
  includeHeader: false,
};

/**
 * Create a sort function for object keys based on an ordering array.
 * Keys in the ordering appear first in that order, then remaining keys alphabetically.
 *
 * @param order - Array of keys in desired order
 * @returns Sort function for use with yaml.stringify sortMapEntries option
 */
export function createKeySorter(order: readonly string[]): (a: yaml.Pair, b: yaml.Pair) => number {
  const orderMap = new Map(order.map((key, index) => [key, index]));

  return (a: yaml.Pair, b: yaml.Pair) => {
    const aKey = String(a.key);
    const bKey = String(b.key);
    const aIndex = orderMap.get(aKey);
    const bIndex = orderMap.get(bKey);

    // Both keys are in the ordering array
    if (aIndex !== undefined && bIndex !== undefined) {
      return aIndex - bIndex;
    }

    // Only a is in the ordering array (comes first)
    if (aIndex !== undefined) {
      return -1;
    }

    // Only b is in the ordering array (comes first)
    if (bIndex !== undefined) {
      return 1;
    }

    // Neither is in ordering array, sort alphabetically
    return aKey.localeCompare(bKey);
  };
}

/**
 * Parse YAML string to object.
 *
 * @param content - YAML string content
 * @returns Parsed object
 * @throws Error if YAML is invalid
 */
export function parseYaml<T = unknown>(content: string): T {
  return yaml.parse(content) as T;
}

/**
 * Stringify object to YAML with optional key ordering.
 *
 * @param data - Object to stringify
 * @param options - Stringify options
 * @returns YAML string
 *
 * @example
 * ```typescript
 * stringifyYaml(metadata, { keyOrder: DATAROOM_KEY_ORDER })
 * // format: DR/0.1
 * // type: dataroom
 * // name: my-research
 * // title: My Research
 * ```
 */
export function stringifyYaml(data: unknown, options: YamlStringifyOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const yamlOptions: yaml.DocumentOptions &
    yaml.SchemaOptions &
    yaml.ParseOptions &
    yaml.CreateNodeOptions &
    yaml.ToStringOptions = {
    lineWidth: opts.lineWidth,
    // Use PLAIN for strings - block style should only be used for multiline
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  };

  // Apply key ordering if specified
  if (opts.keyOrder.length > 0) {
    yamlOptions.sortMapEntries = createKeySorter(opts.keyOrder);
  }

  let result = yaml.stringify(data, yamlOptions);

  // Add header if requested
  if (opts.includeHeader && !result.startsWith('---')) {
    result = '---\n' + result;
  }

  return result;
}

/**
 * Stringify dataroom metadata with proper key ordering.
 *
 * @param metadata - DataRoomMetadata object
 * @returns YAML string with ordered keys
 */
export function stringifyDataroomYaml(metadata: Record<string, unknown>): string {
  return stringifyYaml(metadata, { keyOrder: DATAROOM_KEY_ORDER });
}

/**
 * Stringify datalib metadata with proper key ordering.
 *
 * @param metadata - DataLibMetadata object
 * @returns YAML string with ordered keys
 */
export function stringifyDatalibYaml(metadata: Record<string, unknown>): string {
  return stringifyYaml(metadata, { keyOrder: DATALIB_KEY_ORDER });
}

/**
 * Read and parse a YAML file.
 *
 * @param content - File content as string
 * @returns Parsed object
 */
export function readYaml<T = unknown>(content: string): T {
  return parseYaml<T>(content);
}

// =============================================================================
// blob_compression snake_case ↔ camelCase mapping
// =============================================================================
//
// On disk the block is snake_case (dataroom format convention); in TS it is
// camelCase (project convention):
//
//   blob_compression      ↔ blobCompression
//   codec                 ↔ codec
//   min_size              ↔ minSize
//   skip_content_types    ↔ skipContentTypes
//
// Writers emit snake_case; readers accept both so hand-edited files round-trip.

/**
 * Convert a (partial) compression config to the on-disk snake_case block.
 * Only defined fields are emitted.
 */
export function blobCompressionToYaml(
  config: Partial<BlobCompressionConfig>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (config.codec !== undefined) out['codec'] = config.codec;
  if (config.minSize !== undefined) out['min_size'] = config.minSize;
  if (config.skipContentTypes !== undefined) {
    out['skip_content_types'] = [...config.skipContentTypes];
  }
  return out;
}

/**
 * Parse a `blob_compression` block (snake_case or camelCase) into a partial
 * camelCase config. Returns undefined when the input carries no recognized keys.
 */
export function blobCompressionFromYaml(raw: unknown): Partial<BlobCompressionConfig> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: Partial<BlobCompressionConfig> = {};

  const codec = r['codec'];
  if (typeof codec === 'string') out.codec = codec as CodecChoice;

  const minSize = r['min_size'] ?? r['minSize'];
  if (typeof minSize === 'number') out.minSize = minSize;

  const skip = r['skip_content_types'] ?? r['skipContentTypes'];
  if (Array.isArray(skip)) out.skipContentTypes = skip.map(String);

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Validate that required keys are present in a YAML object.
 *
 * @param obj - Object to validate
 * @param requiredKeys - Keys that must be present
 * @returns Array of missing keys (empty if all present)
 */
export function validateRequiredKeys(
  obj: Record<string, unknown>,
  requiredKeys: readonly string[]
): string[] {
  const missing: string[] = [];
  for (const key of requiredKeys) {
    if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
      missing.push(key);
    }
  }
  return missing;
}
