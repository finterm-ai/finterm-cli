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

/**
 * Format data as a JSON string. `undefined` renders as `null` so the output is
 * always valid JSON.
 */
export function formatAsJson(
  data: unknown,
  options: JsonFormatOptions = { compact: false }
): string {
  const { compact } = options;

  if (data === undefined) {
    return 'null';
  }

  if (compact) {
    return JSON.stringify(data);
  }

  return JSON.stringify(data, null, 2);
}

/**
 * Format data as a YAML string.
 */
export function formatAsYaml(data: unknown): string {
  return yaml.stringify(data);
}

/**
 * Format data as human-readable text: objects become key-value pairs and arrays
 * become numbered lists, recursing with deeper indentation for nested values.
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

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return `${prefix}(empty list)`;
    }

    return data
      .map((item, index) => {
        const itemText = formatAsText(item, { indent: indent + 1 });
        // Scalars stay on the index line; nested structures drop to their own lines.
        if (typeof item !== 'object' || item === null) {
          return `${prefix}${index + 1}. ${itemText}`;
        }
        return `${prefix}${index + 1}.\n${itemText}`;
      })
      .join('\n');
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) {
      return `${prefix}(empty object)`;
    }

    return entries
      .map(([key, value]) => {
        const valueText = formatAsText(value, { indent: indent + 1 });
        // Scalars stay on the key line; nested structures drop to their own lines.
        if (typeof value !== 'object' || value === null) {
          return `${prefix}${key}: ${valueText}`;
        }
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

/**
 * Format data in the requested output format, the single entry point command
 * handlers use to render a payload to text, JSON, or YAML.
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
