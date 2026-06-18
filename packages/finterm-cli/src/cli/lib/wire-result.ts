import { Option } from 'commander';

import { formatAsJson, formatAsYaml } from '../../cli-io/output/formatter.js';
import { APIRequestError } from '../../lib/api-client.js';
import type { CommandContext } from './context.js';
import { CLIError } from './errors.js';

export type ApiOutputFormat = 'json' | 'yaml';

export interface ApiOutputOptions {
  format?: string;
}

export interface FintermResultMeta {
  schema: string;
  tool: string;
  args: Record<string, unknown>;
  request_id?: string;
  command?: string;
  cursor?: unknown;
}

export interface FintermSuccessResult<T> {
  finterm: FintermResultMeta;
  data: T;
}

export interface FintermErrorResult {
  finterm: FintermResultMeta;
  error: {
    code: string;
    message: string;
  };
}

export type FintermWireResult<T = unknown> = FintermSuccessResult<T> | FintermErrorResult;

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

export function createApiOutputFormatOption(): Option {
  return new Option('--format <format>', 'Render API result as json or yaml').choices([
    'json',
    'yaml',
  ]);
}

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

export function hasRequestedApiOutputFormat(
  ctx: CommandContext,
  options: ApiOutputOptions = {}
): boolean {
  return ctx.json || options.format === 'json' || options.format === 'yaml';
}

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

export function isFintermWireErrorResult(
  result: FintermWireResult<unknown>
): result is FintermErrorResult {
  return 'error' in result;
}

export function markFintermWireErrorExitCode(result: FintermWireResult<unknown>): void {
  if (
    isFintermWireErrorResult(result) &&
    (process.exitCode === undefined || process.exitCode === 0)
  ) {
    process.exitCode = 1;
  }
}

export function getFintermWireData<T>(result: FintermWireResult<T>, context: string): T {
  if ('error' in result) {
    throw new CLIError(result.error.message || context, { code: result.error.code });
  }
  return result.data;
}

export function renderFintermWireResult(
  result: FintermWireResult<unknown>,
  format: ApiOutputFormat
): string {
  if (format === 'yaml') {
    return `${WIRE_RESULT_YAML_BANNER}\n${formatAsYaml(result)}`;
  }
  return formatAsJson(result);
}
