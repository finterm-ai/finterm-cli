/**
 * CLI session schemas.
 *
 * Defines Zod schemas for CLI session logging with explicit
 * stable/unstable field classification for golden test support.
 *
 * Stable fields: Deterministic, should match between test runs
 * Unstable fields: Non-deterministic (timestamps, IDs), filtered for golden tests
 */

import { z } from 'zod';

// =============================================================================
// Command Result Schema
// =============================================================================

/**
 * Schema for command execution result.
 */
export const CommandResultSchema = z.object({
  /** Whether the command succeeded */
  success: z.boolean(),
  /** Exit code of the command */
  exitCode: z.number(),
  /** Standard output */
  stdout: z.string(),
  /** Standard error (optional) */
  stderr: z.string().optional(),
});

/** Type for command result */
export type CommandResult = z.infer<typeof CommandResultSchema>;

// =============================================================================
// CLI Session Schema
// =============================================================================

/**
 * Schema for a complete CLI session log entry.
 */
export const CliSessionSchema = z.object({
  // Unstable fields (non-deterministic)
  /** Unique session identifier */
  sessionId: z.string(),
  /** Session start time (ISO 8601) */
  startTime: z.string(),
  /** Session end time (ISO 8601) */
  endTime: z.string(),
  /** Duration in milliseconds */
  durationMs: z.number(),
  /** Environment variables (optional, sensitive data should be redacted) */
  environment: z.record(z.string(), z.string()).optional(),

  // Stable fields (deterministic)
  /** Command name that was executed */
  command: z.string(),
  /** Command arguments (any JSON-serializable values) */
  args: z.looseObject({}),
  /** Command execution result */
  result: CommandResultSchema,
  /** Input file path if used (optional) */
  inputFile: z.string().optional(),
  /** Output file path if used (optional) */
  outputFile: z.string().optional(),
  /** CLI version (optional) */
  version: z.string().optional(),
});

/** Type for CLI session */
export type CliSession = z.infer<typeof CliSessionSchema>;

// =============================================================================
// Field Classification
// =============================================================================

/**
 * Stable fields - deterministic, should match between test runs.
 * These are used for golden test comparisons.
 */
export const STABLE_FIELDS: readonly string[] = [
  'command',
  'args',
  'result',
  'inputFile',
  'outputFile',
  'version',
] as const;

/**
 * Unstable fields - non-deterministic, filtered for golden tests.
 * These vary between runs (timestamps, IDs, environment).
 */
export const UNSTABLE_FIELDS: readonly string[] = [
  'sessionId',
  'startTime',
  'endTime',
  'durationMs',
  'environment',
] as const;

/**
 * Check if a field name is a stable field.
 *
 * @param fieldName - Field name to check
 * @returns True if the field is stable
 */
export function isStableField(fieldName: string): boolean {
  return STABLE_FIELDS.includes(fieldName);
}

/**
 * Check if a field name is an unstable field.
 *
 * @param fieldName - Field name to check
 * @returns True if the field is unstable
 */
export function isUnstableField(fieldName: string): boolean {
  return UNSTABLE_FIELDS.includes(fieldName);
}
