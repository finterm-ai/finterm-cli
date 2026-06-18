/**
 * URL normalization utilities for consistent cache key generation.
 *
 * @packageDocumentation
 */

/**
 * Common tracking parameters to remove from URLs.
 * These don't affect content but would cause cache misses if included.
 */
const TRACKING_PARAMS = new Set([
  // UTM parameters (Google Analytics)
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  // Facebook
  'fbclid',
  // Google
  'gclid',
  'gclsrc',
  // Microsoft/Bing
  'msclkid',
  // Twitter/X
  'twclid',
  // LinkedIn
  'li_fat_id',
  // TikTok
  'ttclid',
  // Mailchimp
  'mc_cid',
  'mc_eid',
  // HubSpot
  '_hsenc',
  '_hsmi',
  // Other common trackers
  'ref',
  'ref_',
  'source',
  'affiliate',
  'partner',
]);

/**
 * Options for URL normalization.
 */
export interface NormalizeUrlOptions {
  /** Remove fragment/hash from URL. Default: true */
  removeFragment?: boolean;
  /** Remove tracking parameters. Default: true */
  removeTracking?: boolean;
  /** Sort query parameters alphabetically. Default: true */
  sortParams?: boolean;
  /** Additional parameters to always remove */
  stripParams?: string[];
}

const DEFAULT_OPTIONS: Required<NormalizeUrlOptions> = {
  removeFragment: true,
  removeTracking: true,
  sortParams: true,
  stripParams: [],
};

/**
 * Normalize a URL for consistent cache key generation.
 *
 * Normalization includes:
 * 1. Lowercase scheme and host
 * 2. Remove default ports (80 for HTTP, 443 for HTTPS)
 * 3. Remove trailing slashes from path (except root)
 * 4. Remove fragments (#section) by default
 * 5. Sort query parameters alphabetically
 * 6. Remove tracking parameters (utm_*, fbclid, etc.)
 *
 * @param url - URL to normalize
 * @param options - Normalization options
 * @returns Normalized URL string
 * @throws Error if URL is invalid
 *
 * @example
 * ```typescript
 * normalizeUrl('https://SEC.GOV/path/')
 * // => 'https://sec.gov/path'
 *
 * normalizeUrl('https://example.com:443/page#section')
 * // => 'https://example.com/page'
 *
 * normalizeUrl('https://site.com/?b=2&a=1')
 * // => 'https://site.com/?a=1&b=2'
 *
 * normalizeUrl('https://site.com/?utm_source=google&q=test')
 * // => 'https://site.com/?q=test'
 * ```
 */
export function normalizeUrl(url: string, options: NormalizeUrlOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Only allow http/https for web content
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}. Only http and https are supported.`);
  }

  // 1. Lowercase scheme (already handled by URL parser)
  // 2. Lowercase host
  const host = parsed.hostname.toLowerCase();

  // 3. Remove default ports
  let port = parsed.port;
  if (
    (parsed.protocol === 'https:' && port === '443') ||
    (parsed.protocol === 'http:' && port === '80')
  ) {
    port = '';
  }

  // 4. Normalize path - remove trailing slash (except for root)
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // 5. Handle query parameters
  let search = '';
  if (parsed.searchParams.toString()) {
    const params: Array<[string, string]> = [];

    for (const [key, value] of parsed.searchParams) {
      // Skip tracking parameters
      if (opts.removeTracking && TRACKING_PARAMS.has(key.toLowerCase())) {
        continue;
      }

      // Skip custom strip params
      if (opts.stripParams.includes(key)) {
        continue;
      }

      params.push([key, value]);
    }

    // Sort parameters if requested
    if (opts.sortParams) {
      params.sort((a, b) => a[0].localeCompare(b[0]));
    }

    if (params.length > 0) {
      const searchParams = new URLSearchParams(params);
      search = '?' + searchParams.toString();
    }
  }

  // 6. Handle fragment
  const fragment = opts.removeFragment ? '' : parsed.hash;

  // Reconstruct URL
  const portPart = port ? `:${port}` : '';
  return `${parsed.protocol}//${host}${portPart}${path}${search}${fragment}`;
}

/**
 * Extract domain from a URL for use in blob filenames.
 *
 * @param url - URL to extract domain from
 * @returns Domain with dots replaced by underscores, e.g., "example_com"
 *
 * @example
 * ```typescript
 * extractDomain('https://docs.example.com/page')
 * // => 'docs_example_com'
 * ```
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/\./g, '_');
  } catch {
    return 'unknown';
  }
}

/**
 * Check if a URL is valid HTTP/HTTPS.
 */
export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
