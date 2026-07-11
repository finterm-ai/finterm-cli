/**
 * Database-free DR/0.3 profile:file reader.
 *
 * This module is the shared implementation for regular launch-delivered
 * dataroom usage. It deliberately does not import database-backed stores.
 */

import { createReadStream, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { open as openFile, readFile, stat } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

import {
  DATA_DIR,
  FILE_PROFILE_FORMAT_VERSION,
  FILES_DIR,
  ROOM_METADATA_FILE,
  ROOM_PROFILE_FILE,
  DEFAULTS,
} from './constants.js';
import { FormatError, NotFoundError, ValidationError } from './errors.js';
import type {
  ArtifactReadOptions,
  ArtifactReadResult,
  FacetFilter,
  ArtifactRef,
  ArtifactSearchFacets,
  DataRoomMetadata,
  FileEntry,
  FileQueryResult,
  QueryFilesOptions,
} from './types.js';
import { asFormatVersion } from './types.js';
import { formatArtifactRef, normalizeArtifactPath, parseArtifactRef } from './utils/artifactRef.js';
import { buildArtifactSearchFacets, matchesFacetFilters } from './utils/artifactFacets.js';
import { getContentTypeFromFilename, isTextContentType } from './utils/contentType.js';
import { sha256 } from './utils/hash.js';
import { parseYaml, validateRequiredKeys } from './utils/yaml.js';

const MAX_SEARCH_SNIPPET_CHARS = 240;
const SNIPPET_BOUNDARY_MARKER = '...';

interface FileDigestCacheEntry {
  size: number;
  mtimeMs: number;
  digest: string;
}

/**
 * Per-room digest cache. Keyed weakly so the cache is reclaimed when a room
 * object is dropped, avoiding unbounded growth across many opened rooms.
 */
const fileDigestCaches = new WeakMap<FileProfileRoom, Map<string, FileDigestCacheEntry>>();

/** An opened profile:file room: its root plus resolved `files/` and `data/` dirs. */
export interface FileProfileRoom {
  path: string;
  filesDir: string;
  dataDir: string;
  metadata: DataRoomMetadata & { profile: typeof ROOM_PROFILE_FILE };
}

/**
 * A single artifact under `files/`, with its derived index entry, facets, and
 * optional metadata pulled from frontmatter or a sidecar.
 */
export interface FileProfileFile {
  roomId: string;
  ref: ArtifactRef;
  path: string;
  absolutePath: string;
  contentType: string;
  size: number;
  updatedAt: string;
  entry: FileEntry;
  facets: ArtifactSearchFacets;
  metadata?: FileProfileMetadata;
}

/**
 * Optional descriptive metadata for a file, merged from markdown frontmatter
 * and `.meta.*` sidecars. All fields are best-effort and may be absent.
 */
export interface FileProfileMetadata {
  kind?: string;
  schemaId?: string;
  title?: string;
  description?: string;
  tags?: string[];
  frontmatterKeys?: string[];
}

/** A single text-search hit: the matched file plus the matching line and snippet. */
export interface FileProfileSearchMatch {
  roomId: string;
  ref: ArtifactRef;
  path: string;
  contentType: string;
  line: number;
  snippet: string;
  snippetTruncated: boolean;
  facets: ArtifactSearchFacets;
}

/** Filters and bounds for {@link searchFileProfileFiles}. */
export interface FileProfileSearchOptions {
  pathPrefix?: string;
  limit?: number;
  facets?: FacetFilter[];
}

/**
 * Open a profile:file room from a directory or its `dataroom.yml` path,
 * validating that the manifest declares a compatible format and the `file`
 * profile before returning a usable room handle.
 */
export async function openFileProfileRoom(inputPath: string): Promise<FileProfileRoom> {
  const resolved = resolve(inputPath);
  const roomPath = basename(resolved) === ROOM_METADATA_FILE ? dirname(resolved) : resolved;
  const manifestPath = join(roomPath, ROOM_METADATA_FILE);
  const rawMetadata = parseYaml<Record<string, unknown>>(await readFile(manifestPath, 'utf-8'));
  const missing = validateRequiredKeys(rawMetadata, ['format', 'type', 'name']);
  if (missing.length > 0) {
    throw new ValidationError(
      `Invalid ${ROOM_METADATA_FILE}`,
      missing.map((key) => `missing ${key}`),
    );
  }

  const format = String(rawMetadata['format']);
  if (format !== FILE_PROFILE_FORMAT_VERSION) {
    throw new FormatError(FILE_PROFILE_FORMAT_VERSION, format);
  }
  if (rawMetadata['type'] !== 'dataroom') {
    throw new ValidationError(`Invalid ${ROOM_METADATA_FILE}`, ['type must be "dataroom"']);
  }
  if (rawMetadata['profile'] !== ROOM_PROFILE_FILE) {
    throw new ValidationError(`Invalid ${ROOM_METADATA_FILE}`, ['profile must be "file"']);
  }

  const capabilities = isRecord(rawMetadata['capabilities'])
    ? rawMetadata['capabilities']
    : undefined;
  return createFileProfileRoom({
    roomPath,
    metadata: {
      format: asFormatVersion(FILE_PROFILE_FORMAT_VERSION),
      type: 'dataroom',
      name: String(rawMetadata['name']),
      profile: ROOM_PROFILE_FILE,
      ...(capabilities ? { capabilities } : {}),
      ...(typeof rawMetadata['title'] === 'string' ? { title: rawMetadata['title'] } : {}),
      ...(typeof rawMetadata['description'] === 'string'
        ? { description: rawMetadata['description'] }
        : {}),
    },
  });
}

/**
 * Construct a room handle from already-parsed metadata, without touching disk.
 * Lets callers that already hold validated metadata avoid re-reading the
 * manifest; still re-checks the format and profile to keep the invariant local.
 */
export function createFileProfileRoom(args: {
  roomPath: string;
  metadata: DataRoomMetadata;
}): FileProfileRoom {
  if (args.metadata.format !== FILE_PROFILE_FORMAT_VERSION) {
    throw new FormatError(FILE_PROFILE_FORMAT_VERSION, args.metadata.format);
  }
  if (args.metadata.profile !== ROOM_PROFILE_FILE) {
    throw new ValidationError('Invalid dataroom profile', ['profile must be "file"']);
  }
  return {
    path: args.roomPath,
    filesDir: join(args.roomPath, FILES_DIR),
    dataDir: join(args.roomPath, DATA_DIR),
    metadata: {
      ...args.metadata,
      format: asFormatVersion(FILE_PROFILE_FORMAT_VERSION),
      profile: ROOM_PROFILE_FILE,
    },
  };
}

/**
 * List every artifact under `files/`, sorted by path for deterministic output
 * across platforms and runs.
 */
export function listFileProfileFiles(room: FileProfileRoom): FileProfileFile[] {
  const results: FileProfileFile[] = [];
  scanFileProfileDirectory(room, room.filesDir, results);
  return results.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Query files by path prefix and facet filters, returning stable query records
 * rather than the heavier internal file shape. Accepts a `files/`-prefixed
 * prefix and strips it so callers can pass refs or display paths interchangeably.
 */
export function queryFileProfileFiles(
  room: FileProfileRoom,
  options: QueryFilesOptions = {},
): FileQueryResult[] {
  const pathPrefix = options.pathPrefix?.replace(new RegExp(`^${FILES_DIR}/`), '');
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  if (limit <= 0) {
    return [];
  }

  const results: FileQueryResult[] = [];
  for (const file of listFileProfileFiles(room)) {
    if (pathPrefix && !file.path.startsWith(pathPrefix)) {
      continue;
    }
    if (!matchesFacetFilters(file.facets, options.facets)) {
      continue;
    }
    results.push({
      ref: file.ref,
      path: file.path,
      entry: file.entry,
      facets: file.facets,
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

/**
 * Build the full descriptor for one file from its room-relative path. Returns
 * `undefined` (rather than throwing) for paths that are unsafe, missing, or not
 * regular files, so directory scans and reads can skip them silently. An
 * already-obtained `Stats` may be passed to avoid a redundant `stat` call.
 */
export function buildFileProfileFile(
  room: FileProfileRoom,
  relativePath: string,
  stats?: Stats,
): FileProfileFile | undefined {
  let normalizedRelativePath: string;
  try {
    normalizedRelativePath = normalizeArtifactPath('file', relativePath);
  } catch {
    return undefined;
  }

  // Containment comes before ANY read: resolve every symlink (in the final
  // component or any parent) and require the target to stay inside the room's
  // files directory. Only the verified real path is statted, hashed, or read,
  // so an escaping symlink leaks neither content nor a size/digest descriptor.
  const realPath = resolveContainedRealPath(room, join(room.filesDir, normalizedRelativePath));
  if (!realPath) {
    return undefined;
  }
  try {
    const currentStats = stats ?? statSync(realPath);
    if (!currentStats.isFile()) {
      return undefined;
    }
    const contentType = getContentTypeFromFilename(normalizedRelativePath);
    const timestamp = currentStats.mtime.toISOString();
    const metadata = loadFileProfileMetadata(room, realPath, normalizedRelativePath);
    const facets = buildFileProfileFacets(normalizedRelativePath, contentType, metadata);
    const entry: FileEntry = {
      path: `${FILES_DIR}/${normalizedRelativePath}`,
      digest: getFileDigest(room, normalizedRelativePath, realPath, currentStats),
      size: currentStats.size,
      contentType,
      facets,
      addedAt: timestamp,
      updatedAt: timestamp,
    };
    return {
      roomId: room.metadata.name,
      ref: formatArtifactRef('file', normalizedRelativePath),
      path: normalizedRelativePath,
      absolutePath: realPath,
      contentType,
      size: currentStats.size,
      updatedAt: timestamp,
      entry,
      facets,
      ...(metadata ? { metadata } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Resolve a candidate path under `files/` to its real path, returning
 * `undefined` unless the fully resolved target stays inside the room's files
 * directory. The files root is resolved too, so rooms living under a
 * symlinked parent still work.
 */
function resolveContainedRealPath(room: FileProfileRoom, fullPath: string): string | undefined {
  try {
    const rootRealPath = realpathSync(room.filesDir);
    const fileRealPath = realpathSync(fullPath);
    if (fileRealPath !== rootRealPath && !fileRealPath.startsWith(rootRealPath + sep)) {
      return undefined;
    }
    return fileRealPath;
  } catch {
    return undefined;
  }
}

/**
 * Return a file's SHA-256, reusing a cached digest while size and mtime are
 * unchanged. Hashing every file on each listing is the dominant cost for large
 * rooms; the (size, mtime) pair is a cheap, good-enough staleness check.
 */
function getFileDigest(
  room: FileProfileRoom,
  relativePath: string,
  fullPath: string,
  stats: Stats,
): string {
  const cache = getFileDigestCache(room);
  const cached = cache.get(relativePath);
  if (cached?.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
    return cached.digest;
  }

  const digest = sha256(readFileSync(fullPath));
  cache.set(relativePath, {
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    digest,
  });
  return digest;
}

function getFileDigestCache(room: FileProfileRoom): Map<string, FileDigestCacheEntry> {
  const existing = fileDigestCaches.get(room);
  if (existing) {
    return existing;
  }
  const cache = new Map<string, FileDigestCacheEntry>();
  fileDigestCaches.set(room, cache);
  return cache;
}

/**
 * Read a bounded slice of a file artifact, decoding text for textual content
 * types. The read is capped at `maxBytes` (truncating large files) and guarded
 * against symlink escapes so a malicious artifact cannot read outside the room.
 */
export async function readFileProfileArtifact(
  room: FileProfileRoom,
  ref: ArtifactRef | string,
  options: ArtifactReadOptions = {},
): Promise<ArtifactReadResult> {
  const parsed = parseArtifactRef(ref);
  if (parsed.kind !== 'file') {
    throw new ValidationError('profile:file rooms expose file artifacts only');
  }

  const maxBytes = options.maxBytes ?? DEFAULTS.AGENT_READ_MAX_BYTES;
  validateMaxBytes(maxBytes);
  const file = buildFileProfileFile(room, parsed.path);
  if (!file) {
    throw new NotFoundError(parsed.ref, 'file');
  }

  // file.absolutePath is the containment-verified real path from
  // buildFileProfileFile; escaping symlinks never reach this point.
  const boundedRead = await readBoundedFile(file.absolutePath, maxBytes, parsed.ref);
  const includeText = options.includeText ?? true;
  const text =
    includeText && isTextContentType(file.contentType)
      ? boundedRead.buffer.toString('utf-8')
      : undefined;

  return {
    ref: parsed.ref,
    contentType: file.contentType,
    facets: file.facets,
    size: boundedRead.size,
    bytesReturned: boundedRead.buffer.length,
    truncated: boundedRead.truncated,
    buffer: boundedRead.buffer,
    ...(text !== undefined ? { text } : {}),
  };
}

/**
 * Case-insensitive substring search over textual files, returning at most one
 * match (the first matching line) per file. Streams files line by line so a
 * large room can be searched without loading whole files into memory.
 */
export async function searchFileProfileFiles(
  room: FileProfileRoom,
  query: string,
  options: FileProfileSearchOptions = {},
): Promise<FileProfileSearchMatch[]> {
  const limit = options.limit ?? 20;
  const pathPrefix = options.pathPrefix?.replace(new RegExp(`^${FILES_DIR}/`), '');
  const needle = query.toLowerCase();
  const matches: FileProfileSearchMatch[] = [];

  for (const file of listFileProfileFiles(room)) {
    if (matches.length >= limit) {
      break;
    }
    if (pathPrefix && !file.path.startsWith(pathPrefix)) {
      continue;
    }
    if (!matchesFacetFilters(file.facets, options.facets)) {
      continue;
    }
    if (!isTextContentType(file.contentType)) {
      continue;
    }

    const match = await findTextMatch(file.absolutePath, needle);
    if (!match) {
      continue;
    }
    matches.push({
      roomId: file.roomId,
      ref: file.ref,
      path: file.path,
      contentType: file.contentType,
      line: match.line,
      snippet: match.snippet,
      snippetTruncated: match.snippetTruncated,
      facets: file.facets,
    });
  }

  return matches;
}

function scanFileProfileDirectory(
  room: FileProfileRoom,
  directory: string,
  results: FileProfileFile[],
): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    // Never follow symlinks while enumerating: a link could expose files from
    // outside the room or loop infinitely. Reads enforce the same boundary.
    if (entry.isSymbolicLink()) {
      continue;
    }
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      scanFileProfileDirectory(room, fullPath, results);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = relative(room.filesDir, fullPath).split('\\').join('/');
    if (isMetadataSidecar(relativePath)) {
      continue;
    }
    const file = buildFileProfileFile(room, relativePath);
    if (file) {
      results.push(file);
    }
  }
}

function loadFileProfileMetadata(
  room: FileProfileRoom,
  absolutePath: string,
  relativePath: string,
): FileProfileMetadata | undefined {
  const sidecar = loadSidecarMetadata(room, absolutePath);
  const frontmatter = loadMarkdownFrontmatter(absolutePath, relativePath);
  const metadata = normalizeMetadata({ ...frontmatter, ...sidecar });
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function loadSidecarMetadata(room: FileProfileRoom, absolutePath: string): Record<string, unknown> {
  for (const path of [
    `${absolutePath}.meta.json`,
    `${absolutePath}.meta.yml`,
    `${absolutePath}.meta.yaml`,
  ]) {
    // The sidecar itself must stay inside the room: a symlinked sidecar could
    // otherwise surface fields parsed from an outside file.
    const contained = resolveContainedRealPath(room, path);
    if (!contained) {
      continue;
    }
    try {
      const raw = readFileSync(contained, 'utf-8');
      const parsed = path.endsWith('.json') ? (JSON.parse(raw) as unknown) : parseYaml(raw);
      return extractMetadataRoot(parsed);
    } catch {
      // Missing or invalid sidecars do not make the artifact unreadable.
    }
  }
  return {};
}

function loadMarkdownFrontmatter(
  absolutePath: string,
  relativePath: string,
): Record<string, unknown> {
  if (!['.md', '.markdown'].includes(extname(relativePath).toLowerCase())) {
    return {};
  }
  try {
    const raw = readFileSync(absolutePath, 'utf-8');
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
    if (!match) {
      return {};
    }
    return extractMetadataRoot(parseYaml(match[1] ?? ''));
  } catch {
    return {};
  }
}

function extractMetadataRoot(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  const dataroom = value['dataroom'];
  if (isRecord(dataroom)) {
    return dataroom;
  }
  return value;
}

function normalizeMetadata(value: Record<string, unknown>): FileProfileMetadata {
  const tags = Array.isArray(value['tags'])
    ? value['tags'].filter((tag): tag is string => typeof tag === 'string')
    : undefined;
  const camelKeys = Array.isArray(value['frontmatterKeys']) ? value['frontmatterKeys'] : [];
  const snakeKeys = Array.isArray(value['frontmatter_keys']) ? value['frontmatter_keys'] : [];
  const frontmatterKeys =
    camelKeys.length > 0 || snakeKeys.length > 0
      ? [...camelKeys, ...snakeKeys].filter((key): key is string => typeof key === 'string')
      : Object.keys(value);

  return {
    ...(typeof value['kind'] === 'string' ? { kind: value['kind'] } : {}),
    ...(typeof value['schemaId'] === 'string' ? { schemaId: value['schemaId'] } : {}),
    ...(typeof value['schema_id'] === 'string' ? { schemaId: value['schema_id'] } : {}),
    ...(typeof value['schema'] === 'string' ? { schemaId: value['schema'] } : {}),
    ...(typeof value['title'] === 'string' ? { title: value['title'] } : {}),
    ...(typeof value['description'] === 'string' ? { description: value['description'] } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(frontmatterKeys.length > 0 ? { frontmatterKeys } : {}),
  };
}

function buildFileProfileFacets(
  relativePath: string,
  contentType: string,
  metadata: FileProfileMetadata | undefined,
): ArtifactSearchFacets {
  return buildArtifactSearchFacets({
    path: relativePath,
    contentType,
    ...(metadata?.kind ? { declaredKind: metadata.kind } : {}),
    ...(metadata?.schemaId ? { schemaId: metadata.schemaId } : {}),
    ...(metadata?.title ? { title: metadata.title } : {}),
    ...(metadata?.description ? { description: metadata.description } : {}),
    ...(metadata?.tags ? { tags: metadata.tags } : {}),
    ...(metadata?.frontmatterKeys ? { frontmatterKeys: metadata.frontmatterKeys } : {}),
  });
}

function isMetadataSidecar(relativePath: string): boolean {
  return /\.(meta\.json|meta\.ya?ml)$/i.test(relativePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new ValidationError('maxBytes must be a non-negative safe integer');
  }
}

async function readBoundedFile(
  fullPath: string,
  maxBytes: number,
  artifactRef: ArtifactRef,
): Promise<{ buffer: Buffer; size: number; truncated: boolean }> {
  try {
    const stats = await stat(fullPath);
    if (!stats.isFile()) {
      throw new Error('not a file');
    }

    const bytesToRead = Math.min(stats.size, maxBytes);
    if (bytesToRead === 0) {
      return {
        buffer: Buffer.alloc(0),
        size: stats.size,
        truncated: stats.size > 0,
      };
    }

    const handle = await openFile(fullPath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
      return {
        buffer: buffer.subarray(0, bytesRead),
        size: stats.size,
        truncated: stats.size > bytesRead,
      };
    } finally {
      await handle.close();
    }
  } catch {
    throw new NotFoundError(artifactRef, 'file');
  }
}

async function findTextMatch(
  filePath: string,
  needle: string,
): Promise<{
  line: number;
  snippet: string;
  snippetTruncated: boolean;
} | null> {
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  let line = 0;
  try {
    for await (const lineText of lines) {
      line += 1;
      const matchIndex = lineText.toLowerCase().indexOf(needle);
      if (matchIndex !== -1) {
        return {
          line,
          ...buildSearchSnippet(lineText, matchIndex, needle.length),
        };
      }
    }
  } finally {
    lines.close();
  }
  return null;
}

function buildSearchSnippet(
  lineText: string,
  matchIndex: number,
  needleLength: number,
): { snippet: string; snippetTruncated: boolean } {
  const trimmedLineText = lineText.trim();
  if (trimmedLineText.length <= MAX_SEARCH_SNIPPET_CHARS) {
    return { snippet: trimmedLineText, snippetTruncated: false };
  }

  const contentBudget = MAX_SEARCH_SNIPPET_CHARS - SNIPPET_BOUNDARY_MARKER.length * 2;
  const matchCenter = matchIndex + Math.floor(needleLength / 2);
  let start = Math.max(0, matchCenter - Math.floor(contentBudget / 2));
  const end = Math.min(lineText.length, start + contentBudget);
  start = Math.max(0, end - contentBudget);

  let snippet = lineText.slice(start, end).trim();
  if (start > 0) {
    snippet = `${SNIPPET_BOUNDARY_MARKER}${snippet}`;
  }
  if (end < lineText.length) {
    snippet = `${snippet}${SNIPPET_BOUNDARY_MARKER}`;
  }
  return { snippet, snippetTruncated: true };
}
