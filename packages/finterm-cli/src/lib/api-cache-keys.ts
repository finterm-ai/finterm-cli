/**
 * Cache key generation for finterm-cli API calls.
 *
 * Keys must be deterministic so the same logical request always maps to the same
 * entry regardless of object key order: parameters are normalized (nulls filtered,
 * keys sorted) and rendered structurally before being joined into a stable string.
 */

/**
 * Map API path to cache key prefix.
 * Endpoints not listed here are not cacheable.
 */
export const ENDPOINT_KEY_PREFIX: Record<string, string> = {
  '/api/v1/fundamentals/financials': 'financial-statements',
  '/api/v1/options/overview': 'options-overview',
  '/api/v1/options/sentiment': 'options-sentiment',
  '/api/v1/ownership/insider-trades': 'insider-trades',
  '/api/v1/ownership/institutional-holdings': 'institutional-holdings',
  '/api/v1/sec/diff': 'sec-diff',
  '/api/v1/sec/fetch': 'sec-fetch',
  '/api/v1/sec/search': 'sec-search',
  '/api/v1/ticker-sentiment': 'ticker-sentiment',
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

/**
 * TTL per endpoint path in milliseconds. TTLs reflect how often each dataset
 * meaningfully changes (intraday sentiment is short-lived; filings are stable).
 * Only endpoints in ENDPOINT_KEY_PREFIX are cacheable.
 */
export const ENDPOINT_TTL_MS: Record<string, number> = {
  '/api/v1/fundamentals/financials': SEVEN_DAYS_MS,
  '/api/v1/options/overview': ONE_HOUR_MS,
  '/api/v1/options/sentiment': ONE_HOUR_MS,
  '/api/v1/ownership/insider-trades': ONE_DAY_MS,
  '/api/v1/ownership/institutional-holdings': SEVEN_DAYS_MS,
  '/api/v1/sec/diff': SEVEN_DAYS_MS,
  '/api/v1/sec/fetch': SEVEN_DAYS_MS,
  '/api/v1/sec/search': SEVEN_DAYS_MS,
  '/api/v1/ticker-sentiment': ONE_HOUR_MS,
};

/**
 * Generate a deterministic cache key for an API request.
 *
 * Returns null for non-cacheable endpoints,
 * which the cache layer treats as "always fetch."
 *
 * @param path - API endpoint path (e.g., '/api/v1/sec/search')
 * @param body - Request body object
 * @returns Cache key string or null if not cacheable
 *
 * @example
 * generateApiCacheKey('/api/v1/sec/search', { ticker: 'AAPL', form_type: '10-K' })
 * // Returns: 'sec-search:form_type=10-K&ticker=AAPL'
 *
 * generateApiCacheKey('/unknown/path', {})
 * // Returns: null
 */
export function generateApiCacheKey(path: string, body: unknown): string | null {
  const prefix = ENDPOINT_KEY_PREFIX[path];
  if (!prefix) return null;
  return `${prefix}:${sortedParamsString(body as Record<string, unknown>)}`;
}

/**
 * Get the TTL for a given endpoint path.
 * Returns null for non-cacheable endpoints.
 */
export function getEndpointTtlMs(path: string): number | null {
  return ENDPOINT_TTL_MS[path] ?? null;
}

/**
 * Create a sorted, deterministic string from request parameters.
 * Filters out null/undefined values, sorts alphabetically, joins with &.
 *
 * Each value is rendered with {@link stableStringify} so that nested objects
 * and arrays produce distinct, deterministic keys regardless of input key
 * order. Simple scalar values keep their bare textual form (e.g. `10-K`).
 */
function sortedParamsString(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([_, v]) => v != null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${stableStringify(v)}`)
    .join('&');
}

/**
 * Serialize a value into a stable, deterministic string.
 *
 * Object keys are sorted recursively so that two inputs with the same
 * contents but different key insertion order serialize identically. Nested
 * objects and arrays are rendered as distinct structured forms, avoiding the
 * `[object Object]` collapse that would otherwise collide different inputs on
 * a single cache key. Scalars are rendered in their bare textual form (so
 * `'10-K'` becomes `10-K`); `null` and `undefined` both render as `null`.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  // Unexpected types (symbol/function) are not valid cache params; serialize
  // deterministically without relying on default object stringification.
  return JSON.stringify(value) ?? typeof value;
}
