/**
 * Session filter.
 *
 * Filters unstable fields from CLI sessions for golden test support.
 * This enables deterministic comparisons between test runs by removing
 * or normalizing non-deterministic fields like timestamps and session IDs.
 */

import type { CliSession } from './schemas';
import { STABLE_FIELDS, UNSTABLE_FIELDS } from './schemas';

export type { CliSession };

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

/**
 * Keep only the deterministic fields of a session, dropping timestamps, IDs, and
 * other run-varying data so two runs can be compared directly.
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
 * Keep only the run-varying fields of a session, useful for extracting the
 * metadata (timestamps, IDs, environment) that the stable view omits.
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

/**
 * Replace a session's run-varying fields with fixed placeholders, yielding a
 * deterministic but still valid CliSession suitable for golden-test comparison.
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
