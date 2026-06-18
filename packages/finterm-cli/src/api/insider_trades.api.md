---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: insider_trades
  title: Insider Trades
  summary: SEC Form 4 insider transactions with a trailing 90-day open-market summary.
  publication_state: published
  schema: finterm.result:InsiderTrades/v1
  fields:
    - name: ticker
      type: string
      description: The stock ticker symbol, uppercased (e.g. "AAPL").
    - name: as_of_date
      type: string
      description: The as-of filing date used for the result, in YYYY-MM-DD format.
    - name: trades
      type: '(object{ticker: string; issuer: string; name: string; title: string |
        null; is_board_director: boolean; is_officer: boolean;
        is_ten_percent_owner: boolean; record_type: "transaction" | "holding";
        transaction_date: string | null; filing_date: string; transaction_code:
        string | null; transaction_type: string | null; acquired_disposed: "A" |
        "D" | null; transaction_shares: number | null;
        transaction_price_per_share: number | null; transaction_value: number |
        null; shares_owned_after_transaction: number | null; direct_or_indirect:
        "D" | "I" | null; nature_of_ownership: string | null; security_title:
        string; security_type: "non_derivative" | "derivative"; is_10b5_1_plan:
        boolean; filing_url: string})[]'
      description: Normalized SEC Form 4 transaction and holding rows, including owner
        role flags, transaction code, shares, price, value, post-transaction
        ownership, and filing URL.
    - name: summary
      type: "object{open_market_net_value_90d: number; buy_count_90d: number;
        sell_count_90d: number; window_complete: boolean}"
      description: "Trailing 90-day open-market purchase/sale summary: net value, buy
        count, sell count, and whether the window was fully scanned."
    - name: truncated
      type: boolean
      description: True when more matching rows existed than were returned.
  examples:
    - comment: Recent insider transactions for one symbol.
      command: finterm tool insider_trades AAPL --as-of-date 2024-03-15
---
# Insider Trades

Get insider transactions and holdings filed with the SEC by a company’s officers,
directors, and 10% owners, normalized into one row per reported security event.
Each row carries the owner’s role flags, the transaction code and type, shares, price,
value, post-transaction ownership, whether it was part of a pre-arranged trading plan,
and the source filing URL. A summary block reports the trailing 90-day open-market net
value with buy and sell counts, and whether that window was fully scanned.
Pass a date to get the view as of a specific filing date.
