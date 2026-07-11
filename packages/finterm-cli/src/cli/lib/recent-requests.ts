/**
 * Local recent-requests ledger (`~/.finterm/recent-requests.json`).
 *
 * Records the last few API call outcomes — command line, tool, outcome, error
 * code, request id — so `finterm feedback bug --last` can attach the failing
 * call's context automatically. Modeled on the runs ledger in bundle-runs.ts:
 * atomic writes, corruption-tolerant reads, plus a cross-process lock so
 * parallel CLI invocations do not drop each other's entries.
 *
 * This is disposable diagnostics, not user data: recording is best-effort and
 * must never fail (or slow) the command that triggered it, a corrupt file is
 * silently replaced, command lines are secret-redacted BEFORE they reach
 * disk, and the file itself is written `0600`.
 */
import { mkdir, readFile, rm, stat } from 'node:fs/promises';

import { getRecentRequestsPath } from '../../cli-io/settings.js';
import { isExpectedFsError } from './errors.js';
import { writeFile } from './fs.js';
import { redactSecretLikeContent } from './secret-scrub.js';
import type { FintermWireResult } from './wire-result.js';

/** Current on-disk schema version for the recent-requests ledger. */
const RECENT_REQUESTS_VERSION = 1;

/** How many API call outcomes the ledger retains (newest first). */
export const MAX_RECENT_REQUESTS = 20;

/** Pretty-print spaces for the ledger JSON, matching the runs ledger. */
const JSON_PRETTY_PRINT_SPACES = 2;

/** Owner-only mode for the ledger file: command lines can be sensitive. */
const LEDGER_FILE_MODE = 0o600;

/** How long one lock attempt waits before retrying (ms). */
const LOCK_RETRY_DELAY_MS = 15;

/**
 * Total budget for acquiring the ledger lock before giving up (best-effort).
 * Sized so a burst of parallel CLI processes on a slow machine drains fully:
 * each holder keeps the lock for milliseconds, so even ten queued writers
 * finish well inside the budget. Uncontended acquisition is instant.
 */
const LOCK_ACQUIRE_BUDGET_MS = 2000;

/**
 * A lock directory older than this is from a dead process; steal it. Must
 * stay well above both a live holder's hold time (milliseconds) and the
 * acquire budget, so a waiter never steals from a slow-but-alive holder.
 */
const LOCK_STALE_MS = 8000;

/** How a recorded call ended. */
export type RecentRequestOutcome = 'ok' | 'error' | 'transport_error';

/** One recorded API call outcome. */
export interface RecentRequestEntry {
  /** ISO timestamp of the call. */
  at: string;
  /** The finterm command line that made the call (secret-redacted argv). */
  command: string;
  /** The snake_case tool id from the wire envelope (or fallback meta). */
  tool: string;
  /** How the call ended: wire success, wire error, or transport failure. */
  outcome: RecentRequestOutcome;
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

const VALID_OUTCOMES: ReadonlySet<string> = new Set(['ok', 'error', 'transport_error']);

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
    // Entries from before the outcome field default from the error code.
    const outcome =
      typeof entry.outcome === 'string' && VALID_OUTCOMES.has(entry.outcome)
        ? (entry.outcome as RecentRequestOutcome)
        : typeof entry.errorCode === 'string'
          ? 'error'
          : 'ok';
    requests.push({
      at: entry.at,
      command: entry.command,
      tool: entry.tool,
      outcome,
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
 * the interpreter and script path, with secret-shaped substrings redacted so
 * a token typed into a flag never reaches disk.
 */
export function commandLineFromArgv(argv: readonly string[] = process.argv): string {
  return redactSecretLikeContent(['finterm', ...argv.slice(2)].join(' '));
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
    outcome: 'error' in result ? 'error' : 'ok',
    ...('error' in result ? { errorCode: result.error.code } : {}),
    ...(typeof requestId === 'string' ? { requestId } : {}),
  };
}

/**
 * Build a ledger entry for a call that never produced a wire result at all —
 * a timeout, DNS/socket failure, or unparseable response. There is no request
 * id to correlate, but the failing command itself is exactly what a feedback
 * report needs.
 */
export function buildTransportFailureEntry(
  tool: string,
  error: unknown,
  argv: readonly string[] = process.argv
): RecentRequestEntry {
  return {
    at: new Date().toISOString(),
    command: commandLineFromArgv(argv),
    tool,
    outcome: 'transport_error',
    errorCode: error instanceof Error && error.name.length > 0 ? error.name : 'TransportError',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-process mutual exclusion via an atomic `mkdir` lock next to the
 * ledger. Best-effort: a lock that cannot be acquired inside the budget means
 * the write is skipped (losing one diagnostics entry beats blocking a data
 * command), and stale locks from dead processes are stolen after a timeout.
 */
async function withLedgerLock(ledgerPath: string, fn: () => Promise<void>): Promise<boolean> {
  const lockPath = `${ledgerPath}.lock`;
  const deadline = Date.now() + LOCK_ACQUIRE_BUDGET_MS;
  let acquiredAt: number | null = null;
  while (Date.now() < deadline) {
    try {
      await mkdir(lockPath);
      acquiredAt = Date.now();
      break;
    } catch {
      // Lock held: steal it if it looks abandoned, otherwise wait and retry.
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // Raced with the holder's release; retry immediately.
        continue;
      }
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }
  if (acquiredAt === null) {
    return false;
  }
  try {
    await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
  return true;
}

/**
 * Prepend one entry, trim to {@link MAX_RECENT_REQUESTS}, write atomically
 * (`0600`) under the cross-process lock. Best-effort by contract: any failure
 * is swallowed — the diagnostics ledger must never break the data command
 * that fed it.
 */
export async function recordRecentRequest(entry: RecentRequestEntry): Promise<void> {
  try {
    const ledgerPath = getRecentRequestsPath();
    await withLedgerLock(ledgerPath, async () => {
      const ledger = await readFileTolerant(ledgerPath);
      ledger.requests = [entry, ...ledger.requests].slice(0, MAX_RECENT_REQUESTS);
      await writeFile(ledgerPath, JSON.stringify(ledger, null, JSON_PRETTY_PRINT_SPACES), {
        mode: LEDGER_FILE_MODE,
      });
    });
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
  return requests.find((entry) => entry.outcome !== 'ok') ?? requests[0] ?? null;
}
