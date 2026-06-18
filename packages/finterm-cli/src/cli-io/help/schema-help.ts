/**
 * Schema help text generator.
 *
 * Generates INPUT SCHEMA help text from Zod schemas for CLI --help output.
 * Shows field names, types, descriptions, and constraints in a readable format.
 */

import type { z } from 'zod';
import { mapSchemaToOptions, type CLIOptionSpec } from '../input/schema-mapper';

/**
 * Column at which the trailing `# comment` is aligned, so that a block of field
 * lines forms an even, scannable table. Fields wider than this still get one
 * space of separation.
 */
const FIELD_COMMENT_COLUMN = 24;

/** Options for generating schema help */
export interface SchemaHelpOptions {
  /** Output format indicator (default: 'yaml') */
  format?: 'yaml' | 'json';
  /** Indentation spaces (default: 2) */
  indent?: number;
}

/** Options for formatting a field line */
export interface FieldLineOptions {
  /** Whether the field is required */
  required: boolean;
  /** Whether the field is an array */
  isArray: boolean;
  /** Field description */
  description?: string;
  /** Enum choices if applicable */
  choices?: string[];
  /** Default value if any */
  defaultValue?: unknown;
}

/**
 * Format a single field line for help output, aligning the comment column so a
 * block of fields reads as a tidy table.
 */
export function formatFieldLine(
  name: string,
  type: string,
  options: FieldLineOptions = { required: true, isArray: false }
): string {
  const { required = true, isArray = false, description, choices, defaultValue } = options;

  let typeStr = type;
  if (isArray) {
    typeStr = `${type}[]`;
  }

  const annotations: string[] = [];

  if (required) {
    annotations.push('required');
  } else {
    annotations.push('optional');
  }

  if (defaultValue !== undefined) {
    let defaultStr: string;
    if (typeof defaultValue === 'string') {
      defaultStr = `"${defaultValue}"`;
    } else if (typeof defaultValue === 'object' && defaultValue !== null) {
      defaultStr = JSON.stringify(defaultValue);
    } else {
      defaultStr = String(defaultValue);
    }
    annotations.push(`default: ${defaultStr}`);
  }

  if (choices && choices.length > 0) {
    annotations.push(`choices: ${choices.join(' | ')}`);
  }

  const parts: string[] = [];
  if (description) {
    parts.push(description);
  }
  if (annotations.length > 0) {
    parts.push(`(${annotations.join(', ')})`);
  }

  const comment = parts.length > 0 ? `# ${parts.join(' ')}` : '';

  const nameType = `${name}: ${typeStr}`;
  const padding = Math.max(1, FIELD_COMMENT_COLUMN - nameType.length);

  return `${nameType}${' '.repeat(padding)}${comment}`.trimEnd();
}

/**
 * Convert a CLIOptionSpec to a field line.
 */
function optionToFieldLine(option: CLIOptionSpec): string {
  return formatFieldLine(option.name, option.type, {
    required: option.required,
    isArray: option.isArray,
    description: option.description,
    choices: option.choices,
    defaultValue: option.defaultValue,
  });
}

/**
 * Format a Zod object schema as YAML-style help text.
 */
export function formatSchemaAsYaml(schema: z.ZodObject<z.ZodRawShape>, indent = 2): string {
  const options = mapSchemaToOptions(schema);
  const indentStr = ' '.repeat(indent);

  const lines = options.map((opt) => `${indentStr}${optionToFieldLine(opt)}`);

  return lines.join('\n');
}

/**
 * Generate complete INPUT SCHEMA help text from a Zod schema, including the
 * format header and one line per field (or a "(no fields)" placeholder).
 */
export function generateSchemaHelp(
  schema: z.ZodObject<z.ZodRawShape>,
  options: SchemaHelpOptions = {}
): string {
  const { format = 'yaml', indent = 2 } = options;

  const formatLabel = format.toUpperCase();
  const header = `INPUT SCHEMA (${formatLabel})`;

  const schemaOptions = mapSchemaToOptions(schema);

  if (schemaOptions.length === 0) {
    return `${header}\n${' '.repeat(indent)}(no fields)`;
  }

  const body = formatSchemaAsYaml(schema, indent);

  return `${header}\n${body}`;
}
