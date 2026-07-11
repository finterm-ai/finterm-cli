---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: options_sentiment
  title: Options Sentiment
  summary: Put/call options sentiment for a symbol on a specific date, with a
    sample-quality verdict.
  publication_state: published
  schema: finterm.result:OptionsSentiment/v1
  fields:
    - name: ticker
      type: string
      description: The underlying stock ticker symbol, uppercased (e.g. "AAPL").
    - name: as_of_date
      type: string
      description: The date the sentiment is reported for, in YYYY-MM-DD format.
    - name: sentiment
      type: 'object{put_call_volume_ratio: number | null; interpretation: "bullish" |
        "neutral" | "bearish" | null; total_call_volume: number;
        total_put_volume: number; avg_spread_percent: number | null;
        liquidity_grade: "A" | "B" | "C" | "D" | null}'
      description: "Put/call sentiment for the day: put_call_volume_ratio (put volume
        ÷ call volume; below 0.7 = bullish, 0.7–1.0 = neutral, above 1.0 =
        bearish), the interpretation label, total_call_volume, total_put_volume,
        avg_spread_percent (average bid/ask spread as a percent of midpoint),
        and liquidity_grade (A best to D worst). Ratio, interpretation, spread,
        and grade are null when there is no volume to read or spread analysis
        was not requested."
    - name: data_quality
      type: 'object{status: "ok" | "no_data" | "thin_sample"; contracts_analyzed:
        number; contracts_with_volume: number; total_volume: number}'
      description: 'Sample-quality verdict: status ("ok", "no_data" for a day with no
        traded contracts, or "thin_sample" for a low-volume sample),
        contracts_analyzed, contracts_with_volume, and total_volume. Use it to
        weight or discard the reading.'
    - name: contracts
      type: "object{total_calls: number; total_puts: number; contracts_with_volume:
        number; expirations: string[]}"
      description: "Contract-count summary for the analyzed sample: total_calls,
        total_puts, contracts_with_volume, and the list of expirations covered
        (YYYY-MM-DD)."
  examples:
    - comment: Options sentiment for one symbol on a specific date.
      command: finterm tool options_sentiment AAPL --as-of-date 2024-01-15
---
# Options Sentiment

Measure options-market sentiment for one underlying symbol on a specific date.
Returns the put/call volume ratio and its interpretation (below 0.7 = bullish, 0.7–1.0 =
neutral, above 1.0 = bearish), call and put volume, the average bid/ask spread, and a
liquidity grade. A data_quality block reports whether the sample is solid ("ok"), empty
("no_data", e.g. a non-trading day), or too small to trust ("thin_sample"), so a reading
is never mistaken for a confident one.
The date is required and identifies which day to report.
