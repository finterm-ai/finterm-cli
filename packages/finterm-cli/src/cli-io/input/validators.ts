/**
 * Input validators.
 *
 * Validation utilities for common CLI input patterns like tickers,
 * dates, numbers, and file paths.
 */

import { extname } from 'path';

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// Validation Error
// =============================================================================

/**
 * Error thrown when validation fails.
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

// =============================================================================
// Validators
// =============================================================================

/** Ticker symbol pattern: 1-10 uppercase letters, optional dot for class shares */
const TICKER_PATTERN = /^[A-Z]{1,10}(\.[A-Z]{1,2})?$/;

/**
 * Validate a stock ticker symbol.
 *
 * @param ticker - The ticker to validate
 * @returns Validation result with normalized uppercase ticker
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
 * Validate an ISO date string.
 *
 * @param date - The date string to validate
 * @returns Validation result with the date string
 */
export function validateDate(date: string): ValidationResult<string> {
  if (!date || date.trim() === '') {
    return { valid: false, error: 'Date cannot be empty' };
  }

  const trimmed = date.trim();

  // Check basic ISO format (YYYY-MM-DD or full ISO)
  const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/;
  if (!isoDatePattern.test(trimmed)) {
    return { valid: false, error: 'Date must be in ISO format (YYYY-MM-DD)' };
  }

  // Validate that the date is actually valid
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    return { valid: false, error: 'Invalid date value' };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validate a date range.
 *
 * @param start - Start date (ISO format)
 * @param end - End date (ISO format)
 * @returns Validation result with the date range
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
 * Validate a positive integer.
 *
 * @param value - The value to validate
 * @param options - Validation options
 * @returns Validation result with the integer
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
 * Validate a value against an enum of allowed values.
 *
 * @param value - The value to validate
 * @param allowedValues - Array of allowed values
 * @param options - Validation options
 * @returns Validation result with the normalized value
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

  // Return the original casing from allowedValues
  return { valid: true, value: allowedValues[index] };
}

/**
 * Validate a file path.
 *
 * @param path - The file path to validate
 * @param options - Validation options
 * @returns Validation result with the path
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
