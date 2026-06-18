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

/** Supported file formats */
type FileFormat = 'json' | 'yaml';

/**
 * Detect file format from extension, defaulting to JSON for unknown extensions.
 */
function detectFormat(filePath: string): FileFormat {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    return 'yaml';
  }
  return 'json';
}

/**
 * Parse already-loaded content with Zod validation.
 *
 * Pure (no I/O), so it can be unit-tested directly with in-memory content.
 *
 * @throws ZodError if validation fails
 * @throws SyntaxError if parsing fails
 */
export function parseInputSync<T>(schema: z.ZodSchema<T>, content: string, format: FileFormat): T {
  const parsed: unknown = format === 'yaml' ? parseYaml(content) : JSON.parse(content);
  return schema.parse(parsed);
}

/**
 * Parse input from the first available source, in descending priority:
 * inline JSON, then a file (JSON/YAML by extension), then a CLI-args object.
 * Letting a single, explicit precedence drive selection keeps behavior
 * predictable when a user supplies more than one source.
 *
 * @throws Error if no source is provided
 * @throws ZodError if validation fails
 */
export async function parseInput<T>(
  schema: z.ZodSchema<T>,
  options: ParseInputOptions<T>
): Promise<ParsedInput<T>> {
  const { inputJson, inputFile, cliArgs } = options;

  if (inputJson !== undefined && inputJson !== null) {
    const parsed: unknown = JSON.parse(inputJson);
    const data = schema.parse(parsed);
    return { data, source: 'inline-json' };
  }

  if (inputFile !== undefined && inputFile !== null) {
    const content = await readFile(inputFile, 'utf-8');
    const format = detectFormat(inputFile);
    const data = parseInputSync(schema, content, format);
    return { data, source: 'file', filePath: inputFile };
  }

  if (cliArgs !== undefined && cliArgs !== null) {
    const data = schema.parse(cliArgs);
    return { data, source: 'cli' };
  }

  throw new Error('No input provided. Use --input-json, --input <file>, or provide CLI arguments.');
}
