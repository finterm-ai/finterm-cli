---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: technical_indicators
  title: Technical Indicators
  summary: Standard momentum and trend indicators (RSI, MACD, SMA) for a symbol.
  publication_state: published
  schema: finterm.result:TechnicalIndicators/v1
  fields:
    - name: ticker
      type: string
      description: The stock ticker symbol, uppercased (e.g. "AAPL").
    - name: rsi_14
      type: number
      description: 14-period Relative Strength Index. The conventional above-70
        overbought and below-30 oversold labels are fixed heuristics, not
        reversal forecasts.
    - name: macd_value
      type: number
      description: MACD line value (12/26/9 configuration).
    - name: macd_signal
      type: number
      description: MACD signal line value.
    - name: macd_histogram
      type: number
      description: MACD histogram (MACD line minus signal line).
    - name: sma_20
      type: number
      description: 20-period simple moving average of the closing price.
    - name: sma_50
      type: number
      description: 50-period simple moving average of the closing price.
  examples:
    - comment: Default indicator set for one symbol.
      command: finterm tool technical_indicators AAPL --as-of-date 2024-01-16
---
# Technical Indicators

Calculate standard momentum and trend indicators.
Returns RSI(14) with conventional above-70 overbought and below-30 oversold heuristic
labels; those labels are not reversal forecasts.
Also returns MACD for momentum and the 20- and 50-period simple moving averages for
trend direction.
