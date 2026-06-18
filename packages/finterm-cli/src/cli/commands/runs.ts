/**
 * `finterm runs` - Local run ledger commands for resumable bundle work.
 */

import { Command } from 'commander';

import { BaseCommand } from '../lib/base-command.js';
import { CLIError } from '../lib/errors.js';
import { listRunLedger, type RunLedgerEntry } from '../lib/bundle-runs.js';

interface RunsListOptions {
  limit?: string;
}

/** Radix for decimal CLI numeric option parsing. */
const DECIMAL_RADIX = 10;

/** Smallest valid value accepted by `finterm runs list --limit`. */
const MIN_RUN_LIST_LIMIT = 1;

/** Run count that indicates there is nothing to render from the local ledger. */
const EMPTY_RUN_COUNT = 0;

function parseOptionalLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const limit = Number.parseInt(value, DECIMAL_RADIX);
  if (!Number.isFinite(limit) || limit < MIN_RUN_LIST_LIMIT) {
    throw new CLIError(`Expected --limit to be a positive integer, got "${value}".`);
  }
  return limit;
}

class RunsHandler extends BaseCommand {
  async run(options: RunsListOptions): Promise<void> {
    const limit = parseOptionalLimit(options.limit);
    const result = await listRunLedger({ limit });
    this.output.data(result, ({ ledgerPath, runs }) => {
      console.log(`Local run ledger: ${ledgerPath}`);
      if (runs.length === EMPTY_RUN_COUNT) {
        console.log('No local bundle runs recorded yet.');
        return;
      }
      for (const run of runs) {
        console.log(formatRunLine(run));
      }
    });
  }
}

function formatRunLine(run: RunLedgerEntry): string {
  const state = run.state ?? run.status ?? 'unknown';
  const bundle = run.bundleName ?? 'unknown-bundle';
  const ticker = run.ticker ? ` ${run.ticker}` : '';
  const next = run.nextAction ? ` next=${run.nextAction}` : '';
  return `${run.updatedAt} ${run.runId} ${state} ${bundle}${ticker}${next}`;
}

const listCommand = new Command('list')
  .description('List recent local bundle runs from the resume ledger')
  .option('--limit <count>', 'Maximum number of local runs to show')
  .action(async (options: RunsListOptions, command: Command) => {
    const handler = new RunsHandler(command);
    await handler.run(options);
  });

export const runsCommand = new Command('runs')
  .description('Inspect local resumable run ledger')
  .addCommand(listCommand);
