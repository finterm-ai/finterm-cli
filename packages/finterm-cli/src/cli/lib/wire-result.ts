/**
 * The public wire format for API results and the helpers that read, render, and
 * exit-code on it.
 *
 * Every result carries a `finterm` metadata envelope plus exactly one of `data`
 * or `error`, so a single shape covers success and failure across all commands.
 */

import { Option } from 'commander';

import { formatAsJson, formatAsYaml } from '../../cli-io/output/formatter.js';
import { APIRequestError } from '../../lib/api-client.js';
import type { CommandContext } from './context.js';
import { CLIError } from './errors.js';

/** Serialization format for a wire result printed to stdout. */
export type ApiOutputFormat = 'json' | 'yaml';

/** Per-command output options that can override the global format. */
export interface ApiOutputOptions {
  format?: string;
}

/** Metadata envelope describing which tool produced a result and with what arguments. */
export interface FintermResultMeta {
  schema: string;
  tool: string;
  args: Record<string, unknown>;
  request_id?: string;
  command?: string;
  cursor?: unknown;
}

/** A successful result: metadata plus the tool's typed payload. */
export interface FintermSuccessResult<T> {
  finterm: FintermResultMeta;
  data: T;
}

/** A failed result: metadata plus a machine-readable error code and message. */
export interface FintermErrorResult {
  finterm: FintermResultMeta;
  error: {
    code: string;
    message: string;
  };
}

/** Either a success or error result; the canonical shape every command emits. */
export type FintermWireResult<T = unknown> = FintermSuccessResult<T> | FintermErrorResult;

/**
 * Minimal metadata used to synthesize an envelope when a response did not already
 * arrive in wire form (e.g. the local mock client).
 */
export interface FallbackResultMeta {
  schema: string;
  tool: string;
  args: Record<string, unknown>;
}

const WIRE_RESULT_YAML_BANNER =
  '# Finterm result. Visit finterm.ai or run `npx finterm@latest --help` for details.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Drop `undefined` entries so the rendered args reflect only what was actually set. */
function cleanArgs(args: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function fallbackFinterm(meta: FallbackResultMeta): FintermResultMeta {
  return {
    schema: meta.schema,
    tool: meta.tool,
    args: cleanArgs(meta.args),
  };
}

/** Build the shared `--format` option so every API command offers the same choices. */
export function createApiOutputFormatOption(): Option {
  return new Option('--format <format>', 'Render API result as json or yaml').choices([
    'json',
    'yaml',
  ]);
}

/**
 * Resolve the effective output format, with the global `--json` flag taking
 * precedence over `--format` and JSON as the default.
 */
export function getRequestedApiOutputFormat(
  ctx: CommandContext,
  options: ApiOutputOptions = {}
): ApiOutputFormat {
  if (ctx.json || options.format === 'json') {
    return 'json';
  }
  if (options.format === 'yaml') {
    return 'yaml';
  }
  return 'json';
}

/** Whether the user explicitly asked for a machine-readable format (vs. default text). */
export function hasRequestedApiOutputFormat(
  ctx: CommandContext,
  options: ApiOutputOptions = {}
): boolean {
  return ctx.json || options.format === 'json' || options.format === 'yaml';
}

/**
 * Runtime guard that a value is already in wire form: a valid metadata envelope
 * plus exactly one of `data` or `error` (never both, never neither).
 */
export function isFintermWireResult<T = unknown>(value: unknown): value is FintermWireResult<T> {
  if (!isRecord(value) || !isRecord(value.finterm)) {
    return false;
  }
  const meta = value.finterm;
  const hasValidMeta =
    typeof meta.schema === 'string' && typeof meta.tool === 'string' && isRecord(meta.args);
  if (!hasValidMeta) {
    return false;
  }
  const hasData = Object.prototype.hasOwnProperty.call(value, 'data');
  const hasError = isRecord(value.error);
  return (hasData && !hasError) || (!hasData && hasError);
}

/**
 * Convert a response body into the public finterm wire result.
 *
 * Live `/api/v1` responses already arrive as `{finterm,data}` or `{finterm,error}`.
 * The fallback path exists for the CLI's local mock client, which has no HTTP server
 * and still produces older in-process fixtures.
 */
export function toFintermWireResult<T>(
  response: unknown,
  fallback: FallbackResultMeta
): FintermWireResult<T> {
  if (isFintermWireResult<T>(response)) {
    return response;
  }

  if (isRecord(response) && response.success === true && 'data' in response) {
    return {
      finterm: fallbackFinterm(fallback),
      data: response.data as T,
    };
  }

  if (isRecord(response) && response.success === false && isRecord(response.error)) {
    return {
      finterm: fallbackFinterm(fallback),
      error: {
        code: typeof response.error.code === 'string' ? response.error.code : 'REQUEST_FAILED',
        message:
          typeof response.error.message === 'string' ? response.error.message : 'Request failed.',
      },
    };
  }

  return {
    finterm: fallbackFinterm(fallback),
    data: response as T,
  };
}

/**
 * Run an API call and normalize its outcome to a wire result.
 *
 * A failed request whose body is itself a wire error (the server's structured
 * error) is returned as data rather than thrown, so callers can render it through
 * the same path as success; non-wire failures still throw.
 */
export async function apiCallToFintermWireResult<T>(
  apiCall: () => Promise<unknown>,
  fallback: FallbackResultMeta
): Promise<FintermWireResult<T>> {
  try {
    return toFintermWireResult<T>(await apiCall(), fallback);
  } catch (error) {
    if (error instanceof APIRequestError && isFintermWireResult<T>(error.body)) {
      return error.body;
    }
    throw error;
  }
}

/** Narrow a wire result to its error variant. */
export function isFintermWireErrorResult(
  result: FintermWireResult<unknown>
): result is FintermErrorResult {
  return 'error' in result;
}

/**
 * Set a failing process exit code for an error result without clobbering an
 * exit code an earlier failure may have already set.
 */
export function markFintermWireErrorExitCode(result: FintermWireResult<unknown>): void {
  if (
    isFintermWireErrorResult(result) &&
    (process.exitCode === undefined || process.exitCode === 0)
  ) {
    process.exitCode = 1;
  }
}

/**
 * Unwrap a result's payload, throwing a {@link CLIError} (carrying the wire error
 * code) when it is an error. `context` supplies a fallback message if the server
 * sent none.
 */
export function getFintermWireData<T>(result: FintermWireResult<T>, context: string): T {
  if ('error' in result) {
    throw new CLIError(result.error.message || context, { code: result.error.code });
  }
  return result.data;
}

/**
 * Serialize a wire result for stdout. The YAML form is prefixed with a banner
 * pointing back to docs so a copied snippet stays self-describing.
 */
export function renderFintermWireResult(
  result: FintermWireResult<unknown>,
  format: ApiOutputFormat
): string {
  if (format === 'yaml') {
    return `${WIRE_RESULT_YAML_BANNER}\n${formatAsYaml(result)}`;
  }
  return formatAsJson(result);
}
