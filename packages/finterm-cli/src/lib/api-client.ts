/**
 * Finterm API Client
 *
 * HTTP client for the Finterm API.
 * Features:
 * - Retry logic with exponential backoff (1s, 2s, 4s)
 * - Configurable timeouts (30s default, 60s for SEC fetch)
 * - Token-based authentication
 * - Type-safe request/response handling
 * - Mock mode support via FINTERM_MOCK_MODE=client
 */

import { isMockMode } from '../cli-io/settings.js';
import {
  ApiCache,
  type CacheStats,
  type CacheLookupResult,
  type DiskCacheInfo,
} from './api-cache.js';
import { createPublicMockAPIClient } from './public-mock-api-client.js';

export type ApiRequestEvent =
  | {
      phase: 'start';
      method: 'GET' | 'POST';
      path: string;
      requestBytes: number;
    }
  | {
      phase: 'cache_hit';
      method: 'GET' | 'POST';
      path: string;
      requestBytes: number;
      responseBytes: number;
      durationMs: number;
    }
  | {
      phase: 'finish';
      method: 'GET' | 'POST';
      path: string;
      status: number;
      ok: boolean;
      attempts: number;
      requestBytes: number;
      responseBytes: number;
      durationMs: number;
    }
  | {
      phase: 'error';
      method: 'GET' | 'POST';
      path: string;
      attempts: number;
      requestBytes: number;
      durationMs: number;
      error: string;
    };

export type ApiRequestObserver = (event: ApiRequestEvent) => void;

// =============================================================================
// Constants
// =============================================================================

/** Default timeout for most endpoints (30 seconds) */
export const DEFAULT_TIMEOUT_MS = 30000;

/** Extended timeout for SEC filing fetch (60 seconds) */
export const SEC_FETCH_TIMEOUT_MS = 60000;

/** Maximum number of retry attempts */
export const MAX_RETRIES = 3;

/** Maximum backoff time in milliseconds */
const MAX_BACKOFF_MS = 8000;

/** Base backoff time in milliseconds */
const BASE_BACKOFF_MS = 1000;

// =============================================================================
// Retry Logic
// =============================================================================

/** Retry configuration */
export interface RetryConfig {
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

/**
 * Calculate backoff time for a retry attempt using exponential backoff.
 * Formula: min(baseBackoff * 2^attempt, maxBackoff)
 *
 * @param attempt - The retry attempt number (0-indexed)
 * @returns Backoff time in milliseconds
 */
export function calculateBackoff(attempt: number): number {
  const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
  return Math.min(backoff, MAX_BACKOFF_MS);
}

/**
 * Determine if an error should trigger a retry.
 *
 * Retryable conditions:
 * - Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
 * - Timeout/abort errors
 * - Server errors (502, 503, 504)
 *
 * Non-retryable:
 * - Client errors (4xx)
 * - Max retries exceeded
 *
 * @param error - The error to check
 * @param attempt - Current attempt number
 * @returns true if should retry
 */
export function shouldRetry(error: unknown, attempt: number): boolean {
  // Don't retry if max attempts reached
  if (attempt >= MAX_RETRIES) {
    return false;
  }

  // Check for network/timeout errors
  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    if (name === 'fetcherror' || name === 'aborterror' || name === 'typeerror') {
      return true;
    }
    // Check message for common network errors
    const message = error.message.toLowerCase();
    if (
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('enotfound') ||
      message.includes('aborted') ||
      message.includes('network')
    ) {
      return true;
    }
  }

  // Check for HTTP status codes
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    // Retry on server errors that might be transient
    if (status === 502 || status === 503 || status === 504 || status === 429) {
      return true;
    }
  }

  return false;
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Response Types
// =============================================================================

/** Login start response */
export interface LoginStartResponse {
  success: boolean;
  sessionId?: string;
  /** Poll secret - MUST be kept secret by CLI, required for /poll endpoint */
  pollSecret?: string;
  loginUrl?: string;
  pollUrl?: string;
  expiresAt?: number;
  error?: { code: string; message: string };
}

/** Login poll response */
export interface LoginPollResponse {
  success: boolean;
  status?: 'pending' | 'authorized' | 'denied' | 'expired';
  token?: string;
  tokenId?: string;
  error?: { code: string; message: string };
}

/** Generic API response wrapper */
export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export type BundleDeliveryMode =
  | 'inline_result'
  | 'artifact_metadata'
  | 'summary_json'
  | 'dataroom_sync';

export type BundleRunLifecycle = 'placeholder' | 'mock_runtime' | 'runtime_http';

export type BundleRuntimeAdapter = 'mock' | 'http';

export interface BundleRunErrorData {
  code: string;
  message: string;
  retryable: boolean;
}

export interface BundleUsageSummaryData {
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface BundleCatalogEntry {
  name: string;
  descriptorId: string;
  toolFamily: 'bundle' | 'package';
  summary: string;
  execution: 'async';
  lifecycle: 'placeholder' | 'runtime_wired';
  deliveryModes: BundleDeliveryMode[];
  artifactTypes: string[];
  runEndpoint: string;
  inputSchemaRef: string;
  outputSchemaRef: string;
  requiredScopes: string[];
}

export interface BundleCatalogData {
  catalogVersion: string;
  bundles: BundleCatalogEntry[];
  links?: {
    bundles: string;
  };
}

export interface BundleRunRequest {
  ticker?: string;
  companyName?: string;
  mode?: 'placeholder' | 'live';
  asOfDate?: string;
  deliveryMode?: BundleDeliveryMode;
  parameters?: Record<string, unknown>;
}

export interface BundleRunData {
  runId: string;
  bundleName: string;
  descriptorId: string;
  lifecycle: BundleRunLifecycle;
  runtimeAdapter?: BundleRuntimeAdapter;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
  state?: BundleRunData['status'];
  normalizedRequest: Record<string, unknown>;
  result?: unknown;
  usageSummary?: BundleUsageSummaryData | null;
  error?: BundleRunErrorData | null;
  /**
   * True iff the run's dataroom sync manifest is published (newer servers only;
   * absent on older servers, in which case the CLI may probe the manifest endpoint).
   */
  manifestReady?: boolean | undefined;
  links?: {
    self: string;
    result: string;
    artifacts: string;
    /** Present when the run publishes a downloadable sync manifest. */
    syncManifest?: string;
  };
}

export interface BundleRunResultData {
  runId: string;
  bundleName: string;
  descriptorId: string;
  lifecycle: BundleRunLifecycle;
  runtimeAdapter?: BundleRuntimeAdapter;
  status: BundleRunData['status'];
  state?: BundleRunData['status'];
  normalizedRequest: Record<string, unknown>;
  result: unknown;
  usageSummary?: BundleUsageSummaryData | null;
  error?: BundleRunErrorData | null;
}

export interface BundleArtifactsData {
  runId: string;
  bundleName: string;
  descriptorId: string;
  lifecycle: BundleRunLifecycle;
  status: BundleRunData['status'];
  state?: BundleRunData['status'];
  /** True iff the run's dataroom sync manifest is published (newer servers only). */
  manifestReady?: boolean | undefined;
  artifacts: Record<string, unknown>[];
}

/**
 * API error code returned by `GET /api/v1/runs/{runId}/sync-manifest` while the run's
 * artifacts have not been published yet (4xx). Not terminal: retry after waiting.
 */
export const MANIFEST_NOT_READY_ERROR_CODE = 'MANIFEST_NOT_READY';

/** One downloadable file in a run sync manifest. */
export interface SyncManifestFile {
  /** POSIX-style room-relative path (no leading slash, no `..`, no backslashes). */
  path: string;
  bytes: number;
  /** Hex-encoded SHA-256 of the file content. */
  sha256: string;
  /** Signed HTTPS GET URL for the file content. */
  url: string;
  /** ISO 8601 expiry of the signed URL. */
  expiresAt: string;
}

/**
 * Pinned artifact delivery contract: the full downloadable file list for a run,
 * served by `GET /api/v1/runs/{runId}/sync-manifest`.
 */
export interface SyncManifestData {
  runId: string;
  /** Launch-delivered rooms ship as DR/0.3 file-profile datarooms. */
  roomFormat: 'DR/0.3';
  /** Launch profile: file tree plus managed `data/`, without a required catalog DB. */
  roomProfile: 'file';
  files: SyncManifestFile[];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBundleUsageSummary(value: unknown): BundleUsageSummaryData | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isObjectRecord(value)) {
    return undefined;
  }
  const summary: BundleUsageSummaryData = {};
  if (typeof value.requests === 'number') {
    summary.requests = value.requests;
  }
  const inputTokens = value.inputTokens ?? value.input_tokens;
  if (typeof inputTokens === 'number') {
    summary.inputTokens = inputTokens;
  }
  const outputTokens = value.outputTokens ?? value.output_tokens;
  if (typeof outputTokens === 'number') {
    summary.outputTokens = outputTokens;
  }
  const costUsd = value.costUsd ?? value.cost_usd;
  if (typeof costUsd === 'number') {
    summary.costUsd = costUsd;
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function normalizeBundleRunData<T extends BundleRunData | BundleRunResultData>(value: unknown): T {
  if (!isObjectRecord(value)) {
    return value as T;
  }
  const links = isObjectRecord(value.links) ? value.links : undefined;
  return {
    ...value,
    runId: value.runId ?? value.run_id,
    bundleName: value.bundleName ?? value.bundle_name,
    descriptorId: value.descriptorId ?? value.descriptor_id,
    runtimeAdapter: value.runtimeAdapter ?? value.runtime_adapter,
    state: value.state ?? value.status,
    normalizedRequest: value.normalizedRequest ?? value.normalized_request ?? {},
    usageSummary: normalizeBundleUsageSummary(value.usageSummary ?? value.usage_summary),
    manifestReady: value.manifestReady ?? value.manifest_ready,
    links: links
      ? {
          self: links.self,
          result: links.result,
          artifacts: links.artifacts,
          syncManifest: links.syncManifest ?? links.sync_manifest,
        }
      : undefined,
  } as T;
}

function normalizeBundleArtifactsData(value: unknown): BundleArtifactsData {
  if (!isObjectRecord(value)) {
    return value as BundleArtifactsData;
  }
  return {
    ...value,
    runId: value.runId ?? value.run_id,
    bundleName: value.bundleName ?? value.bundle_name,
    descriptorId: value.descriptorId ?? value.descriptor_id,
    runtimeAdapter: value.runtimeAdapter ?? value.runtime_adapter,
    state: value.state ?? value.status,
    manifestReady: value.manifestReady ?? value.manifest_ready,
    artifacts: Array.isArray(value.artifacts) ? value.artifacts : [],
  } as unknown as BundleArtifactsData;
}

function normalizeSyncManifestData(value: unknown): SyncManifestData {
  if (!isObjectRecord(value)) {
    return value as SyncManifestData;
  }
  const files = Array.isArray(value.files)
    ? value.files.map((file) => {
        if (!isObjectRecord(file)) {
          return file as SyncManifestFile;
        }
        return {
          ...file,
          expiresAt: file.expiresAt ?? file.expires_at,
        } as SyncManifestFile;
      })
    : value.files;
  return {
    ...value,
    runId: value.runId ?? value.run_id,
    roomFormat: value.roomFormat ?? value.room_format,
    roomProfile: value.roomProfile ?? value.room_profile,
    files,
  } as SyncManifestData;
}

function normalizeResponseData<T>(
  response: unknown,
  normalizeData: (value: unknown) => T
): APIResponse<T> {
  if (isObjectRecord(response) && 'data' in response) {
    return {
      ...response,
      data: normalizeData(response.data),
    } as APIResponse<T>;
  }
  return response as APIResponse<T>;
}

/**
 * Typed error thrown by the live HTTP layer for non-2xx responses.
 * Carries the machine-readable error code and human message extracted from the server's
 * error envelope (`{ success: false, error: { code, message } }`) so callers can branch
 * on `code` (e.g. RUN_NOT_FOUND fail-fast) and surface the real server message.
 */
export class APIRequestError extends Error {
  /** HTTP status of the failed response. */
  readonly status: number;
  /** Machine-readable error code from the server envelope, when present. */
  readonly code: string | undefined;
  /** Parsed response body from the server, when it was JSON. */
  readonly body: Record<string, unknown> | undefined;

  constructor(
    message: string,
    options: { status: number; code?: string; body?: Record<string, unknown> }
  ) {
    super(message);
    this.name = 'APIRequestError';
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
  }
}

/**
 * Extract the machine-readable code and human message from a server error body.
 * Handles both the live envelope (`{ success, error: { code, message } }`) and flat
 * bodies (`{ code, message }`); absent fields stay undefined.
 */
function extractErrorEnvelope(body: Record<string, unknown>): {
  code: string | undefined;
  message: string | undefined;
} {
  const nested =
    typeof body.error === 'object' && body.error !== null
      ? (body.error as Record<string, unknown>)
      : undefined;
  const code =
    typeof nested?.code === 'string'
      ? nested.code
      : typeof body.code === 'string'
        ? body.code
        : undefined;
  const message =
    typeof nested?.message === 'string'
      ? nested.message
      : typeof body.message === 'string'
        ? body.message
        : undefined;
  return { code, message };
}

/**
 * Pull a machine-readable error code off an error thrown by the HTTP layer.
 * The live client throws {@link APIRequestError} with `code` set; the nested
 * `error.error.code` shape is still handled for errors raised elsewhere.
 */
function extractApiErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  if (typeof record.code === 'string') {
    return record.code;
  }
  const nested = record.error;
  if (typeof nested === 'object' && nested !== null) {
    const nestedCode = (nested as Record<string, unknown>).code;
    if (typeof nestedCode === 'string') {
      return nestedCode;
    }
  }
  return undefined;
}

interface RequestOptions {
  timeout?: number;
  requiresAuth: boolean;
  cacheable: boolean | null;
}

const DEFAULT_REQUEST_OPTIONS: RequestOptions = {
  requiresAuth: false,
  cacheable: null,
};

const AUTHENTICATED_REQUEST_OPTIONS: RequestOptions = {
  requiresAuth: true,
  cacheable: null,
};

// =============================================================================
// API Client Interface
// =============================================================================

/**
 * Finterm API Client interface.
 * Provides methods for the public first-release CLI API endpoints.
 */
export interface FintermAPIClient {
  /** Base URL of the API */
  readonly baseUrl: string;

  /** Current authentication token */
  token: string | null;

  /** Set the authentication token */
  setToken(token: string): void;

  /** Clear the authentication token */
  clearToken(): void;

  // Auth endpoints (no token required)
  loginStart(deviceName?: string): Promise<LoginStartResponse>;
  loginPoll(sessionId: string, pollSecret: string): Promise<LoginPollResponse>;

  // SEC endpoints (token required)
  secFilingsSearch(params: {
    ticker: string;
    formType?: string;
    from_date?: string;
    limit?: number;
  }): Promise<APIResponse<unknown>>;
  secFilingFetch(params: {
    ticker: string;
    year: number;
    period: string;
    sections: string;
    format?: string;
  }): Promise<APIResponse<unknown>>;
  secFilingDiff(params: {
    ticker: string;
    base: { year: number; period: string };
    compare: { year: number; period: string };
    sections?: string;
    mode?: string;
    qa: boolean | null;
  }): Promise<APIResponse<unknown>>;
  // Financial tools endpoints (token required)
  optionsSentiment(params: {
    underlyingTicker: string;
    date: string;
    includeSpreadAnalysis: boolean;
    expirationFilter?: string;
    maxContracts?: number;
  }): Promise<APIResponse<unknown>>;
  financialStatements(params: {
    ticker: string;
    statementType: 'balance_sheet' | 'income_statement' | 'cash_flow';
    asOfDate: string;
    timeframe?: 'quarterly' | 'annual' | 'trailing_twelve_months';
    fiscalYear?: number;
    fiscalQuarter?: number;
    limit?: number;
  }): Promise<APIResponse<unknown>>;
  insiderTrades(params: {
    ticker: string;
    asOfDate?: string;
    limit?: number;
    transactionCodes?: ('P' | 'S' | 'A' | 'M' | 'F' | 'G' | 'C' | 'W')[];
    includeDerivatives: boolean;
    includeHoldings: boolean;
  }): Promise<APIResponse<unknown>>;
  institutionalHoldings(params: {
    ticker?: string;
    investorCik?: string;
    asOfDate?: string;
    limit?: number;
  }): Promise<APIResponse<unknown>>;
  optionsOverview(params: { ticker: string; asOfDate?: string }): Promise<APIResponse<unknown>>;
  tickerSentiment(params: { ticker: string; asOfDate?: string }): Promise<APIResponse<unknown>>;

  // Bundle endpoints (token required)
  bundleCatalog(): Promise<APIResponse<BundleCatalogData>>;
  bundleDescribe(bundleName: string): Promise<APIResponse<BundleCatalogEntry>>;
  bundleRun(bundleName: string, params: BundleRunRequest): Promise<APIResponse<BundleRunData>>;
  bundleStatus(runId: string): Promise<APIResponse<BundleRunData>>;
  bundleResult(runId: string): Promise<APIResponse<BundleRunResultData>>;
  bundleArtifacts(runId: string): Promise<APIResponse<BundleArtifactsData>>;
  /** Read the run's sync manifest (never cached; signed URLs expire). */
  bundleSyncManifest(runId: string): Promise<APIResponse<SyncManifestData>>;

  // Cache management
  getCacheStats(): CacheStats;
  getLastCacheLookup(): CacheLookupResult | null;
  getDiskCacheInfo(): DiskCacheInfo | null;

  /** Initialize disk persistence layer. */
  initDiskCache(cachePath: string): Promise<void>;

  /** Close disk cache (call on process exit). */
  closeDiskCache(): void;

  /** Clear all cached entries (memory + disk). */
  clearCache(): void;

  /** Set a callback that fires on each cache lookup (for verbose logging). */
  setOnCacheLookup(cb: ((result: CacheLookupResult) => void) | null): void;
}

// =============================================================================
// Live API Client Implementation
// =============================================================================

/**
 * Live API client that makes actual HTTP requests.
 */
class LiveFintermAPIClient implements FintermAPIClient {
  readonly baseUrl: string;
  private _token: string | null;
  private cache: ApiCache;
  /** Diagnostic hook invoked for every API request (drives `--debug` logging). */
  private onRequest: ApiRequestObserver | null;

  constructor(
    baseUrl: string,
    token?: string,
    options: { cacheEnabled: boolean; onRequest?: ApiRequestObserver } = {
      cacheEnabled: true,
    }
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this._token = token ?? null;
    this.cache = new ApiCache({ enabled: options.cacheEnabled });
    this.onRequest = options.onRequest ?? null;
  }

  get token(): string | null {
    return this._token;
  }

  set token(value: string | null) {
    this._token = value;
  }

  setToken(token: string): void {
    this._token = token;
  }

  clearToken(): void {
    this._token = null;
  }

  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  getLastCacheLookup(): CacheLookupResult | null {
    return this.cache.lastLookup;
  }

  setOnCacheLookup(cb: ((result: CacheLookupResult) => void) | null): void {
    this.cache.onLookup = cb;
  }

  async initDiskCache(cachePath: string): Promise<void> {
    await this.cache.initDisk(cachePath);
  }

  closeDiskCache(): void {
    this.cache.close();
  }

  clearCache(): void {
    this.cache.clear();
  }

  getDiskCacheInfo(): DiskCacheInfo | null {
    return this.cache.getDiskInfo();
  }

  /**
   * Make an HTTP request with retry logic.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    options: RequestOptions = DEFAULT_REQUEST_OPTIONS
  ): Promise<T> {
    const { timeout = DEFAULT_TIMEOUT_MS, requiresAuth, cacheable: requestedCacheable } = options;
    const cacheable = requestedCacheable ?? method === 'POST';
    const startedAt = performance.now();
    const requestBody = body ? JSON.stringify(body) : undefined;
    const requestBytes = requestBody ? Buffer.byteLength(requestBody) : 0;

    this.onRequest?.({ phase: 'start', method, path, requestBytes });

    // Cache check before network (only for POST with body)
    if (cacheable && method === 'POST' && body) {
      const lookup = this.cache.get(path, body);
      if (lookup.status === 'hit') {
        this.onRequest?.({
          phase: 'cache_hit',
          method,
          path,
          requestBytes,
          responseBytes: lookup.sizeBytes,
          durationMs: performance.now() - startedAt,
        });
        return lookup.data as T;
      }
    }

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (requiresAuth) {
      if (!this._token) {
        throw new Error('Authentication required. Please run `finterm auth login` first.');
      }
      headers.Authorization = `Bearer ${this._token}`;
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, timeout);

        try {
          const response = await fetch(url, {
            method,
            headers,
            body: requestBody,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // Check the status before parsing: proxies serve HTML error pages (502/503),
          // and a JSON parse failure there would mask the retryable status code.
          if (!response.ok) {
            let errorBody: Record<string, unknown> = {};
            let responseBytes = 0;
            try {
              const errorText = await response.text();
              responseBytes = Buffer.byteLength(errorText);
              errorBody = JSON.parse(errorText) as Record<string, unknown>;
            } catch {
              // Non-JSON error body (e.g. an HTML page from a proxy): keep status only.
            }
            const errorData = { status: response.status, ...errorBody };
            if (shouldRetry(errorData, attempt)) {
              lastError = errorData;
              const backoff = calculateBackoff(attempt);
              await sleep(backoff);
              continue;
            }
            // Terminal failure: emit a single finish event (its `attempts` reflects the
            // total tries) so retried attempts are not counted as extra calls/errors.
            this.onRequest?.({
              phase: 'finish',
              method,
              path,
              status: response.status,
              ok: false,
              attempts: attempt + 1,
              requestBytes,
              responseBytes,
              durationMs: performance.now() - startedAt,
            });
            // Surface the server's nested error envelope ({ error: { code, message } })
            // as a typed error so callers see the real message and can branch on code.
            const envelope = extractErrorEnvelope(errorBody);
            throw new APIRequestError(envelope.message ?? `HTTP ${response.status}`, {
              status: response.status,
              code: envelope.code,
              body: errorBody,
            });
          }

          let data: Record<string, unknown>;
          let responseBytes = 0;
          try {
            const responseText = await response.text();
            responseBytes = Buffer.byteLength(responseText);
            data = JSON.parse(responseText) as Record<string, unknown>;
          } catch (parseError) {
            const contentType = response.headers.get('content-type') ?? 'unknown';
            const error = new Error(
              `Invalid JSON response from server (HTTP ${response.status}, content-type: ${contentType})`,
              { cause: parseError }
            );
            Object.assign(error, { status: response.status });
            throw error;
          }

          // Cache successful responses
          if (cacheable && method === 'POST' && body) {
            this.cache.set(path, body, data);
          }

          this.onRequest?.({
            phase: 'finish',
            method,
            path,
            status: response.status,
            ok: true,
            attempts: attempt + 1,
            requestBytes,
            responseBytes,
            durationMs: performance.now() - startedAt,
          });

          return data as T;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        lastError = error;

        if (shouldRetry(error, attempt)) {
          const backoff = calculateBackoff(attempt);
          await sleep(backoff);
          continue;
        }

        if (error instanceof APIRequestError) {
          throw error;
        }

        this.onRequest?.({
          phase: 'error',
          method,
          path,
          attempts: attempt + 1,
          requestBytes,
          durationMs: performance.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    throw lastError;
  }

  // Auth endpoints
  async loginStart(deviceName?: string): Promise<LoginStartResponse> {
    return this.request('POST', '/cli/login/start', { deviceName });
  }

  async loginPoll(sessionId: string, pollSecret: string): Promise<LoginPollResponse> {
    return this.request('POST', '/cli/login/poll', { sessionId, pollSecret });
  }

  // SEC endpoints
  async secFilingsSearch(params: {
    ticker: string;
    formType?: string;
    from_date?: string;
    limit?: number;
  }): Promise<APIResponse<unknown>> {
    return this.request(
      'POST',
      '/api/v1/sec/search',
      {
        ticker: params.ticker,
        form_type: params.formType,
        from_date: params.from_date,
        limit: params.limit,
      },
      AUTHENTICATED_REQUEST_OPTIONS
    );
  }

  async secFilingFetch(params: {
    ticker: string;
    year: number;
    period: string;
    sections: string;
    format?: string;
  }): Promise<APIResponse<unknown>> {
    return this.request('POST', '/api/v1/sec/fetch', params, {
      requiresAuth: true,
      cacheable: null,
      timeout: SEC_FETCH_TIMEOUT_MS,
    });
  }

  async secFilingDiff(params: {
    ticker: string;
    base: { year: number; period: string };
    compare: { year: number; period: string };
    sections?: string;
    mode?: string;
    qa: boolean | null;
  }): Promise<APIResponse<unknown>> {
    const { qa, ...rest } = params;
    const requestParams = qa === null ? rest : params;
    return this.request('POST', '/api/v1/sec/diff', requestParams, AUTHENTICATED_REQUEST_OPTIONS);
  }

  // Financial tools endpoints
  async optionsSentiment(params: {
    underlyingTicker: string;
    date: string;
    includeSpreadAnalysis: boolean;
    expirationFilter?: string;
    maxContracts?: number;
  }): Promise<APIResponse<unknown>> {
    return this.request(
      'POST',
      '/api/v1/options/sentiment',
      {
        underlying_ticker: params.underlyingTicker,
        date: params.date,
        include_spread_analysis: params.includeSpreadAnalysis,
        expiration_filter: params.expirationFilter,
        max_contracts: params.maxContracts,
      },
      AUTHENTICATED_REQUEST_OPTIONS
    );
  }

  async financialStatements(params: {
    ticker: string;
    statementType: 'balance_sheet' | 'income_statement' | 'cash_flow';
    asOfDate: string;
    timeframe?: 'quarterly' | 'annual' | 'trailing_twelve_months';
    fiscalYear?: number;
    fiscalQuarter?: number;
    limit?: number;
  }): Promise<APIResponse<unknown>> {
    return this.request(
      'POST',
      '/api/v1/fundamentals/financials',
      {
        ticker: params.ticker,
        statement_type: params.statementType,
        as_of_date: params.asOfDate,
        timeframe: params.timeframe,
        fiscal_year: params.fiscalYear,
        fiscal_quarter: params.fiscalQuarter,
        limit: params.limit,
      },
      AUTHENTICATED_REQUEST_OPTIONS
    );
  }

  async insiderTrades(params: {
    ticker: string;
    asOfDate?: string;
    limit?: number;
    transactionCodes?: ('P' | 'S' | 'A' | 'M' | 'F' | 'G' | 'C' | 'W')[];
    includeDerivatives: boolean;
    includeHoldings: boolean;
  }): Promise<APIResponse<unknown>> {
    return this.request(
      'POST',
      '/api/v1/ownership/insider-trades',
      {
        ticker: params.ticker,
        as_of_date: params.asOfDate,
        limit: params.limit,
        transaction_codes: params.transactionCodes,
        include_derivatives: params.includeDerivatives,
        include_holdings: params.includeHoldings,
      },
      AUTHENTICATED_REQUEST_OPTIONS
    );
  }

  async institutionalHoldings(params: {
    ticker?: string;
    investorCik?: string;
    asOfDate?: string;
    limit?: number;
  }): Promise<APIResponse<unknown>> {
    return this.request(
      'POST',
      '/api/v1/ownership/institutional-holdings',
      {
        ticker: params.ticker,
        investor_cik: params.investorCik,
        as_of_date: params.asOfDate,
        limit: params.limit,
      },
      AUTHENTICATED_REQUEST_OPTIONS
    );
  }

  async optionsOverview(params: {
    ticker: string;
    asOfDate?: string;
  }): Promise<APIResponse<unknown>> {
    return this.request(
      'POST',
      '/api/v1/options/overview',
      { ticker: params.ticker, as_of_date: params.asOfDate },
      AUTHENTICATED_REQUEST_OPTIONS
    );
  }

  async tickerSentiment(params: {
    ticker: string;
    asOfDate?: string;
  }): Promise<APIResponse<unknown>> {
    return this.request(
      'POST',
      '/api/v1/ticker-sentiment',
      { ticker: params.ticker, as_of_date: params.asOfDate },
      AUTHENTICATED_REQUEST_OPTIONS
    );
  }

  // Bundle endpoints
  async bundleCatalog(): Promise<APIResponse<BundleCatalogData>> {
    return this.request('GET', '/api/v1/catalog', undefined, AUTHENTICATED_REQUEST_OPTIONS);
  }

  async bundleDescribe(bundleName: string): Promise<APIResponse<BundleCatalogEntry>> {
    return this.request(
      'GET',
      `/api/v1/catalog/bundles/${encodeURIComponent(bundleName)}`,
      undefined,
      AUTHENTICATED_REQUEST_OPTIONS
    );
  }

  async bundleRun(
    bundleName: string,
    params: BundleRunRequest
  ): Promise<APIResponse<BundleRunData>> {
    const body = {
      ticker: params.ticker,
      company_name: params.companyName,
      mode: params.mode,
      as_of_date: params.asOfDate,
      delivery_mode: params.deliveryMode,
      parameters: params.parameters,
    };
    const response = await this.request<unknown>(
      'POST',
      `/api/v1/bundles/${encodeURIComponent(bundleName)}/runs`,
      body,
      {
        requiresAuth: true,
        cacheable: false,
      }
    );
    return normalizeResponseData(response, normalizeBundleRunData<BundleRunData>);
  }

  async bundleStatus(runId: string): Promise<APIResponse<BundleRunData>> {
    const response = await this.request<unknown>(
      'GET',
      `/api/v1/runs/${encodeURIComponent(runId)}`,
      undefined,
      AUTHENTICATED_REQUEST_OPTIONS
    );
    return normalizeResponseData(response, normalizeBundleRunData<BundleRunData>);
  }

  async bundleResult(runId: string): Promise<APIResponse<BundleRunResultData>> {
    const response = await this.request<unknown>(
      'GET',
      `/api/v1/runs/${encodeURIComponent(runId)}/result`,
      undefined,
      AUTHENTICATED_REQUEST_OPTIONS
    );
    return normalizeResponseData(response, normalizeBundleRunData<BundleRunResultData>);
  }

  async bundleArtifacts(runId: string): Promise<APIResponse<BundleArtifactsData>> {
    const response = await this.request<unknown>(
      'GET',
      `/api/v1/runs/${encodeURIComponent(runId)}/artifacts`,
      undefined,
      AUTHENTICATED_REQUEST_OPTIONS
    );
    return normalizeResponseData(response, normalizeBundleArtifactsData);
  }

  async bundleSyncManifest(runId: string): Promise<APIResponse<SyncManifestData>> {
    try {
      // GET requests are never cached by this client (cacheable defaults apply to POST
      // only), which is required here: the manifest carries expiring signed URLs.
      const response = await this.request<unknown>(
        'GET',
        `/api/v1/runs/${encodeURIComponent(runId)}/sync-manifest`,
        undefined,
        AUTHENTICATED_REQUEST_OPTIONS
      );
      return normalizeResponseData(response, normalizeSyncManifestData);
    } catch (error) {
      // MANIFEST_NOT_READY is a normal pre-publication state, not a failure: convert
      // the thrown 4xx into a typed error envelope so callers can advise wait/retry.
      if (extractApiErrorCode(error) === MANIFEST_NOT_READY_ERROR_CODE) {
        return {
          success: false,
          error: {
            code: MANIFEST_NOT_READY_ERROR_CODE,
            message:
              error instanceof Error
                ? error.message
                : 'Run artifacts are not published yet. Keep waiting and retry.',
          },
        };
      }
      throw error;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an API client instance.
 *
 * In mock mode (FINTERM_MOCK_MODE=client), returns a mock client that
 * provides instant, deterministic responses without network calls.
 *
 * @param baseUrl - The base URL of the API
 * @param token - Optional authentication token
 * @returns API client instance (mock or live based on environment)
 */
export function createAPIClient(
  baseUrl: string,
  token?: string,
  options: { cacheEnabled: boolean; onRequest?: ApiRequestObserver } = {
    cacheEnabled: true,
  }
): FintermAPIClient {
  if (isMockMode()) {
    const mockClient = createPublicMockAPIClient();
    if (token) {
      mockClient.setToken(token);
    }
    return mockClient;
  }
  return new LiveFintermAPIClient(baseUrl, token, options);
}
