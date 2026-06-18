---
title: Daily Market Scan
description: Quick public-tool scan for a symbol or index ETF
category: research
tags:
  - market
  - daily
  - overview
---
# Daily Market Scan

Build a concise market read from the published point tools.

## Steps

### 1. Check Sentiment

```bash
finterm tool ticker_sentiment SPY
```

Summarize the composite score, band, coverage, and stated caveats.

### 2. Review Options Context

```bash
finterm tool options_overview SPY
finterm tool options_sentiment SPY --as-of-date 2024-01-15
```

Compare volatility, flow, positioning, and put/call sentiment.

### 3. Check Filing Catalysts

```bash
finterm tool sec_filings_search META --form-type 8-K --as-of-date 2024-12-31
```

Look for recent filing events that may affect the name.

### 4. Add Ownership Context

```bash
finterm tool institutional_holdings META --as-of-date 2024-03-15
finterm tool insider_trades META --as-of-date 2024-03-15
```

Note large holders, ownership changes, and recent insider activity.

## Output

Provide a brief summary:

1. **Market Tone:** Sentiment score, band, and main driver
2. **Options Context:** Volatility, flow, and positioning
3. **Filing Catalysts:** Recent material filings to inspect
4. **Ownership Context:** Holder and insider signals
5. **Caveats:** Missing or thin data called out by the tool output

## Quick Version

For a rapid assessment, run:

```bash
finterm tool ticker_sentiment SPY && finterm tool options_overview SPY
```
