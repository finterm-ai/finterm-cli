/**
 * Local recent-requests ledger (`~/.finterm/recent-requests.json`).
 *
 * Records the last few API call outcomes — command line, tool, error code,
 * request id — so `finterm feedback bug --last` can attach the failing call's
 * context automatically (Phase 2 of the user feedback loop). Modeled on the
 * runs ledger in bundle-runs.ts: atomic writes, corruption-tolerant reads.
 *
 * This is disposable diagnostics, not user data: recording is best-effort and
 * must never fail (or slow) the command that triggered it, and a corrupt file
 * is silently replaced.
 */
import { readFile } from 'node:fs/promises';

import { getRecentRequestsPath } from '../../cli-io/settings.js';
import { isExpectedFsError } from './errors.js';
import { writeFile } from './fs.js';
import type { FintermWireResult } from './wire-result.js';

/** Current on-disk schema version for the recent-requests ledger. */
const RECENT_REQUESTS_VERSION = 1;

/** How many API call outcomes the ledger retains (newest first). */
export const MAX_RECENT_REQUESTS = 20;

/** Pretty-print spaces for the ledger JSON, matching the runs ledger. */
const JSON_PRETTY_PRINT_SPACES = 2;

/** One recorded API call outcome. */
export interface RecentRequestEntry {
  /** ISO timestamp of the call. */
  at: string;
  /** The finterm command line that made the call (sanitized argv). */
  command: string;
  /** The snake_case tool id from the wire envelope. */
  tool: string;
  /** The wire error code, present only when the call failed. */
  errorCode?: string;
  /** The server request id, when the envelope carried one. */
  requestId?: string;
}

interface RecentRequestsFile {
  version: number;
  requests: RecentRequestEntry[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Tolerate any on-disk shape: keep only well-formed entries, else start fresh. */
function normalizeFile(value: unknown): RecentRequestsFile {
  const object = asObject(value);
  if (!object || !Array.isArray(object.requests)) {
    return { version: RECENT_REQUESTS_VERSION, requests: [] };
  }
  const requests: RecentRequestEntry[] = [];
  for (const raw of object.requests) {
    const entry = asObject(raw);
    if (
      typeof entry?.at !== 'string' ||
      typeof entry.command !== 'string' ||
      typeof entry.tool !== 'string'
    ) {
      continue;
    }
    requests.push({
      at: entry.at,
      command: entry.command,
      tool: entry.tool,
      ...(typeof entry.errorCode === 'string' ? { errorCode: entry.errorCode } : {}),
      ...(typeof entry.requestId === 'string' ? { requestId: entry.requestId } : {}),
    });
  }
  return { version: RECENT_REQUESTS_VERSION, requests };
}

async function readFileTolerant(ledgerPath: string): Promise<RecentRequestsFile> {
  try {
    const content = await readFile(ledgerPath, 'utf-8');
    return normalizeFile(JSON.parse(content));
  } catch (error) {
    if (isExpectedFsError(error) || error instanceof SyntaxError) {
      // Disposable diagnostics: a missing or corrupt ledger just starts fresh.
      return { version: RECENT_REQUESTS_VERSION, requests: [] };
    }
    throw error;
  }
}

/**
 * Reconstruct the user-facing `finterm ...` command line from argv, without
 * the interpreter and script path.
 */
export function commandLineFromArgv(argv: readonly string[] = process.argv): string {
  return ['finterm', ...argv.slice(2)].join(' ');
}

/**
 * Build a ledger entry from a rendered wire result: tool and request id from
 * the envelope, error code from the error variant.
 */
export function buildRecentRequestEntry(
  result: FintermWireResult<unknown>,
  argv: readonly string[] = process.argv
): RecentRequestEntry {
  const requestId = result.finterm.request_id;
  return {
    at: new Date().toISOString(),
    command: commandLineFromArgv(argv),
    tool: result.finterm.tool,
    ...('error' in result ? { errorCode: result.error.code } : {}),
    ...(typeof requestId === 'string' ? { requestId } : {}),
  };
}

/**
 * Prepend one entry, trim to {@link MAX_RECENT_REQUESTS}, write atomically.
 * Best-effort by contract: any failure is swallowed — the diagnostics ledger
 * must never break the data command that fed it.
 */
export async function recordRecentRequest(entry: RecentRequestEntry): Promise<void> {
  try {
    const ledgerPath = getRecentRequestsPath();
    const ledger = await readFileTolerant(ledgerPath);
    ledger.requests = [entry, ...ledger.requests].slice(0, MAX_RECENT_REQUESTS);
    await writeFile(ledgerPath, JSON.stringify(ledger, null, JSON_PRETTY_PRINT_SPACES));
  } catch {
    // Best-effort: never propagate.
  }
}

/** Read the recorded outcomes, newest first. */
export async function listRecentRequests(): Promise<RecentRequestEntry[]> {
  const ledger = await readFileTolerant(getRecentRequestsPath());
  return ledger.requests;
}

/**
 * The entry `--last` should attach: the most recent failed call when one
 * exists (a bug report almost always follows an error), otherwise the most
 * recent call of any outcome. Null when nothing is recorded.
 */
export async function pickLastRequestForFeedback(): Promise<RecentRequestEntry | null> {
  const requests = await listRecentRequests();
  return requests.find((entry) => entry.errorCode !== undefined) ?? requests[0] ?? null;
}
