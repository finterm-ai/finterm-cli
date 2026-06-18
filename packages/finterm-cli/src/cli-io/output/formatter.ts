/**
 * Output formatter for CLI results.
 *
 * Supports multiple output formats:
 * - text: Human-readable key-value pairs
 * - json: Structured JSON with pretty-printing
 * - yaml: YAML format for config-style output
 *
 * Boundary vs `cli/lib/output.ts` (OutputManager): this module renders DOMAIN
 * DATA into a chosen format — pure string-in/string-out, no console, no colors,
 * no flag awareness. OutputManager owns the terminal: streams, semantic colors,
 * --json/--quiet/--verbose gating, icons, spinners. Command handlers format
 * payloads here (when they need yaml/kv rendering) and emit them through
 * OutputManager. Keep rendering logic out of OutputManager and terminal
 * concerns out of this module.
 */

import * as yaml from 'yaml';

// =============================================================================
// Types
// =============================================================================

/** Supported output formats */
export type OutputFormat = 'text' | 'json' | 'yaml';

/** Options for JSON formatting */
export interface JsonFormatOptions {
  /** Output compact JSON without indentation */
  compact: boolean;
}

/** Options for text formatting */
export interface TextFormatOptions {
  /** Indentation level for nested objects */
  indent?: number;
}

/** Combined format options */
export interface FormatOptions extends JsonFormatOptions, TextFormatOptions {}

// =============================================================================
// JSON Formatting
// =============================================================================

/**
 * Format data as JSON string.
 *
 * @param data - Data to format
 * @param options - Formatting options
 * @returns JSON string
 */
export function formatAsJson(
  data: unknown,
  options: JsonFormatOptions = { compact: false }
): string {
  const { compact } = options;

  // Handle undefined specially
  if (data === undefined) {
    return 'null';
  }

  if (compact) {
    return JSON.stringify(data);
  }

  return JSON.stringify(data, null, 2);
}

// =============================================================================
// YAML Formatting
// =============================================================================

/**
 * Format data as YAML string.
 *
 * @param data - Data to format
 * @returns YAML string
 */
export function formatAsYaml(data: unknown): string {
  return yaml.stringify(data);
}

// =============================================================================
// Text Formatting
// =============================================================================

/**
 * Format data as human-readable text.
 *
 * Objects become key-value pairs, arrays become numbered lists.
 *
 * @param data - Data to format
 * @param options - Formatting options
 * @returns Formatted text string
 */
export function formatAsText(data: unknown, options: TextFormatOptions = {}): string {
  const { indent = 0 } = options;
  const prefix = '  '.repeat(indent);

  // Handle primitives
  if (data === null) {
    return 'null';
  }

  if (data === undefined) {
    return 'undefined';
  }

  if (typeof data === 'string') {
    return data;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }

  // Handle arrays
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return `${prefix}(empty list)`;
    }

    return data
      .map((item, index) => {
        const itemText = formatAsText(item, { indent: indent + 1 });
        // For simple items, put on same line
        if (typeof item !== 'object' || item === null) {
          return `${prefix}${index + 1}. ${itemText}`;
        }
        // For complex items, put on new line
        return `${prefix}${index + 1}.\n${itemText}`;
      })
      .join('\n');
  }

  // Handle objects
  if (typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) {
      return `${prefix}(empty object)`;
    }

    return entries
      .map(([key, value]) => {
        const valueText = formatAsText(value, { indent: indent + 1 });
        // For simple values, put on same line
        if (typeof value !== 'object' || value === null) {
          return `${prefix}${key}: ${valueText}`;
        }
        // For complex values, put on new line
        return `${prefix}${key}:\n${valueText}`;
      })
      .join('\n');
  }

  // Fallback for unknown types
  if (typeof data === 'object' && data !== null) {
    return JSON.stringify(data);
  }
  return String(data);
}

// =============================================================================
// Unified Format Function
// =============================================================================

/**
 * Format data in the specified output format.
 *
 * @param data - Data to format
 * @param format - Output format (default: 'text')
 * @param options - Format-specific options
 * @returns Formatted string
 */
export function formatOutput(
  data: unknown,
  format: OutputFormat = 'text',
  options: FormatOptions = { compact: false }
): string {
  switch (format) {
    case 'json':
      return formatAsJson(data, options);
    case 'yaml':
      return formatAsYaml(data);
    case 'text':
    default:
      return formatAsText(data, options);
  }
}
