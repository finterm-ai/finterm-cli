/**
 * Input parser for CLI commands.
 *
 * Supports multiple input sources with priority:
 * 1. Inline JSON (--input-json)
 * 2. File input (--input) - JSON or YAML
 * 3. CLI arguments
 *
 * All inputs are validated against a Zod schema.
 */

import type { z } from 'zod';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { parse as parseYaml } from 'yaml';

// =============================================================================
// Types
// =============================================================================

/** Source of parsed input */
export type InputSource = 'cli' | 'file' | 'inline-json';

/** Result of parsing input */
export interface ParsedInput<T> {
  /** The validated data */
  data: T;
  /** Where the input came from */
  source: InputSource;
  /** File path if input came from a file */
  filePath?: string;
}

/** Options for parseInput */
export interface ParseInputOptions<T> {
  /** Inline JSON string (highest priority) */
  inputJson?: string;
  /** Path to input file (JSON or YAML) */
  inputFile?: string;
  /** CLI arguments object (lowest priority) */
  cliArgs?: Partial<T>;
}

// =============================================================================
// Format Detection
// =============================================================================

/** Supported file formats */
type FileFormat = 'json' | 'yaml';

/**
 * Detect file format from extension.
 *
 * @param filePath - Path to the file
 * @returns Detected format, defaults to 'json'
 */
function detectFormat(filePath: string): FileFormat {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    return 'yaml';
  }
  return 'json';
}

// =============================================================================
// Synchronous Parsing
// =============================================================================

/**
 * Parse content synchronously with Zod validation.
 *
 * This is a pure function - useful for testing with pre-loaded content.
 *
 * @param schema - Zod schema to validate against
 * @param content - Raw content string
 * @param format - Content format ('json' or 'yaml')
 * @returns Validated data
 * @throws ZodError if validation fails
 * @throws SyntaxError if parsing fails
 */
export function parseInputSync<T>(schema: z.ZodSchema<T>, content: string, format: FileFormat): T {
  const parsed: unknown = format === 'yaml' ? parseYaml(content) : JSON.parse(content);
  return schema.parse(parsed);
}

// =============================================================================
// Async Parsing
// =============================================================================

/**
 * Parse input from multiple sources with Zod validation.
 *
 * Priority order:
 * 1. inputJson - Inline JSON string (highest priority)
 * 2. inputFile - File path (JSON or YAML based on extension)
 * 3. cliArgs - CLI arguments object (lowest priority)
 *
 * @param schema - Zod schema to validate against
 * @param options - Input options
 * @returns Parsed and validated input with source info
 * @throws Error if no valid input provided
 * @throws ZodError if validation fails
 */
export async function parseInput<T>(
  schema: z.ZodSchema<T>,
  options: ParseInputOptions<T>
): Promise<ParsedInput<T>> {
  const { inputJson, inputFile, cliArgs } = options;

  // Priority 1: Inline JSON
  if (inputJson !== undefined && inputJson !== null) {
    const parsed: unknown = JSON.parse(inputJson);
    const data = schema.parse(parsed);
    return { data, source: 'inline-json' };
  }

  // Priority 2: File input
  if (inputFile !== undefined && inputFile !== null) {
    const content = await readFile(inputFile, 'utf-8');
    const format = detectFormat(inputFile);
    const data = parseInputSync(schema, content, format);
    return { data, source: 'file', filePath: inputFile };
  }

  // Priority 3: CLI arguments
  if (cliArgs !== undefined && cliArgs !== null) {
    const data = schema.parse(cliArgs);
    return { data, source: 'cli' };
  }

  // No valid input
  throw new Error('No input provided. Use --input-json, --input <file>, or provide CLI arguments.');
}
