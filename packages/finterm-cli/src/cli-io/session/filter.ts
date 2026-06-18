/**
 * Session filter.
 *
 * Filters unstable fields from CLI sessions for golden test support.
 * This enables deterministic comparisons between test runs by removing
 * or normalizing non-deterministic fields like timestamps and session IDs.
 */

import type { CliSession } from './schemas';
import { STABLE_FIELDS, UNSTABLE_FIELDS } from './schemas';

// Re-export CliSession type for convenience
export type { CliSession };

// =============================================================================
// Types
// =============================================================================

/** Partial session with only stable fields */
export type StableSession = Pick<
  CliSession,
  'command' | 'args' | 'result' | 'inputFile' | 'outputFile' | 'version'
>;

/** Partial session with only unstable fields */
export type UnstableSession = Pick<
  CliSession,
  'sessionId' | 'startTime' | 'endTime' | 'durationMs' | 'environment'
>;

/** Options for normalizing sessions */
export interface FilterOptions {
  /** Placeholder for session ID (default: '<session-id>') */
  sessionIdPlaceholder?: string;
  /** Placeholder for timestamps (default: '<timestamp>') */
  timestampPlaceholder?: string;
  /** Placeholder for duration (default: 0) */
  durationPlaceholder?: number;
}

// =============================================================================
// Field Filtering
// =============================================================================

/**
 * Filter out unstable fields from a session, keeping only stable fields.
 *
 * This is useful for golden test comparisons where you want to ignore
 * non-deterministic data like timestamps and session IDs.
 *
 * @param session - The full CLI session
 * @returns Session with only stable fields
 */
export function filterUnstableFields(session: CliSession): Partial<StableSession> {
  const result: Partial<StableSession> = {};

  for (const field of STABLE_FIELDS) {
    const key = field as keyof CliSession;
    if (key in session && session[key] !== undefined) {
      Object.assign(result, { [key]: session[key] });
    }
  }

  return result;
}

/**
 * Filter out stable fields from a session, keeping only unstable fields.
 *
 * This is useful for extracting metadata that varies between runs.
 *
 * @param session - The full CLI session
 * @returns Session with only unstable fields
 */
export function filterStableFields(session: CliSession): Partial<UnstableSession> {
  const result: Partial<UnstableSession> = {};

  for (const field of UNSTABLE_FIELDS) {
    const key = field as keyof CliSession;
    if (key in session && session[key] !== undefined) {
      Object.assign(result, { [key]: session[key] });
    }
  }

  return result;
}

// =============================================================================
// Session Normalization
// =============================================================================

/**
 * Normalize a session by replacing unstable fields with placeholders.
 *
 * This produces a deterministic session object suitable for golden test
 * comparisons. The result is still a valid CliSession but with all
 * unstable fields replaced by fixed values.
 *
 * @param session - The full CLI session
 * @param options - Normalization options
 * @returns Normalized session with placeholder values for unstable fields
 */
export function normalizeSession(session: CliSession, options: FilterOptions = {}): CliSession {
  const {
    sessionIdPlaceholder = '<session-id>',
    timestampPlaceholder = '<timestamp>',
    durationPlaceholder = 0,
  } = options;

  return {
    // Unstable fields - replaced with placeholders
    sessionId: sessionIdPlaceholder,
    startTime: timestampPlaceholder,
    endTime: timestampPlaceholder,
    durationMs: durationPlaceholder,
    environment: {},

    // Stable fields - copied as-is
    command: session.command,
    args: session.args,
    result: session.result,
    inputFile: session.inputFile,
    outputFile: session.outputFile,
    version: session.version,
  };
}
