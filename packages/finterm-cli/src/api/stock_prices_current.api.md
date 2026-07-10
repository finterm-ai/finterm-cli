---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: stock_prices_current
  title: Current Stock Prices
  summary: Latest available price for one or more stock symbols, delayed by up to
    15 minutes.
  publication_state: published
  schema: finterm.result:StockPricesCurrent/v1
  fields:
    - name: ticker
      type: string
      description: The stock ticker symbol, uppercased (e.g. "AAPL").
    - name: price
      type: number
      description: The latest available price for the symbol, in USD. Delayed by up to
        15 minutes depending on provider plan and exchange entitlements.
  examples:
    - comment: Current prices for two symbols.
      command: finterm tool stock_prices_current NVDA AAPL
---
# Current Stock Prices

Get the latest available price for one or more stock symbols in a single call.
Prices are the latest available from Finterm’s market-data provider.
They are delayed by up to 15 minutes depending on provider plan and exchange
entitlements.
Returns one price per requested symbol; historical dates are not supported.
