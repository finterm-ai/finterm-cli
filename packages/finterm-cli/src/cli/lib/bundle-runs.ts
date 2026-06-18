/**
 * Local bundle run ledger, agent-facing status shaping, and sync-manifest download.
 *
 * The live download path implements the pinned artifact delivery contract:
 * `GET /api/v1/runs/{runId}/sync-manifest` lists every room file with a signed HTTPS
 * URL plus sha256/bytes, and the CLI diffs that manifest against the local sync state
 * (`<room>/.finterm/sync-state.json`) so re-runs only download missing/changed files.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { getRunLedgerPath } from '../../cli-io/settings.js';
import type {
  BundleArtifactsData,
  BundleRunData,
  FintermAPIClient,
  SyncManifestData,
} from '../../lib/api-client.js';
import { MANIFEST_NOT_READY_ERROR_CODE } from '../../lib/api-client.js';
import { isExpectedFsError, CLIError } from './errors.js';
import { pathExists, writeFile } from './fs.js';
import { getFintermWireData, toFintermWireResult } from './wire-result.js';

/** Current on-disk schema version for the local bundle run ledger. */
const RUN_LEDGER_VERSION = 1;

/** Default number of recent runs displayed by `finterm runs list`. */
const DEFAULT_RUN_LIST_LIMIT = 20;

/** Number of seconds in one minute, used for readable wait timeout constants. */
const SECONDS_PER_MINUTE = 60;

/** Number of milliseconds in one second, used for readable wait timeout constants. */
const MILLISECONDS_PER_SECOND = 1_000;

/** Default interval between bundle status polls. */
const DEFAULT_POLL_INTERVAL_MS = 2_000;

/** Default wait timeout in minutes before returning resumable state. */
const DEFAULT_WAIT_TIMEOUT_MINUTES = 10;

/** Default maximum time that `finterm bundle wait` polls before returning resumable state. */
const DEFAULT_WAIT_TIMEOUT_MS =
  DEFAULT_WAIT_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

/** Default number of consecutive status read failures tolerated during polling. */
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;

/** Minimum string or collection length treated as containing usable content. */
const MIN_NON_EMPTY_LENGTH = 1;

/** Array index used when taking a prefix from the start of a collection. */
const ARRAY_START_INDEX = 0;

/** Initial consecutive error count before polling has observed any failures. */
const INITIAL_CONSECUTIVE_ERROR_COUNT = 0;

/** Amount added when a polling attempt fails. */
const CONSECUTIVE_ERROR_INCREMENT = 1;

/** Number of spaces used for deterministic human-readable JSON files. */
const JSON_PRETTY_PRINT_SPACES = 2;

/** Current on-disk schema version for the per-room sync state file. */
const SYNC_STATE_VERSION = 1;

/** Room-relative location of the CLI sync bookkeeping file. */
const SYNC_STATE_RELATIVE_PATH = '.finterm/sync-state.json';

/** Maximum number of files downloaded concurrently from signed URLs. */
const MAX_CONCURRENT_DOWNLOADS = 8;

/**
 * HTTP statuses storage backends return for expired/invalid signed URLs: S3-style
 * backends answer 403, while GCS V4 signed URLs commonly answer 400 (ExpiredToken)
 * and some backends 401. Any of these triggers the at-most-once manifest refresh.
 */
const EXPIRED_SIGNED_URL_HTTP_STATUSES = new Set([400, 401, 403]);

/** Number of random bytes used to make temp download filenames unique. */
const TEMP_SUFFIX_RANDOM_BYTES = 4;

/** Hex-encoded SHA-256 digests are exactly this long. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Default wait and retry settings for long-running bundle polling. */
export const BUNDLE_WAIT_DEFAULTS = {
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  timeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
  maxConsecutiveErrors: DEFAULT_MAX_CONSECUTIVE_ERRORS,
} as const;

const TERMINAL_RUN_STATES = new Set<BundleRunState>([
  'succeeded',
  'failed',
  'cancelled',
  'expired',
]);
const WAITABLE_RUN_STATES = new Set<BundleRunState>(['queued', 'running']);

export type BundleRunState = BundleRunData['status'];

export type BundleRunNextAction =
  | 'wait'
  | 'download'
  | 'result'
  | 'inspect_error'
  | 'resume_later'
  | 'done';

/** API error code returned when a bundle run id does not exist (never retried). */
const RUN_NOT_FOUND_ERROR_CODE = 'RUN_NOT_FOUND';

function bundleResponseFallbackMeta(
  schema: string,
  tool: string,
  runId: string
): { schema: string; tool: string; args: Record<string, unknown> } {
  return {
    schema,
    tool,
    args: { run_id: runId },
  };
}

/**
 * True when the error carries the RUN_NOT_FOUND code, whatever layer threw it:
 * `CLIError` (mock-envelope path) or `APIRequestError` (live HTTP path) both expose
 * the machine-readable code as `error.code`.
 */
function isRunNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: unknown }).code === RUN_NOT_FOUND_ERROR_CODE
  );
}

/**
 * One resumable bundle run recorded in the local ledger.
 */
export interface RunLedgerEntry {
  runId: string;
  bundleName?: string;
  ticker?: string;
  account?: string;
  createdAt: string;
  updatedAt: string;
  state?: BundleRunState;
  status?: BundleRunState;
  links?: Record<string, string>;
  artifactIds?: string[];
  targetOutputPath?: string;
  localPaths?: {
    room?: string;
    files?: string[];
  };
  nextAction?: BundleRunNextAction;
}

interface RunLedgerFile {
  version: typeof RUN_LEDGER_VERSION;
  runs: RunLedgerEntry[];
}

/**
 * Agent-facing status response shared by text and JSON command output.
 */
export interface AgentRunStatus {
  runId: string;
  bundleName?: string;
  ticker?: string;
  account?: string;
  state: BundleRunState;
  status: BundleRunState;
  links: Record<string, string>;
  artifactIds: string[];
  artifacts: Record<string, unknown>[];
  /** Sync-manifest availability, probed only when the run links a sync manifest. */
  syncManifest?: 'ready' | 'not_ready';
  localPaths: {
    ledger: string;
    room?: string;
    files?: string[];
  };
  nextAction: BundleRunNextAction;
  message: string;
}

/**
 * Polling controls for `finterm bundle wait`.
 */
export interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  maxErrors?: number;
  onPoll?: (status: AgentRunStatus) => void;
}

/**
 * Web-compatible fetch used for signed artifact URLs. Injectable so tests can serve
 * manifest files from local fixtures (and simulate expired-URL 403s) without a network.
 */
export type SignedUrlFetcher = (url: string) => Promise<Response>;

/**
 * Local artifact materialization controls for `finterm bundle download`.
 */
export interface DownloadOptions {
  mode: 'new' | 'merge';
  room?: string;
  fixtureArtifactsPath?: string;
  /** Test seam: replaces global fetch for signed-URL downloads. */
  fetcher?: SignedUrlFetcher;
}

/** One room file the download command materialized or verified. */
export interface SyncedFileResult {
  /** Room-relative POSIX path. */
  path: string;
  bytes: number;
  sha256: string;
  action: 'downloaded' | 'verified';
}

/** Basic transfer and sync statistics for a bundle room download attempt. */
export interface DownloadStats {
  /** Number of files declared by the sync manifest or fixture plan. */
  totalFiles: number;
  /** Number of files written during this command invocation. */
  downloadedFiles: number;
  /** Number of files already present with matching content. */
  verifiedFiles: number;
  /** Number of files left untouched because merge policy kept a local copy. */
  skippedFiles: number;
  /** Declared bytes across all planned files. */
  totalBytes: number;
  /** Bytes written during this command invocation. */
  downloadedBytes: number;
  /** Bytes already present with matching content. */
  verifiedBytes: number;
  /** Declared bytes for files left untouched by merge policy. */
  skippedBytes: number;
  /** End-to-end elapsed time for status, manifest, diff, and file sync work. */
  durationMs: number;
  /** Bytes written per second during this command invocation. */
  throughputBytesPerSecond: number;
  /** Activity-summary alias for bytes written per second. */
  downloadThroughputBytesPerSecond: number;
}

/**
 * Result of syncing bundle run artifacts into a local room.
 */
export interface DownloadResult {
  runId: string;
  state: BundleRunState;
  nextAction: BundleRunNextAction;
  /** Room format declared by the sync manifest (absent in fixture mode). */
  roomFormat?: string;
  /** Room profile declared by the sync manifest (absent in fixture mode). */
  roomProfile?: string;
  files: SyncedFileResult[];
  downloadedCount: number;
  verifiedCount: number;
  stats: DownloadStats;
  /** Non-fatal issues, e.g. merge collisions where the existing file was kept. */
  warnings: string[];
  localPaths: {
    ledger: string;
    room: string;
    files: string[];
  };
  message: string;
}

export function getRunLedgerFilePath(): string {
  return getRunLedgerPath();
}

function nowIso(): string {
  return new Date().toISOString();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length >= MIN_NON_EMPTY_LENGTH ? value : undefined;
}

function asStringRecord(value: unknown): Record<string, string> {
  const object = asObject(value);
  if (!object) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(object)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return result;
}

function getRunTicker(run: BundleRunData): string | undefined {
  const ticker = run.normalizedRequest.ticker;
  return typeof ticker === 'string' && ticker.length >= MIN_NON_EMPTY_LENGTH ? ticker : undefined;
}

/**
 * Delivery mode the server normalized for this run. Only `dataroom_sync` runs are
 * expected to publish a sync manifest; other modes (e.g. `inline_result`) may never
 * publish one, so MANIFEST_NOT_READY must not make them wait forever.
 */
function getRunDeliveryMode(run: BundleRunData): string | undefined {
  return asString(run.normalizedRequest.deliveryMode);
}

/**
 * True when at least one artifact carries a download URL that `finterm bundle download`
 * can actually use (file:// sources are only usable in fixture mode, never live).
 */
function hasDownloadableArtifact(artifacts: Record<string, unknown>[]): boolean {
  return artifacts.some((artifact) => {
    const downloadUrl = asString(artifact.downloadUrl);
    return downloadUrl !== undefined && !downloadUrl.startsWith('file://');
  });
}

function getNextAction(
  state: BundleRunState,
  artifacts: Record<string, unknown>[]
): BundleRunNextAction {
  if (WAITABLE_RUN_STATES.has(state)) {
    return 'wait';
  }
  if (state === 'succeeded') {
    // Only recommend download when it can succeed; otherwise steer to the inline result.
    return hasDownloadableArtifact(artifacts) ? 'download' : 'result';
  }
  if (state === 'failed') {
    return 'inspect_error';
  }
  return 'resume_later';
}

function getStatusMessage(status: AgentRunStatus): string {
  if (status.state === 'succeeded' && status.syncManifest === 'not_ready') {
    return `Run ${status.runId} succeeded but its artifacts are not published yet. Keep waiting (finterm bundle wait ${status.runId}), then retry: finterm bundle download ${status.runId}`;
  }
  if (status.nextAction === 'wait') {
    return `Run ${status.runId} is ${status.state}. Next: finterm bundle wait ${status.runId}`;
  }
  if (status.nextAction === 'download') {
    return `Run ${status.runId} succeeded. Next: finterm bundle download ${status.runId}`;
  }
  if (status.nextAction === 'result') {
    return `Run ${status.runId} succeeded with no downloadable artifacts. Next: finterm bundle result ${status.runId}`;
  }
  if (status.nextAction === 'inspect_error') {
    return `Run ${status.runId} failed. Next: inspect the error with finterm bundle result ${status.runId}`;
  }
  if (status.nextAction === 'resume_later') {
    return `Run ${status.runId} is ${status.state}. Save the run id and resume later.`;
  }
  return `Run ${status.runId} is ${status.state}. No follow-up action is required.`;
}

function normalizeLedgerFile(value: unknown): RunLedgerFile {
  const object = asObject(value);
  if (!object || !Array.isArray(object.runs)) {
    return { version: RUN_LEDGER_VERSION, runs: [] };
  }

  const runs: RunLedgerEntry[] = [];
  for (const entry of object.runs) {
    const run = asObject(entry);
    if (typeof run?.runId !== 'string' || typeof run.createdAt !== 'string') {
      continue;
    }
    const normalized = run as unknown as RunLedgerEntry;
    // Older or hand-edited ledgers may lack updatedAt; fall back to createdAt so
    // sorting and display never crash.
    runs.push(
      typeof run.updatedAt === 'string'
        ? normalized
        : { ...normalized, updatedAt: normalized.createdAt }
    );
  }

  return { version: RUN_LEDGER_VERSION, runs };
}

async function readLedgerFile(ledgerPath = getRunLedgerPath()): Promise<RunLedgerFile> {
  try {
    const content = await readFile(ledgerPath, 'utf-8');
    return normalizeLedgerFile(JSON.parse(content));
  } catch (error) {
    if (isExpectedFsError(error)) {
      return { version: RUN_LEDGER_VERSION, runs: [] };
    }
    if (error instanceof SyntaxError) {
      // A corrupt ledger must not brick every bundle command: back it up and start fresh.
      const backupPath = `${ledgerPath}.bak`;
      try {
        await rename(ledgerPath, backupPath);
      } catch {
        throw new CLIError(
          `Run ledger is not valid JSON and could not be backed up: ${ledgerPath}. Delete the file to reset the local run ledger.`,
          { cause: error }
        );
      }
      console.error(
        `Warning: run ledger at ${ledgerPath} was not valid JSON; backed it up to ${backupPath} and started a fresh ledger.`
      );
      return { version: RUN_LEDGER_VERSION, runs: [] };
    }
    throw error;
  }
}

async function writeLedgerFile(
  ledger: RunLedgerFile,
  ledgerPath = getRunLedgerPath()
): Promise<void> {
  await writeFile(ledgerPath, JSON.stringify(ledger, null, JSON_PRETTY_PRINT_SPACES));
}

export async function listRunLedger(options: { limit?: number } = {}): Promise<{
  ledgerPath: string;
  runs: RunLedgerEntry[];
}> {
  const ledgerPath = getRunLedgerPath();
  const ledger = await readLedgerFile(ledgerPath);
  const limit = options.limit ?? DEFAULT_RUN_LIST_LIMIT;
  return {
    ledgerPath,
    runs: ledger.runs
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.runId.localeCompare(b.runId))
      .slice(ARRAY_START_INDEX, limit),
  };
}

/**
 * Insert or update one run in the local ledger using atomic file writes.
 *
 * Known limitation (tracked separately): the read-modify-write is not protected by a
 * cross-process lock, so two concurrent finterm processes can lose one ledger update.
 * The atomic write keeps the file itself uncorrupted.
 */
export async function upsertRunLedgerEntry(
  patch: Omit<RunLedgerEntry, 'createdAt' | 'updatedAt'> & Partial<RunLedgerEntry>
): Promise<RunLedgerEntry> {
  const ledger = await readLedgerFile();
  const existing = ledger.runs.find((entry) => entry.runId === patch.runId);
  const timestamp = nowIso();
  const next: RunLedgerEntry = {
    ...existing,
    ...patch,
    createdAt: existing?.createdAt ?? patch.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  ledger.runs = [next, ...ledger.runs.filter((entry) => entry.runId !== patch.runId)];
  await writeLedgerFile(ledger);
  return next;
}

/**
 * Build a ledger entry from the run creation/status payload returned by the API.
 */
export function buildRunLedgerEntry(run: BundleRunData, account?: string): RunLedgerEntry {
  const artifactIds: string[] = [];
  const links = asStringRecord(run.links);
  // No artifact metadata is known at creation time, so never promise 'download' here;
  // a later status read upgrades the next action once downloadable artifacts exist.
  const nextAction = getNextAction(run.status, []);
  return {
    runId: run.runId,
    bundleName: run.bundleName,
    ticker: getRunTicker(run),
    account,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    state: run.status,
    status: run.status,
    links,
    artifactIds,
    nextAction,
  };
}

async function fetchArtifacts(
  client: FintermAPIClient,
  run: BundleRunData
): Promise<{ artifacts: Record<string, unknown>[]; manifestReady: boolean | undefined }> {
  if (run.status !== 'succeeded') {
    return { artifacts: [], manifestReady: undefined };
  }
  const response = await client.bundleArtifacts(run.runId);
  const data = getFintermWireData(
    toFintermWireResult<BundleArtifactsData>(
      response,
      bundleResponseFallbackMeta('finterm.result:BundleArtifacts/v1', 'bundle_artifacts', run.runId)
    ),
    `Failed to read artifacts for ${run.runId}`
  );
  return {
    artifacts: data.artifacts ?? [],
    manifestReady: typeof data.manifestReady === 'boolean' ? data.manifestReady : undefined,
  };
}

/** Normalized outcome of one sync-manifest read. */
type SyncManifestFetch =
  | { kind: 'ready'; manifest: SyncManifestData }
  | { kind: 'not_ready' }
  | { kind: 'error'; message: string };

/**
 * Read the run's sync manifest and normalize every failure shape (thrown HTTP errors
 * and `success: false` envelopes) into ready / not_ready / error.
 */
async function fetchSyncManifestSafe(
  client: FintermAPIClient,
  runId: string
): Promise<SyncManifestFetch> {
  let response;
  try {
    response = await client.bundleSyncManifest(runId);
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const result = toFintermWireResult<SyncManifestData>(
    response,
    bundleResponseFallbackMeta('finterm.result:SyncManifest/v1', 'bundle_sync_manifest', runId)
  );
  if ('data' in result) {
    return { kind: 'ready', manifest: result.data };
  }
  if (result.error.code === MANIFEST_NOT_READY_ERROR_CODE) {
    return { kind: 'not_ready' };
  }
  return {
    kind: 'error',
    message: result.error.message ?? `Failed to read sync manifest for ${runId}`,
  };
}

export async function getAgentRunStatus(
  client: FintermAPIClient,
  runId: string
): Promise<AgentRunStatus> {
  const response = await client.bundleStatus(runId);
  const run = getFintermWireData(
    toFintermWireResult<BundleRunData>(
      response,
      bundleResponseFallbackMeta('finterm.result:BundleRun/v1', 'bundle_status', runId)
    ),
    `Failed to read status for ${runId}`
  );
  const links = asStringRecord(run.links);
  const fetched = await fetchArtifacts(client, run);
  const artifacts = fetched.artifacts;
  const artifactIds = artifacts
    .map((artifact) => asString(artifact.artifactId))
    .filter((artifactId): artifactId is string => artifactId !== undefined);

  let nextAction = getNextAction(run.status, artifacts);
  let syncManifest: AgentRunStatus['syncManifest'];
  if (run.status === 'succeeded' && links.syncManifest) {
    // Newer servers report manifest publication directly on the status/artifacts
    // payloads; consume that when present instead of probing the manifest endpoint.
    const manifestReady =
      typeof run.manifestReady === 'boolean' ? run.manifestReady : fetched.manifestReady;
    const isDataroomSync = getRunDeliveryMode(run) === 'dataroom_sync';
    if (manifestReady === true) {
      syncManifest = 'ready';
      nextAction = 'download';
    } else if (manifestReady === false) {
      // An unpublished manifest only means "keep waiting" for dataroom_sync runs;
      // other delivery modes (e.g. inline_result) may never publish one, so they keep
      // the artifact-metadata next action (typically the inline result).
      if (isDataroomSync) {
        syncManifest = 'not_ready';
        nextAction = 'wait';
      }
    } else if (isDataroomSync) {
      // Older servers without manifestReady: probe the manifest, but only for runs
      // whose delivery contract actually publishes one (avoids an expensive probe and
      // an endless wait loop for inline runs that merely carry the link).
      const probe = await fetchSyncManifestSafe(client, run.runId);
      if (probe.kind === 'ready') {
        syncManifest = 'ready';
        nextAction = 'download';
      } else if (probe.kind === 'not_ready') {
        syncManifest = 'not_ready';
        nextAction = 'wait';
      }
      // probe errors: keep the legacy artifact-metadata next action.
    }
  }

  const ledgerEntry = await upsertRunLedgerEntry({
    ...buildRunLedgerEntry(run, client.baseUrl),
    artifactIds,
    nextAction,
  });
  const status: AgentRunStatus = {
    runId: run.runId,
    bundleName: run.bundleName,
    ticker: getRunTicker(run),
    account: client.baseUrl,
    state: run.status,
    status: run.status,
    links,
    artifactIds,
    artifacts,
    ...(syncManifest ? { syncManifest } : {}),
    localPaths: {
      ledger: getRunLedgerPath(),
      room: ledgerEntry.localPaths?.room,
      files: ledgerEntry.localPaths?.files,
    },
    nextAction,
    message: '',
  };
  status.message = getStatusMessage(status);
  return status;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForBundleRun(
  client: FintermAPIClient,
  runId: string,
  options: WaitOptions = {}
): Promise<AgentRunStatus> {
  const intervalMs = options.intervalMs ?? BUNDLE_WAIT_DEFAULTS.pollIntervalMs;
  const timeoutMs = options.timeoutMs ?? BUNDLE_WAIT_DEFAULTS.timeoutMs;
  const maxErrors = options.maxErrors ?? BUNDLE_WAIT_DEFAULTS.maxConsecutiveErrors;
  const startedAt = Date.now();
  let consecutiveErrors = INITIAL_CONSECUTIVE_ERROR_COUNT;
  let lastStatus: AgentRunStatus | undefined;

  while (true) {
    try {
      const status = await getAgentRunStatus(client, runId);
      consecutiveErrors = INITIAL_CONSECUTIVE_ERROR_COUNT;
      lastStatus = status;
      options.onPoll?.(status);

      // A terminal run whose sync manifest is not published yet still advises 'wait',
      // so keep polling until the artifacts become downloadable (or the timeout hits).
      if (TERMINAL_RUN_STATES.has(status.state) && status.nextAction !== 'wait') {
        return status;
      }
    } catch (error) {
      // A missing run never becomes findable by polling; surface it immediately.
      // This must match both the mock envelope (CLIError) and the live HTTP error
      // shape (APIRequestError with the code from the nested error envelope).
      if (isRunNotFoundError(error)) {
        throw error;
      }
      consecutiveErrors += CONSECUTIVE_ERROR_INCREMENT;
      if (consecutiveErrors > maxErrors) {
        throw error;
      }
    }

    // Enforce the timeout on every iteration, including after failed polls.
    if (Date.now() - startedAt >= timeoutMs) {
      if (lastStatus) {
        lastStatus.nextAction = 'resume_later';
        lastStatus.message = getStatusMessage(lastStatus);
        return lastStatus;
      }
      throw new CLIError(
        `Timed out after ${timeoutMs}ms waiting for run ${runId} without a successful status read. Save the run id and retry with: finterm bundle wait ${runId}`
      );
    }

    await sleep(intervalMs);
  }
}

// =============================================================================
// Manifest-diff sync download
// =============================================================================

/** Persisted per-file record of the last content the CLI itself wrote. */
interface SyncStateEntry {
  sha256: string;
  bytes: number;
}

/** One planned room file: where it goes, what it must hash to, where it comes from. */
interface SyncPlanItem {
  /** Validated room-relative POSIX path. */
  relativePath: string;
  /** Lowercase hex sha256 the materialized file must hash to. */
  sha256: string;
  /** Expected byte size after manifest or fixture normalization. */
  bytes: number;
  source: { kind: 'url'; url: string } | { kind: 'file'; path: string };
}

/** Room prefix reserved for CLI bookkeeping (sync state); never server-writable. */
const RESERVED_ROOM_PREFIX = '.finterm';

/**
 * Validate a manifest- or fixture-declared relative path before any filesystem use.
 * Rejects absolute paths, traversal (`..`), backslashes, and the reserved `.finterm/`
 * bookkeeping prefix; returns the normalized POSIX form used both as sync-state key
 * and (joined to the room) on disk.
 */
function assertSafeRelativePath(candidate: string, context: string): string {
  if (candidate.length < MIN_NON_EMPTY_LENGTH) {
    throw new CLIError(`Unsafe ${context} relative path: empty path`);
  }
  if (candidate.includes('\\')) {
    throw new CLIError(`Unsafe ${context} relative path (backslash): ${candidate}`);
  }
  const normalized = path.normalize(candidate);
  if (path.isAbsolute(normalized) || normalized.startsWith('..')) {
    throw new CLIError(`Unsafe ${context} relative path: ${candidate}`);
  }
  const posix = normalized.split(path.sep).join('/');
  if (posix === RESERVED_ROOM_PREFIX || posix.startsWith(`${RESERVED_ROOM_PREFIX}/`)) {
    throw new CLIError(
      `Unsafe ${context} relative path (reserved ${RESERVED_ROOM_PREFIX}/ prefix): ${candidate}`
    );
  }
  return posix;
}

function getSyncStatePath(roomPath: string): string {
  return path.join(roomPath, SYNC_STATE_RELATIVE_PATH);
}

/**
 * Read the room's sync state, tolerating a missing or unreadable file (empty state).
 * A lost sync state degrades safely: existing files that no longer match the manifest
 * are treated as user-modified and kept, never clobbered.
 */
async function readSyncState(roomPath: string): Promise<Record<string, SyncStateEntry>> {
  try {
    const content = await readFile(getSyncStatePath(roomPath), 'utf-8');
    const parsed = asObject(JSON.parse(content));
    const files = asObject(parsed?.files);
    if (!files) {
      return {};
    }
    const state: Record<string, SyncStateEntry> = {};
    for (const [key, value] of Object.entries(files)) {
      const entry = asObject(value);
      const sha256 = asString(entry?.sha256);
      if (sha256 !== undefined && typeof entry?.bytes === 'number') {
        state[key] = { sha256: sha256.toLowerCase(), bytes: entry.bytes };
      }
    }
    return state;
  } catch {
    return {};
  }
}

async function writeSyncState(
  roomPath: string,
  runId: string,
  files: Record<string, SyncStateEntry>
): Promise<void> {
  const sortedFiles: Record<string, SyncStateEntry> = {};
  for (const key of Object.keys(files).sort()) {
    sortedFiles[key] = files[key]!;
  }
  await writeFile(
    getSyncStatePath(roomPath),
    JSON.stringify(
      {
        version: SYNC_STATE_VERSION,
        lastRunId: runId,
        updatedAt: nowIso(),
        files: sortedFiles,
      },
      null,
      JSON_PRETTY_PRINT_SPACES
    )
  );
}

/** Stream-hash a local file without loading it fully into memory. */
async function hashLocalFile(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    bytes += buffer.byteLength;
  }
  return { sha256: hash.digest('hex'), bytes };
}

function getArtifactSourcePath(artifact: Record<string, unknown>): string | undefined {
  const explicitPath =
    asString(artifact.localPath) ??
    asString(artifact.sourcePath) ??
    asString(artifact.path) ??
    asString(artifact.filePath);
  if (explicitPath) {
    return explicitPath;
  }

  const downloadUrl = asString(artifact.downloadUrl);
  if (downloadUrl?.startsWith('file://')) {
    return new URL(downloadUrl).pathname;
  }
  return undefined;
}

function getArtifactSha256(artifact: Record<string, unknown>): string | undefined {
  const checksum = asObject(artifact.checksum);
  return (
    asString(artifact.sha256) ??
    asString(artifact.checksumSha256) ??
    asString(checksum?.sha256) ??
    asString(checksum?.value)
  );
}

async function readArtifactFixture(fixturePath: string): Promise<Record<string, unknown>[]> {
  let data: unknown;
  try {
    const content = await readFile(fixturePath, 'utf-8');
    data = JSON.parse(content) as unknown;
  } catch (error) {
    if (error instanceof Error) {
      throw new CLIError(`Failed to read artifact fixture: ${fixturePath}: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
  if (Array.isArray(data)) {
    return data.filter((entry): entry is Record<string, unknown> => asObject(entry) !== null);
  }
  const object = asObject(data);
  const artifacts = object?.artifacts;
  if (Array.isArray(artifacts)) {
    return artifacts.filter((entry): entry is Record<string, unknown> => asObject(entry) !== null);
  }
  throw new CLIError(`Artifact fixture does not contain an artifacts array: ${fixturePath}`);
}

/**
 * Build the sync plan from local fixture artifact metadata (tests and demos only).
 * Declared checksums are verified against the actual source content up front.
 */
async function planFromFixtureArtifacts(
  artifacts: Record<string, unknown>[]
): Promise<SyncPlanItem[]> {
  const plan: SyncPlanItem[] = [];
  for (const artifact of artifacts) {
    const sourcePath = getArtifactSourcePath(artifact);
    if (!sourcePath) {
      continue;
    }
    const artifactId = asString(artifact.artifactId) ?? path.basename(sourcePath);
    const relativePath = assertSafeRelativePath(
      asString(artifact.relativePath) ?? path.basename(sourcePath),
      'fixture artifact'
    );
    const actual = await hashLocalFile(sourcePath);
    const declaredSha256 = getArtifactSha256(artifact)?.toLowerCase();
    if (declaredSha256 !== undefined && declaredSha256 !== actual.sha256) {
      throw new CLIError(`Checksum mismatch for artifact ${artifactId}`);
    }
    plan.push({
      relativePath,
      sha256: actual.sha256,
      bytes: actual.bytes,
      source: { kind: 'file', path: sourcePath },
    });
  }
  return plan;
}

/**
 * Build the sync plan from a live sync manifest, validating every entry: safe relative
 * path, https URL (the CLI never reads server-named local paths), and a real sha256.
 */
function planFromSyncManifest(manifest: SyncManifestData): SyncPlanItem[] {
  return manifest.files.map((file) => {
    const relativePath = assertSafeRelativePath(file.path, 'sync manifest');
    if (typeof file.url !== 'string' || !file.url.startsWith('https://')) {
      throw new CLIError(
        `Sync manifest entry ${file.path} does not use an https download URL; refusing to download.`
      );
    }
    const sha256 = typeof file.sha256 === 'string' ? file.sha256.toLowerCase() : '';
    if (!SHA256_HEX_PATTERN.test(sha256)) {
      throw new CLIError(`Sync manifest entry ${file.path} has an invalid sha256 checksum.`);
    }
    if (typeof file.bytes !== 'number' || !Number.isFinite(file.bytes) || file.bytes < 0) {
      throw new CLIError(`Sync manifest entry ${file.path} has an invalid byte size.`);
    }
    return {
      relativePath,
      sha256,
      bytes: file.bytes,
      source: { kind: 'url' as const, url: file.url },
    };
  });
}

function defaultRoomPath(status: AgentRunStatus): string {
  const name = status.ticker?.toLowerCase() ?? status.runId;
  return path.resolve(process.cwd(), 'datarooms', name);
}

async function ensureRoomMode(roomPath: string, mode: DownloadOptions['mode']): Promise<void> {
  if (mode === 'merge') {
    await mkdir(roomPath, { recursive: true });
    return;
  }

  if (await pathExists(roomPath)) {
    const entries = await readdir(roomPath);
    if (entries.length >= MIN_NON_EMPTY_LENGTH) {
      throw new CLIError(
        `Dataroom already exists and is not empty: ${roomPath}. Use --mode merge.`
      );
    }
  }
  await mkdir(roomPath, { recursive: true });
}

/** Temp filenames written by this module match `<name>.<8 hex chars>.part`. */
const STALE_PART_FILE_PATTERN = /\.[0-9a-f]{8}\.part$/;

/**
 * Remove leftover `*.part` temp files (from a previously killed or crashed sync) in
 * every directory this sync plan touches, so partial downloads never accumulate.
 */
async function sweepStalePartFiles(roomPath: string, plan: SyncPlanItem[]): Promise<void> {
  const dirs = new Set(plan.map((item) => path.dirname(path.join(roomPath, item.relativePath))));
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if (isExpectedFsError(error)) {
        continue;
      }
      throw error;
    }
    for (const entry of entries) {
      if (STALE_PART_FILE_PATTERN.test(entry)) {
        await rm(path.join(dir, entry), { force: true });
      }
    }
  }
}

/**
 * Resolve and verify the destination directory for one room file: after following
 * symlinks it must still live inside the room. Merge rooms may contain symlinked
 * directories pointing outside the room; writing through them would escape it.
 * Creates the destination directory and returns the file's local path.
 */
async function assertDestinationInsideRoom(
  roomPath: string,
  relativePath: string
): Promise<string> {
  const localPath = path.join(roomPath, relativePath);
  const destDir = path.dirname(localPath);
  await mkdir(destDir, { recursive: true });
  const [roomReal, destReal] = await Promise.all([realpath(roomPath), realpath(destDir)]);
  const relativeToRoom = path.relative(roomReal, destReal);
  if (relativeToRoom.startsWith('..') || path.isAbsolute(relativeToRoom)) {
    throw new CLIError(
      `Refusing to write ${relativePath}: its directory resolves outside the room (symlink escape).`
    );
  }
  return localPath;
}

/** Diff of the sync plan against the room's current contents and sync state. */
interface SyncDiff {
  toDownload: SyncPlanItem[];
  verified: SyncedFileResult[];
  warnings: string[];
}

/**
 * Decide per file: already up to date (verify), download (missing, or changed upstream
 * while locally untouched), or skip with a warning (locally modified/foreign file —
 * the merge collision policy never clobbers files the CLI did not write).
 */
async function diffPlanAgainstRoom(
  roomPath: string,
  plan: SyncPlanItem[],
  previousState: Record<string, SyncStateEntry>
): Promise<SyncDiff> {
  const diff: SyncDiff = { toDownload: [], verified: [], warnings: [] };
  for (const item of plan) {
    const localPath = path.join(roomPath, item.relativePath);
    if (!(await pathExists(localPath))) {
      diff.toDownload.push(item);
      continue;
    }
    const local = await hashLocalFile(localPath);
    if (local.sha256 === item.sha256) {
      diff.verified.push({
        path: item.relativePath,
        bytes: local.bytes,
        sha256: local.sha256,
        action: 'verified',
      });
      continue;
    }
    const recorded = previousState[item.relativePath];
    if (recorded?.sha256 === local.sha256) {
      // The local file is exactly what the CLI last wrote, so the change is upstream:
      // safe to replace with the new version.
      diff.toDownload.push(item);
      continue;
    }
    diff.warnings.push(
      recorded
        ? `Skipped ${item.relativePath}: the local file was modified after the last sync; kept your copy.`
        : `Skipped ${item.relativePath}: a different file already exists in the room; kept the existing file.`
    );
  }
  return diff;
}

/** Outcome of one signed-URL fetch streamed to a temp file. */
type UrlDownloadOutcome =
  | { kind: 'ok'; sha256: string; bytes: number }
  | { kind: 'expired'; status: number };

async function downloadUrlToTemp(
  fetcher: SignedUrlFetcher,
  url: string,
  tempPath: string
): Promise<UrlDownloadOutcome> {
  const response = await fetcher(url);
  if (EXPIRED_SIGNED_URL_HTTP_STATUSES.has(response.status)) {
    return { kind: 'expired', status: response.status };
  }
  if (!response.ok) {
    throw new CLIError(`Artifact download failed with HTTP ${response.status}.`);
  }
  await mkdir(path.dirname(tempPath), { recursive: true });
  const hash = createHash('sha256');
  let bytes = 0;
  if (response.body) {
    const readable = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
    await pipeline(
      readable,
      async function* (source: AsyncIterable<Buffer | Uint8Array>) {
        for await (const chunk of source) {
          hash.update(chunk);
          bytes += chunk.byteLength;
          yield chunk;
        }
      },
      createWriteStream(tempPath)
    );
  } else {
    await writeFile(tempPath, Buffer.alloc(0));
  }
  return { kind: 'ok', sha256: hash.digest('hex'), bytes };
}

/**
 * Materialize one planned file into the room: stream to a temp file, verify sha256 and
 * size, then atomically rename into place. Fixture file sources are copied through the
 * same verify-then-atomic-write discipline.
 */
async function materializePlanItem(
  item: SyncPlanItem,
  roomPath: string,
  fetcher: SignedUrlFetcher,
  getFreshUrl: ((relativePath: string) => Promise<string>) | undefined
): Promise<SyncedFileResult> {
  const localPath = await assertDestinationInsideRoom(roomPath, item.relativePath);

  if (item.source.kind === 'file') {
    const content = await readFile(item.source.path);
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (sha256 !== item.sha256) {
      throw new CLIError(`Checksum mismatch for ${item.relativePath}`);
    }
    await writeFile(localPath, content);
    return { path: item.relativePath, bytes: content.byteLength, sha256, action: 'downloaded' };
  }

  const tempSuffix = randomBytes(TEMP_SUFFIX_RANDOM_BYTES).toString('hex');
  const tempPath = `${localPath}.${tempSuffix}.part`;
  try {
    let outcome = await downloadUrlToTemp(fetcher, item.source.url, tempPath);
    if (outcome.kind === 'expired') {
      // The signed URL expired mid-download: refresh the manifest once and resume.
      if (!getFreshUrl) {
        throw new CLIError(
          `Signed URL rejected (HTTP ${outcome.status}) for ${item.relativePath} and no manifest refresh is available.`
        );
      }
      const freshUrl = await getFreshUrl(item.relativePath);
      outcome = await downloadUrlToTemp(fetcher, freshUrl, tempPath);
      if (outcome.kind === 'expired') {
        throw new CLIError(
          `Signed URL for ${item.relativePath} is still rejected (HTTP ${outcome.status}) after refreshing the sync manifest. Retry: finterm bundle download.`
        );
      }
    }
    if (outcome.sha256 !== item.sha256) {
      throw new CLIError(
        `Checksum mismatch for ${item.relativePath} (expected ${item.sha256}, got ${outcome.sha256}).`
      );
    }
    if (outcome.bytes !== item.bytes) {
      throw new CLIError(
        `Size mismatch for ${item.relativePath} (expected ${item.bytes} bytes, got ${outcome.bytes}).`
      );
    }
    await rename(tempPath, localPath);
    return {
      path: item.relativePath,
      bytes: outcome.bytes,
      sha256: outcome.sha256,
      action: 'downloaded',
    };
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/**
 * Build the at-most-once manifest refresher used when signed URLs expire mid-download.
 * All concurrent workers share one refresh; the refreshed URLs are looked up by path.
 */
function createManifestRefresher(
  client: FintermAPIClient,
  runId: string
): (relativePath: string) => Promise<string> {
  let refreshed: Promise<Map<string, string>> | null = null;
  return async (relativePath: string) => {
    refreshed ??= (async () => {
      const fetched = await fetchSyncManifestSafe(client, runId);
      if (fetched.kind !== 'ready') {
        throw new CLIError(
          `Signed URL expired and the sync manifest for ${runId} could not be refreshed${
            fetched.kind === 'error' ? `: ${fetched.message}` : ' (artifacts no longer published).'
          }`
        );
      }
      return new Map(
        planFromSyncManifest(fetched.manifest).map((item) => [
          item.relativePath,
          item.source.kind === 'url' ? item.source.url : '',
        ])
      );
    })();
    const url = (await refreshed).get(relativePath);
    if (!url) {
      throw new CLIError(
        `Signed URL expired and the refreshed sync manifest no longer lists ${relativePath}.`
      );
    }
    return url;
  };
}

/** Run the worker over all items with bounded concurrency, failing fast on first error. */
async function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  let failure: unknown;
  let failed = false;
  const workerCount = Math.min(limit, items.length);
  const runners = Array.from({ length: workerCount }, async () => {
    while (!failed) {
      const index = nextIndex;
      nextIndex += CONSECUTIVE_ERROR_INCREMENT;
      if (index >= items.length) {
        return;
      }
      try {
        await worker(items[index]!);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  });
  await Promise.all(runners);
  if (failed) {
    throw failure;
  }
}

function sumPlanBytes(items: readonly SyncPlanItem[]): number {
  return items.reduce((total, item) => total + item.bytes, 0);
}

function sumSyncedBytes(files: readonly SyncedFileResult[]): number {
  return files.reduce((total, file) => total + file.bytes, 0);
}

function buildDownloadStats(
  plan: readonly SyncPlanItem[],
  downloaded: readonly SyncedFileResult[],
  verified: readonly SyncedFileResult[],
  startedAtMs: number
): DownloadStats {
  const totalBytes = sumPlanBytes(plan);
  const downloadedBytes = sumSyncedBytes(downloaded);
  const verifiedBytes = sumSyncedBytes(verified);
  const skippedFiles = Math.max(plan.length - downloaded.length - verified.length, 0);
  const skippedBytes = Math.max(totalBytes - downloadedBytes - verifiedBytes, 0);
  const durationMs = Math.max(performance.now() - startedAtMs, 0);
  const throughputBytesPerSecond =
    durationMs > 0 ? (downloadedBytes / durationMs) * MILLISECONDS_PER_SECOND : 0;

  return {
    totalFiles: plan.length,
    downloadedFiles: downloaded.length,
    verifiedFiles: verified.length,
    skippedFiles,
    totalBytes,
    downloadedBytes,
    verifiedBytes,
    skippedBytes,
    durationMs,
    throughputBytesPerSecond,
    downloadThroughputBytesPerSecond: throughputBytesPerSecond,
  };
}

/**
 * Sync a bundle run's published files into a local room using the sync manifest
 * (or fixture artifact metadata when `fixtureArtifactsPath` is set).
 */
export async function downloadBundleRunArtifacts(
  client: FintermAPIClient,
  runId: string,
  options: DownloadOptions
): Promise<DownloadResult> {
  const startedAtMs = performance.now();
  const status = await getAgentRunStatus(client, runId);
  if (status.state !== 'succeeded') {
    throw new CLIError(
      `Run ${runId} is ${status.state}; wait for it to succeed before downloading.`
    );
  }

  const fetcher = options.fetcher ?? ((url: string) => fetch(url));
  let plan: SyncPlanItem[];
  let roomFormat: string | undefined;
  let roomProfile: string | undefined;
  let getFreshUrl: ((relativePath: string) => Promise<string>) | undefined;
  if (options.fixtureArtifactsPath) {
    const artifacts = await readArtifactFixture(options.fixtureArtifactsPath);
    plan = await planFromFixtureArtifacts(artifacts);
  } else {
    // The live path never trusts artifact metadata for file sources: the sync manifest
    // with signed https URLs is the only way the CLI materializes remote content.
    const manifestFetch = await fetchSyncManifestSafe(client, runId);
    if (manifestFetch.kind === 'not_ready') {
      throw new CLIError(
        `Run ${runId} succeeded but its artifacts are not published yet. Keep waiting and retry: finterm bundle download ${runId}`,
        { code: MANIFEST_NOT_READY_ERROR_CODE }
      );
    }
    if (manifestFetch.kind === 'error') {
      throw new CLIError(`Failed to read the sync manifest for ${runId}: ${manifestFetch.message}`);
    }
    plan = planFromSyncManifest(manifestFetch.manifest);
    roomFormat = manifestFetch.manifest.roomFormat;
    roomProfile = manifestFetch.manifest.roomProfile;
    getFreshUrl = createManifestRefresher(client, runId);
  }

  if (plan.length < MIN_NON_EMPTY_LENGTH) {
    throw new CLIError(`Run ${runId} published no downloadable files; nothing to sync.`);
  }
  const seenPaths = new Set<string>();
  for (const item of plan) {
    if (seenPaths.has(item.relativePath)) {
      throw new CLIError(`Duplicate path in download plan: ${item.relativePath}`);
    }
    seenPaths.add(item.relativePath);
  }

  const roomPath = path.resolve(options.room ?? defaultRoomPath(status));
  await ensureRoomMode(roomPath, options.mode);
  await sweepStalePartFiles(roomPath, plan);

  const previousState = await readSyncState(roomPath);
  const diff = await diffPlanAgainstRoom(roomPath, plan, previousState);

  // Union the previous state (other runs' files, skipped files' last-synced records)
  // with everything verified or downloaded in this pass. Each successful download is
  // recorded immediately so a partially-failed pass still flushes what it placed.
  const nextState: Record<string, SyncStateEntry> = { ...previousState };
  for (const file of diff.verified) {
    nextState[file.path] = { sha256: file.sha256, bytes: file.bytes };
  }

  const downloaded: SyncedFileResult[] = [];
  try {
    await forEachWithConcurrency(diff.toDownload, MAX_CONCURRENT_DOWNLOADS, async (item) => {
      const file = await materializePlanItem(item, roomPath, fetcher, getFreshUrl);
      downloaded.push(file);
      nextState[file.path] = { sha256: file.sha256, bytes: file.bytes };
    });
  } catch (error) {
    // Files already renamed into the room by this failed pass must be recorded, or a
    // later merge would treat them as user-modified and freeze them forever.
    try {
      await writeSyncState(roomPath, runId, nextState);
    } catch {
      // Keep the original download failure as the surfaced error.
    }
    throw error;
  }
  await writeSyncState(roomPath, runId, nextState);

  const syncedFiles = [...downloaded, ...diff.verified];
  const stats = buildDownloadStats(plan, downloaded, diff.verified, startedAtMs);
  const absoluteFiles = syncedFiles.map((file) => path.join(roomPath, file.path));
  await upsertRunLedgerEntry({
    runId,
    bundleName: status.bundleName,
    ticker: status.ticker,
    account: client.baseUrl,
    state: status.state,
    status: status.status,
    links: status.links,
    artifactIds: status.artifactIds,
    targetOutputPath: roomPath,
    localPaths: { room: roomPath, files: absoluteFiles },
    nextAction: 'done',
  });

  const readHint =
    roomFormat === 'DR/0.3' && roomProfile === 'file'
      ? ` Read it with: finterm dataroom files ${roomPath}`
      : ` The room is plain local files; read them directly.`;
  const skippedSuffix =
    diff.warnings.length >= MIN_NON_EMPTY_LENGTH
      ? ` Skipped ${diff.warnings.length} file(s); see warnings.`
      : '';
  const message =
    downloaded.length >= MIN_NON_EMPTY_LENGTH
      ? `Downloaded ${downloaded.length} file(s) into ${roomPath}.` +
        (diff.verified.length >= MIN_NON_EMPTY_LENGTH
          ? ` ${diff.verified.length} file(s) already up to date.`
          : '') +
        skippedSuffix +
        readHint
      : diff.warnings.length >= MIN_NON_EMPTY_LENGTH
        ? `No files downloaded; ${diff.verified.length} verified.${skippedSuffix}${readHint}`
        : `Up to date, ${diff.verified.length} file(s) verified in ${roomPath}.${readHint}`;

  return {
    runId,
    state: status.state,
    nextAction: 'done',
    ...(roomFormat ? { roomFormat } : {}),
    ...(roomProfile ? { roomProfile } : {}),
    files: syncedFiles,
    downloadedCount: downloaded.length,
    verifiedCount: diff.verified.length,
    stats,
    warnings: diff.warnings,
    localPaths: {
      ledger: getRunLedgerPath(),
      room: roomPath,
      files: absoluteFiles,
    },
    message,
  };
}
