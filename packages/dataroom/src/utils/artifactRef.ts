/**
 * Room-local artifact reference helpers.
 *
 * @packageDocumentation
 */

import { basename, posix } from 'node:path';

import type { ArtifactRef, ArtifactRefKind, ParsedArtifactRef } from '../types.js';
import { FILES_DIR } from '../constants.js';
import { ValidationError } from '../errors.js';

const ARTIFACT_REF_PREFIXES: Record<ArtifactRefKind, `${ArtifactRefKind}:`> = {
  blob: 'blob:',
  file: 'file:',
};
const BLOB_STORAGE_DIR = 'blobs';

/**
 * Parse and validate a room-local artifact ref.
 */
export function parseArtifactRef(ref: string): ParsedArtifactRef {
  if (ref.startsWith(ARTIFACT_REF_PREFIXES.blob)) {
    const artifactPath = ref.slice(ARTIFACT_REF_PREFIXES.blob.length);
    validateArtifactPath('blob', artifactPath);
    return { kind: 'blob', path: artifactPath, ref: ref as ArtifactRef };
  }

  if (ref.startsWith(ARTIFACT_REF_PREFIXES.file)) {
    const artifactPath = ref.slice(ARTIFACT_REF_PREFIXES.file.length);
    validateArtifactPath('file', artifactPath);
    return { kind: 'file', path: artifactPath, ref: ref as ArtifactRef };
  }

  throw new ValidationError(`Invalid artifact ref: ${ref}`);
}

/**
 * Format a room-local artifact ref from a kind and path.
 *
 * Paths may be provided with their storage directory prefix (`files/` or
 * `blobs/`); the returned ref always uses the prefix-free room-local path.
 */
export function formatArtifactRef(kind: ArtifactRefKind, artifactPath: string): ArtifactRef {
  const normalizedPath = normalizeArtifactPath(kind, artifactPath);
  return `${ARTIFACT_REF_PREFIXES[kind]}${normalizedPath}` as ArtifactRef;
}

/**
 * Normalize a storage path into the path segment used inside an artifact ref.
 */
export function normalizeArtifactPath(kind: ArtifactRefKind, artifactPath: string): string {
  let normalizedPath = artifactPath.replace(/\\/g, '/');

  if (kind === 'file' && normalizedPath.startsWith(`${FILES_DIR}/`)) {
    normalizedPath = normalizedPath.slice(FILES_DIR.length + 1);
  }
  if (kind === 'blob' && normalizedPath.startsWith(`${BLOB_STORAGE_DIR}/`)) {
    normalizedPath = normalizedPath.slice(BLOB_STORAGE_DIR.length + 1);
  }

  validateArtifactPath(kind, normalizedPath);
  return normalizedPath;
}

/**
 * Validate the path component of an artifact ref.
 */
export function validateArtifactPath(kind: ArtifactRefKind, artifactPath: string): void {
  if (artifactPath.length === 0) {
    throw new ValidationError(`${kind} artifact path cannot be empty`);
  }
  if (artifactPath.includes('\0')) {
    throw new ValidationError(`${kind} artifact path cannot contain null bytes`);
  }
  if (posix.isAbsolute(artifactPath)) {
    throw new ValidationError(`${kind} artifact path must be room-local`);
  }
  if (artifactPath.split('/').some((part) => part === '..' || part === '')) {
    throw new ValidationError(`${kind} artifact path must be normalized`);
  }
  if (kind === 'file' && artifactPath.startsWith(`${FILES_DIR}/`)) {
    throw new ValidationError('file artifact refs must not include files/');
  }
  if (kind === 'blob') {
    if (artifactPath.startsWith(`${BLOB_STORAGE_DIR}/`)) {
      throw new ValidationError('blob artifact refs must not include blobs/');
    }
    if (artifactPath !== basename(artifactPath)) {
      throw new ValidationError('blob artifact refs must use a blob filename');
    }
  }
}
