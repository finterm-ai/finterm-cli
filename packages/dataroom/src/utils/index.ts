/**
 * Utility functions for the dataroom package.
 *
 * @packageDocumentation
 */

// Hash utilities
export { hash12, sha256, actionHash, urlHash12 } from './hash.js';

// URL normalization
export {
  normalizeUrl,
  extractDomain,
  isValidHttpUrl,
  type NormalizeUrlOptions,
} from './urlNormalize.js';

// Blob filename generation
export {
  sanitizeForFilename,
  generateBlobFilename,
  generateUrlBlobFilename,
  generateApiBlobFilename,
  extractExtension,
  type BlobFilenameOptions,
} from './blobFilename.js';

// Content type detection
export {
  getContentTypeFromExtension,
  getExtensionFromContentType,
  getContentTypeFromFilename,
  isTextContentType,
  isBinaryContentType,
  normalizeContentType,
  DEFAULT_CONTENT_TYPE,
  DEFAULT_EXTENSION,
} from './contentType.js';

// YAML utilities
export {
  parseYaml,
  stringifyYaml,
  stringifyDataroomYaml,
  stringifyDatalibYaml,
  readYaml,
  validateRequiredKeys,
  createKeySorter,
  DATAROOM_KEY_ORDER,
  DATALIB_KEY_ORDER,
  type YamlStringifyOptions,
} from './yaml.js';
