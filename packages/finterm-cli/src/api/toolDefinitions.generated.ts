/**
 * GENERATED - do not edit. Source of truth:
 *   packages/finterm-cli/src/api/<tool>.api.md (definition.title / .summary)
 *
 * Canonical tool titles and summaries mirrored from the committed `.api.md`
 * definitions so CLI help and generated docs read one description per tool.
 */

export interface FintermToolDefinition {
  readonly title: string;
  readonly summary: string;
}

export const FINTERM_TOOL_DEFINITIONS: Record<string, FintermToolDefinition> = {
  financial_statements: {
    title: 'Financial Statements',
    summary: 'Reported balance sheet, income statement, or cash flow for a company.',
  },
  insider_trades: {
    title: 'Insider Trades',
    summary: 'SEC Form 4 insider transactions with a trailing 90-day open-market summary.',
  },
  institutional_holdings: {
    title: 'Institutional Holdings',
    summary: 'SEC Form 13F institutional holders for a stock or the portfolio of one manager.',
  },
  options_overview: {
    title: 'Options Overview',
    summary:
      "A live one-call options overview: implied vs realized volatility with rank, today's flow, the positioning book, expected moves, and probability bands.",
  },
  options_sentiment: {
    title: 'Options Sentiment',
    summary:
      'Put/call options sentiment for a symbol on a specific date, with a sample-quality verdict.',
  },
  sec_filing_diff: {
    title: 'SEC Filing Diff',
    summary: 'Compare two of a company’s SEC filings and report section-level changes.',
  },
  sec_filing_fetch: {
    title: 'SEC Filing Fetch',
    summary: 'Fetch narrative sections from a company’s SEC filing by fiscal year and period.',
  },
  sec_filings_search: {
    title: 'SEC Filings Search',
    summary: 'Search SEC EDGAR filings for a company by ticker and form type.',
  },
  ticker_sentiment: {
    title: 'Ticker Sentiment',
    summary:
      "A live 0-100 sentiment composite for a ticker: seven components scored vs the ticker's own year, grouped trend / flow / positioning.",
  },
};
