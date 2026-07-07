---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: ticker_data
  title: Ticker Data
  summary: "The full ticker snapshot: earnings, guidance, the price reaction
    window, ratios, options sentiment, short pressure, technicals, financial
    statements, and pre-earnings market context — in one call."
  publication_state: published
  schema: finterm.result:TickerDataBundle/v1
  fields:
    - name: ticker
      type: string
      description: The stock ticker symbol, uppercased (e.g. "AAPL").
    - name: earnings_date
      type: string
      description: The reported earnings date this snapshot is anchored on, in
        YYYY-MM-DD format.
    - name: earnings
      type: "object{eps_actual: number | null; eps_estimate: number | null;
        eps_surprise_pct: number | null; revenue_actual: number | null;
        revenue_estimate: number | null; revenue_surprise_pct: number | null;
        fiscal_quarter: string | null; reported_at: string | null} | null"
      description: "The reported quarter’s earnings: eps_actual, eps_estimate,
        eps_surprise_pct, revenue_actual, revenue_estimate,
        revenue_surprise_pct, fiscal_quarter, and reported_at. A figure is null
        when not reported. Null when the section produced no data."
    - name: guidance
      type: "object{fiscal_period: string; guidance_date: string; revenue_min: number
        | null; revenue_max: number | null; revenue_mid: number | null;
        revenue_prev_min: number | null; revenue_prev_max: number | null;
        revenue_method: string | null; guidance_revised: boolean | null;
        eps_min: number | null; eps_max: number | null; eps_mid: number | null}
        | null"
      description: "Forward guidance for the fiscal period being analyzed: the
        fiscal_period, guidance_date, revenue range (revenue_min, revenue_max,
        revenue_mid, plus the prior revenue_prev_min / revenue_prev_max and the
        revenue_method), the eps range (eps_min, eps_max, eps_mid), and
        guidance_revised (whether the range changed from the prior guide). Note:
        revenue_mid is analyst consensus, which can fall outside the company
        range. Null when no guidance was found."
    - name: prices
      type: "object{t_minus_1: object{date: string; close: number} | null; t0:
        object{date: string; close: number} | null; t_plus_1: object{date:
        string; close: number} | null; t_plus_5: object{date: string; close:
        number} | null} | null"
      description: "Event-study price window around the earnings close: t_minus_1 (the
        prior trading day), t0 (the event close), t_plus_1, and t_plus_5. Each
        is { date, close } in USD, or null when that day is not yet available.
        Null when no prices were resolved."
    - name: ratios
      type: "object{gross_margin_pct: number | null; operating_margin_pct: number |
        null; net_margin_pct: number | null; return_on_equity_pct: number |
        null; revenue_growth_yoy_pct: number | null; pe_ratio: number | null} |
        null"
      description: "Trailing-twelve-month ratios: gross_margin_pct,
        operating_margin_pct, net_margin_pct, return_on_equity_pct,
        revenue_growth_yoy_pct, and pe_ratio. A value is null when not
        computable. Null when the section produced no data."
    - name: options
      type: 'object{put_call_volume_ratio: number | null; interpretation: "bullish" |
        "neutral" | "bearish" | null; total_call_volume: number | null;
        total_put_volume: number | null; avg_spread_percent: number | null;
        liquidity_grade: "A" | "B" | "C" | "D" | null; contracts_with_volume:
        number | null; expirations: string[] | null; data_quality:
        object{status: "ok" | "no_data" | "thin_sample"; contracts_analyzed:
        number; contracts_with_volume: number; total_volume: number} | null} |
        null'
      description: 'Options-market sentiment: put_call_volume_ratio and its
        interpretation (below 0.7 = bullish, 0.7–1.0 = neutral, above 1.0 =
        bearish), total_call_volume, total_put_volume, avg_spread_percent,
        liquidity_grade (A best to D worst), contracts_with_volume, the list of
        expirations covered, and a data_quality verdict (status "ok" / "no_data"
        / "thin_sample" with the contract and volume counts) so a thin reading
        is never mistaken for a confident one. Null when the section produced no
        data.'
    - name: short
      type: "object{shares_short: number | null; short_float_pct: number | null;
        days_to_cover: number | null; interest_as_of_date: string | null;
        avg_short_volume_ratio_pct: number | null; max_short_volume_ratio_pct:
        number | null; days_above_40_pct: number | null} | null"
      description: "Short pressure: shares_short, short_float_pct, days_to_cover, and
        interest_as_of_date from the latest short-interest reading, plus
        avg_short_volume_ratio_pct, max_short_volume_ratio_pct, and
        days_above_40_pct from the recent short-volume window. A value is null
        when unavailable. Null when the section produced no data."
    - name: technical_indicators
      type: "object{rsi_14: number | null; macd_value: number | null; macd_signal:
        number | null; macd_histogram: number | null; sma_20: number | null;
        sma_50: number | null} | null"
      description: "The default indicator set: rsi_14 (above 70 overbought, below 30
        oversold), macd_value, macd_signal, macd_histogram (12/26/9
        configuration), sma_20, and sma_50. A value is null when not computable.
        Null when the section produced no data."
    - name: financial_statements
      type: "object{as_of_period_end: string | null; lite?: object{revenue: number |
        null; gross_profit: number | null; operating_income: number | null;
        net_income: number | null; eps: number | null; eps_diluted: number |
        null; cash_from_operations: number | null; free_cash_flow: number |
        null; total_debt: number | null; cash_and_equivalents: number | null;
        total_equity: number | null}; verbose?: object{income_statement:
        object{ticker: string; fiscal_year: number; fiscal_quarter: number |
        null; period_end: string; filing_date: string; timeframe: string;
        total_revenue: number | null; cost_of_revenue: number | null;
        gross_profit: number | null; operating_expenses: number | null;
        operating_income: number | null; research_and_development: number |
        null; selling_general_admin: number | null; interest_expense: number |
        null; interest_income: number | null; other_income: number | null;
        income_before_tax: number | null; income_tax: number | null; net_income:
        number | null; earnings_per_share: number | null;
        earnings_per_share_diluted: number | null; shares_outstanding: number |
        null; shares_outstanding_diluted: number | null} | null; balance_sheet:
        object{ticker: string; fiscal_year: number; fiscal_quarter: number |
        null; period_end: string; filing_date: string; timeframe: string;
        total_assets: number | null; total_current_assets: number | null;
        cash_and_equivalents: number | null; short_term_investments: number |
        null; accounts_receivable: number | null; inventory: number | null;
        total_non_current_assets: number | null; property_plant_equipment:
        number | null; goodwill: number | null; intangible_assets: number |
        null; total_liabilities: number | null; total_current_liabilities:
        number | null; accounts_payable: number | null; short_term_debt: number
        | null; total_non_current_liabilities: number | null; long_term_debt:
        number | null; total_equity: number | null; retained_earnings: number |
        null; common_stock: number | null} | null; cash_flow: object{ticker:
        string; fiscal_year: number; fiscal_quarter: number | null; period_end:
        string; filing_date: string; timeframe: string; net_cash_from_operating:
        number | null; depreciation_amortization: number | null;
        stock_based_compensation: number | null; change_in_working_capital:
        number | null; net_cash_from_investing: number | null;
        capital_expenditures: number | null; acquisitions: number | null;
        investment_purchases: number | null; investment_sales: number | null;
        net_cash_from_financing: number | null; dividends_paid: number | null;
        share_repurchases: number | null; debt_issuance: number | null;
        debt_repayment: number | null; net_change_in_cash: number | null;
        free_cash_flow: number | null} | null}} | null"
      description: Reported financials as of as_of_period_end. By default a "lite"
        key-metric snapshot (revenue, gross_profit, operating_income,
        net_income, eps, eps_diluted, cash_from_operations, free_cash_flow,
        total_debt, cash_and_equivalents, total_equity); on request a "verbose"
        block with the full income_statement, balance_sheet, and cash_flow
        records. Null when no statements were found.
    - name: pre_earnings_context
      type: "object{run_10d_pct: number | null; run_30d_pct: number | null;
        run_90d_pct: number | null; percentile_52w: number | null;
        vix_proxy_close: number | null; vix_percentile: number | null;
        sp500_vs_200dma_pct: number | null; stock_bars_count: number;
        vix_bars_count: number; spy_bars_count: number} | null"
      description: "Market context heading into the event: run_10d_pct, run_30d_pct,
        run_90d_pct (the stock’s run-up over those windows), percentile_52w
        (where the price sits in its 52-week range), vix_proxy_close and
        vix_percentile (a volatility proxy and its percentile),
        sp500_vs_200dma_pct (the index versus its 200-day average), and the bar
        counts behind each series (stock_bars_count, vix_bars_count,
        spy_bars_count). A value is null when not computable. Null when the
        section produced no data."
  examples:
    - comment: The full data bundle for one ticker.
      command: finterm bundle run ticker_data AAPL
    - comment: Include the full reported financial statements.
      command: finterm bundle run ticker_data AAPL --param verbose_statements=true
---
# Ticker Data

Get the complete data snapshot for a ticker in a single bundle run.
ticker_data composes finterm’s individual data tools into one bundle anchored on a
company’s most recent earnings event, so you can read the whole picture without
stitching ten separate requests together.
Each section is self-contained and is present only when it has data; a section that
produced nothing comes back as null.

The bundle returns:

- **earnings** — the reported quarter’s actuals, estimates, and surprise for both EPS
  and revenue, with the fiscal quarter.
- **guidance** — forward guidance for the period being analyzed: the revenue and EPS
  ranges (min / max / mid, plus the prior range and whether the guide was revised).
- **prices** — the event-study price window around the earnings close: the prior trading
  day, the event close, and the closes one and five trading days later.
- **ratios** — trailing-twelve-month margins, return on equity, and the P/E ratio.
- **options** — put/call sentiment with its interpretation, call and put volume, the
  average spread, a liquidity grade, and a data-quality verdict so a thin sample is
  never mistaken for a confident reading.
- **short** — short interest (shares short, days to cover) and recent short-volume
  pressure.
- **technical_indicators** — the default set: RSI(14), MACD(12/26/9), and the 20- and
  50-period simple moving averages.
- **financial_statements** — a key-metric snapshot by default, or the full income
  statement, balance sheet, and cash flow on request.
- **pre_earnings_context** — the stock’s run-up into the event, where its price sits in
  its 52-week range, a volatility proxy, and the index versus its 200-day average.

Each external CLI invocation creates a bundle run for one ticker; create another run for
another ticker.
