/**
 * Cache key builders and parser for the loading-cache model.
 *
 * Keys name *what you want*, independent of how it is produced:
 *   - `url:<normalized-url>`  — a fetched/provided web resource
 *   - `call:<name>:<hash12>`  — a parameterized API/tool call, deduped by args
 *   - `file:<path>`           — an explicitly named file
 *
 * Key construction (URL normalization, argument canonicalization) lives here so
 * the loading-cache core can treat keys as opaque strings. Adapters and callers
 * build keys with these helpers; the core never parses provider/endpoint/params
 * shapes.
 *
 * @packageDocumentation
 */

import { hash12, canonicalizeForHash } from './hash.js';
import { normalizeUrl } from './urlNormalize.js';

/** Key scheme prefixes. */
export type KeyScheme = 'url' | 'call' | 'file';

const KEY_SCHEMES: readonly KeyScheme[] = ['url', 'call', 'file'] as const;

/**
 * Build a `url:` key from a URL. The URL is normalized so equivalent URLs
 * (case, default port, etc.) collapse to the same key.
 */
export function urlKey(url: string): string {
  return `url:${normalizeUrl(url)}`;
}

/**
 * Build a `call:` key from a logical operation name and its arguments. Args are
 * canonicalized (key order-independent) and hashed for stable deduplication, so
 * the same logical call always maps to the same key.
 *
 * Uses the shared {@link canonicalizeForHash} so `call:` keys and adapter
 * `actionHash` keys canonicalize identically. They remain SEPARATE namespaces,
 * though (this hashes `{name, args}`; `actionHash` hashes
 * `{provider, endpoint, params}`) — see `canonicalizeForHash`.
 */
export function callKey(name: string, args: Record<string, unknown>): string {
  return `call:${name}:${hash12(JSON.stringify(canonicalizeForHash(args)))}`;
}

/**
 * Build a `file:` key from a path under `files/`.
 */
export function fileKey(path: string): string {
  return `file:${path}`;
}

/**
 * Parse a key into its scheme and the remainder. Returns `undefined` for an
 * unrecognized scheme so callers can treat unknown keys as opaque.
 */
export function parseKey(key: string): { scheme: KeyScheme; rest: string } | undefined {
  const idx = key.indexOf(':');
  if (idx === -1) {
    return undefined;
  }
  const scheme = key.slice(0, idx);
  if (!KEY_SCHEMES.includes(scheme as KeyScheme)) {
    return undefined;
  }
  return { scheme: scheme as KeyScheme, rest: key.slice(idx + 1) };
}
