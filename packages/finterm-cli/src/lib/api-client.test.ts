import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAPIClient, parseRetryAfterMs, type BundleRunRequest } from './api-client.js';

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

/**
 * Nested payloads are passed through untouched: commands print them verbatim, so
 * the client must not add key spellings the server did not send. Reconciling
 * snake_case to camelCase happens where fields are read (see bundle-runs), not
 * by rewriting responses.
 *
 * Fixtures use the real snake_case wire shape. Fixtures written camelCase agree
 * with the reader rather than the server, which is what let the nested-read bugs
 * survive.
 */
describe('response payloads (live snake_case wire shape)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubJson(payload: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    );
  }

  const client = () =>
    createAPIClient('https://api.example.invalid', 'fint_auth_test', { cacheEnabled: false });

  it('hands back artifact entries exactly as the server sent them', async () => {
    const artifact = {
      artifact_id: 'artifact_1',
      run_id: 'run_1',
      artifact_type: 'dataroom',
      content_type: 'application/zip',
      size_bytes: 1024,
      checksum_sha256: 'abc123',
      download_url: 'https://downloads.example.invalid/artifact_1',
      expires_at: '2026-01-01T00:00:00.000Z',
    };
    stubJson({
      success: true,
      data: {
        run_id: 'run_1',
        bundle_name: 'ticker_data',
        descriptor_id: 'ticker_data@1',
        status: 'succeeded',
        manifest_ready: true,
        artifacts: [artifact],
      },
    });

    const response = await client().bundleArtifacts('run_1');

    // `bundle artifacts` prints this array, and the artifacts are the substance
    // of that command — adding camelCase aliases here would double every key of
    // its output.
    expect(response.data?.artifacts).toEqual([artifact]);
  });

  /**
   * `bundle result` prints the run's `result` verbatim. Reconciling spellings by
   * rewriting the payload is the obvious fix for the nested reads this change is
   * about, and it silently doubles every key of the printed output — so the
   * reconciliation lives in the readers and these pin the payload.
   */
  it('leaves the printed result payload exactly as the server sent it', async () => {
    const result = {
      financial_statements: {
        statement_type: 'income_statement',
        periods: [{ fiscal_year: 2024, total_revenue: 1 }],
        miss_reason: null,
      },
    };
    stubJson({
      success: true,
      data: {
        run_id: 'run_1',
        bundle_name: 'ticker_data',
        descriptor_id: 'ticker_data@1',
        status: 'succeeded',
        normalized_request: { ticker: 'AAPL', delivery_mode: 'inline_result' },
        result,
      },
    });

    const response = await client().bundleResult('run_1');

    expect(response.data?.result).toEqual(result);
  });

  it('does not rewrite caller-supplied parameter keys', async () => {
    stubJson({
      success: true,
      data: {
        run_id: 'run_1',
        bundle_name: 'ticker_data',
        descriptor_id: 'ticker_data@1',
        status: 'succeeded',
        normalized_request: {
          ticker: 'AAPL',
          delivery_mode: 'inline_result',
          parameters: { verbose_statements: true },
        },
      },
    });

    const response = await client().bundleStatus('run_1');

    expect(response.data?.normalizedRequest.parameters).toEqual({ verbose_statements: true });
  });
});

describe('parseRetryAfterMs (rate-limit backoff honors the server)', () => {
  it('parses delta-seconds to milliseconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs(' 12 ')).toBe(12000);
  });

  it('returns null for absent, HTTP-date, or non-positive values', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
    expect(parseRetryAfterMs('0')).toBeNull();
    expect(parseRetryAfterMs('-5')).toBeNull();
  });
});
