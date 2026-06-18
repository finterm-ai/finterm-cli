/**
 * Input validators.
 *
 * Validation utilities for common CLI input patterns like tickers,
 * dates, numbers, and file paths.
 */

import { extname } from 'path';

/** Result of a validation operation */
export interface ValidationResult<T> {
  /** Whether validation passed */
  valid: boolean;
  /** The validated/normalized value (if valid) */
  value?: T;
  /** Error message (if invalid) */
  error?: string;
}

/** Options for positive integer validation */
export interface PositiveIntegerOptions {
  /** Allow zero as a valid value (default: false) */
  allowZero: boolean;
  /** Maximum allowed value */
  max?: number;
}

/** Options for enum validation */
export interface EnumOptions {
  /** Whether comparison is case-sensitive (default: false) */
  caseSensitive: boolean;
}

/** Options for file path validation */
export interface FilePathOptions {
  /** Allowed file extensions (e.g., ['.json', '.yaml']) */
  allowedExtensions?: string[];
}

/**
 * Error carrying the name of the field that failed, so callers can report which
 * input was rejected without parsing the message.
 */
export class ValidationError extends Error {
  /** The field that failed validation */
  field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/** Ticker symbol pattern: 1-10 uppercase letters, optional dot for class shares */
const TICKER_PATTERN = /^[A-Z]{1,10}(\.[A-Z]{1,2})?$/;

/**
 * Validate a stock ticker symbol, returning it upper-cased and trimmed so
 * downstream lookups can rely on a canonical form.
 */
export function validateTicker(ticker: string): ValidationResult<string> {
  if (!ticker || ticker.trim() === '') {
    return { valid: false, error: 'Ticker cannot be empty' };
  }

  const normalized = ticker.trim().toUpperCase();

  if (normalized.length > 10) {
    return { valid: false, error: 'Ticker exceeds maximum length of 10 characters' };
  }

  if (!TICKER_PATTERN.test(normalized)) {
    return {
      valid: false,
      error: 'Ticker contains invalid characters (use letters and optional dot only)',
    };
  }

  return { valid: true, value: normalized };
}

/**
 * Validate an ISO date string. Checks both the textual shape and that the value
 * names a real calendar date, since the regex alone admits dates like 2020-13-40.
 */
export function validateDate(date: string): ValidationResult<string> {
  if (!date || date.trim() === '') {
    return { valid: false, error: 'Date cannot be empty' };
  }

  const trimmed = date.trim();

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/;
  if (!isoDatePattern.test(trimmed)) {
    return { valid: false, error: 'Date must be in ISO format (YYYY-MM-DD)' };
  }

  // The regex admits impossible dates (e.g. month 13), so confirm it parses.
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    return { valid: false, error: 'Invalid date value' };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validate a start/end date pair, rejecting ranges where the start falls after
 * the end so callers never act on an inverted window.
 */
export function validateDateRange(
  start: string,
  end: string
): ValidationResult<{ start: string; end: string }> {
  const startResult = validateDate(start);
  if (!startResult.valid) {
    return { valid: false, error: `Start date: ${startResult.error}` };
  }

  const endResult = validateDate(end);
  if (!endResult.valid) {
    return { valid: false, error: `End date: ${endResult.error}` };
  }

  const startDate = new Date(start);
  const endDate = new Date(end);

  if (startDate > endDate) {
    return { valid: false, error: 'Start date cannot be after end date' };
  }

  return {
    valid: true,
    value: { start: startResult.value!, end: endResult.value! },
  };
}

/**
 * Validate a positive integer, optionally allowing zero and enforcing a maximum.
 */
export function validatePositiveInteger(
  value: number,
  options: PositiveIntegerOptions = { allowZero: false }
): ValidationResult<number> {
  const { allowZero, max } = options;

  // Handle string input (common from CLI)
  const num = typeof value === 'string' ? parseInt(value, 10) : value;

  if (isNaN(num)) {
    return { valid: false, error: 'Value must be a number' };
  }

  if (!Number.isInteger(num)) {
    return { valid: false, error: 'Value must be an integer' };
  }

  if (num < 0) {
    return { valid: false, error: 'Value must be positive' };
  }

  if (num === 0 && !allowZero) {
    return { valid: false, error: 'Value must be a positive integer (not zero)' };
  }

  if (max !== undefined && num > max) {
    return { valid: false, error: `Value cannot exceed ${max}` };
  }

  return { valid: true, value: num };
}

/**
 * Validate a value against a set of allowed values. On success the value from
 * `allowedValues` is returned, so a case-insensitive match still normalizes to
 * the canonical casing.
 */
export function validateEnum<T extends string>(
  value: string,
  allowedValues: readonly T[],
  options: EnumOptions = { caseSensitive: false }
): ValidationResult<T> {
  const { caseSensitive } = options;

  const normalizedValue = caseSensitive ? value : value.toLowerCase();
  const normalizedAllowed = allowedValues.map((v) => (caseSensitive ? v : v.toLowerCase()));

  const index = normalizedAllowed.indexOf(normalizedValue);
  if (index === -1) {
    return {
      valid: false,
      error: `Invalid value. Must be one of: ${allowedValues.join(', ')}`,
    };
  }

  return { valid: true, value: allowedValues[index] };
}

/**
 * Validate a file path, optionally restricting it to an allowed set of
 * extensions (compared case-insensitively).
 */
export function validateFilePath(
  path: string,
  options: FilePathOptions = {}
): ValidationResult<string> {
  const { allowedExtensions } = options;

  if (!path || path.trim() === '') {
    return { valid: false, error: 'File path cannot be empty' };
  }

  const trimmed = path.trim();

  if (allowedExtensions && allowedExtensions.length > 0) {
    const ext = extname(trimmed).toLowerCase();
    const normalizedAllowed = allowedExtensions.map((e) => e.toLowerCase());

    if (!normalizedAllowed.includes(ext)) {
      return {
        valid: false,
        error: `Invalid file extension. Allowed: ${allowedExtensions.join(', ')}`,
      };
    }
  }

  return { valid: true, value: trimmed };
}
