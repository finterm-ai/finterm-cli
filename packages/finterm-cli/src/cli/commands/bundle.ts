/**
 * `finterm bundle` - Authenticated company research bundle commands.
 */
import { Command, Option } from 'commander';

import { BaseCommand } from '../lib/base-command.js';
import { CLIError } from '../lib/errors.js';
import { getAuthenticatedClient } from '../lib/authenticated-client.js';
import {
  BUNDLE_WAIT_DEFAULTS,
  buildRunLedgerEntry,
  downloadBundleRunArtifacts,
  getAgentRunStatus,
  getRunLedgerFilePath,
  upsertRunLedgerEntry,
  waitForBundleRun,
  type AgentRunStatus,
  type BundleRunNextAction,
  type DownloadResult,
} from '../lib/bundle-runs.js';
import type {
  APIResponse,
  BundleCatalogData,
  BundleDeliveryMode,
  BundleRunData,
  BundleRunRequest,
  FintermAPIClient,
} from '../../lib/api-client.js';
import {
  apiCallToFintermWireResult,
  createApiOutputFormatOption,
  getFintermWireData,
  getRequestedApiOutputFormat,
  hasRequestedApiOutputFormat,
  isFintermWireErrorResult,
  printFintermWireResult,
  renderFintermWireResult,
  type ApiOutputOptions,
  type FallbackResultMeta,
} from '../lib/wire-result.js';
import { recordDownloadStats } from '../lib/activity-stats.js';
import { formatBytes, formatDuration } from '../lib/format.js';

/** Options for `bundle run`, combining run parameters with the shared output-format flags. */
interface BundleRunOptions extends ApiOutputOptions {
  companyName?: string;
  deliveryMode?: BundleDeliveryMode;
  param?: string[];
}

/**
 * Options for `bundle wait`. Values are strings because Commander passes them through
 * unparsed; they are validated into positive integers before use.
 */
interface BundleWaitOptions {
  intervalMs?: string;
  timeoutMs?: string;
  maxErrors?: string;
}

/** Options for `bundle download`, controlling the target room and sync semantics. */
interface BundleDownloadOptions {
  mode?: 'new' | 'merge';
  room?: string;
  fixtureArtifacts?: string;
}

/** Radix for decimal CLI numeric option parsing. */
const DECIMAL_RADIX = 10;

/** Smallest valid positive integer accepted by CLI wait options. */
const MIN_POSITIVE_INTEGER = 1;

/** Smallest separator position that leaves a non-empty parameter key. */
const MIN_PARAMETER_SEPARATOR_INDEX = 1;

/** First character index used when slicing the parameter key from `key=value`. */
const PARAMETER_KEY_START_INDEX = 0;

/** Width of the single-character `=` separator in `--param key=value`. */
const PARAMETER_SEPARATOR_WIDTH = 1;

/** Minimum artifact count before printing an artifact id list. */
const MIN_PRINTABLE_ARTIFACT_COUNT = 1;

/** Exit code used when a completed command reports a failed run outcome. */
const COMMAND_FAILURE_EXIT_CODE = 1;

const COMPANY_WEB_RESEARCH_BUNDLE = 'company_deep_research';

export const TICKER_DATA_BUNDLE = 'ticker_data';

/**
 * Bundles exposed by this CLI. The server may offer more, but commands accept and list
 * only these so the published surface stays narrow and predictable.
 */
const PUBLISHED_BUNDLE_NAMES = new Set<string>([COMPANY_WEB_RESEARCH_BUNDLE, TICKER_DATA_BUNDLE]);

/** Parameters a live (non-placeholder) company web research run cannot run without. */
const COMPANY_WEB_RESEARCH_REQUIRED_LIVE_PARAMS = ['q', 'fy', 'prev_q', 'prev_fy'] as const;

/** Terminal next-actions that indicate a wait finished on a failed run. */
const FAILED_WAIT_NEXT_ACTIONS = new Set<BundleRunNextAction>(['inspect_error', 'resume_later']);

/**
 * Per-action result metadata used to wrap raw API responses in a stable wire-result
 * envelope, keyed by command action name.
 */
const BUNDLE_RESULT_SPECS: Record<string, Omit<FallbackResultMeta, 'args'>> = {
  catalog: {
    schema: 'finterm.result:BundleCatalog/v1',
    tool: 'catalog',
  },
  describe: {
    schema: 'finterm.result:BundleDescriptor/v1',
    tool: 'bundle_describe',
  },
  run: {
    schema: 'finterm.result:BundleRun/v1',
    tool: 'bundle_run',
  },
  result: {
    schema: 'finterm.result:BundleRunResult/v1',
    tool: 'bundle_result',
  },
  artifacts: {
    schema: 'finterm.result:BundleArtifacts/v1',
    tool: 'bundle_artifacts',
  },
};

/**
 * Resolve the wire-result metadata for an action, defaulting to a generic schema/tool
 * name when the action is not in {@link BUNDLE_RESULT_SPECS}.
 */
function buildBundleFallbackMeta(
  actionName: string,
  args: Record<string, unknown>
): FallbackResultMeta {
  const spec = BUNDLE_RESULT_SPECS[actionName] ?? {
    schema: `finterm.result:${actionName}/v1`,
    tool: actionName,
  };
  return { ...spec, args };
}

/** Convert a run request to the snake_case shape used in wire-result `args` echoes. */
function snakeBundleRunRequest(
  bundleName: string,
  request: BundleRunRequest
): Record<string, unknown> {
  return {
    bundle_name: bundleName,
    ticker: request.ticker,
    company_name: request.companyName,
    mode: request.mode,
    delivery_mode: request.deliveryMode,
    parameters: request.parameters,
  };
}

/** Parse repeated `--param key=value` flags into a parameter map, rejecting malformed entries. */
export function parseBundleParameters(values: string[] | null): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  const entries = values ?? [];
  for (const value of entries) {
    const separatorIndex = value.indexOf('=');
    if (separatorIndex < MIN_PARAMETER_SEPARATOR_INDEX) {
      throw new CLIError(`Invalid --param value "${value}". Use key=value.`);
    }
    const key = value.slice(PARAMETER_KEY_START_INDEX, separatorIndex);
    parameters[key] = value.slice(separatorIndex + PARAMETER_SEPARATOR_WIDTH);
  }
  return parameters;
}

/** Reject bundle names not in the CLI's published set, with a message listing valid names. */
function assertPublishedBundleName(bundleName: string): void {
  if (PUBLISHED_BUNDLE_NAMES.has(bundleName)) {
    return;
  }
  throw new CLIError(
    `Bundle "${bundleName}" is not published in this CLI. Published bundles: ${[
      ...PUBLISHED_BUNDLE_NAMES,
    ].join(', ')}.`
  );
}

/** Strip unpublished bundles from a catalog response so the CLI only surfaces its own set. */
function filterPublishedBundleCatalogResponse(
  response: APIResponse<BundleCatalogData>
): APIResponse<BundleCatalogData> {
  if (!response.success || !response.data) {
    return response;
  }
  return {
    ...response,
    data: {
      ...response.data,
      bundles: response.data.bundles.filter((bundle) => PUBLISHED_BUNDLE_NAMES.has(bundle.name)),
    },
  };
}

/**
 * Validate a run request before hitting the API: the bundle must be published, and
 * live company web research runs must supply the required fiscal-period parameters.
 */
function assertBundleRunRequest(bundleName: string, request: BundleRunRequest): void {
  assertPublishedBundleName(bundleName);
  if (bundleName !== COMPANY_WEB_RESEARCH_BUNDLE || request.mode === 'placeholder') {
    return;
  }
  const missing = COMPANY_WEB_RESEARCH_REQUIRED_LIVE_PARAMS.filter(
    (key) => typeof request.parameters?.[key] !== 'string' || request.parameters[key] === ''
  );
  if (missing.length === 0) {
    return;
  }
  throw new CLIError(
    `${COMPANY_WEB_RESEARCH_BUNDLE} live runs require fiscal period params: ${missing
      .map((key) => `--param ${key}=...`)
      .join(' ')}`
  );
}

/** Parse a CLI numeric option to a positive integer, falling back when unset. */
function parsePositiveInteger(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }
  const parsed = Number.parseInt(value, DECIMAL_RADIX);
  if (!Number.isFinite(parsed) || parsed < MIN_POSITIVE_INTEGER) {
    throw new CLIError(`Expected a positive integer, got "${value}".`);
  }
  return parsed;
}

/** Set a non-zero exit code when a wait completes on a failed run, for scripting/CI. */
function markWaitStatusExitCode(status: AgentRunStatus): void {
  if (FAILED_WAIT_NEXT_ACTIONS.has(status.nextAction)) {
    process.exitCode = COMMAND_FAILURE_EXIT_CODE;
  }
}

/**
 * Executes the `bundle` subcommands against the authenticated API, rendering every
 * response through the shared wire-result envelope so text and JSON output stay aligned.
 * Exported so bundle-backed `finterm tool` subcommands share the run-creation path.
 */
export class BundleHandler extends BaseCommand {
  /**
   * Shared path for read-only bundle actions: run one API call, wrap it in a wire
   * result, render it, and propagate any error exit code.
   */
  async run<T>(
    actionName: string,
    args: Record<string, unknown>,
    apiCall: (client: FintermAPIClient) => Promise<APIResponse<T>>,
    outputOptions: ApiOutputOptions
  ): Promise<void> {
    const client = await getAuthenticatedClient(this.requestLogger());
    const fallback = buildBundleFallbackMeta(actionName, args);
    const wireResult = await this.execute(
      () => apiCallToFintermWireResult<T>(() => apiCall(client), fallback),
      `Failed to execute bundle command: ${actionName}`
    );

    // Machine formats keep the wire envelope; a wire error in default mode
    // renders as the human block (C0/C1).
    await printFintermWireResult(this.ctx, this.output, wireResult, outputOptions);
  }

  /**
   * Create a bundle run and record it in the local run ledger so it can be resumed
   * later. Separate from {@link run} because it has side effects beyond rendering.
   */
  async createRun(
    bundleName: string,
    request: BundleRunRequest,
    outputOptions: ApiOutputOptions,
    actionName: string
  ): Promise<void> {
    assertBundleRunRequest(bundleName, request);
    const client = await getAuthenticatedClient(this.requestLogger());
    const fallback = buildBundleFallbackMeta(
      actionName,
      snakeBundleRunRequest(bundleName, request)
    );
    const wireResult = await this.execute(
      () =>
        apiCallToFintermWireResult<BundleRunData>(
          () => client.bundleRun(bundleName, request),
          fallback
        ),
      `Failed to execute bundle command: ${actionName}`
    );

    if (isFintermWireErrorResult(wireResult)) {
      await printFintermWireResult(this.ctx, this.output, wireResult, outputOptions);
      return;
    }

    const run = getFintermWireData(wireResult, `Bundle command failed: ${actionName}`);

    // The run already exists server-side: a failed local ledger write must never lose
    // the runId, so fall back to the unpersisted entry and warn instead of throwing.
    let ledgerEntry = buildRunLedgerEntry(run, client.baseUrl);
    try {
      ledgerEntry = await upsertRunLedgerEntry(ledgerEntry);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `Warning: created run ${run.runId} but failed to record it in the local run ledger (${reason}). Save the run id; resume with: finterm bundle status ${run.runId}`
      );
    }
    const output = {
      ...run,
      state: run.status,
      nextAction: ledgerEntry.nextAction,
      localPaths: {
        ledger: getRunLedgerFilePath(),
      },
    };
    this.output.data(wireResult, () => {
      if (hasRequestedApiOutputFormat(this.ctx, outputOptions)) {
        console.log(
          renderFintermWireResult(wireResult, getRequestedApiOutputFormat(this.ctx, outputOptions))
        );
        return;
      }

      console.log(`Created bundle run ${output.runId} (${output.status}).`);
      console.log(`Ledger: ${getRunLedgerFilePath()}`);
      console.log(`Next: finterm bundle status ${output.runId}`);
    });
  }

  async status(runId: string): Promise<void> {
    const client = await getAuthenticatedClient(this.requestLogger());
    const status = await this.execute(
      () => getAgentRunStatus(client, runId),
      `Failed to read bundle run status: ${runId}`
    );
    this.output.data(status, printStatus);
  }

  async wait(runId: string, options: BundleWaitOptions): Promise<void> {
    const client = await getAuthenticatedClient(this.requestLogger());
    const intervalMs = parsePositiveInteger(
      options.intervalMs ?? null,
      BUNDLE_WAIT_DEFAULTS.pollIntervalMs
    );
    const timeoutMs = parsePositiveInteger(
      options.timeoutMs ?? null,
      BUNDLE_WAIT_DEFAULTS.timeoutMs
    );
    const maxErrors = parsePositiveInteger(
      options.maxErrors ?? null,
      BUNDLE_WAIT_DEFAULTS.maxConsecutiveErrors
    );
    const status = await this.execute(
      () =>
        waitForBundleRun(client, runId, {
          intervalMs,
          timeoutMs,
          maxErrors,
          onPoll: (pollStatus) => {
            if (!this.ctx.json && !this.ctx.quiet) {
              console.error(`Run ${pollStatus.runId}: ${pollStatus.state}`);
            }
          },
        }),
      `Failed while waiting for bundle run: ${runId}`
    );
    this.output.data(status, printStatus);
    markWaitStatusExitCode(status);
  }

  /** Sync a finished run's artifacts into a local dataroom and record transfer stats. */
  async download(runId: string, options: BundleDownloadOptions): Promise<void> {
    if (
      this.checkDryRun(`Would download bundle run artifacts into a local dataroom: ${runId}`, {
        runId,
        mode: options.mode ?? 'new',
        room: options.room,
        fixtureArtifacts: options.fixtureArtifacts,
      })
    ) {
      return;
    }
    const client = await getAuthenticatedClient(this.requestLogger());
    const result = await this.execute(
      () =>
        downloadBundleRunArtifacts(client, runId, {
          mode: options.mode ?? 'new',
          room: options.room,
          fixtureArtifactsPath: options.fixtureArtifacts,
        }),
      `Failed to download bundle run artifacts: ${runId}`
    );
    recordDownloadStats({
      runId: result.runId,
      room: result.localPaths.room,
      stats: result.stats,
    });
    this.output.data(result, printDownloadResult);
  }
}

/** Text formatter for a run status, used as the non-JSON branch of `output.data`. */
function printStatus(status: AgentRunStatus): void {
  console.log(`Run: ${status.runId}`);
  console.log(`State: ${status.state}`);
  if (status.bundleName) {
    console.log(`Bundle: ${status.bundleName}`);
  }
  if (status.ticker) {
    console.log(`Ticker: ${status.ticker}`);
  }
  if (status.artifactIds.length >= MIN_PRINTABLE_ARTIFACT_COUNT) {
    console.log(`Artifacts: ${status.artifactIds.join(', ')}`);
  }
  console.log(`Next action: ${status.nextAction}`);
  console.log(status.message);
}

/** Text formatter for a download result, used as the non-JSON branch of `output.data`. */
function printDownloadResult(result: DownloadResult): void {
  for (const warning of result.warnings) {
    console.error(`Warning: ${warning}`);
  }
  console.log(result.message);
  console.log(`Room: ${result.localPaths.room}`);
  // Brief transfer summary in regular output so the size/time of a run is visible
  // without --verbose; full per-request diagnostics stay behind --verbose/--debug.
  console.log(
    `Downloaded: ${result.downloadedCount}, verified: ${result.verifiedCount} ` +
      `(${formatBytes(result.stats.downloadedBytes)} of ${formatBytes(result.stats.totalBytes)} in ${formatDuration(result.stats.durationMs)})`
  );
  console.log(`Next action: ${result.nextAction}`);
}

const catalogCommand = new Command('catalog')
  .description('Show authenticated company research bundle catalog')
  .addOption(createApiOutputFormatOption())
  .action(async (options: ApiOutputOptions, command: Command) => {
    const handler = new BundleHandler(command);
    await handler.run(
      'catalog',
      {},
      async (client) => filterPublishedBundleCatalogResponse(await client.bundleCatalog()),
      options
    );
  });

const describeCommand = new Command('describe')
  .description('Show one company research bundle descriptor')
  .argument('<bundleName>', 'Bundle public name, e.g. company_deep_research')
  .addOption(createApiOutputFormatOption())
  .action(async (bundleName: string, options: ApiOutputOptions, command: Command) => {
    assertPublishedBundleName(bundleName);
    const handler = new BundleHandler(command);
    await handler.run(
      'describe',
      { bundle_name: bundleName },
      (client) => client.bundleDescribe(bundleName),
      options
    );
  });

const runCommand = new Command('run')
  .description('Create an authenticated company research bundle run')
  .argument('<bundleName>', 'Bundle public name, e.g. company_deep_research')
  .argument('<ticker>', 'Company ticker, e.g. AAPL')
  .option('--company-name <name>', 'Company name for display and normalization')
  .addOption(
    new Option('--delivery-mode <mode>', 'Requested delivery mode').choices([
      'inline_result',
      'artifact_metadata',
      'summary_json',
      'dataroom_sync',
    ])
  )
  .option('--param <key=value...>', 'Additional bundle parameter values')
  .addOption(createApiOutputFormatOption())
  .action(
    async (bundleName: string, ticker: string, options: BundleRunOptions, command: Command) => {
      const handler = new BundleHandler(command);
      await handler.createRun(
        bundleName,
        {
          ticker,
          companyName: options.companyName,
          deliveryMode: options.deliveryMode,
          parameters: parseBundleParameters(options.param ?? null),
        },
        options,
        'run'
      );
    }
  );

const statusCommand = new Command('status')
  .description('Show bundle run status and next action')
  .argument('<runId>', 'Bundle run id')
  .action(async (runId: string, _options: unknown, command: Command) => {
    const handler = new BundleHandler(command);
    await handler.status(runId);
  });

const waitCommand = new Command('wait')
  .description('Poll a bundle run until it finishes or the wait timeout expires')
  .argument('<runId>', 'Bundle run id')
  .option('--interval-ms <ms>', 'Polling interval in milliseconds')
  .option('--timeout-ms <ms>', 'Maximum wait time in milliseconds')
  .option('--max-errors <count>', 'Consecutive status read failures before aborting')
  .action(async (runId: string, options: BundleWaitOptions, command: Command) => {
    const handler = new BundleHandler(command);
    await handler.wait(runId, options);
  });

const resultCommand = new Command('result')
  .description('Show bundle run result')
  .argument('<runId>', 'Bundle run id')
  .addOption(createApiOutputFormatOption())
  .action(async (runId: string, options: ApiOutputOptions, command: Command) => {
    const handler = new BundleHandler(command);
    await handler.run('result', { run_id: runId }, (client) => client.bundleResult(runId), options);
  });

const artifactsCommand = new Command('artifacts')
  .description('Show bundle run artifact metadata')
  .argument('<runId>', 'Bundle run id')
  .addOption(createApiOutputFormatOption())
  .action(async (runId: string, options: ApiOutputOptions, command: Command) => {
    const handler = new BundleHandler(command);
    await handler.run(
      'artifacts',
      { run_id: runId },
      (client) => client.bundleArtifacts(runId),
      options
    );
  });

const downloadCommand = new Command('download')
  .description(
    'Sync bundle run files into a local room via the run sync manifest (downloads only missing or changed files; re-running on a complete room is a fast no-op)'
  )
  .argument('<runId>', 'Bundle run id')
  .addOption(
    new Option(
      '--mode <mode>',
      'Room sync mode: "new" requires an empty room; "merge" syncs into an existing room, keeping locally modified or foreign files (skipped with a warning)'
    )
      .choices(['new', 'merge'])
      .default('new')
  )
  .option('--room <path>', 'Target local room path')
  .option('--fixture-artifacts <path>', 'Read local fixture artifact metadata instead of live URLs')
  .action(async (runId: string, options: BundleDownloadOptions, command: Command) => {
    const handler = new BundleHandler(command);
    await handler.download(runId, options);
  });

/** Top-level `bundle` command grouping the catalog, run lifecycle, and download subcommands. */
export const bundleCommand = new Command('bundle')
  .description('Authenticated company research bundle catalog and run commands')
  .addCommand(catalogCommand)
  .addCommand(describeCommand)
  .addCommand(runCommand)
  .addCommand(statusCommand)
  .addCommand(waitCommand)
  .addCommand(resultCommand)
  .addCommand(artifactsCommand)
  .addCommand(downloadCommand);
