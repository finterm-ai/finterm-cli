/**
 * Cache key generation for finterm-cli API calls.
 *
 * Uses stable HTTP cache-key rules:
 * - Colon separators between key parts
 * - sortedParamsString for deterministic param ordering
 * - Normalization (filter nulls, sort keys)
 */

// =============================================================================
// Endpoint Configuration
// =============================================================================

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
 * TTL per endpoint path in milliseconds.
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

// =============================================================================
// Key Generation
// =============================================================================

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

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a sorted, deterministic string from request parameters.
 * Filters out null/undefined values, sorts alphabetically, joins with &.
 */
function sortedParamsString(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([_, v]) => v != null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join('&');
}
