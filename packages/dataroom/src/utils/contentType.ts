/**
 * Content type (MIME type) detection utilities.
 *
 * @packageDocumentation
 */

/**
 * Map of file extensions to MIME types.
 * Covers common research-related file types.
 */
const EXTENSION_TO_MIME: Record<string, string> = {
  // Text formats
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',

  // Data formats
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/x-yaml',
  yml: 'application/x-yaml',

  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',

  // Archives
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',

  // Code
  js: 'application/javascript',
  ts: 'application/typescript',
  py: 'text/x-python',
  rb: 'text/x-ruby',
  sh: 'application/x-sh',

  // Other
  wasm: 'application/wasm',
};

/**
 * Map of MIME types to preferred extensions.
 */
const MIME_TO_EXTENSION: Record<string, string> = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
  'text/css': 'css',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/xml': 'xml',
  'application/x-yaml': 'yaml',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'application/zip': 'zip',
  'application/javascript': 'js',
  'application/octet-stream': 'bin',
};

/**
 * Default content type for unknown files.
 */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Default extension for unknown content types.
 */
export const DEFAULT_EXTENSION = 'bin';

/**
 * Get MIME type from file extension.
 *
 * @param extension - File extension (with or without leading dot)
 * @returns MIME type string
 *
 * @example
 * ```typescript
 * getContentTypeFromExtension('json')
 * // => 'application/json'
 *
 * getContentTypeFromExtension('.html')
 * // => 'text/html'
 * ```
 */
export function getContentTypeFromExtension(extension: string): string {
  const ext = extension.replace(/^\./, '').toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? DEFAULT_CONTENT_TYPE;
}

/**
 * Get file extension from MIME type.
 *
 * @param contentType - MIME type (may include parameters like charset)
 * @returns File extension without dot
 *
 * @example
 * ```typescript
 * getExtensionFromContentType('application/json')
 * // => 'json'
 *
 * getExtensionFromContentType('text/html; charset=utf-8')
 * // => 'html'
 * ```
 */
export function getExtensionFromContentType(contentType: string): string {
  // Strip parameters (e.g., "; charset=utf-8")
  const parts = contentType.split(';');
  const mimeType = (parts[0] ?? '').trim().toLowerCase();
  return MIME_TO_EXTENSION[mimeType] ?? DEFAULT_EXTENSION;
}

/**
 * Detect content type from filename.
 *
 * @param filename - Filename or path
 * @returns MIME type string
 */
export function getContentTypeFromFilename(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return DEFAULT_CONTENT_TYPE;
  }
  const ext = filename.slice(lastDot + 1);
  return getContentTypeFromExtension(ext);
}

/**
 * Check if a content type is text-based (human-readable).
 *
 * @param contentType - MIME type
 * @returns True if text-based
 */
export function isTextContentType(contentType: string): boolean {
  const parts = contentType.split(';');
  const mimeType = (parts[0] ?? '').trim().toLowerCase();
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-yaml' ||
    mimeType === 'application/javascript' ||
    mimeType.endsWith('+json') ||
    mimeType.endsWith('+xml')
  );
}

/**
 * Check if a content type is binary.
 *
 * @param contentType - MIME type
 * @returns True if binary
 */
export function isBinaryContentType(contentType: string): boolean {
  return !isTextContentType(contentType);
}

/**
 * Normalize a content type header value.
 * Extracts just the MIME type without parameters.
 *
 * @param contentType - Content-Type header value
 * @returns Normalized MIME type
 */
export function normalizeContentType(contentType: string): string {
  const parts = contentType.split(';');
  return (parts[0] ?? '').trim().toLowerCase();
}
