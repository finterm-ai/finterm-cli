export const PUBLICATION_STATES = ['unpublished', 'preview', 'published'] as const;

export type PublicationState = (typeof PUBLICATION_STATES)[number];

/**
 * Public point-tool IDs shipped in this CLI package.
 *
 * Source boundary: this list is local to the public package and is drift-checked
 * against committed `.api.md` files. Unpublished tools must not be listed here.
 */
export const FINTERM_TOOL_IDS = [
  'financial_statements',
  'options_sentiment',
  'options_overview',
  'ticker_sentiment',
  'sec_filings_search',
  'sec_filing_fetch',
  'sec_filing_diff',
  'insider_trades',
  'institutional_holdings',
] as const;

export type FintermToolId = (typeof FINTERM_TOOL_IDS)[number];

export const FINTERM_TOOL_PUBLICATION_STATES: Record<
  FintermToolId,
  Exclude<PublicationState, 'unpublished'>
> = {
  financial_statements: 'published',
  options_sentiment: 'published',
  options_overview: 'published',
  ticker_sentiment: 'published',
  sec_filings_search: 'published',
  sec_filing_fetch: 'published',
  sec_filing_diff: 'published',
  insider_trades: 'published',
  institutional_holdings: 'published',
};

export interface PublishedToolRegistryOptions {
  experimental: boolean | null;
}

export function visibleFintermToolIds(
  options: PublishedToolRegistryOptions = { experimental: null }
): FintermToolId[] {
  return FINTERM_TOOL_IDS.filter((id) => {
    const state = FINTERM_TOOL_PUBLICATION_STATES[id];
    return state === 'published' || (state === 'preview' && options.experimental === true);
  });
}
