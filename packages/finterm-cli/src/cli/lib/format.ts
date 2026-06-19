/**
 * Shared human-readable formatters for byte sizes, durations, and transfer rates.
 *
 * Command output and the activity-stats diagnostics share these so a megabyte or a
 * second reads the same everywhere.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const BYTES_PER_UNIT = 1024;
const MILLISECONDS_PER_SECOND = 1000;

/** Below this value a unit is shown with one decimal place; at or above it, none. */
const SINGLE_DECIMAL_THRESHOLD = 10;

/** Format a byte count as a short human-readable string, e.g. `3.4 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  let value = bytes;
  let unitIndex = 0;
  while (value >= BYTES_PER_UNIT && unitIndex < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unitIndex += 1;
  }
  return `${value >= SINGLE_DECIMAL_THRESHOLD || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${BYTE_UNITS[unitIndex]}`;
}

/** Format a millisecond duration as `Nms` (sub-second) or `N.Ns`. */
export function formatDuration(ms: number): string {
  if (ms < MILLISECONDS_PER_SECOND) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / MILLISECONDS_PER_SECOND).toFixed(1)}s`;
}

/** Format a transfer rate in bytes per second, e.g. `2.1 MB/s`. */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
