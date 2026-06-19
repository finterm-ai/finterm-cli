/**
 * Type definitions for the dataroom package.
 *
 * @packageDocumentation
 */

// =============================================================================
// Branded Types
// =============================================================================

/**
 * Branded type for path specifications.
 * Prevents accidentally using plain strings where paths are expected.
 * Use `asPathSpec(str)` to create from validated string.
 *
 * Path specification - can be relative or absolute.
 * Relative paths are interpreted relative to the referencing file's directory.
 * Absolute paths start with / (Unix) or drive letter (Windows).
 * Tilde paths (~/) are expanded to user home directory.
 */
export type PathSpec = string & { readonly __brand: 'PathSpec' };

/**
 * Branded type for format version strings.
 * Use `asFormatVersion(str)` to create from validated string.
 * Format version follows pattern: DR/{major}.{minor}
 */
export type FormatVersion = string & { readonly __brand: 'FormatVersion' };

/** Public room profile for DR/0.3 launch-delivered file rooms. */
export type DataRoomProfile = 'file';

/**
 * Helper to create PathSpec from string.
 */
export function asPathSpec(path: string): PathSpec {
  // Basic validation: check for null bytes which are invalid in paths
  if (path.includes('\0')) {
    throw new Error('Path cannot contain null bytes');
  }
  return path as PathSpec;
}

/**
 * Helper to create FormatVersion from string.
 */
export function asFormatVersion(version: string): FormatVersion {
  // Validate format matches DR/x.y pattern
  if (!/^DR\/\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid format version: ${version}. Expected pattern: DR/x.y`);
  }
  return version as FormatVersion;
}

// =============================================================================
// Metadata Interfaces
// =============================================================================

/**
 * Dataroom metadata (metadata/dataroom.yml).
 * Minimal identification metadata for a single research bundle.
 */
export interface DataRoomMetadata {
  /** Format version (e.g., "DR/0.1") */
  format: FormatVersion;
  /** Type identifier - always 'dataroom' */
  type: 'dataroom';
  /** Room name (defaults to directory name) */
  name: string;
  /** Optional room profile. `file` means no catalog database is required to read. */
  profile?: DataRoomProfile;
  /** Optional profile capability metadata copied from `dataroom.yml`. */
  capabilities?: Record<string, unknown>;
  /** Optional: Human-readable title */
  title?: string;
  /** Optional: Longer description */
  description?: string;
  /** Optional blob compression config (camelCase mirror of `blob_compression`). */
  blobCompression?: Partial<BlobCompressionConfig>;
}

/**
 * Room reference in a datalib file.
 */
export interface RoomReference {
  /** Room identifier (typically the room name) */
  id: string;
  /** Relative path to room directory */
  path: PathSpec;
}

/**
 * Blob layer reference in a datalib file.
 */
export interface BlobLayerReference {
  /** Relative or absolute path to blob cache */
  path: PathSpec;
}

/**
 * Datalib metadata (datalib.yml).
 * Coordinates multiple rooms with shared blob cache layers.
 */
export interface DataLibMetadata {
  /** Format version (e.g., "DR/0.1") */
  format: FormatVersion;
  /** Type identifier - always 'datalib' */
  type: 'datalib';
  /** Library name (defaults to directory name) */
  name: string;
  /** Shared blob cache layers, checked in order */
  blob_layers: BlobLayerReference[];
  /** Rooms in this library */
  rooms: RoomReference[];
  /** Optional: Human-readable title */
  title?: string;
  /** Optional: Longer description */
  description?: string;
  /** Optional blob compression config (camelCase mirror of `blob_compression`). */
  blobCompression?: Partial<BlobCompressionConfig>;
  /**
   * Unknown top-level fields read from `datalib.yml` that the current schema
   * does not model (e.g. a future `library_id`, `retention`, `layers`, or user
   * extensions). Preserved verbatim so manifest mutations (`addRoom`,
   * `removeRoom`) round-trip them instead of silently erasing forward-compatible
   * or downstream fields.
   */
  extra?: Record<string, unknown>;
}

// =============================================================================
// Runtime Types
// =============================================================================

/**
 * Runtime options when opening a room.
 */
export interface RuntimeOptions {
  /** Never update dataroom (writes blocked). Default: false */
  readonly?: boolean;
  /**
   * Sealed: no external operations (network fetches, API/tool calls) may run.
   * Cached values and local derivations are still served; a sealed miss throws
   * `SealedRoomError`. Default: false.
   */
  sealed?: boolean;
  /**
   * Deprecated alias for `sealed`. Retained for one release; prefer `sealed`.
   * When both are set, either being true seals the room.
   */
  offline?: boolean;
  /**
   * Suppress the one-time stderr warning emitted when opening a room or
   * library whose `format:` is older than the package's current version. The
   * database-free core does not emit these warnings, but adapter packages may
   * honor this option.
   */
  suppressFormatWarnings?: boolean;
}

/**
 * Options for creating a new dataroom.
 */
export interface CreateRoomOptions {
  /** Room name (defaults to directory name) */
  name?: string;
  /** Human-readable title */
  title?: string;
  /** Longer description */
  description?: string;
  /** Optional public room profile. `file` writes a DR/0.3 file-tree layout. */
  profile?: DataRoomProfile;
  /** Optional blob compression config written to `dataroom.yml`. */
  blobCompression?: Partial<BlobCompressionConfig>;
}

/**
 * Options for creating a new datalib.
 */
export interface CreateLibraryOptions {
  /** Library name (defaults to directory name) */
  name?: string;
  /** Human-readable title */
  title?: string;
  /** Longer description */
  description?: string;
  /** Shared blob cache layers */
  blobLayers?: BlobLayerReference[];
  /** Optional blob compression config written to `datalib.yml`. */
  blobCompression?: Partial<BlobCompressionConfig>;
}

// =============================================================================
// Compression Types
// =============================================================================

/**
 * Per-blob compression codec.
 *
 * Phase 1 registers `gzip` and `zstd` (both via Node's built-in `zlib`).
 * `brotli` is reserved for a later registry addition.
 */
export type BlobEncoding = 'gzip' | 'zstd' | 'brotli';

/**
 * A codec choice for writing, including the `'none'` sentinel for "store raw".
 */
export type CodecChoice = BlobEncoding | 'none';

/**
 * Room/library compression configuration.
 *
 * Snake_case on disk (`blob_compression` in `dataroom.yml` / `datalib.yml`),
 * camelCase in TS (`blobCompression`).
 */
export interface BlobCompressionConfig {
  /** Default codec for new fetches; `'none'` stores raw. */
  codec: CodecChoice;
  /** -1 = never compress, 0 = always compress, N>0 = compress when size >= N. */
  minSize: number;
  /** Glob patterns of content types that bypass compression. */
  skipContentTypes: string[];
}

// =============================================================================
// Entry Types
// =============================================================================

/**
 * Entry for a file in files/ directory.
 * Pure provenance only - no user-editable metadata.
 *
 * In profile:file rooms this entry is derived directly from files under
 * `files/`, including markdown files with YAML frontmatter.
 */
export interface FileEntry {
  /** Relative to dataroom: "files/overview.md" */
  path: string;
  /** SHA-256 (informational, not enforced) */
  digest: string;
  /** File size in bytes */
  size: number;
  /** MIME content type */
  contentType: string;
  /** Searchable facets derived from path/content metadata */
  facets?: ArtifactSearchFacets;
  /** ISO timestamp when file was added */
  addedAt: string;
  /** ISO timestamp when file was last updated */
  updatedAt: string;
}

/**
 * Source information for a blob.
 */
export interface BlobSource {
  /** Type of source */
  type: 'url' | 'api' | 'file';
  /** Original URL if fetched from web */
  url?: string;
  /** API provider if from API call */
  provider?: string;
  /** API endpoint if from API call */
  endpoint?: string;
  /** API params for deduplication */
  params?: Record<string, unknown>;
}

/**
 * HTTP metadata from a fetch.
 * Only key headers are preserved by producer adapters.
 */
export interface HttpMetadata {
  /** HTTP status code */
  status: number;
  /** Allowlisted headers only (content-type, content-length, etag, last-modified) */
  headers: Record<string, string>;
  /** Final URL after redirects */
  finalUrl?: string;
}

/**
 * Entry for a blob in blobs/ directory.
 * Pure provenance only - no user-editable metadata.
 * Use markdown frontmatter in reports to document sources, add notes, etc.
 *
 * This keeps blob metadata shareable across rooms without mixing
 * room-specific annotations with cache provenance.
 */
export interface BlobEntry {
  /** On-disk relative path: "blobs/{source}_...json[.gz|.zst]" */
  path: string;
  /** SHA-256 of the UNCOMPRESSED content (semantic identity) */
  digest: string;
  /** UNCOMPRESSED size in bytes (semantic identity) */
  size: number;
  /** MIME content type */
  contentType: string;
  /** ISO timestamp when fetched */
  fetchedAt: string;
  /** Source information */
  source: BlobSource;
  /**
   * Neutral provenance bag (loading-cache model). Additive: populated going
   * forward; readers may also derive equivalent info from {@link source} for
   * blobs written before this field existed.
   */
  provenance?: Provenance;
  /** HTTP metadata if from web fetch */
  http?: HttpMetadata;
  /** Optional expiry timestamp; undefined = never expires */
  expiresAt?: string;
  /** On-disk codec; absent means raw or adapter-defined default behavior. */
  encoding?: BlobEncoding;
  /** On-disk size in bytes; absent ⇒ same as `size`. */
  storedSize?: number;
  /** SHA-256 of the on-disk (compressed) bytes, for sync/validate. */
  storedDigest?: string;
}

// =============================================================================
// Artifact and Search Facet Types
// =============================================================================

/**
 * Room-local artifact reference.
 *
 * Blob refs name a blob filename without the `blobs/` prefix.
 * File refs name a path under `files/` without the `files/` prefix.
 */
export type ArtifactRef = `blob:${string}` | `file:${string}`;

/**
 * Artifact reference kind.
 */
export type ArtifactRefKind = 'blob' | 'file';

/**
 * Parsed artifact reference.
 */
export interface ParsedArtifactRef {
  /** Artifact kind */
  kind: ArtifactRefKind;
  /** Prefix-free room-local path */
  path: string;
  /** Original validated reference */
  ref: ArtifactRef;
}

/**
 * Normalized searchable facet scalar value.
 */
export type FacetValue = string | number | boolean | null;

/**
 * Facets exposed by readable artifacts and file query results.
 */
export interface ArtifactSearchFacets {
  /** MIME content type, normalized without parameters */
  contentType: string;
  /** Broad extension, e.g. "md" */
  extension: string | null;
  /** Broad-to-specific suffixes, e.g. ["md", "process.md"] */
  extensionSuffixes: string[];
  /** Most specific extension-derived kind, e.g. "process.md" */
  fileKind: string | null;
  /** Broad-to-specific file-kind hierarchy */
  fileKindHierarchy: string[];
  /** Optional kind declared by frontmatter or sidecar metadata */
  declaredKind?: string;
  /** Optional schema ID declared by frontmatter or sidecar metadata */
  schemaId?: string;
  /** Optional human-readable title */
  title?: string;
  /** Optional human-readable description */
  description?: string;
  /** Optional normalized tags */
  tags?: string[];
  /** Optional normalized frontmatter key names */
  frontmatterKeys?: string[];
  /** Future normalized client-specific facets */
  custom?: Record<string, FacetValue>;
}

/**
 * Top-level or custom facet key used by filters.
 */
export type ArtifactSearchFacetKey = keyof ArtifactSearchFacets | `custom.${string}`;

/**
 * Exact-match facet filter.
 */
export interface FacetFilter {
  /** Facet key, such as contentType, fileKindHierarchy, or custom.foo */
  key: ArtifactSearchFacetKey;
  /** Value to match */
  value: FacetValue;
  /** Match only when the facet is absent */
  missing?: boolean;
}

// =============================================================================
// Index Types
// =============================================================================

/** URL index entry pointing to a blob. */
export interface UrlIndex {
  /** The actual normalized URL (for collision detection) */
  normalizedUrl: string;
  /** Points to blob:{filename} */
  blobKey: string;
  /** ISO timestamp when fetched */
  fetchedAt: string;
}

/** Action index entry for request deduplication. */
export interface ActionIndex {
  /** Points to blob:{filename} */
  blobKey: string;
  /** ISO timestamp when fetched */
  fetchedAt: string;
  /**
   * The full request-identity digest (SHA-256 of the canonical request) this
   * entry was stored under, for collision detection. Adapters that use compact
   * keys can compare this field and treat a mismatch as a cache miss.
   */
  requestHash?: string;
}

// =============================================================================
// Loading-Cache Core Types
// =============================================================================

/**
 * A cache payload: opaque bytes plus their content type. This is the unit the
 * loading-cache core stores and returns; it knows nothing about how the bytes
 * were produced (HTTP fetch, API/tool call, derivation, or caller-provided).
 */
export interface Payload {
  /** Raw bytes of the payload. */
  bytes: Buffer;
  /** MIME content type (e.g. 'application/json', 'text/html'). */
  contentType: string;
}

/**
 * An acquisition operation: an opaque callback the cache runs only on a miss.
 *
 * `kind` controls sealing: `external` operations (network/API/tool) are refused
 * when the room is sealed; `local` operations (pure derivations that read only
 * already-stored bytes) always run. Defaults to `external` when omitted, since
 * the conservative assumption is that an unknown operation may reach outside.
 */
export interface Operation {
  /** Whether this operation reaches outside the room. Default: 'external'. */
  kind?: 'external' | 'local';
  /** Produce the payload. Invoked only on a cache miss. */
  run: () => Promise<Payload>;
}

/**
 * Provenance recorded alongside a cached blob. `origin` says how the
 * bytes arrived, `evidence` carries adapter-supplied detail the core stores but
 * does not interpret.
 */
export interface Provenance {
  /** How the bytes were obtained. */
  origin: 'fetched' | 'provided' | 'derived';
  /** Opaque adapter-supplied detail (e.g. source URL, request descriptor). */
  evidence?: Record<string, unknown>;
}

/**
 * Options for `get`/`put`.
 */
export interface CacheGetOptions {
  /** TTL in milliseconds; undefined = never expires (default). */
  ttlMs?: number;
  /** Override the room's codec for this write; `'none'` forces raw. */
  encoding?: CodecChoice;
  /** Provenance to record (defaults derived from the operation/put kind). */
  provenance?: Provenance;
}

/**
 * Result of a `get`/`put`: the payload plus cache status and the backing entry.
 */
export interface CacheResult {
  /** The stored payload. */
  payload: Payload;
  /** Whether this was a cache hit (no operation run). */
  cached: boolean;
  /** Full blob entry metadata. */
  entry: BlobEntry;
}

/**
 * Role of a member within a key's labeled group.
 */
export type GroupMemberRole = 'raw' | 'derived';

/**
 * A single artifact within a key's group: the raw original or a derivation,
 * labeled so a caller can pick which representation to use.
 */
export interface GroupMember {
  /** Whether this is the raw source or a derivation of it. */
  role: GroupMemberRole;
  /** Artifact ref (`blob:` for raw, `file:` for a derivation). */
  ref: ArtifactRef;
  /** MIME content type of this member. */
  contentType: string;
  /** Producer label for a derivation (e.g. 'defuddle-0.18'); absent for raw. */
  producer?: string;
}

/**
 * The labeled group reachable from a primary key: the raw original plus any
 * derivations. Small by construction (typically 2-3, rarely >10).
 */
export interface ArtifactGroup {
  /** The primary key this group was resolved from. */
  key: string;
  /** Group members; the raw original (if present) plus derivations. */
  members: GroupMember[];
}

// =============================================================================
// Option Types
// =============================================================================

/**
 * Options for fetching and caching a URL.
 * Write target is determined by how room was opened (standalone vs via library).
 */
export interface FetchOptions {
  /** Override detected content type */
  contentType?: string;
  /** Custom HTTP headers */
  headers?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** TTL in milliseconds; undefined = eternal (default) */
  ttlMs?: number;
  /** Override the room's codec for this fetch; `'none'` forces raw. */
  encoding?: CodecChoice;
}

/**
 * Options for batch URL fetching.
 * Write target is determined by how room was opened (standalone vs via library).
 */
export interface FetchUrlsOptions {
  /** Max parallel fetches. Default: 5 */
  concurrency?: number;
  /** Continue on individual URL failures. Default: true */
  continueOnError?: boolean;
  /** Per-URL fetch options */
  fetchOptions?: FetchOptions;
}

/**
 * Options for action-based API deduplication.
 * Write target is determined by how room was opened (standalone vs via library).
 */
export interface FetchApiOptions<T> {
  /** Provider identifier (e.g., 'example-api', 'data-service') */
  provider: string;
  /** Endpoint or action name */
  endpoint: string;
  /** Request parameters (will be hashed for dedup) */
  params: Record<string, unknown>;
  /** Function that performs the actual fetch */
  fetcher: () => Promise<T>;
  /** Content type for caching. Default: 'application/json' */
  contentType?: string;
  /** TTL in milliseconds; undefined = eternal (default) */
  ttlMs?: number;
  /** Override the room's codec for this fetch; `'none'` forces raw. */
  encoding?: CodecChoice;
}

/**
 * Options for bounded artifact reads.
 */
export interface ArtifactReadOptions {
  /** Maximum bytes to return. Defaults to DEFAULTS.AGENT_READ_MAX_BYTES. */
  maxBytes?: number;
  /** Text decoding for textual artifacts. Defaults to utf-8. */
  encoding?: BufferEncoding;
  /** Include decoded text for textual content types. Default: true. */
  includeText?: boolean;
}

/**
 * Options for querying room-local file artifacts.
 */
export interface QueryFilesOptions {
  /** Only include files with paths under this prefix */
  pathPrefix?: string;
  /** Exact-match facet filters */
  facets?: FacetFilter[];
  /** Maximum number of files to return */
  limit?: number;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of adding a file.
 */
export interface AddFileResult {
  /** Relative path in files/ */
  path: string;
  /** SHA-256 digest of content */
  digest: string;
  /** File size in bytes */
  size: number;
}

/**
 * Result of fetching a URL.
 */
export interface FetchUrlResult extends BlobEntry {
  /** Whether this was a cache hit */
  cached: boolean;
}

/**
 * Result of fetching via API with dedup.
 */
export interface FetchApiResult<T> {
  /** The parsed API response data */
  data: T;
  /** Relative path to cached blob */
  path: string;
  /** Whether this was a cache hit */
  cached: boolean;
  /** Full blob entry metadata */
  entry: BlobEntry;
}

/**
 * Result of a bounded artifact read.
 */
export interface ArtifactReadResult {
  /** Artifact ref that was read */
  ref: ArtifactRef;
  /** MIME content type */
  contentType: string;
  /** Searchable facets for this artifact */
  facets: ArtifactSearchFacets;
  /** Full artifact size in bytes */
  size: number;
  /** Returned byte count */
  bytesReturned: number;
  /** True when maxBytes truncated the result */
  truncated: boolean;
  /** Returned bytes */
  buffer: Buffer;
  /** Decoded text for textual artifacts when includeText is enabled */
  text?: string;
}

/**
 * File query result with stable artifact metadata.
 */
export interface FileQueryResult {
  /** File artifact ref */
  ref: ArtifactRef;
  /** Prefix-free path under files/ */
  path: string;
  /** File index entry */
  entry: FileEntry;
  /** Searchable facets */
  facets: ArtifactSearchFacets;
}

// =============================================================================
// Relationship Types
// =============================================================================

/**
 * Directed relationship between two room-local artifacts.
 */
export interface ArtifactRelationship {
  /** Deterministic relationship ID derived from subject/predicate/object */
  id: string;
  /** Derivative or source artifact depending on predicate semantics */
  subject: ArtifactRef;
  /** Generic relationship predicate, such as derived_from */
  predicate: 'derived_from' | (string & {});
  /** Target artifact */
  object: ArtifactRef;
  /** Provenance metadata, not client ranking policy */
  metadata: Record<string, unknown>;
  /** ISO timestamp when the relationship was first created */
  createdAt: string;
  /** ISO timestamp when the relationship was last updated */
  updatedAt: string;
}

/**
 * Relationship lookup direction from the perspective of a ref.
 */
export type RelationshipDirection = 'incoming' | 'outgoing' | 'both';

/**
 * Options for adding a relationship.
 */
export interface AddRelationshipOptions {
  /** Permit missing subject/object artifacts. Intended for migrations only. */
  allowDangling?: boolean;
}

/**
 * Options for listing relationships.
 */
export interface ListRelationshipsOptions {
  /** Direction relative to the requested artifact. Defaults to both. */
  direction?: RelationshipDirection;
  /** Optional predicate filter */
  predicate?: string;
  /** Maximum number of relationships to return */
  limit?: number;
}

/**
 * URL artifact search miss reasons.
 */
export type UrlArtifactMissReason = 'url_not_cached' | 'blob_missing' | 'blob_expired';

/**
 * Successful URL artifact search result.
 */
export interface UrlArtifactMatch {
  /** Discriminant */
  ok: true;
  /** Normalized URL used for search */
  normalizedUrl: string;
  /** Blob artifact ref */
  ref: ArtifactRef;
  /** Blob metadata */
  entry: BlobEntry;
  /** Blob facets */
  facets: ArtifactSearchFacets;
  /** Layer type where the blob was found */
  layerType: LayerType;
  /** Absolute layer path where the blob was found */
  layerPath: string;
}

/**
 * URL artifact search miss result.
 */
export interface UrlArtifactMiss {
  /** Discriminant */
  ok: false;
  /** Normalized URL used for search */
  normalizedUrl: string;
  /** Structured miss reason */
  missReason: UrlArtifactMissReason;
  /** Blob ref when URL metadata exists but the blob is unavailable */
  ref?: ArtifactRef;
}

/**
 * URL artifact search result.
 */
export type UrlArtifactResult = UrlArtifactMatch | UrlArtifactMiss;

/**
 * Options for joining relationships to artifact metadata.
 */
export interface ListRelatedArtifactsOptions extends ListRelationshipsOptions {
  /** Exact-match facet filters for related artifacts */
  facets?: FacetFilter[];
  /** Include relationships whose related artifact is missing */
  includeMissing?: boolean;
}

/**
 * Relationship joined to the artifact on the other end of the edge.
 */
export interface RelatedArtifactResult {
  /** Relationship record */
  relationship: ArtifactRelationship;
  /** Related artifact ref */
  ref: ArtifactRef;
  /** Whether the related artifact exists in indexes/layers */
  exists: boolean;
  /** Content type when available */
  contentType?: string;
  /** Searchable facets when available */
  facets?: ArtifactSearchFacets;
  /** Artifact size when available */
  size?: number;
}

/**
 * Result of backfilling relationships for page-fetch derived files.
 */
export interface BackfillDerivedRelationshipsResult {
  /** Number of relationships newly added */
  added: number;
  /** Number of relationships that already existed */
  existing: number;
  /** Derived files whose digest prefix matched no blob */
  missing: { fileRef: ArtifactRef; digestPrefix: string }[];
  /** Derived files whose digest prefix matched multiple blobs */
  ambiguous: {
    fileRef: ArtifactRef;
    digestPrefix: string;
    blobRefs: ArtifactRef[];
  }[];
}

/**
 * Detailed room reference from a DataLibrary.
 */
export interface LibraryRoomDetail {
  /** Room ID */
  roomId: string;
  /** Stored path from datalib.yml */
  path: string;
  /** Absolute resolved room path */
  resolvedPath: string;
  /** Whether the stored path is relative */
  isRelative: boolean;
  /** Whether the resolved path is under the library root */
  isInsideLibrary: boolean;
  /** Portability classification */
  portability: 'relative' | 'in_root_absolute' | 'external_absolute';
  /** Basic file count when the room opens successfully */
  files?: number;
  /** Basic blob count when the room opens successfully */
  blobs?: number;
}

/**
 * Room-qualified URL artifact match.
 */
export interface LibraryUrlArtifactMatch extends UrlArtifactMatch {
  /** Room containing the URL artifact match */
  roomId: string;
}

/**
 * Options for finding URL artifacts across a library.
 */
export interface LibraryFindUrlArtifactsOptions {
  /** Room ID subset, or null to search every registered room. */
  roomIds: string[] | null;
}

/**
 * One per-room miss record returned by
 * {@link LibraryUrlArtifactsResult.misses}. Lets the caller
 * distinguish "this room never saw this URL" from "this room has a stale
 * URL entry pointing at a missing blob", which is index drift the caller
 * may want to flag or repair.
 */
export interface LibraryUrlArtifactMiss {
  /** Room ID the miss came from. */
  roomId: string;
  /** Structured per-room miss reason. */
  missReason: UrlArtifactMissReason;
  /** Blob ref when URL metadata exists but the blob is unavailable. */
  ref?: ArtifactRef;
}

/**
 * Options for {@link DataRoom.removeBlob}.
 *
 * Default behavior is unchanged: the blob and its index entry go away; URL
 * index entries pointing at the blob are left intact, so subsequent
 * `findUrlArtifact()` calls return a structured `blob_missing` miss.
 * `removeUrlMappings: true` drops those URL entries in the same pass.
 */
export interface RemoveBlobOptions {
  /**
   * When true, also delete every URL index entry whose `blobKey` points at
   * the removed blob. Default `false` preserves the intentional-tombstone
   * model — `findUrlArtifact()` then reports `blob_missing` rather than
   * `url_not_cached`.
   */
  removeUrlMappings?: boolean;
}

/**
 * Cross-room URL artifact search result.
 */
export interface LibraryUrlArtifactsResult {
  /** True when at least one room matched */
  ok: boolean;
  /** Normalized URL used for search */
  normalizedUrl: string;
  /**
   * Structured miss reason when no rooms matched, rolled up by severity:
   * `blob_missing` or `blob_expired` outrank `url_not_cached` so the caller
   * sees the most actionable diagnostic first.
   */
  missReason?: UrlArtifactMissReason;
  /** Room-qualified matches sorted by roomId */
  matches: LibraryUrlArtifactMatch[];
  /**
   * Bounded list of per-room misses. Capped at
   * {@link LIBRARY_URL_MISSES_CAP} to keep payloads small in libraries with
   * many rooms; ordering preserves the same `roomId` sort as `matches`.
   */
  misses?: LibraryUrlArtifactMiss[];
}

/**
 * Library file query options.
 */
export interface LibraryQueryFilesOptions extends QueryFilesOptions {
  /** Optional room ID subset */
  roomIds?: string[];
}

/**
 * Room-qualified file query result.
 */
export interface LibraryFileQueryResult extends FileQueryResult {
  /** Room containing the file */
  roomId: string;
}

/**
 * Room-qualified artifact read result.
 */
export interface LibraryArtifactReadResult extends ArtifactReadResult {
  /** Room containing the artifact */
  roomId: string;
}

/**
 * Room-qualified relationship result.
 */
export interface LibraryRelationshipResult extends ArtifactRelationship {
  /** Room containing the relationship */
  roomId: string;
}

/**
 * Room-qualified related artifact result.
 */
export interface LibraryRelatedArtifactResult extends RelatedArtifactResult {
  /** Room containing the relationship and related artifact */
  roomId: string;
}

/**
 * Secondary-index value for relationship lookups.
 */
export interface RelationshipIndexEntry {
  /** Primary relationship ID */
  relationshipId: string;
  /** Full subject ref for collision checks */
  subject: ArtifactRef;
  /** Full predicate for collision checks */
  predicate: string;
  /** Full object ref for collision checks */
  object: ArtifactRef;
}

/**
 * Layer type for blob resolution. A room's own store is `room`; library-managed
 * shared/external caches are `external`. (An earlier `library` variant was never
 * assigned by any code path and was removed.)
 */
export type LayerType = 'room' | 'external';

/**
 * Resolved blob reference with layer-aware reading.
 *
 * IMPORTANT: When resolving URLs/actions across layers, we return a ResolvedBlob
 * instead of just a BlobEntry because the entry's path is only meaningful
 * relative to the layer that contained it.
 *
 * This abstraction allows reading blob content without the caller needing to
 * know which layer the blob came from.
 */
export interface ResolvedBlob {
  /** Blob metadata */
  entry: BlobEntry;
  /** Which layer this came from */
  layerType: LayerType;
  /** Absolute path to the layer root */
  layerPath: string;

  /** Read entire blob content into memory */
  read(): Promise<Buffer>;
  /** Open a readable stream for the blob */
  readStream(): Promise<NodeJS.ReadableStream>;
}

/**
 * Sync status for a dataroom.
 */
export interface SyncStatus {
  /** Files/blobs where stored digest doesn't match current content */
  stale: { path: string; storedDigest: string; currentDigest: string }[];
  /** Files on disk not tracked in index */
  orphans: string[];
  /** Index entries pointing to missing files */
  dangling: string[];
}

/**
 * Blob/key index integrity status for a dataroom. Complements `SyncStatus`
 * (which only covers the files index) by validating the blob store and the
 * URL/action mappings that point into it.
 */
export interface IndexIntegrityStatus {
  /** Blob files present on disk but absent from the blob index. */
  orphanBlobs: string[];
  /** URL mappings whose target blob index entry is missing. */
  danglingUrlMappings: { url: string; blobKey: string }[];
  /** Action mappings whose target blob index entry is missing. */
  danglingActionMappings: { actionKey: string; blobKey: string }[];
}

// =============================================================================
// Internal Types (not exported from index.ts)
// =============================================================================

/**
 * Blob layer configuration for internal use.
 */
export interface BlobLayer {
  /** Layer type */
  type: LayerType;
  /** Absolute path to layer root */
  path: string;
  /** Path to blobs directory */
  blobsDir: string;
  /** Path to blobs index */
  indexPath: string;
}
