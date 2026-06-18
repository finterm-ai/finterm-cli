---
title: Pre-Earnings Research Workflow
description: Pre-earnings analysis using published Finterm point tools
category: research
tags:
  - earnings
  - research
  - analysis
---
# Pre-Earnings Research Workflow

Prepare a concise pre-earnings view for one ticker.

## Steps

### 1. Review SEC Filings

```bash
finterm tool sec_filings_search <TICKER> --form-type 10-Q --as-of-date 2024-12-31
finterm tool sec_filings_search <TICKER> --form-type 8-K --as-of-date 2024-12-31
finterm tool sec_filing_fetch <TICKER> --year 2024 --period Q3 --sections mda,risk_factors
```

Look for recent operating commentary, risks, and material events.

### 2. Check Financial Statements

```bash
finterm tool financial_statements <TICKER> --statement-type income_statement --timeframe quarterly --as-of-date 2024-12-01
finterm tool financial_statements <TICKER> --statement-type cash_flow --timeframe quarterly --as-of-date 2024-12-01
```

Compare revenue, margins, cash generation, and share count trends.

### 3. Read Sentiment and Options

```bash
finterm tool ticker_sentiment <TICKER>
finterm tool options_overview <TICKER>
finterm tool options_sentiment <TICKER> --as-of-date 2024-01-15
```

Use tool-provided caveats when sentiment or options samples are thin.

### 4. Add Ownership Signals

```bash
finterm tool insider_trades <TICKER> --as-of-date 2024-03-15
finterm tool institutional_holdings <TICKER> --as-of-date 2024-03-15
```

Summarize insider activity and institutional positioning.

### 5. Synthesize

Combine the data into a short view:

1. **Current State:** Financial statement trend and sentiment
2. **Filing Focus:** Sections or filings that matter most
3. **Options Setup:** Expected move, volatility, and flow
4. **Ownership Signals:** Insider and institutional context
5. **Risks:** Caveats, thin data, or unresolved questions
