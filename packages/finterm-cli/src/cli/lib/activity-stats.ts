/**
 * Lightweight per-process CLI activity statistics for a single invocation: the API
 * requests made and the artifact downloads performed.
 *
 * Scope note: this is transfer/I-O activity for one CLI run, NOT account "usage" in the
 * billing sense. Billing/quota/token usage, if it ever surfaces in the CLI, is a separate
 * concern (it pairs with the server-side billing surface) and should not be folded in
 * here under the same name. New diagnostic categories can be added as named sections on
 * the snapshot below.
 *
 * Diagnostics stay on stderr and are emitted only for --verbose/--debug. Debug mode
 * also writes a JSON snapshot under the Finterm config directory for later triage.
 */

import path from 'node:path';
import { readdir, rm } from 'node:fs/promises';

import { getFintermDir } from '../../cli-io/settings.js';
import type { ApiRequestEvent } from '../../lib/api-client.js';
import type { DownloadStats } from './bundle-runs.js';
import type { CommandContext } from './context.js';
import { OutputManager } from './output.js';
import { writeFile } from './fs.js';
import { formatBytes, formatDuration, formatRate } from './format.js';

/** Most recent debug snapshots to retain under the config dir; older ones are pruned. */
export const MAX_DEBUG_SNAPSHOTS = 20;

/** API event retained in the process snapshot. */
export type RecordedApiEvent = ApiRequestEvent & { recordedAt: string };

/** Download event retained in the process snapshot. */
export interface RecordedDownloadEvent {
  recordedAt: string;
  runId: string;
  room: string;
  stats: DownloadStats;
}

export interface ActivitySnapshot {
  generatedAt: string;
  apiEvents: RecordedApiEvent[];
  downloads: RecordedDownloadEvent[];
}

const apiEvents: RecordedApiEvent[] = [];
const downloads: RecordedDownloadEvent[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

export function recordApiRequestEvent(event: ApiRequestEvent): void {
  apiEvents.push({ ...event, recordedAt: nowIso() });
}

export function recordDownloadStats(params: {
  runId: string;
  room: string;
  stats: DownloadStats;
}): void {
  downloads.push({ ...params, recordedAt: nowIso() });
}

export function getActivitySnapshot(): ActivitySnapshot {
  return {
    generatedAt: nowIso(),
    apiEvents: [...apiEvents],
    downloads: [...downloads],
  };
}

export function resetActivityStats(): void {
  apiEvents.length = 0;
  downloads.length = 0;
}

export function formatApiRequestEvent(event: ApiRequestEvent): string | null {
  if (event.phase === 'start') {
    return null;
  }
  if (event.phase === 'cache_hit') {
    return `< ${event.method} ${event.path} cache-hit ${formatDuration(event.durationMs)}, ${formatBytes(event.responseBytes)} cached`;
  }
  if (event.phase === 'error') {
    return `< ${event.method} ${event.path} error after ${formatDuration(event.durationMs)} (${event.attempts} attempt${event.attempts === 1 ? '' : 's'}): ${event.error}`;
  }
  return `< ${event.method} ${event.path} ${event.status} ${formatDuration(event.durationMs)}, sent ${formatBytes(event.requestBytes)}, received ${formatBytes(event.responseBytes)}${event.attempts > 1 ? `, ${event.attempts} attempts` : ''}`;
}

function formatApiSummary(events: RecordedApiEvent[]): string[] {
  const completed = events.filter((event) => event.phase !== 'start');
  if (completed.length === 0) {
    return [];
  }
  const receivedBytes = completed.reduce(
    (sum, event) => sum + ('responseBytes' in event ? event.responseBytes : 0),
    0
  );
  const sentBytes = completed.reduce((sum, event) => sum + event.requestBytes, 0);
  const durationMs = completed.reduce(
    (sum, event) => sum + ('durationMs' in event ? event.durationMs : 0),
    0
  );
  const errors = completed.filter(
    (event) => event.phase === 'error' || (event.phase === 'finish' && !event.ok)
  ).length;
  const cacheHits = completed.filter((event) => event.phase === 'cache_hit').length;
  const suffixes = [
    errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : '',
    cacheHits > 0 ? `${cacheHits} cache hit${cacheHits === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return [
    `API: ${completed.length} call${completed.length === 1 ? '' : 's'}, sent ${formatBytes(sentBytes)}, received ${formatBytes(receivedBytes)}, ${formatDuration(durationMs)} request time${suffixes.length > 0 ? ` (${suffixes.join(', ')})` : ''}`,
  ];
}

function formatDownloadSummary(downloadEvents: RecordedDownloadEvent[]): string[] {
  if (downloadEvents.length === 0) {
    return [];
  }
  const totals = downloadEvents.reduce(
    (acc, event) => {
      acc.files += event.stats.totalFiles;
      acc.downloadedFiles += event.stats.downloadedFiles;
      acc.verifiedFiles += event.stats.verifiedFiles;
      acc.skippedFiles += event.stats.skippedFiles;
      acc.totalBytes += event.stats.totalBytes;
      acc.downloadedBytes += event.stats.downloadedBytes;
      acc.verifiedBytes += event.stats.verifiedBytes;
      acc.durationMs += event.stats.durationMs;
      return acc;
    },
    {
      files: 0,
      downloadedFiles: 0,
      verifiedFiles: 0,
      skippedFiles: 0,
      totalBytes: 0,
      downloadedBytes: 0,
      verifiedBytes: 0,
      durationMs: 0,
    }
  );
  const throughput =
    totals.downloadedBytes > 0
      ? totals.downloadedBytes / Math.max(totals.durationMs / 1000, 0.001)
      : 0;
  return [
    `Downloads: ${totals.files} file${totals.files === 1 ? '' : 's'}, ${totals.downloadedFiles} downloaded / ${totals.verifiedFiles} verified / ${totals.skippedFiles} skipped, ${formatBytes(totals.totalBytes)} total, ${formatBytes(totals.downloadedBytes)} downloaded, ${formatRate(throughput)}`,
  ];
}

export function formatActivityLines(snapshot: ActivitySnapshot, detailed: boolean): string[] {
  const lines = [
    ...formatApiSummary(snapshot.apiEvents),
    ...formatDownloadSummary(snapshot.downloads),
  ];
  if (!detailed) {
    return lines;
  }
  for (const event of snapshot.apiEvents) {
    const line = formatApiRequestEvent(event);
    if (line) {
      lines.push(`  ${line}`);
    }
  }
  for (const event of snapshot.downloads) {
    lines.push(
      `  download ${event.runId}: ${event.stats.downloadedFiles} downloaded, ${event.stats.verifiedFiles} verified, ${formatBytes(event.stats.downloadedBytes)} in ${formatDuration(event.stats.durationMs)} (${formatRate(event.stats.downloadThroughputBytesPerSecond)}) -> ${event.room}`
    );
  }
  return lines;
}

/** Keep only the most recent {@link MAX_DEBUG_SNAPSHOTS} snapshot files. */
async function pruneDebugSnapshots(debugDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(debugDir);
  } catch {
    return;
  }
  // Names embed an ISO timestamp, so a lexical sort is chronological.
  const snapshots = entries
    .filter((name) => name.startsWith('activity-') && name.endsWith('.json'))
    .sort();
  const excess = snapshots.length - MAX_DEBUG_SNAPSHOTS;
  for (let i = 0; i < excess; i += 1) {
    await rm(path.join(debugDir, snapshots[i]!), { force: true });
  }
}

async function writeDebugSnapshot(snapshot: ActivitySnapshot): Promise<string> {
  const debugDir = path.join(getFintermDir(), 'debug');
  const safeTimestamp = snapshot.generatedAt.replace(/[:.]/g, '-');
  const filePath = path.join(debugDir, `activity-${safeTimestamp}-${process.pid}.json`);
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  await pruneDebugSnapshots(debugDir);
  return filePath;
}

export async function emitActivityStats(ctx: CommandContext): Promise<void> {
  const snapshot = getActivitySnapshot();
  if (snapshot.apiEvents.length === 0 && snapshot.downloads.length === 0) {
    return;
  }

  const output = new OutputManager(ctx);
  const shouldPrint = !ctx.quiet && (ctx.verbose || ctx.debug);
  if (shouldPrint) {
    if (!ctx.json) {
      output.heading('Activity Summary');
    }
    for (const line of formatActivityLines(snapshot, ctx.debug)) {
      output.stat(line);
    }
    if (!ctx.json) {
      output.rule();
    }
  }

  if (ctx.debug) {
    const filePath = await writeDebugSnapshot(snapshot);
    output.debug(`Activity snapshot saved: ${filePath}`);
  }

  resetActivityStats();
}
