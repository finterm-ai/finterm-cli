# Finterm CLI Documentation

The Finterm CLI (`@finterm-ai/cli` package, `finterm` command) provides authenticated
financial data lookups, company web research bundle runs, agent documentation, local
Dataroom reading, and a built-in feedback channel to the Finterm team.

## Installation

Run without installing:

```bash
npx @finterm-ai/cli@latest --help
```

Or install globally so the `finterm` command is always available:

```bash
npm install -g @finterm-ai/cli
```

Finterm requires Node.js 22.12 or newer.

## Quick Start

```bash
finterm --help          # Show all commands
finterm auth status     # Check token state
finterm auth login      # Authenticate when needed
finterm setup --check   # Verify agent setup
finterm setup           # Install supported agent setup
finterm skill --brief   # Short agent workflow
finterm tool --help     # Public point-tool surface
finterm bundle run company_deep_research AAPL \
  --param q=Q1 --param fy=2025 --param prev_q=Q4 --param prev_fy=2024
finterm feedback --help # Report a bug, ask a question, request a feature
```

## Commands

For option-level detail, run `finterm <command> --help` or
`finterm <command> <subcommand> --help`.

### Documentation Commands

#### `finterm docs`

Shows this full documentation.
Output is automatically paged when running interactively.

#### `finterm prime`

Shows compact context for AI coding agents.
Use it after context compaction or at the start of a new session.

#### `finterm skill`

Outputs the full agent skill.

Options:

- `--brief` - Output condensed workflow rules instead of the full skill file

#### `finterm shortcut [query]`

Find and output reusable agent shortcuts.
Use `--list` to list available shortcuts.

#### `finterm resources [query]`

Find and output reference resources.
Use `--list` to list available resources.

### Initialization Commands

#### `finterm init`

Initializes Finterm in the current directory by creating `.finterm/config.yml`.

Creates:

- `.finterm/config.yml` - Configuration file
- `.finterm/.gitignore` - Ignores local-only files

Use `finterm setup` for agent integration.

### Authentication Commands

#### `finterm auth login`

Authenticate with the Finterm platform.
Signing in creates a new account API key and revokes the previous active key.
The command opens the browser by default and always prints the login URL as a fallback
for copy and paste.

Options:

- `--no-browser` - Print the login URL without opening a browser
- `--device-name <name>` - Set the display name for the CLI device

Use `FINTERM_API_KEY` instead of `finterm auth login` for fully non-interactive
automation.

#### `finterm auth status`

Check the active authentication source, token id, masked key, and plan/trial state.

Data and tool calls require Finterm Pro; `finterm auth status` and `finterm feedback`
work with any authenticated key.

#### `finterm auth logout`

Remove the stored local authentication token.

### Setup Commands

#### `finterm setup`

Installs the Finterm agent skill once into supported agent locations.
The command is idempotent and non-interactive.

Options:

- `--check` - Show setup status without changing anything
- `--remove` - Remove installed agent setup

### Point Tool Commands

`finterm tool <id>` exposes authenticated point-data lookups.
Use `finterm tool --help` and `finterm tool <id> --help` before adding flags.
Add `--json` for machine-readable output.

Current public ids:

- `financial_statements`
- `insider_trades`
- `institutional_holdings`
- `options_sentiment`
- `options_overview`
- `sec_filing_diff`
- `sec_filing_fetch`
- `sec_filings_search`
- `stock_prices_current`
- `technical_indicators`
- `ticker_data`
- `ticker_sentiment`

Examples:

```bash
finterm tool financial_statements AAPL --statement-type income_statement --timeframe quarterly --as-of-date 2024-12-01
finterm tool sec_filings_search AAPL --form-type 10-K --as-of-date 2024-12-31
finterm tool sec_filing_fetch AAPL --year 2024 --period FY --sections risk_factors,mda
finterm tool sec_filing_diff AAPL --base 2023:FY --compare 2024:FY --sections risk_factors --mode summary
finterm tool options_overview AAPL
finterm tool options_sentiment AAPL --as-of-date 2024-01-15
finterm tool ticker_sentiment AAPL
finterm tool insider_trades AAPL --as-of-date 2024-03-15
finterm tool institutional_holdings AAPL --as-of-date 2024-03-15
finterm tool stock_prices_current NVDA AAPL
finterm tool technical_indicators AAPL --as-of-date 2024-01-16
finterm tool ticker_data AAPL
```

Tool roles:

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

### Bundle Commands

Two bundles are published: `ticker_data` and `company_deep_research`.

`ticker_data` aggregates earnings, guidance, prices, ratios, options sentiment, short
pressure, technicals, statements, and pre-earnings context for one ticker; it needs no
extra parameters (`finterm tool ticker_data AAPL` is shorthand for a run).

A `company_deep_research` run executes live and requires four fiscal-period parameters:
`q`, `fy`, `prev_q`, and `prev_fy` (the current and prior fiscal quarter and year).
A run executes live and requires four fiscal-period parameters: `q`, `fy`, `prev_q`, and
`prev_fy` (the current and prior fiscal quarter and year).
Omitting any of them fails before the API is called.

```bash
finterm bundle catalog
finterm bundle describe ticker_data
finterm bundle run ticker_data AAPL
finterm bundle describe company_deep_research
finterm bundle run company_deep_research AAPL \
  --param q=Q1 --param fy=2025 --param prev_q=Q4 --param prev_fy=2024
finterm bundle wait <runId>
finterm bundle result <runId>
finterm bundle download <runId> --room ./datarooms/aapl
finterm runs list
```

### Dataroom Commands

`finterm dataroom` exposes the read/search subset needed for local Datarooms:

- `finterm dataroom info <room>` - Show room metadata
- `finterm dataroom list <room>` - List room contents
- `finterm dataroom files <room>` - List file artifacts
- `finterm dataroom search <room> <query>` - Search file contents
- `finterm dataroom read <room> <ref>` - Read one artifact

Examples:

```bash
finterm dataroom info ./datarooms/aapl
finterm dataroom list ./datarooms/aapl
finterm dataroom files ./datarooms/aapl
finterm dataroom search ./datarooms/aapl "revenue"
finterm dataroom read ./datarooms/aapl <ref>
```

Room-mutating and authoring verbs are not exposed under `finterm dataroom`.

### Feedback & Support Commands

#### `finterm feedback bug|question|feature-request`

Send a bug report, question, or feature request to the Finterm team directly from the
CLI (`feature` is an alias for `feature-request`). Feedback works with any
authenticated key — Pro is not required.

The one-line summary is a positional argument (up to 200 characters). The exact payload
always prints before sending, so you (or your agent) can see every field being shared;
the global `--dry-run` previews the payload without sending it. Agents can submit
feedback on the user's behalf after showing the payload and getting the user's
go-ahead.

Options:

- `--body <text>` - Longer Markdown detail (up to 16 KB)
- `--body-file <path>` - Read the body from a file, or `-` for stdin
- `--command <command>` - The command line that hit the issue
- `--tool <toolId>` - The tool id involved (e.g. sec_filings_search)
- `--error-code <code>` - The error code received (e.g. RATE_LIMITED)
- `--request-id <id>` - A related request id (repeatable, up to 8)
- `--last` - Attach the context of the most recent failed API call from the local
  request history; explicit flags take precedence

Examples:

```bash
finterm feedback bug "options_overview returned an empty positioning book" --last
finterm feedback question "does sec_filing_diff support S-1 filings?"
finterm feedback feature-request "add a CSV output mode" --body-file notes.md
```

To make `--last` accurate, the CLI keeps a local history of recent API call outcomes in
`~/.finterm/recent-requests.json` (capped at 20 entries, secret-shaped values redacted,
file mode 0600). Feedback submissions themselves are never recorded there, and obvious
credential shapes are rejected before any submission is sent.

## Global Options

All commands support these global options:

| Option | Description |
| --- | --- |
| `--dry-run` | Preview changes without executing |
| `--verbose` | Show detailed output |
| `--quiet` | Suppress non-essential output |
| `--json` | Output as JSON |
| `--color <when>` | Control colorization: auto, always, never |
| `--non-interactive` | Disable prompts, fail if input is required |
| `--debug` | Show debug information |
| `--experimental` | Enable preview command groups and tools |

## JSON Output

Add `--json` to any command for machine-readable output:

```bash
finterm tool ticker_sentiment AAPL --json
```

## Exit Codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | General error |
| 2 | Validation/usage error |
| 130 | Interrupted (Ctrl+C) |

## Environment Variables

| Variable | Description |
| --- | --- |
| `FINTERM_API_KEY` | Account API key used for authentication (overrides the stored credentials) |
| `FINTERM_API_URL` | Override the Finterm API base URL (default: production) |
| `FINTERM_CONFIG` | Override the `~/.finterm` config directory (stored token, run ledger, recent-requests history) |
| `NO_COLOR` | Disable colors |
| `CI` | Enables non-interactive mode automatically |

## Feedback and Support

Report a bug, ask a question, or request a feature with `finterm feedback` (see
[Feedback & Support Commands](#feedback--support-commands)). You can also use
[GitHub Issues](https://github.com/finterm-ai/finterm-cli/issues) or email
<contact@finterm.ai>.

## Links

- npm package: https://www.npmjs.com/package/@finterm-ai/cli
