---
name: finterm
description: >
  Run authenticated Finterm financial-data lookups and read local Datarooms. Use when
  users ask for financial statements, SEC filings, ownership, options sentiment,
  ticker sentiment, current prices, technical indicators, the ticker data or web
  research bundles, or Dataroom artifacts. Start with auth, setup, point-tool help,
  and the mounted Dataroom read/search verbs.
allowed-tools: Bash(finterm:*), Read, Grep, Glob
---
# Finterm CLI

## Primary Workflow

Start with authentication and agent setup:

```bash
finterm auth status
finterm auth login
finterm setup --check
finterm setup
finterm skill --brief
```

`finterm auth login` opens the browser by default and prints the same URL in the
terminal. If the browser cannot open from an agent shell, give the printed URL to the
human operator; use `--no-browser` only when suppressing the automatic browser open is
intentional.

Inspect the point-tool surface before running a lookup:

```bash
finterm tool --help
finterm tool financial_statements --help
finterm tool sec_filings_search --help
```

Run focused public tools for the user’s question:

```bash
finterm tool financial_statements META --statement-type income_statement --timeframe quarterly --as-of-date 2024-12-01
finterm tool sec_filings_search META --form-type 10-K --as-of-date 2024-12-31
finterm tool sec_filing_fetch META --year 2024 --period FY --sections risk_factors,mda
finterm tool sec_filing_diff META --base 2023:FY --compare 2024:FY --sections risk_factors --mode summary
finterm tool options_overview META
finterm tool options_sentiment META --as-of-date 2024-01-15
finterm tool ticker_sentiment META
finterm tool insider_trades META --as-of-date 2024-03-15
finterm tool institutional_holdings META --as-of-date 2024-03-15
finterm tool stock_prices_current NVDA META
finterm tool technical_indicators META --as-of-date 2024-01-16
```

Use `--json` when another tool or agent needs machine-readable output.

## Bundles

Two bundles are published: `ticker_data` and `company_web_research`.

Use `ticker_data` for the full fundamentals snapshot of one ticker; it needs no extra
parameters, and `finterm tool ticker_data <ticker>` is shorthand for starting a run:

```bash
finterm bundle run ticker_data META
finterm bundle wait <runId>
finterm bundle result <runId>
```

Use `company_web_research` when the user asks for a company research packet.
A run executes live and requires the fiscal-period parameters `q`, `fy`, `prev_q`, and
`prev_fy`; without them the run is rejected before it starts:

```bash
finterm bundle catalog
finterm bundle describe company_web_research
finterm bundle run company_web_research META --param q=Q4 --param fy=2024 --param prev_q=Q3 --param prev_fy=2024
finterm bundle status <runId>
finterm bundle wait <runId>
finterm bundle result <runId>
finterm bundle download <runId> --room ./datarooms/meta
```

Use `finterm runs list` to find resumable local bundle runs.

## Dataroom Follow-Up

When the user has a local Dataroom, read and search it through the mounted public
subset:

```bash
finterm dataroom info ./datarooms/meta
finterm dataroom list ./datarooms/meta
finterm dataroom files ./datarooms/meta
finterm dataroom search ./datarooms/meta "revenue"
finterm dataroom read ./datarooms/meta <artifact-ref>
```

The mounted Dataroom verbs are `info`, `list`, `files`, `search`, and `read`.
Room-mutating and authoring verbs are not part of the public `finterm dataroom` surface.

## Command Map

### Auth and Agent Setup

- `finterm auth login` - Authenticate with Finterm
- `finterm auth status` - Check the active token source
- `finterm auth logout` - Clear the stored token
- `finterm setup` - Install supported agent setup
- `finterm setup --check` - Check agent setup state
- `finterm setup --remove` - Remove installed agent setup
- `finterm init` - Create local `.finterm/config.yml`
- `finterm skill` - Print this full agent skill
- `finterm skill --brief` - Print the short workflow brief
- `finterm prime` - Print compact agent context
- `finterm docs` - Print the full CLI documentation
- `finterm shortcut [query]` / `--list` - Find agent shortcuts
- `finterm resources [query]` / `--list` - Find reference resources

### Bundles

- `finterm bundle catalog` - List published bundles
- `finterm bundle run ticker_data <ticker>` - Start a full ticker snapshot run
- `finterm bundle describe company_web_research` - Inspect the web research bundle
- `finterm bundle run company_web_research <ticker> --param q=.. --param fy=.. --param prev_q=.. --param prev_fy=..`
  \- Start a live run
- `finterm bundle status <runId>` - Show run state and next action
- `finterm bundle wait <runId>` - Wait for completion
- `finterm bundle result <runId>` - Read the run result
- `finterm bundle download <runId> --room <dir>` - Sync output into a local room
- `finterm runs list` - List resumable local runs

### Point Tools

Use `finterm tool <id>` for authenticated live data and filing lookups.

- `financial_statements` - Balance sheet, income statement, or cash flow periods
- `insider_trades` - SEC Form 4 insider transactions and holdings
- `institutional_holdings` - SEC Form 13F holders or manager positions
- `options_sentiment` - Put/call sentiment for one symbol on one date
- `options_overview` - Live options overview for one symbol
- `sec_filing_diff` - Compare two SEC filing sections
- `sec_filing_fetch` - Fetch SEC filing narrative sections
- `sec_filings_search` - Search SEC filings by ticker and form type
- `stock_prices_current` - Latest trade price for one or more symbols
- `technical_indicators` - RSI, MACD, and SMA indicators for one or more symbols
- `ticker_data` - Full ticker snapshot bundle run (async; returns a run id)
- `ticker_sentiment` - Live ticker sentiment composite

Run `finterm tool <id> --help` before adding flags.

### Dataroom

- `finterm dataroom info <room>` - Show room metadata
- `finterm dataroom list <room>` - List room contents
- `finterm dataroom files <room>` - List file artifacts
- `finterm dataroom search <room> <query>` - Search file contents
- `finterm dataroom read <room> <artifact-ref>` - Read one artifact

## Global Options

- `--json` - Machine-readable output
- `--dry-run` - Preview changes
- `--verbose` / `--quiet` - Output verbosity
- `--debug` - Include debug diagnostics
- `--color auto|always|never` - Color output

Use `--verbose` or `--debug` when checking live API behavior.

## Quick Reference

- Install with `npm install -g @finterm-ai/cli` (or run `npx @finterm-ai/cli@latest`);
  needs Node >=22.12
- Start with `finterm auth status`, `finterm setup --check`, and `finterm tool --help`
- Use only the published point-tool ids listed above
- Run web research packets with `finterm bundle run company_web_research <ticker>` plus
  the `q`, `fy`, `prev_q`, and `prev_fy` params
- Use `finterm dataroom info|list|files|search|read` for local Datarooms
