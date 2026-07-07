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
      description: 14-period Relative Strength Index. Above 70 = overbought, below 30
        = oversold.
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

Identify overbought/oversold conditions, momentum, and trend direction using standard
technical analysis.
Returns RSI(14) for overbought (>70) and oversold (<30) signals, MACD
for momentum, and the 20- and 50-period simple moving averages for trend direction.
