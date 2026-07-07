---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: stock_prices_current
  title: Current Stock Prices
  summary: Latest trade price for one or more stock symbols.
  publication_state: published
  schema: finterm.result:StockPricesCurrent/v1
  fields:
    - name: ticker
      type: string
      description: The stock ticker symbol, uppercased (e.g. "AAPL").
    - name: price
      type: number
      description: The latest trade price for the symbol, in USD.
  examples:
    - comment: Current prices for two symbols.
      command: finterm tool stock_prices_current NVDA AAPL
---
# Current Stock Prices

Get the latest trade price for one or more stock symbols in a single call.
Returns one price per requested symbol; historical dates are not supported.
