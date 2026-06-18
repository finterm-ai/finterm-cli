/**
 * `finterm tool` - Unified tool command for Finterm CLI.
 *
 * Provides access to public point tools via a single `finterm tool <public_id>` interface.
 * Public IDs are canonical snake_case ids from the committed external `.api.md` docs.
 */

import { Command, InvalidArgumentError, Option } from 'commander';

import { BaseCommand } from '../lib/base-command.js';
import { getAuthenticatedClient } from '../lib/authenticated-client.js';
import { FINTERM_TOOL_IDS, type FintermToolId, visibleFintermToolIds } from '../../api/toolIds.js';
import type { FintermAPIClient } from '../../lib/api-client.js';
import {
  apiCallToFintermWireResult,
  createApiOutputFormatOption,
  getRequestedApiOutputFormat,
  markFintermWireErrorExitCode,
  renderFintermWireResult,
  type ApiOutputOptions,
  type FallbackResultMeta,
} from '../lib/wire-result.js';
// =============================================================================
// Generic Tool Handler
// =============================================================================

export const TOOL_RESULT_SPECS = {
  financial_statements: {
    schema: 'finterm.result:FinancialStatements/v1',
    tool: 'financial_statements',
  },
  options_sentiment: {
    schema: 'finterm.result:OptionsSentiment/v1',
    tool: 'options_sentiment',
  },
  options_overview: {
    schema: 'finterm.result:OptionsOverview/v1',
    tool: 'options_overview',
  },
  ticker_sentiment: {
    schema: 'finterm.result:TickerSentiment/v1',
    tool: 'ticker_sentiment',
  },
  sec_filings_search: {
    schema: 'finterm.result:SecFilingsSearch/v1',
    tool: 'sec_filings_search',
  },
  sec_filing_fetch: {
    schema: 'finterm.result:SecFilingFetch/v1',
    tool: 'sec_filing_fetch',
  },
  sec_filing_diff: {
    schema: 'finterm.result:SecFilingDiff/v1',
    tool: 'sec_filing_diff',
  },
  insider_trades: {
    schema: 'finterm.result:InsiderTrades/v1',
    tool: 'insider_trades',
  },
  institutional_holdings: {
    schema: 'finterm.result:InstitutionalHoldings/v1',
    tool: 'institutional_holdings',
  },
} satisfies Record<FintermToolId, Omit<FallbackResultMeta, 'args'>>;

export function buildToolFallbackMeta(
  toolId: string,
  args: Record<string, unknown>
): FallbackResultMeta {
  const spec = (TOOL_RESULT_SPECS as Record<string, Omit<FallbackResultMeta, 'args'>>)[toolId] ?? {
    schema: `finterm.result:${toolId}/v1`,
    tool: toolId,
  };
  return { ...spec, args };
}

function parsePositiveInteger(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return parsed;
}

function parseYear(value: string): number {
  if (!/^\d{4}$/.test(value)) {
    throw new InvalidArgumentError('must be a four-digit year');
  }
  const parsed = Number(value);
  if (parsed < 1993 || parsed > 2030) {
    throw new InvalidArgumentError('must be between 1993 and 2030');
  }
  return parsed;
}

class ToolHandler extends BaseCommand {
  async run(
    toolId: string,
    args: Record<string, unknown>,
    apiCall: (client: FintermAPIClient) => Promise<unknown>,
    outputOptions: ApiOutputOptions = {}
  ): Promise<void> {
    const client = await getAuthenticatedClient(this.requestLogger());
    const fallback = buildToolFallbackMeta(toolId, args);

    const wireResult = await this.execute(
      () => apiCallToFintermWireResult(() => apiCall(client), fallback),
      `Failed to execute tool: ${toolId}`
    );

    this.output.data(wireResult, () => {
      console.log(
        renderFintermWireResult(wireResult, getRequestedApiOutputFormat(this.ctx, outputOptions))
      );
    });
    markFintermWireErrorExitCode(wireResult);
  }
}

// =============================================================================
// Tool Subcommands
// =============================================================================

const financialStatementsCommand = new Command('financial_statements')
  .description('Get financial statements (balance sheet, income, cash flow)')
  .argument('<ticker>', 'Stock ticker (e.g., AAPL)')
  .addOption(
    new Option('--statement-type <type>', 'Statement type')
      .choices(['balance_sheet', 'income_statement', 'cash_flow'])
      .makeOptionMandatory()
  )
  .requiredOption('--as-of-date <date>', 'Filing/resource as-of date (YYYY-MM-DD)')
  .addOption(
    new Option('--timeframe <timeframe>', 'Timeframe')
      .choices(['quarterly', 'annual', 'trailing_twelve_months'])
      .default('annual')
  )
  .option('--limit <number>', 'Number of periods to return', parsePositiveInteger, 4)
  .action(
    async (
      ticker: string,
      options: {
        statementType: 'balance_sheet' | 'income_statement' | 'cash_flow';
        asOfDate: string;
        timeframe?: 'quarterly' | 'annual' | 'trailing_twelve_months';
        limit?: number;
      } & ApiOutputOptions,
      command: Command
    ) => {
      const limit = options.limit;
      const handler = new ToolHandler(command);
      await handler.run(
        'financial_statements',
        {
          ticker,
          statement_type: options.statementType,
          as_of_date: options.asOfDate,
          timeframe: options.timeframe,
          limit,
        },
        (client) =>
          client.financialStatements({
            ticker,
            statementType: options.statementType,
            asOfDate: options.asOfDate,
            timeframe: options.timeframe!,
            limit,
          }),
        options
      );
    }
  );

const optionsSentimentCommand = new Command('options_sentiment')
  .description('Get options sentiment analysis')
  .argument('<ticker>', 'Underlying stock ticker (e.g., AAPL)')
  .requiredOption('--as-of-date <date>', 'Date for analysis (YYYY-MM-DD)')
  .option('--include-spread-analysis', 'Include spread analysis', false)
  .option('--expiration-filter <filter>', 'Filter by expiration window')
  .option('--max-contracts <number>', 'Maximum contracts to analyze', parsePositiveInteger, 50)
  .action(
    async (
      ticker: string,
      options: {
        asOfDate: string;
        includeSpreadAnalysis: boolean;
        expirationFilter?: string;
        maxContracts?: number;
      } & ApiOutputOptions,
      command: Command
    ) => {
      const maxContracts = options.maxContracts;
      const handler = new ToolHandler(command);
      await handler.run(
        'options_sentiment',
        {
          underlying_ticker: ticker,
          as_of_date: options.asOfDate,
          include_spread_analysis: options.includeSpreadAnalysis,
          expiration_filter: options.expirationFilter,
          max_contracts: maxContracts,
        },
        (client) =>
          client.optionsSentiment({
            underlyingTicker: ticker,
            date: options.asOfDate,
            includeSpreadAnalysis: options.includeSpreadAnalysis,
            expirationFilter: options.expirationFilter,
            maxContracts,
          }),
        options
      );
    }
  );

// -- SEC Filings --

const filingsSearchCommand = new Command('sec_filings_search')
  .description('Search SEC EDGAR filings (10-K, 10-Q)')
  .argument('<ticker>', 'Stock ticker (e.g., AAPL)')
  .addOption(
    new Option('--form-type <type>', 'Filter by form type')
      .choices(['10-K', '10-Q', 'all'])
      .default('all')
  )
  .option('--as-of-date <date>', 'Only filings after this date (YYYY-MM-DD)')
  .option('--limit <number>', 'Maximum filings to return', parsePositiveInteger, 10)
  .action(
    async (
      ticker: string,
      options: { formType?: string; asOfDate?: string; limit?: number } & ApiOutputOptions,
      command: Command
    ) => {
      const limit = options.limit;
      const handler = new ToolHandler(command);
      await handler.run(
        'sec_filings_search',
        { ticker, form_type: options.formType, as_of_date: options.asOfDate, limit },
        (client) =>
          client.secFilingsSearch({
            ticker,
            formType: options.formType,
            from_date: options.asOfDate,
            limit,
          }),
        options
      );
    }
  );

const filingsFetchCommand = new Command('sec_filing_fetch')
  .description('Fetch and parse SEC filing content')
  .argument('<ticker>', 'Stock ticker (e.g., AAPL)')
  .requiredOption('--year <year>', 'Fiscal year (e.g., 2024)', parseYear)
  .addOption(
    new Option('--period <period>', 'Fiscal period')
      .choices(['FY', 'Q1', 'Q2', 'Q3', 'Q4'])
      .makeOptionMandatory()
  )
  .option(
    '--sections <sections>',
    'Comma-separated section names (e.g., risk_factors,business)',
    'risk_factors'
  )
  .addOption(
    new Option('--format <format>', 'Output format')
      .choices(['text', 'json', 'yaml'])
      .default('text')
  )
  .action(
    async (
      ticker: string,
      options: { year: number; period: string; sections?: string; format?: string },
      command: Command
    ) => {
      const year = options.year;
      const handler = new ToolHandler(command);
      await handler.run(
        'sec_filing_fetch',
        {
          ticker,
          year,
          period: options.period,
          sections: options.sections,
          format: options.format,
        },
        (client) =>
          client.secFilingFetch({
            ticker,
            year,
            period: options.period,
            sections: options.sections!,
            format: options.format,
          }),
        options
      );
    }
  );

type FilingPeriod = 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4';

function parseFilingRef(value: string): { year: number; period: FilingPeriod } {
  const [yearStr, periodRaw] = value.split(':');
  const year = parseYear(yearStr ?? '');
  const period = (periodRaw ?? 'FY').toUpperCase();
  const validPeriods = ['FY', 'Q1', 'Q2', 'Q3', 'Q4'];
  if (!Number.isFinite(year) || !validPeriods.includes(period)) {
    throw new Error(
      `Invalid filing reference "${value}". Expected YEAR:PERIOD, e.g. "2024:FY" or "2024:Q3".`
    );
  }
  if (year < 1993 || year > 2030) {
    throw new Error(
      `Invalid filing year "${year}" in "${value}". Year must be between 1993 and 2030.`
    );
  }
  return { year, period: period as FilingPeriod };
}

const filingsDiffCommand = new Command('sec_filing_diff')
  .description('Diff two SEC 10-K/10-Q filings')
  .argument('<ticker>', 'Stock ticker (e.g., AAPL)')
  .requiredOption('--base <year:period>', 'Earlier filing as YEAR:PERIOD (e.g., 2023:FY)')
  .requiredOption('--compare <year:period>', 'Later filing as YEAR:PERIOD (e.g., 2024:FY)')
  .option(
    '--sections <sections>',
    'Comma-separated section names (e.g., risk_factors,mda)',
    'risk_factors,mda,business,legal'
  )
  .addOption(
    new Option('--mode <mode>', 'Output mode').choices(['diff', 'raw', 'summary']).default('diff')
  )
  .option('--no-qa', 'Skip the QA fidelity review')
  .action(
    async (
      ticker: string,
      options: {
        base: string;
        compare: string;
        sections?: string;
        mode?: string;
        qa: boolean | null;
      } & ApiOutputOptions,
      command: Command
    ) => {
      const base = parseFilingRef(options.base);
      const compare = parseFilingRef(options.compare);
      const handler = new ToolHandler(command);
      await handler.run(
        'sec_filing_diff',
        {
          ticker,
          base,
          compare,
          sections: options.sections,
          mode: options.mode,
          qa: options.qa ?? null,
        },
        (client) =>
          client.secFilingDiff({
            ticker,
            base,
            compare,
            sections: options.sections,
            mode: options.mode,
            qa: options.qa ?? null,
          }),
        options
      );
    }
  );

// -- Ownership --

const insiderTradesCommand = new Command('insider_trades')
  .description('Get SEC Form 4 insider transactions and holdings')
  .argument('<ticker>', 'Stock ticker (e.g., AAPL)')
  .option('--as-of-date <date>', 'As-of filing date (YYYY-MM-DD)')
  .option('--limit <number>', 'Maximum rows to return', parsePositiveInteger)
  .option('--transaction-codes <codes>', 'Comma-separated Form 4 codes (P,S,A,M,F,G,C,W)')
  .option('--include-derivatives', 'Include derivative-security rows', false)
  .option('--include-holdings', 'Include ownership-statement rows', false)
  .action(
    async (
      ticker: string,
      options: {
        asOfDate?: string;
        limit?: number;
        transactionCodes?: string;
        includeDerivatives: boolean;
        includeHoldings: boolean;
      } & ApiOutputOptions,
      command: Command
    ) => {
      const limit = options.limit;
      const transactionCodes = options.transactionCodes
        ? (options.transactionCodes
            .split(',')
            .map((code) => code.trim())
            .filter(Boolean) as ('P' | 'S' | 'A' | 'M' | 'F' | 'G' | 'C' | 'W')[])
        : undefined;
      const handler = new ToolHandler(command);
      await handler.run(
        'insider_trades',
        {
          ticker,
          as_of_date: options.asOfDate,
          limit,
          transaction_codes: transactionCodes,
          include_derivatives: options.includeDerivatives,
          include_holdings: options.includeHoldings,
        },
        (client) =>
          client.insiderTrades({
            ticker,
            asOfDate: options.asOfDate,
            limit,
            transactionCodes,
            includeDerivatives: options.includeDerivatives,
            includeHoldings: options.includeHoldings,
          }),
        options
      );
    }
  );

const institutionalHoldingsCommand = new Command('institutional_holdings')
  .description('Get institutional 13F holdings by ticker or investor CIK')
  .argument('[ticker]', 'Stock ticker (e.g., AAPL); omit when using --investor-cik')
  .option('--investor-cik <cik>', 'Investor portfolio mode: SEC CIK')
  .option('--as-of-date <date>', 'As-of filing date (YYYY-MM-DD)')
  .option('--limit <number>', 'Maximum rows to return', parsePositiveInteger)
  .action(
    async (
      ticker: string | undefined,
      options: { investorCik?: string; asOfDate?: string; limit?: number } & ApiOutputOptions,
      command: Command
    ) => {
      const limit = options.limit;
      const handler = new ToolHandler(command);
      await handler.run(
        'institutional_holdings',
        {
          ticker,
          investor_cik: options.investorCik,
          as_of_date: options.asOfDate,
          limit,
        },
        (client) =>
          client.institutionalHoldings({
            ticker,
            investorCik: options.investorCik,
            asOfDate: options.asOfDate,
            limit,
          }),
        options
      );
    }
  );

// -- Sentiment --

const optionsOverviewCommand = new Command('options_overview')
  .description('Get an options-market overview (IV, put/call, open interest)')
  .argument('<ticker>', 'Stock ticker (e.g., TSLA)')
  .option('--as-of-date <date>', "As-of date: 'today' (default) or YYYY-MM-DD (live data only)")
  .action(
    async (ticker: string, options: { asOfDate?: string } & ApiOutputOptions, command: Command) => {
      const handler = new ToolHandler(command);
      await handler.run(
        'options_overview',
        { ticker, as_of_date: options.asOfDate },
        (client) => client.optionsOverview({ ticker, asOfDate: options.asOfDate }),
        options
      );
    }
  );

const tickerSentimentCommand = new Command('ticker_sentiment')
  .description('Get aggregated news and social sentiment for a ticker')
  .argument('<ticker>', 'Stock ticker (e.g., AAPL)')
  .option('--as-of-date <date>', "As-of date: 'today' (default) or YYYY-MM-DD (live data only)")
  .action(
    async (ticker: string, options: { asOfDate?: string } & ApiOutputOptions, command: Command) => {
      const handler = new ToolHandler(command);
      await handler.run(
        'ticker_sentiment',
        { ticker, as_of_date: options.asOfDate },
        (client) => client.tickerSentiment({ ticker, asOfDate: options.asOfDate }),
        options
      );
    }
  );

const ALL_TOOL_COMMANDS = [
  financialStatementsCommand,
  optionsSentimentCommand,
  // SEC Filings
  filingsSearchCommand,
  filingsFetchCommand,
  filingsDiffCommand,
  // Ownership
  insiderTradesCommand,
  institutionalHoldingsCommand,
  // Sentiment
  optionsOverviewCommand,
  tickerSentimentCommand,
] as const;

export interface CreateToolCommandOptions {
  experimental: boolean | null;
}

export function createToolCommand(
  options: CreateToolCommandOptions = { experimental: null }
): Command {
  const visibleToolIds = new Set(visibleFintermToolIds({ experimental: options.experimental }));
  const command = new Command('tool').description(
    'Secondary point financial data tools for follow-up lookups'
  );

  for (const toolSubcommand of ALL_TOOL_COMMANDS) {
    if (!visibleToolIds.has(toolSubcommand.name() as FintermToolId)) {
      continue;
    }
    command.addCommand(toolSubcommand);
  }

  for (const subcommand of command.commands) {
    if (!subcommand.options.some((option) => option.attributeName() === 'format')) {
      subcommand.addOption(createApiOutputFormatOption());
    }
  }

  validateRegisteredToolCommands(command, visibleToolIds);
  return command;
}

function validateRegisteredToolCommands(
  command: Command,
  expectedToolIds: ReadonlySet<string>
): void {
  const registeredNames = new Set(command.commands.map((cmd) => cmd.name()));
  for (const id of expectedToolIds) {
    if (!registeredNames.has(id)) {
      throw new Error(
        `Finterm tool subcommand missing for FINTERM_TOOL_IDS entry: ${id}. ` +
          'Add a subcommand in tool.ts or remove it from src/api/toolIds.ts.'
      );
    }
  }
  for (const name of registeredNames) {
    if (!(FINTERM_TOOL_IDS as readonly string[]).includes(name)) {
      throw new Error(
        `Finterm tool subcommand "${name}" not in FINTERM_TOOL_IDS. ` +
          'Add it to src/api/toolIds.ts or remove the subcommand.'
      );
    }
  }
}
