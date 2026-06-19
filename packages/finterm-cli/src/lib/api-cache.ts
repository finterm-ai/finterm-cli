/**
 * API Response Cache
 *
 * Two-layer cache for finterm-cli API responses:
 * 1. In-memory Map - instant lookups within the current session
 * 2. File-backed persistent store - survives across runs (~/.finterm/cache/api-cache.json)
 *
 * Lookup order: memory -> disk file -> network.
 * On network fetch: write to both layers.
 * On disk hit: promote to memory (hot layer).
 *
 * Tracks hit/miss/skip statistics for session summary logging.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { writeFileSync } from 'atomically';

import { generateApiCacheKey, getEndpointTtlMs } from './api-cache-keys.js';

/** Counters surfaced in the session summary so users can see cache effectiveness. */
export interface CacheStats {
  hits: number;
  memoryHits: number;
  diskHits: number;
  misses: number;
  skips: number;
  writes: number;
  errors: number;
  /** Total bytes of cached data returned (approximate, from JSON serialization). */
  totalHitBytes: number;
  /** Total bytes of data written to cache (approximate). */
  totalWriteBytes: number;
}

/** A cached response plus the metadata needed to expire and report on it. */
export interface CacheEntry {
  data: unknown;
  expiresAt: number;
  createdAt: number;
  endpoint: string;
  cacheKey: string;
}

/** Result of a cache lookup */
export type CacheLookupResult =
  | {
      status: 'hit';
      source: 'memory' | 'disk';
      data: unknown;
      age: number;
      key: string;
      sizeBytes: number;
    }
  | { status: 'miss'; key: string }
  | { status: 'skip'; reason: string };

/** Persistent cache statistics for `finterm cache stats` */
export interface DiskCacheInfo {
  entryCount: number;
  oldestCreatedAt: number | null;
  newestCreatedAt: number | null;
  cachePath: string;
}

export interface ApiCacheOptions {
  enabled?: boolean | null;
}

/** On-disk shape of the cache file; `version` gates forward/backward compatibility. */
interface CacheFileData {
  version: 1;
  entries: Record<string, CacheEntry>;
}

const CACHE_FILE_VERSION = 1;

/** Estimate byte size of a value (rough JSON serialization length). */
function estimateBytes(data: unknown): number {
  try {
    if (typeof data === 'string') return data.length;
    return JSON.stringify(data)?.length ?? 0;
  } catch {
    return 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validate a decoded JSON value against the {@link CacheEntry} shape.
 * The cache file is user-editable and may be stale from an older version, so every
 * entry is checked before trust; `data` is intentionally unconstrained.
 */
function isCacheEntry(value: unknown): value is CacheEntry {
  return (
    isRecord(value) &&
    isFiniteNumber(value.expiresAt) &&
    isFiniteNumber(value.createdAt) &&
    typeof value.endpoint === 'string' &&
    typeof value.cacheKey === 'string'
  );
}

/**
 * Parse and validate the raw cache file contents into a map of entries.
 * Throws on any unexpected shape so the caller can discard a corrupt file rather
 * than serving malformed entries; an empty file is treated as an empty cache.
 */
function parseCacheFile(raw: string): Map<string, CacheEntry> {
  if (raw.trim() === '') return new Map();

  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || parsed.version !== CACHE_FILE_VERSION || !isRecord(parsed.entries)) {
    throw new Error('Unsupported cache file format');
  }

  const entries = new Map<string, CacheEntry>();
  for (const [key, value] of Object.entries(parsed.entries)) {
    if (!isCacheEntry(value)) {
      throw new Error(`Invalid cache entry: ${key}`);
    }
    entries.set(key, value);
  }
  return entries;
}

/**
 * Two-layer (memory + optional disk) response cache. Disk persistence is opt-in and
 * best-effort: any disk failure is recorded in {@link CacheStats.errors} and degrades
 * to memory-only rather than breaking requests.
 */
export class ApiCache {
  private memory = new Map<string, CacheEntry>();
  private _lastLookup: CacheLookupResult | null = null;
  onLookup: ((result: CacheLookupResult) => void) | null = null;
  private stats: CacheStats = {
    hits: 0,
    memoryHits: 0,
    diskHits: 0,
    misses: 0,
    skips: 0,
    writes: 0,
    errors: 0,
    totalHitBytes: 0,
    totalWriteBytes: 0,
  };
  private enabled: boolean;
  private diskEntries: Map<string, CacheEntry> | null = null;
  private cachePath: string | null = null;
  private _diskInitialized = false;

  constructor(options: ApiCacheOptions = {}) {
    this.enabled = options.enabled ?? true;
  }

  /**
   * Initialize the file-backed disk layer.
   * Call this before first use if disk persistence is desired.
   * Safe to call multiple times (idempotent).
   * Errors are caught and logged; disk failure falls back to memory-only.
   */
  async initDisk(cachePath: string): Promise<void> {
    if (this._diskInitialized || !this.enabled) return;
    this._diskInitialized = true;
    this.cachePath = cachePath;
    this.diskEntries = new Map();

    try {
      await mkdir(dirname(cachePath), { recursive: true });
      if (!existsSync(cachePath)) return;

      const raw = await readFile(cachePath, 'utf8');
      this.diskEntries = parseCacheFile(raw);
    } catch (err) {
      this.stats.errors++;
      this.diskEntries = null;
      console.error(
        `[cache] disk cache init failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private emitLookup(result: CacheLookupResult): CacheLookupResult {
    this._lastLookup = result;
    this.onLookup?.(result);
    return result;
  }

  private persistDisk(): void {
    if (!this.diskEntries || !this.cachePath) return;

    try {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      const data: CacheFileData = {
        version: CACHE_FILE_VERSION,
        entries: Object.fromEntries(this.diskEntries),
      };
      writeFileSync(this.cachePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    } catch (err) {
      this.stats.errors++;
      console.error(
        `[cache] disk cache write error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Look up a cached response for the given API request.
   */
  get(path: string, body: unknown): CacheLookupResult {
    if (!this.enabled) {
      this.stats.skips++;
      return this.emitLookup({ status: 'skip', reason: 'cache disabled' });
    }

    const cacheKey = generateApiCacheKey(path, body);
    if (cacheKey === null) {
      this.stats.skips++;
      return this.emitLookup({ status: 'skip', reason: 'not cacheable' });
    }

    const now = Date.now();

    // Layer 1: Check in-memory
    const memEntry = this.memory.get(cacheKey);
    if (memEntry && memEntry.expiresAt > now) {
      const sizeBytes = estimateBytes(memEntry.data);
      this.stats.hits++;
      this.stats.memoryHits++;
      this.stats.totalHitBytes += sizeBytes;
      return this.emitLookup({
        status: 'hit',
        source: 'memory',
        data: memEntry.data,
        age: now - memEntry.createdAt,
        key: cacheKey,
        sizeBytes,
      });
    }

    // Expired memory entry - clean up
    if (memEntry) {
      this.memory.delete(cacheKey);
    }

    // Layer 2: Check persistent disk file
    const diskEntry = this.diskEntries?.get(cacheKey);
    if (diskEntry && diskEntry.expiresAt > now) {
      const diskSizeBytes = estimateBytes(diskEntry.data);
      this.memory.set(cacheKey, diskEntry);
      this.stats.hits++;
      this.stats.diskHits++;
      this.stats.totalHitBytes += diskSizeBytes;
      return this.emitLookup({
        status: 'hit',
        source: 'disk',
        data: diskEntry.data,
        age: now - diskEntry.createdAt,
        key: cacheKey,
        sizeBytes: diskSizeBytes,
      });
    }

    // Expired disk entry - lazy cleanup
    if (diskEntry) {
      this.diskEntries?.delete(cacheKey);
      this.persistDisk();
    }

    this.stats.misses++;
    return this.emitLookup({ status: 'miss', key: cacheKey });
  }

  /**
   * Get the most recent cache lookup result (for per-call logging).
   */
  get lastLookup(): CacheLookupResult | null {
    return this._lastLookup;
  }

  /**
   * Store a response in the cache.
   */
  set(path: string, body: unknown, data: unknown): void {
    if (!this.enabled) return;

    const cacheKey = generateApiCacheKey(path, body);
    if (cacheKey === null) return;

    const ttlMs = getEndpointTtlMs(path);
    if (ttlMs === null) return;

    const now = Date.now();
    const entry: CacheEntry = {
      data,
      expiresAt: now + ttlMs,
      createdAt: now,
      endpoint: path,
      cacheKey,
    };

    this.memory.set(cacheKey, entry);
    this.stats.writes++;
    this.stats.totalWriteBytes += estimateBytes(data);

    if (this.diskEntries) {
      this.diskEntries.set(cacheKey, entry);
      this.persistDisk();
    }
  }

  /**
   * Get current cache statistics.
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get info about the persistent disk cache (for `finterm cache stats`).
   */
  getDiskInfo(): DiskCacheInfo | null {
    if (!this.diskEntries || !this.cachePath) return null;

    let entryCount = 0;
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const entry of this.diskEntries.values()) {
      entryCount++;
      if (oldest === null || entry.createdAt < oldest) oldest = entry.createdAt;
      if (newest === null || entry.createdAt > newest) newest = entry.createdAt;
    }

    return {
      entryCount,
      oldestCreatedAt: oldest,
      newestCreatedAt: newest,
      cachePath: this.cachePath,
    };
  }

  /**
   * Clear all cached entries and reset stats.
   * If disk persistence is active, also empties the cache file.
   */
  clear(): void {
    this.memory.clear();

    if (this.diskEntries) {
      this.diskEntries.clear();
      this.persistDisk();
    }

    this.stats = {
      hits: 0,
      memoryHits: 0,
      diskHits: 0,
      misses: 0,
      skips: 0,
      writes: 0,
      errors: 0,
      totalHitBytes: 0,
      totalWriteBytes: 0,
    };
  }

  /**
   * Close the disk cache. Included for API symmetry; file-backed cache writes eagerly.
   */
  close(): void {
    this.diskEntries = null;
  }
}
