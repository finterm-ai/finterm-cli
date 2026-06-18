/**
 * Error classes for the dataroom package.
 *
 * @packageDocumentation
 */

/**
 * Base error for all dataroom errors.
 * All specific error types extend this class.
 */
export class DataRoomError extends Error {
  /** Optional underlying cause of this error. */
  declare readonly cause: Error | undefined;

  constructor(message: string) {
    super(message);
    this.name = 'DataRoomError';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DataRoomError);
    }
  }
}

/**
 * Room or file not found at specified path.
 */
export class NotFoundError extends DataRoomError {
  constructor(
    public readonly path: string,
    public readonly resourceType: 'room' | 'library' | 'file' | 'blob' = 'room'
  ) {
    super(`${resourceType} not found at: ${path}`);
    this.name = 'NotFoundError';
  }
}

/**
 * Attempted write operation on readonly room.
 */
export class ReadOnlyError extends DataRoomError {
  constructor(public readonly operation: string) {
    super(`Cannot ${operation}: room is opened in readonly mode`);
    this.name = 'ReadOnlyError';
  }
}

/**
 * Attempted network operation in offline mode.
 */
export class OfflineError extends DataRoomError {
  constructor(public readonly url: string) {
    super(`Cannot fetch ${url}: room is opened in offline mode`);
    this.name = 'OfflineError';
  }
}

/**
 * A key was not cached and the room is sealed, so the external operation that
 * would have populated it is not permitted. Distinct from a generic miss: it
 * signals "the data is absent and we are forbidden from acquiring it", not an
 * empty result or an unexpected failure.
 */
export class SealedRoomError extends DataRoomError {
  constructor(public readonly key: string) {
    super(`"${key}" is not cached and the dataroom is sealed (no external operations permitted)`);
    this.name = 'SealedRoomError';
  }
}

/**
 * URL not found in cache.
 */
export class CacheMissError extends DataRoomError {
  constructor(
    public readonly url: string,
    public readonly normalizedUrl: string
  ) {
    super(`URL not in cache: ${url}`);
    this.name = 'CacheMissError';
  }
}

/**
 * Entry not found in index store.
 */
export class EntryNotFoundError extends DataRoomError {
  constructor(public readonly key: string) {
    super(`Entry not found: ${key}`);
    this.name = 'EntryNotFoundError';
  }
}

/**
 * Invalid format version or incompatible bundle.
 */
export class FormatError extends DataRoomError {
  constructor(
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(`Incompatible format version: expected ${expected}, got ${actual}`);
    this.name = 'FormatError';
  }
}

/**
 * Validation error for dataroom structure.
 */
export class ValidationError extends DataRoomError {
  constructor(
    message: string,
    public readonly issues: string[] = []
  ) {
    super(issues.length > 0 ? `${message}: ${issues.join(', ')}` : message);
    this.name = 'ValidationError';
  }
}

/**
 * Error during fetch operation.
 */
export class FetchError extends DataRoomError {
  constructor(
    public readonly url: string,
    public readonly statusCode?: number,
    public override readonly cause: Error | undefined = undefined
  ) {
    const statusPart = statusCode ? ` (status: ${statusCode})` : '';
    const causePart = cause ? `: ${cause.message}` : '';
    super(`Failed to fetch ${url}${statusPart}${causePart}`);
    this.name = 'FetchError';
  }
}

/**
 * Configuration error (e.g., a selected codec is unavailable in this runtime).
 */
export class ConfigurationError extends DataRoomError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Error while decoding a stored blob (e.g., codec unavailable or corrupt bytes).
 */
export class DecodeError extends DataRoomError {
  constructor(
    message: string,
    public override readonly cause: Error | undefined = undefined
  ) {
    const causePart = cause ? `: ${cause.message}` : '';
    super(`${message}${causePart}`);
    this.name = 'DecodeError';
  }
}

/** Error during adapter-managed index operations. */
export class IndexError extends DataRoomError {
  constructor(
    message: string,
    public readonly indexPath: string,
    public override readonly cause: Error | undefined = undefined
  ) {
    const causePart = cause ? `: ${cause.message}` : '';
    super(`Index error in ${indexPath}: ${message}${causePart}`);
    this.name = 'IndexError';
  }
}
