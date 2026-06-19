---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: ticker_sentiment
  title: Ticker Sentiment
  summary: "A live 0-100 sentiment composite for a ticker: seven components scored
    vs the ticker's own year, grouped trend / flow / positioning."
  publication_state: published
  schema: finterm.result:TickerSentiment/v1
  fields:
    - name: ticker
      type: string
      description: The stock ticker symbol, uppercased (e.g. "AAPL").
    - name: as_of_date
      type: string
      description: The calendar date the score reflects, in YYYY-MM-DD format.
    - name: price
      type: number | null
      description: The underlying price at the snapshot, or null when unavailable.
    - name: score
      type: number | null
      description: The composite sentiment score, 0-100 (100 = greed-side), as the
        equal-weight mean of the scored components. Null when no component
        cleared its data gates.
    - name: band
      type: '"extreme fear" | "fear" | "neutral" | "greed" | "extreme greed" | null'
      description: 'The band label for the score: "extreme fear", "fear", "neutral",
        "greed", or "extreme greed" (cutoffs versioned in methodology). Null
        when the score is null.'
    - name: coverage
      type: string
      description: How many components were scored, as "N/7" over the v1 component set.
    - name: sub_scores
      type: "object{trend: number | null; flow: number | null; positioning: number |
        null}"
      description: The mean score within each group — trend, flow, and positioning —
        each null when no component in that group was scored.
    - name: components
      type: '(object{id: string; group: "trend" | "flow" | "positioning"; raw: number;
        unit: "pct" | "ratio" | "share_pct" | "rank" | "days"; percentile:
        number; score: number; window: string; note?: string})[]'
      description: "The scored components, each with: id, group, raw (today's value),
        unit, percentile (0-100 vs the ticker's own window), score (oriented so
        100 = greed-side), the reference window, and an optional note when an
        interim source was substituted."
    - name: omitted
      type: '(object{component: string; reason: "history_accumulating" | "thin_chain"
        | "insufficient_history" | "no_data"})[]'
      description: Components dropped from the composite, each with the component id
        and the reason (history_accumulating, thin_chain, insufficient_history,
        or no_data) — so a degraded score is always explained.
    - name: delta
      type: "object{d1: number | null; d5: number | null; d20: number | null}"
      description: Change in the composite over 1, 5, and 20 trading days (d1/d5/d20),
        each computed on today's component set so the comparison is
        like-for-like. Null when the prior anchor was not computable.
    - name: history
      type: "object{date: string; score: number; coverage: string}[]"
      description: Weekly composite closes (oldest first), each with its date, score,
        and coverage at that point.
    - name: flags
      type: string[]
      description: Notable transitions on this snapshot (e.g. entered_extreme_fear,
        crossed_below_125d_ma, flow_positioning_divergence).
    - name: context
      type: "object{next_earnings: object{date: string; days: number; confirmed:
        boolean} | null}"
      description: "Event context: next_earnings carries the upcoming earnings date,
        days until it, and whether it is confirmed (null when no upcoming date
        is known)."
    - name: derived
      type: string[]
      description: Quotable plain-English sentences summarizing the score, its
        drivers, and any caveats. The first sentence doubles as a headline.
    - name: scope
      type: 'object{selection: "full_chain" | "partial_chain"; contracts_analyzed:
        number; expirations_covered: number; pages_fetched: number}'
      description: "What the options-derived components saw: selection (full_chain or
        partial_chain when the fetch cap stopped at a prefix),
        contracts_analyzed, expirations_covered, and pages_fetched."
    - name: data_quality
      type: 'object{status: "ok" | "degraded" | "no_data"; history: object{status:
        "ok" | "accumulating"; days_collected: number}; note?: string}'
      description: 'Reading reliability: status ("ok", "degraded" when components were
        omitted, or "no_data"), history (status and days_collected for the
        trailing daily series), and an optional note.'
    - name: methodology
      type: "object{version: string; component_scoring: string; composite: string;
        band_cutoffs: unknown[]; orientation: string; flow_sharing: string}"
      description: "A versioned description of the scoring: component_scoring,
        composite, band_cutoffs (the four ascending thresholds between the five
        band labels), orientation, and flow_sharing."
  examples:
    - comment: Live sentiment composite for one symbol.
      command: finterm tool ticker_sentiment AAPL
---
# Ticker Sentiment

Get a live 0-100 sentiment score for a ticker, composed of seven components grouped into
trend, flow, and positioning sub-scores.
Each component is scored as a percentile vs the ticker’s own trailing year and oriented
so 100 is the greed side.
The result carries the composite score with a band label (extreme fear to extreme greed;
cutoffs versioned in the methodology block), the three sub-scores, every component with
its raw value, percentile, and window, deltas over 1, 5, and 20 trading days, a weekly
history series, transition flags, and quotable derived[] sentences.
A thin option chain degrades to a disclosed coverage with omission reasons, so the score
never silently changes meaning.
Serves live data only.
