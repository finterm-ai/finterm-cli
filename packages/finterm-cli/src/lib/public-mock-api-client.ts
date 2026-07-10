/**
 * Public first-release mock API client.
 *
 * This file is bundled into the npm package, so keep it limited to the shipped
 * CLI surface: auth, bundles, cache hooks, and the approved point tools.
 */

import { CLI_TOKEN_PREFIX, TOKEN_ID_PREFIX, isMockErrorMode } from '../cli-io/settings.js';
import type { CacheLookupResult } from './api-cache.js';
import type {
  AccountWireResponse,
  APIResponse,
  BundleArtifactsData,
  BundleCatalogData,
  BundleCatalogEntry,
  BundleRunData,
  BundleRunRequest,
  BundleRunResultData,
  FeedbackAckWireResponse,
  FeedbackSubmission,
  FintermAPIClient,
  LoginPollResponse,
  LoginStartResponse,
  SyncManifestData,
} from './api-client.js';

const MANIFEST_NOT_READY_ERROR_CODE = 'MANIFEST_NOT_READY';

/** Lifetime of a mock login session, matching the live login expiry window. */
const MOCK_LOGIN_SESSION_TTL_MS = 15 * 60 * 1000;

const MOCK_BUNDLE_CATALOG: BundleCatalogData = {
  catalogVersion: '2026-06-17',
  bundles: [
    {
      name: 'ticker_data',
      descriptorId: 'ticker_data',
      toolFamily: 'bundle',
      summary:
        'Aggregated company fundamentals bundle with earnings, prices, ratios, and statements.',
      execution: 'async',
      lifecycle: 'placeholder',
      deliveryModes: ['inline_result', 'artifact_metadata'],
      artifactTypes: ['result_json', 'run_manifest', 'resource_events'],
      runEndpoint: '/api/v1/bundles/ticker_data/runs',
      inputSchemaRef: '/api/v1/catalog/bundles/ticker_data/input-schema',
      outputSchemaRef: '/api/v1/catalog/bundles/ticker_data/output-schema',
      requiredScopes: ['bundle:fundamentals', 'runs:create'],
    },
    {
      name: 'company_deep_research',
      descriptorId: 'company_deep_research',
      toolFamily: 'package',
      summary: 'Company web research bundle with optional Dataroom delivery.',
      execution: 'async',
      lifecycle: 'placeholder',
      deliveryModes: ['summary_json', 'dataroom_sync'],
      artifactTypes: ['bundle_manifest', 'dataroom_manifest', 'source_cache', 'run_manifest'],
      runEndpoint: '/api/v1/bundles/company_deep_research/runs',
      inputSchemaRef: '/api/v1/catalog/bundles/company_deep_research/input-schema',
      outputSchemaRef: '/api/v1/catalog/bundles/company_deep_research/output-schema',
      requiredScopes: ['bundle:web_research', 'runs:create'],
    },
  ],
  links: {
    bundles: '/api/v1/catalog/bundles',
  },
};

function getMockBundleEntry(bundleName: string): BundleCatalogEntry | null {
  return MOCK_BUNDLE_CATALOG.bundles.find((bundle) => bundle.name === bundleName) ?? null;
}

/** Sentinel ticker that drives the mock into the failed-run path for testing. */
const MOCK_FAILED_BUNDLE_TICKER = 'FAIL';

function normalizeMockBundleRequest(
  entry: BundleCatalogEntry,
  params: BundleRunRequest
): Record<string, unknown> {
  return {
    ticker: params.ticker ? params.ticker.toUpperCase() : null,
    companyName: params.companyName ?? null,
    mode: params.mode ?? 'placeholder',
    deliveryMode: params.deliveryMode ?? entry.deliveryModes[0],
    parameters: params.parameters ?? {},
  };
}

/**
 * Recover the bundle and ticker from a mock run id. Run ids are deterministic
 * (`run_ph_mock_<bundle>_<ticker>`) so the mock can answer status/result/artifacts
 * queries statelessly, without tracking issued runs.
 */
function parseMockRunId(runId: string): { bundleName: string; ticker: string } | null {
  const match = /^run_ph_mock_(company_deep_research|ticker_data)_([A-Z0-9.]+)$/.exec(runId);
  if (!match) {
    return null;
  }
  return {
    bundleName: match[1]!,
    ticker: match[2]!,
  };
}

function buildMockRun(entry: BundleCatalogEntry, params: BundleRunRequest): BundleRunData {
  const normalizedRequest = normalizeMockBundleRequest(entry, params);
  const ticker =
    typeof normalizedRequest.ticker === 'string' ? normalizedRequest.ticker : 'UNKNOWN';
  const runId = `run_ph_mock_${entry.name}_${ticker}`;
  return {
    runId,
    bundleName: entry.name,
    descriptorId: entry.descriptorId,
    lifecycle: 'placeholder',
    runtimeAdapter: 'mock',
    status: 'succeeded',
    normalizedRequest,
    links: {
      self: `/api/v1/runs/${runId}`,
      result: `/api/v1/runs/${runId}/result`,
      artifacts: `/api/v1/runs/${runId}/artifacts`,
      syncManifest: `/api/v1/runs/${runId}/sync-manifest`,
    },
  };
}

/**
 * Network-free implementation of {@link FintermAPIClient} for tests and offline demos.
 * Returns deterministic, hand-authored fixtures and has no cache; selected by
 * createAPIClient when mock mode is enabled.
 */
class PublicMockAPIClient implements FintermAPIClient {
  readonly baseUrl = 'mock://finterm-api';
  private _token: string | null = null;

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

  async loginStart(_deviceName: string): Promise<LoginStartResponse> {
    if (isMockErrorMode()) {
      throw new Error('connect ECONNREFUSED 127.0.0.1:443');
    }
    const sessionId = `mock_session_${Date.now()}`;
    const pollSecret = `mock_poll_secret_${Date.now()}`;
    return {
      success: true,
      sessionId,
      pollSecret,
      loginUrl: `mock://finterm/cli-login#session=${sessionId}`,
      pollUrl: 'mock://finterm-api/cli/login/poll',
      expiresAt: Date.now() + MOCK_LOGIN_SESSION_TTL_MS,
    };
  }

  async loginPoll(_sessionId: string, _pollSecret: string): Promise<LoginPollResponse> {
    return {
      success: true,
      status: 'authorized',
      token: `${CLI_TOKEN_PREFIX}mock_${Date.now().toString(16)}`,
      tokenId: `${TOKEN_ID_PREFIX}mock_${Date.now().toString(16)}`,
      entitlement: {
        plan: 'pro',
        hasPro: true,
        status: 'active',
        trialEndsAt: null,
      },
    };
  }

  async account(): Promise<AccountWireResponse> {
    return {
      finterm: { schema: 'finterm.result:Account/v1', tool: 'account', args: {} },
      data: {
        email: 'mock@finterm.ai',
        plan: 'pro',
        has_pro: true,
        subscription_status: 'active',
        trial_ends_at: null,
        current_period_end: null,
        cancel_at_period_end: false,
      },
    };
  }

  async submitFeedback(submission: FeedbackSubmission): Promise<FeedbackAckWireResponse> {
    // Deterministic id (keyed by kind, no clock) so test output is stable.
    return {
      finterm: {
        schema: 'finterm.result:FeedbackAck/v1',
        tool: 'feedback',
        args: { kind: submission.kind },
      },
      data: {
        feedback_id: `fb_mock_${submission.kind}`,
        status: 'received',
      },
    };
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
    return {
      success: true,
      data: {
        ticker: params.ticker,
        statement_type: params.statementType,
        as_of_date: params.asOfDate,
        periods: [
          {
            fiscal_year: params.fiscalYear ?? 2024,
            fiscal_quarter: params.fiscalQuarter ?? 1,
            timeframe: params.timeframe ?? 'quarterly',
            period_end: '2024-03-30',
            filing_date: '2024-05-03',
            total_revenue: params.statementType === 'income_statement' ? 383285000000 : null,
            net_income: params.statementType === 'income_statement' ? 96995000000 : null,
            total_assets: params.statementType === 'balance_sheet' ? 352755000000 : null,
            free_cash_flow: params.statementType === 'cash_flow' ? 99584000000 : null,
          },
        ].slice(0, params.limit ?? 1),
      },
    };
  }

  async optionsSentiment(params: {
    underlyingTicker: string;
    date: string;
    includeSpreadAnalysis: boolean;
    expirationFilter?: string;
    maxContracts?: number;
  }): Promise<APIResponse<unknown>> {
    return {
      success: true,
      data: {
        ticker: params.underlyingTicker,
        as_of_date: params.date,
        sentiment: {
          put_call_volume_ratio: 0.78,
          interpretation: 'neutral',
          total_call_volume: 128400,
          total_put_volume: 100152,
          avg_spread_percent: params.includeSpreadAnalysis ? 4.6 : null,
          liquidity_grade: params.includeSpreadAnalysis ? 'A' : null,
        },
        data_quality: {
          status: 'ok',
          contracts_analyzed: params.maxContracts ?? 50,
          contracts_with_volume: 42,
        },
        contracts: {
          expirations: [params.expirationFilter ?? '2024-02-16'],
        },
      },
    };
  }

  async secFilingsSearch(params: {
    ticker: string;
    formType?: string;
    from_date?: string;
    limit?: number;
  }): Promise<APIResponse<unknown>> {
    return {
      success: true,
      data: {
        ticker: params.ticker,
        filings: [
          {
            accession_number: '0000320193-24-000123',
            form_type: params.formType ?? '10-K',
            filing_date: params.from_date ?? '2024-11-01',
            company_name: `${params.ticker} Inc.`,
            document_url: 'https://www.sec.gov/Archives/mock-primary-document.htm',
          },
        ].slice(0, params.limit ?? 1),
      },
    };
  }

  async secFilingFetch(params: {
    ticker: string;
    year: number;
    period: string;
    sections: string;
    format?: string;
  }): Promise<APIResponse<unknown>> {
    return {
      success: true,
      data: {
        ticker: params.ticker,
        year: params.year,
        period: params.period,
        sections: params.sections,
        format: params.format ?? 'text',
        text: `Mock ${params.sections} section for ${params.ticker}.`,
      },
    };
  }

  async secFilingDiff(params: {
    ticker: string;
    base: { year: number; period: string };
    compare: { year: number; period: string };
    sections?: string;
    mode?: string;
    qa: boolean | null;
  }): Promise<APIResponse<unknown>> {
    return {
      success: true,
      data: {
        ticker: params.ticker,
        base: params.base,
        compare: params.compare,
        sections: params.sections ?? 'risk_factors',
        mode: params.mode ?? 'summary',
        qa: params.qa,
        changes: [
          {
            section: params.sections ?? 'risk_factors',
            summary: 'Mock filing language changed between selected periods.',
          },
        ],
      },
    };
  }

  async insiderTrades(params: {
    ticker: string;
    asOfDate?: string;
    limit?: number;
    transactionCodes?: ('P' | 'S' | 'A' | 'M' | 'F' | 'G' | 'C' | 'W')[];
    includeDerivatives: boolean;
    includeHoldings: boolean;
  }): Promise<APIResponse<unknown>> {
    return {
      success: true,
      data: {
        ticker: params.ticker,
        as_of_date: params.asOfDate ?? '2024-03-15',
        trades: [
          {
            name: 'DOE JANE',
            transaction_code: params.transactionCodes?.[0] ?? 'P',
            transaction_date: '2024-03-12',
            transaction_shares: 1000,
            transaction_price_per_share: 172.5,
            include_derivatives: params.includeDerivatives,
            include_holdings: params.includeHoldings,
          },
        ].slice(0, params.limit ?? 1),
      },
    };
  }

  async institutionalHoldings(params: {
    ticker?: string;
    investorCik?: string;
    asOfDate?: string;
    limit?: number;
  }): Promise<APIResponse<unknown>> {
    return {
      success: true,
      data: {
        ticker: params.ticker ?? null,
        investor_cik: params.investorCik ?? null,
        as_of_date: params.asOfDate ?? '2024-03-15',
        holders: [
          {
            filer_name: 'Vanguard Group Inc',
            filer_cik: params.investorCik ?? '0000102909',
            ticker: params.ticker ?? 'AAPL',
            shares: 1325000000,
            value_usd: 228000000000,
          },
        ].slice(0, params.limit ?? 1),
      },
    };
  }

  async optionsOverview(params: {
    ticker: string;
    asOfDate?: string;
  }): Promise<APIResponse<unknown>> {
    return {
      success: true,
      data: {
        ticker: params.ticker,
        as_of_date: params.asOfDate ?? '2024-03-15',
        spot: 381.16,
        volatility: {
          iv_30: 48.2,
          hv_20: 48,
        },
        flow: {
          volume: 3623504,
          puts: 1425740,
          calls: 2197764,
          pc_ratio: 0.65,
        },
      },
    };
  }

  async tickerSentiment(params: {
    ticker: string;
    asOfDate?: string;
  }): Promise<APIResponse<unknown>> {
    return {
      success: true,
      data: {
        ticker: params.ticker,
        as_of_date: params.asOfDate ?? '2024-03-15',
        price: 172.62,
        score: 58.4,
        band: 'greed',
        components: [
          {
            id: 'price_vs_125d_sma',
            group: 'trend',
            score: 71.2,
          },
        ],
      },
    };
  }

  async stockPricesCurrent(params: { symbols: string[] }): Promise<APIResponse<unknown>> {
    const quotes = params.symbols.map((symbol, index) => ({
      ticker: symbol.toUpperCase(),
      price: 172.62 + index,
    }));
    if (quotes.length === 1) {
      return { success: true, data: quotes[0] };
    }
    return {
      success: true,
      data: Object.fromEntries(quotes.map((quote) => [quote.ticker, quote])),
    };
  }

  async technicalIndicators(params: {
    symbols: string[];
    date: string;
  }): Promise<APIResponse<unknown>> {
    const indicators = params.symbols.map((symbol, index) => ({
      ticker: symbol.toUpperCase(),
      rsi_14: 61.3 + index,
      macd_value: 2.41,
      macd_signal: 1.98,
      macd_histogram: 0.43,
      sma_20: 168.9,
      sma_50: 161.2,
    }));
    if (indicators.length === 1) {
      return { success: true, data: indicators[0] };
    }
    return {
      success: true,
      data: Object.fromEntries(indicators.map((entry) => [entry.ticker, entry])),
    };
  }

  async bundleCatalog(): Promise<APIResponse<BundleCatalogData>> {
    return {
      success: true,
      data: MOCK_BUNDLE_CATALOG,
    };
  }

  async bundleDescribe(bundleName: string): Promise<APIResponse<BundleCatalogEntry>> {
    const entry = getMockBundleEntry(bundleName);
    if (!entry) {
      return {
        success: false,
        error: {
          code: 'BUNDLE_NOT_FOUND',
          message: `Unknown bundle: ${bundleName}`,
        },
      };
    }
    return {
      success: true,
      data: entry,
    };
  }

  async bundleRun(
    bundleName: string,
    params: BundleRunRequest
  ): Promise<APIResponse<BundleRunData>> {
    const entry = getMockBundleEntry(bundleName);
    if (!entry) {
      return {
        success: false,
        error: {
          code: 'BUNDLE_NOT_FOUND',
          message: `Unknown bundle: ${bundleName}`,
        },
      };
    }
    return {
      success: true,
      data: buildMockRun(entry, params),
    };
  }

  async bundleStatus(runId: string): Promise<APIResponse<BundleRunData>> {
    const parsed = parseMockRunId(runId);
    if (!parsed) {
      return {
        success: false,
        error: {
          code: 'RUN_NOT_FOUND',
          message: `Unknown run: ${runId}`,
        },
      };
    }
    const entry = getMockBundleEntry(parsed.bundleName);
    if (!entry) {
      return {
        success: false,
        error: {
          code: 'BUNDLE_NOT_FOUND',
          message: `Unknown bundle: ${parsed.bundleName}`,
        },
      };
    }
    if (parsed.ticker === MOCK_FAILED_BUNDLE_TICKER) {
      return {
        success: true,
        data: {
          ...buildMockRun(entry, { ticker: parsed.ticker }),
          status: 'failed',
        },
      };
    }
    return {
      success: true,
      data: buildMockRun(entry, { ticker: parsed.ticker }),
    };
  }

  async bundleResult(runId: string): Promise<APIResponse<BundleRunResultData>> {
    const status = await this.bundleStatus(runId);
    if (!status.success || !status.data) {
      return status as APIResponse<BundleRunResultData>;
    }
    return {
      success: true,
      data: {
        ...status.data,
        result: {
          kind: `${status.data.bundleName}_placeholder`,
          ticker: status.data.normalizedRequest.ticker,
          dataroomAvailable: false,
          providerExecution: 'not_wired',
        },
      },
    };
  }

  async bundleArtifacts(runId: string): Promise<APIResponse<BundleArtifactsData>> {
    const status = await this.bundleStatus(runId);
    if (!status.success || !status.data) {
      return status as unknown as APIResponse<BundleArtifactsData>;
    }
    const entry = getMockBundleEntry(status.data.bundleName);
    return {
      success: true,
      data: {
        runId: status.data.runId,
        bundleName: status.data.bundleName,
        descriptorId: status.data.descriptorId,
        lifecycle: status.data.lifecycle,
        status: status.data.status,
        artifacts: (entry?.artifactTypes ?? []).map((artifactType) => ({
          artifactId: `artifact_ph_mock_${artifactType}`,
          runId,
          bundleName: status.data!.bundleName,
          artifactType,
          status: 'metadata_only',
          downloadUrl: null,
        })),
      },
    };
  }

  async bundleSyncManifest(runId: string): Promise<APIResponse<SyncManifestData>> {
    const parsed = parseMockRunId(runId);
    if (!parsed) {
      return {
        success: false,
        error: {
          code: 'RUN_NOT_FOUND',
          message: `Unknown run: ${runId}`,
        },
      };
    }
    return {
      success: false,
      error: {
        code: MANIFEST_NOT_READY_ERROR_CODE,
        message: `Run ${runId} artifacts are not published yet.`,
      },
    };
  }

  getCacheStats() {
    return {
      hits: 0,
      memoryHits: 0,
      diskHits: 0,
      misses: 0,
      skips: 0,
      writes: 0,
      errors: 0,
      totalHitBytes: 0,
      totalWriteBytes: 0,
    };
  }

  getLastCacheLookup(): null {
    return null;
  }

  getDiskCacheInfo(): null {
    return null;
  }

  async initDiskCache(_cachePath: string): Promise<void> {
    // Mock mode intentionally has no disk cache.
  }

  closeDiskCache(): void {
    // Mock mode intentionally has no disk cache.
  }

  clearCache(): void {
    // Mock mode intentionally has no cached state.
  }

  setOnCacheLookup(_cb: ((result: CacheLookupResult) => void) | null): void {
    // Mock mode intentionally has no cache lookups.
  }
}

export function createPublicMockAPIClient(): FintermAPIClient {
  return new PublicMockAPIClient();
}
