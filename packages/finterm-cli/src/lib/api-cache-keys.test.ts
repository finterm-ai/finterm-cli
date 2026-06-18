import { describe, expect, it } from 'vitest';

import { generateApiCacheKey, getEndpointTtlMs } from './api-cache-keys.js';

const SEC_DIFF_PATH = '/api/v1/sec/diff';

describe('generateApiCacheKey', () => {
  it('produces distinct keys for inputs that differ only inside nested objects', () => {
    const a = generateApiCacheKey(SEC_DIFF_PATH, {
      ticker: 'AAPL',
      base: { year: 2023, period: 'FY' },
      compare: { year: 2024, period: 'FY' },
    });
    const b = generateApiCacheKey(SEC_DIFF_PATH, {
      ticker: 'AAPL',
      base: { year: 2020, period: 'Q1' },
      compare: { year: 2024, period: 'FY' },
    });

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it('produces a stable key regardless of object-key insertion order', () => {
    const a = generateApiCacheKey(SEC_DIFF_PATH, {
      ticker: 'AAPL',
      base: { year: 2023, period: 'FY' },
      compare: { year: 2024, period: 'FY' },
    });
    // Same content, but top-level and nested keys inserted in a different order.
    const b = generateApiCacheKey(SEC_DIFF_PATH, {
      compare: { period: 'FY', year: 2024 },
      base: { period: 'FY', year: 2023 },
      ticker: 'AAPL',
    });

    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('keeps simple scalar params in a readable, unchanged form', () => {
    const key = generateApiCacheKey('/api/v1/sec/search', {
      ticker: 'AAPL',
      form_type: '10-K',
    });

    expect(key).toBe('sec-search:form_type=10-K&ticker=AAPL');
  });

  it('returns null for non-cacheable endpoints', () => {
    expect(generateApiCacheKey('/unknown/path', {})).toBeNull();
  });
});

describe('getEndpointTtlMs', () => {
  it('returns a positive TTL for a cacheable endpoint', () => {
    const ttl = getEndpointTtlMs(SEC_DIFF_PATH);
    expect(ttl).not.toBeNull();
    expect(ttl).toBeGreaterThan(0);
  });

  it('returns null for a non-cacheable endpoint', () => {
    expect(getEndpointTtlMs('/unknown/path')).toBeNull();
  });
});
