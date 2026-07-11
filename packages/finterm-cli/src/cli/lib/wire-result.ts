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
import { printHumanWireError, UPSTREAM_HTTP_CODE_PREFIX } from './human-error.js';
import type { OutputManager } from './output.js';
import {
  buildRecentRequestEntry,
  buildTransportFailureEntry,
  recordRecentRequest,
} from './recent-requests.js';

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
    /**
     * Machine-readable upgrade URL, sent by the server on
     * `SUBSCRIPTION_REQUIRED` (402) — the paywall consumes it structurally.
     */
    upgrade_url?: string;
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
  '# Finterm result. Visit finterm.ai or run `npx @finterm-ai/cli@latest --help` for details.';

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
 * the same path as success. An HTTP failure without an envelope is synthesized
 * into one (code `UPSTREAM_HTTP_<status>`) so rendering, JSON output, and exit
 * codes stay on the normal path; non-HTTP failures still throw.
 */
export async function apiCallToFintermWireResult<T>(
  apiCall: () => Promise<unknown>,
  fallback: FallbackResultMeta
): Promise<FintermWireResult<T>> {
  // Feed the recent-requests ledger (the `finterm feedback --last` context
  // source) with every API outcome except feedback submissions themselves —
  // a report should attach the failing data call, not the previous report.
  let result: FintermWireResult<T>;
  try {
    result = await apiCallOutcome<T>(apiCall, fallback);
  } catch (error) {
    // No wire result at all (timeout, DNS/socket failure, unparseable
    // response): still worth a ledger entry — the failing command is exactly
    // what a feedback report needs — then let the failure propagate.
    if (fallback.tool !== 'feedback') {
      await recordRecentRequest(buildTransportFailureEntry(fallback.tool, error));
    }
    throw error;
  }
  if (result.finterm.tool !== 'feedback') {
    await recordRecentRequest(buildRecentRequestEntry(result));
  }
  return result;
}

async function apiCallOutcome<T>(
  apiCall: () => Promise<unknown>,
  fallback: FallbackResultMeta
): Promise<FintermWireResult<T>> {
  try {
    return toFintermWireResult<T>(await apiCall(), fallback);
  } catch (error) {
    if (error instanceof APIRequestError && isFintermWireResult<T>(error.body)) {
      return error.body;
    }
    if (error instanceof APIRequestError) {
      return {
        finterm: fallbackFinterm(fallback),
        error: {
          code: `${UPSTREAM_HTTP_CODE_PREFIX}${error.status}`,
          message: `The Finterm API returned HTTP ${error.status} without a structured error.`,
        },
      };
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

/**
 * Print a wire result the way the funnel spec's C0 requires: machine formats
 * (`--json` / `--format`) always emit the wire shape on stdout, and a wire
 * ERROR in default (human) mode renders as the concise human block on stderr
 * instead of the raw envelope — with the 402 paywall as the flagship case.
 * Also maps an error result to a failing exit code.
 */
export async function printFintermWireResult(
  ctx: CommandContext,
  output: OutputManager,
  result: FintermWireResult<unknown>,
  options: ApiOutputOptions
): Promise<void> {
  if (isFintermWireErrorResult(result) && !hasRequestedApiOutputFormat(ctx, options)) {
    // Pass the envelope's request id through: remedy lines reference it, so
    // the human block must actually show it when the server sent one.
    await printHumanWireError(ctx, output, result.error, result.finterm.request_id);
  } else {
    output.data(result, () => {
      console.log(renderFintermWireResult(result, getRequestedApiOutputFormat(ctx, options)));
    });
  }
  markFintermWireErrorExitCode(result);
}
