/**
 * dataroom - Database-free DR/0.3 profile:file research bundles.
 *
 * This package is deliberately domain-agnostic and database-free. Internal
 * database-backed adapters live outside this package.
 *
 * @packageDocumentation
 */

export {
  FILE_PROFILE_FORMAT_VERSION,
  FILES_DIR,
  DATA_DIR,
  DATA_BLOBS_DIR,
  ROOM_METADATA_FILE,
  ROOM_PROFILE_FILE,
  DEFAULTS,
} from './constants.js';

export type { PathSpec, FormatVersion, DataRoomProfile } from './types.js';
export { asPathSpec, asFormatVersion } from './types.js';

export type {
  DataRoomMetadata,
  DataLibMetadata,
  RoomReference,
  BlobLayerReference,
  RuntimeOptions,
  CreateRoomOptions,
  CreateLibraryOptions,
  FileEntry,
  BlobEntry,
  BlobSource,
  HttpMetadata,
  Provenance,
  Payload,
  Operation,
  CacheGetOptions,
  CacheResult,
  ArtifactGroup,
  GroupMember,
  GroupMemberRole,
  BlobEncoding,
  CodecChoice,
  BlobCompressionConfig,
  ArtifactRef,
  ArtifactRefKind,
  ParsedArtifactRef,
  FacetValue,
  ArtifactSearchFacets,
  ArtifactSearchFacetKey,
  FacetFilter,
  UrlIndex,
  ActionIndex,
  FetchOptions,
  FetchUrlsOptions,
  FetchApiOptions,
  ArtifactReadOptions,
  QueryFilesOptions,
  AddRelationshipOptions,
  ListRelationshipsOptions,
  ListRelatedArtifactsOptions,
  RemoveBlobOptions,
  AddFileResult,
  FetchUrlResult,
  FetchApiResult,
  ResolvedBlob,
  LayerType,
  SyncStatus,
  IndexIntegrityStatus,
  ArtifactReadResult,
  FileQueryResult,
  ArtifactRelationship,
  RelationshipDirection,
  RelationshipIndexEntry,
  UrlArtifactMissReason,
  UrlArtifactMatch,
  UrlArtifactMiss,
  UrlArtifactResult,
  RelatedArtifactResult,
  BackfillDerivedRelationshipsResult,
  LibraryRoomDetail,
  LibraryFindUrlArtifactsOptions,
  LibraryUrlArtifactMatch,
  LibraryUrlArtifactMiss,
  LibraryUrlArtifactsResult,
  LibraryQueryFilesOptions,
  LibraryFileQueryResult,
  LibraryArtifactReadResult,
  LibraryRelationshipResult,
  LibraryRelatedArtifactResult,
  BlobLayer,
} from './types.js';

export {
  DataRoomError,
  NotFoundError,
  ReadOnlyError,
  OfflineError,
  SealedRoomError,
  CacheMissError,
  EntryNotFoundError,
  FormatError,
  ValidationError,
  FetchError,
  IndexError,
  ConfigurationError,
  DecodeError,
} from './errors.js';

export {
  openFileProfileRoom,
  createFileProfileRoom,
  listFileProfileFiles,
  queryFileProfileFiles,
  buildFileProfileFile,
  readFileProfileArtifact,
  searchFileProfileFiles,
} from './fileProfile.js';
export type {
  FileProfileRoom,
  FileProfileFile,
  FileProfileMetadata,
  FileProfileSearchMatch,
  FileProfileSearchOptions,
} from './fileProfile.js';

export { hash12, sha256, actionHash, urlHash12 } from './utils/hash.js';
export { normalizeUrl, extractDomain, isValidHttpUrl } from './utils/urlNormalize.js';
export type { NormalizeUrlOptions } from './utils/urlNormalize.js';

export { urlKey, callKey, fileKey, parseKey } from './utils/cacheKey.js';
export type { KeyScheme } from './utils/cacheKey.js';

export {
  sanitizeForFilename,
  generateBlobFilename,
  generateUrlBlobFilename,
  generateApiBlobFilename,
  logicalBlobFilename,
  extractExtension,
} from './utils/blobFilename.js';
export type { BlobFilenameOptions } from './utils/blobFilename.js';

export {
  getContentTypeFromExtension,
  getExtensionFromContentType,
  getContentTypeFromFilename,
  isTextContentType,
  isBinaryContentType,
  normalizeContentType,
  DEFAULT_CONTENT_TYPE,
  DEFAULT_EXTENSION,
} from './utils/contentType.js';

export {
  parseYaml,
  stringifyYaml,
  stringifyDataroomYaml,
  stringifyDatalibYaml,
  readYaml,
  validateRequiredKeys,
  createKeySorter,
  blobCompressionToYaml,
  blobCompressionFromYaml,
  DATAROOM_KEY_ORDER,
  DATALIB_KEY_ORDER,
} from './utils/yaml.js';
export type { YamlStringifyOptions } from './utils/yaml.js';

export {
  parseArtifactRef,
  formatArtifactRef,
  normalizeArtifactPath,
  validateArtifactPath,
} from './utils/artifactRef.js';
export {
  extractExtensionSuffixes,
  buildArtifactSearchFacets,
  matchesFacetFilter,
  matchesFacetFilters,
  getFacetValue,
} from './utils/artifactFacets.js';
