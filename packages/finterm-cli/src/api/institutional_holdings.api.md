---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: institutional_holdings
  title: Institutional Holdings
  summary: SEC Form 13F institutional holders for a stock or the portfolio of one
    manager.
  publication_state: published
  schema: finterm.result:InstitutionalHoldings/v1
  fields:
    - name: ticker
      type: string
      description: Ticker requested in holder mode; omitted in investor portfolio mode.
    - name: investor_cik
      type: string
      description: SEC CIK requested in investor portfolio mode; omitted in ticker
        holder mode.
    - name: as_of_date
      type: string
      description: The as-of filing date used for the result, in YYYY-MM-DD format.
    - name: latest_period
      type: string | null
      description: Newest period_of_report represented by the returned rows, or null
        when empty.
    - name: holders
      type: '(object{filer_name: string; filer_cik: string; period_of_report: string;
        filed_at: string; form_type: string; accession_number: string;
        name_of_issuer: string; cusip: string; ticker: string | null;
        title_of_class: string; put_call: "put" | "call" | null; shares: number;
        shares_type: string; value_usd: number; investment_discretion: string |
        null; voting_authority_sole: number | null; voting_authority_shared:
        number | null; voting_authority_none: number | null; is_stale: boolean;
        filing_url: string | null})[]'
      description: "Ticker mode rows: institutional managers holding the requested
        security, ranked by value within the scanned filing window."
    - name: positions
      type: '(object{filer_name: string; filer_cik: string; period_of_report: string;
        filed_at: string; form_type: string; accession_number: string;
        name_of_issuer: string; cusip: string; ticker: string | null;
        title_of_class: string; put_call: "put" | "call" | null; shares: number;
        shares_type: string; value_usd: number; investment_discretion: string |
        null; voting_authority_sole: number | null; voting_authority_shared:
        number | null; voting_authority_none: number | null; is_stale: boolean;
        filing_url: string | null})[]'
      description: "Investor mode rows: positions from the requested manager latest
        filing, ranked by value."
    - name: scanned_filings
      type: number
      description: Ticker mode count of filing-shaped hits scanned to build the holder rows.
    - name: scanned_filed_range
      type: "object{earliest: string; latest: string}"
      description: Ticker mode filed-at date range covered by scanned filings.
    - name: truncated
      type: boolean
      description: True when a page or row cap stopped collection before all matching rows.
  examples:
    - comment: Institutional holders of one symbol.
      command: finterm tool institutional_holdings AAPL --as-of-date 2024-03-15
---
# Institutional Holdings

Get institutional ownership from SEC Form 13F filings in either of two modes.
In ticker mode, pass a symbol to list the institutional managers that hold that
security, ranked by reported value across the scanned filing window.
In investor mode, pass a manager’s SEC CIK to list the positions in that manager’s
latest filing, ranked by value.
Each row carries the filer, the period and filing dates, the security and its CUSIP,
shares and reported value, voting authority, and whether the row is from a stale
(superseded) filing.
