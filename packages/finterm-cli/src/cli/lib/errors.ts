/**
 * CLI error classes.
 *
 * See: research-modern-typescript-cli-patterns.md#3-base-command-pattern
 */

/**
 * Custom error class for CLI errors with exit code support.
 */
export class CLIError extends Error {
  readonly exitCode: number;
  /** Optional machine-readable error code (e.g. an API error code like RUN_NOT_FOUND). */
  readonly code: string | undefined;

  constructor(message: string, options?: { exitCode?: number; cause?: Error; code?: string }) {
    super(message, { cause: options?.cause });
    this.name = 'CLIError';
    this.exitCode = options?.exitCode ?? 1;
    this.code = options?.code;
  }
}

/**
 * Validation error - exit code 2 (usage errors).
 */
export class ValidationError extends CLIError {
  constructor(message: string, cause?: Error) {
    super(message, { exitCode: 2, cause });
    this.name = 'ValidationError';
  }
}

/**
 * Type guard for Node.js system errors with error codes.
 */
interface NodeSystemError extends Error {
  code?: string;
}

/**
 * Check if an error is a Node.js system error with a code property.
 */
function isNodeError(error: unknown): error is NodeSystemError {
  return error instanceof Error && 'code' in error;
}

/**
 * Expected error codes for file operations.
 * - ENOENT: File or directory not found (expected when checking if something exists)
 * - ENOTDIR: Not a directory (expected when path doesn't exist)
 */
const EXPECTED_FS_ERROR_CODES = new Set(['ENOENT', 'ENOTDIR']);

/**
 * Expected error codes for command execution.
 * - ENOENT: Command not found
 */
const EXPECTED_EXEC_ERROR_CODES = new Set(['ENOENT']);

/**
 * Check if an error is an expected filesystem error (file not found, etc.).
 * Use this in catch blocks to only silently handle expected errors.
 *
 * @example
 * ```typescript
 * try {
 *   const content = await readFile(path, 'utf-8');
 *   return JSON.parse(content);
 * } catch (error) {
 *   if (isExpectedFsError(error)) {
 *     return null; // File doesn't exist - expected case
 *   }
 *   throw error; // Unexpected error (permission denied, etc.) - rethrow
 * }
 * ```
 */
export function isExpectedFsError(error: unknown): boolean {
  return isNodeError(error) && !!error.code && EXPECTED_FS_ERROR_CODES.has(error.code);
}

/**
 * Type guard for execSync errors that have a status property.
 * When execSync throws because a command returned non-zero, the error has a `status` property.
 */
interface ExecSyncError extends Error {
  status?: number;
  code?: string;
}

/**
 * Check if an error is an execSync error (has status property from non-zero exit).
 */
function isExecSyncError(error: unknown): error is ExecSyncError {
  return error instanceof Error && ('status' in error || 'code' in error);
}

/**
 * Check if an error is an expected command execution error.
 * Expected cases:
 * - Command not found (ENOENT)
 * - Command ran but returned non-zero exit code (has `status` property)
 *
 * @example
 * ```typescript
 * try {
 *   return execSync('git status', { encoding: 'utf-8' });
 * } catch (error) {
 *   if (isExpectedExecError(error)) {
 *     return undefined; // Git not installed or command failed - expected
 *   }
 *   throw error; // Unexpected error - rethrow
 * }
 * ```
 */
export function isExpectedExecError(error: unknown): boolean {
  if (!isExecSyncError(error)) {
    return false;
  }
  // Command not found
  if (error.code && EXPECTED_EXEC_ERROR_CODES.has(error.code)) {
    return true;
  }
  // Command ran but returned non-zero (e.g., git in non-git directory)
  if (typeof error.status === 'number') {
    return true;
  }
  return false;
}
