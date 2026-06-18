/**
 * Hash utilities for the dataroom package.
 *
 * Uses SHA-256 for consistent hashing across platforms.
 * SHA-256 is the canonical algorithm for hash12 and related index keys.
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';

/**
 * Compute 12-character hash (first 12 hex chars of SHA-256).
 * Used consistently for:
 * - URL index keys (urlh12:{hash12(url)})
 * - Action index keys (action:{hash12(request)})
 * - Blob filenames ({prefix}_{hash12}.{ext})
 *
 * 12 hex characters = 48 bits, providing ~2^48 (281 trillion) unique values.
 * Collision probability is negligible for typical use cases.
 */
export function hash12(input: string | Buffer): string {
  const hash = sha256(input);
  return hash.slice(0, 12);
}

/**
 * Full SHA-256 hash (64 hex characters).
 * Used for file digests.
 */
export function sha256(input: string | Buffer): string {
  const hash = createHash('sha256');
  hash.update(input);
  return hash.digest('hex');
}

/**
 * Action identity digest for API deduplication.
 *
 * Canonicalizes the request, then returns the **full** SHA-256 digest (64 hex
 * chars) of the canonical form. This is the request *identity*: the action
 * adapters may truncate it to 48 bits (`digest.slice(0, 12)`) for compact
 * index keys while storing the full digest in `ActionIndex.requestHash` so
 * that two distinct requests which collide on the 48-bit key are still
 * distinguishable.
 *
 * Storing the digest — rather than the raw canonical request — also keeps API
 * params (which may carry keys/tokens) out of the on-disk index (#10/#44).
 *
 * @param request - API request with provider, endpoint, and params
 * @returns 64-character SHA-256 digest identifying the canonical request
 */
export function actionHash(request: {
  provider: string;
  endpoint: string;
  params: Record<string, unknown>;
}): string {
  const canonical = canonicalizeForHash(request);
  return sha256(JSON.stringify(canonical));
}

/**
 * Canonicalize a value for stable, deterministic hashing. This is the single
 * canonicalization used by both `actionHash` (adapter action keys) and
 * `callKey` (loading-cache `call:` keys), so the two never diverge in how they
 * order keys or treat null/undefined.
 *
 * Rules (the cross-language contract — see the canonicalization test vectors):
 * - object keys sorted lexicographically at every level
 * - `undefined` values dropped; `null` and `undefined` both serialize as `null`
 * - arrays preserved in order, elements canonicalized
 * - scalars passed through unchanged
 *
 * NOTE: `actionHash` and `callKey` hash DIFFERENT inputs (the `{provider,
 * endpoint, params}` triple vs `{name, args}`) and live in SEPARATE on-disk key
 * namespaces. They share only this canonicalizer.
 */
export function canonicalizeForHash(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return null;
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalizeForHash);
  }

  if (typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();

    for (const key of keys) {
      const value = (obj as Record<string, unknown>)[key];
      if (value !== undefined) {
        sorted[key] = canonicalizeForHash(value);
      }
    }

    return sorted;
  }

  return obj;
}

/**
 * Compute hash12 of a normalized URL.
 * This is a convenience function that combines URL normalization with hashing.
 * Use this for URL index keys.
 */
export function urlHash12(normalizedUrl: string): string {
  return hash12(normalizedUrl);
}
