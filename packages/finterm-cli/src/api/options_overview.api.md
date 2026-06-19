---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: options_overview
  title: Options Overview
  summary: "A live one-call options overview: implied vs realized volatility with
    rank, today's flow, the positioning book, expected moves, and probability
    bands."
  publication_state: published
  schema: finterm.result:OptionsOverview/v1
  fields:
    - name: ticker
      type: string
      description: The stock ticker symbol, uppercased (e.g. "AAPL").
    - name: as_of_date
      type: string
      description: The calendar date the snapshot reflects, in YYYY-MM-DD format.
    - name: spot
      type: number | null
      description: The underlying spot price at the snapshot, or null when unavailable.
    - name: context
      type: "object{next_earnings: object{date: string; days: number; confirmed:
        boolean} | null}"
      description: "Event context: next_earnings carries the upcoming earnings date,
        the number of calendar days until it, and whether it is confirmed (null
        when no upcoming date is known)."
    - name: volatility
      type: "object{iv_30: number | null; hv_20: number | null; iv_vs_hv: number |
        null; skew: number | null; iv_rank: number | null; iv_percentile: number
        | null; iv_1y_low: object{value: number; date: string} | null;
        iv_1y_high: object{value: number; date: string} | null; hv_rank: number
        | null}"
      description: "Volatility block, all in percent points: iv_30 (30-day
        constant-maturity at-the-money implied vol), hv_20 (20-day realized
        vol), iv_vs_hv (their spread), skew (near-the-money put-minus-call IV),
        iv_rank and iv_percentile (position of today's IV30 in its own
        trailing-year range and the share of days below it, 0-100), iv_1y_low /
        iv_1y_high (the year's IV extremes with their dates), and hv_rank (the
        interim realized-vol rank). Rank, percentile, and the 1-year extremes
        are null until the daily series has collected a year of history."
    - name: flow
      type: "object{volume: number; puts: number; calls: number; pc_ratio: number |
        null; vs_avg_30d: number | null; pc_5d_avg: number | null;
        pc_percentile_1y: number | null}"
      description: "Today's options volume: total volume with the put and call splits,
        pc_ratio (put ÷ call volume), vs_avg_30d (today vs the trailing 30-day
        average, 1.15 = 115%), pc_5d_avg (trailing 5-day average volume P/C),
        and pc_percentile_1y (today's volume P/C percentile in the trailing
        year, 0-100). The averages and percentile are null while the daily
        series accumulates."
    - name: positioning
      type: "object{open_interest: number; puts: number; calls: number; pc_ratio:
        number | null; vs_avg_30d: number | null; max_pain: object{strike:
        number; expiry: string; spot_vs: number} | null; top_strikes:
        object{calls: unknown[][]; puts: unknown[][]}}"
      description: "The accumulated open-interest book: open_interest with the put and
        call splits, pc_ratio, vs_avg_30d (today's OI vs its trailing 30-day
        average), max_pain (the strike with the least total option value at
        expiry, the expiry it applies to, and spot_vs = spot ÷ strike − 1), and
        top_strikes (the largest open-interest strikes per side as [strike,
        share-of-side-OI] pairs)."
    - name: expected_move
      type: "object{expiry: string; days: number; pct: number; dollars: number;
        post_earnings?: true}[]"
      description: "Per-expiry expected moves from the at-the-money straddle: expiry,
        days ahead, pct (the ±% move) and dollars (the ± dollar move). The entry
        on or after the next earnings date carries post_earnings: true so the
        event-spanning move is never missed."
    - name: probability
      type: 'object{expiry: string; method: "lognormal_iv30"; bands: object{p10:
        number; p25: number; p50: number; p75: number; p90: number}} | null'
      description: "Lognormal price bands at one target expiry (the first
        post-earnings expiry when one is known): expiry, method, and bands with
        the p10/p25/p50/p75/p90 price levels. Null when no bands could be
        computed."
    - name: derived
      type: string[]
      description: Quotable plain-English sentences summarizing flow, volatility, and
        the priced-in move. The first sentence doubles as a headline.
    - name: flags
      type: string[]
      description: Notable conditions on this snapshot (e.g. volume_above_average,
        iv_rank_high, pc_volume_high_extreme, chain_truncated).
    - name: scope
      type: 'object{selection: "full_chain" | "partial_chain"; contracts_analyzed:
        number; expirations_covered: number; pages_fetched: number}'
      description: "What was summarized: selection (full_chain or partial_chain when
        the fetch cap stopped at a prefix), contracts_analyzed,
        expirations_covered, and pages_fetched."
    - name: data_quality
      type: 'object{status: "ok" | "thin" | "no_data"; history: object{status: "ok" |
        "accumulating"; days_collected: number}; note?: string}'
      description: 'Reading reliability: status ("ok", "thin" for a sparse or
        zero-volume chain, or "no_data"), history (status and days_collected for
        the trailing daily series the rank/average fields depend on), and an
        optional note describing any caveat.'
    - name: methodology
      type: "object{version: string; iv_30: string; hv_20: string; skew: string;
        expected_move: string; probability_bands: string; max_pain: string;
        flag_thresholds: string}"
      description: A versioned description of how each figure is computed (iv_30,
        hv_20, skew, expected_move, probability_bands, max_pain, and the
        flag_thresholds), so explanations stay grounded in the actual
        computation.
  examples:
    - comment: Live options overview for one symbol.
      command: finterm tool options_overview TSLA
---
# Options Overview

Get a live one-call options overview for a ticker.
One full-chain snapshot is summarized into a volatility block (30-day implied vs 20-day
realized vol, their spread, skew, and the rank/percentile of today’s IV in the ticker’s
own year), a flow block (today’s volume with put/call splits and reference averages),
and a positioning block (open interest, max pain, and the largest open-interest
strikes). It adds expected moves per expiry — always including the first expiry on or
after the next earnings date — lognormal probability bands, quotable derived[]
sentences, condition flags, and a data_quality block.
History-dependent fields report null with a days-collected count while the daily series
fills, never fabricated.
Serves live data only; pass a past date to options_sentiment instead.
