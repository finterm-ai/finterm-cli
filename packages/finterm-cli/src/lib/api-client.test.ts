import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAPIClient, type BundleRunRequest } from './api-client.js';

/**
 * The public bundle-run request contract. The server's bundleRunRequestSchema is
 * strict, so a key outside this list is a 400 VALIDATION_ERROR, not a no-op —
 * this pin exists because the CLI once sent an `as_of_date` the contract never
 * had. Update it only together with the server schema and OpenAPI.
 */
const BUNDLE_RUN_CONTRACT_KEYS = ['ticker', 'company_name', 'mode', 'delivery_mode', 'parameters'];

describe('bundleRun request body (contract guard)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends only keys the strict server schema accepts', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (typeof init?.body !== 'string') {
          throw new Error('expected a JSON string request body');
        }
        captured = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      })
    );

    // Required<> forces every BundleRunRequest field to be populated here, so a
    // field added to the interface must pass through this guard consciously.
    const fullRequest: Required<BundleRunRequest> = {
      ticker: 'AAPL',
      companyName: 'Apple Inc.',
      mode: 'placeholder',
      deliveryMode: 'inline_result',
      parameters: { verbose_statements: true },
    };

    const client = createAPIClient('https://api.example.invalid', 'fint_auth_test', {
      cacheEnabled: false,
    });
    await client.bundleRun('ticker_data', fullRequest);

    const sentKeys = Object.keys(captured);
    expect(sentKeys.length).toBeGreaterThan(0);
    for (const key of sentKeys) {
      expect(BUNDLE_RUN_CONTRACT_KEYS, `body key '${key}' is not in the contract`).toContain(key);
    }
  });
});
