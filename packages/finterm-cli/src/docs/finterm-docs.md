# Finterm CLI Documentation

The Finterm CLI (`finterm` package, `finterm` command) provides authenticated financial
data lookups, company web research bundle runs, agent documentation, and local Dataroom
reading.

## Installation

```bash
npm install -g finterm
```

After installation, the `finterm` command is available globally.

## Quick Start

```bash
finterm --help          # Show all commands
finterm auth status     # Check token state
finterm auth login      # Authenticate when needed
finterm setup --check   # Verify agent setup
finterm setup           # Install supported agent setup
finterm skill --brief   # Short agent workflow
finterm tool --help     # Public point-tool surface
finterm bundle run company_web_research META
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

Check the active authentication source, token id, and masked key.

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
- `ticker_sentiment` - Live ticker sentiment composite

### Web Research Bundle Commands

Use `company_web_research` for the published company web research bundle.

```bash
finterm bundle catalog
finterm bundle describe company_web_research
finterm bundle run company_web_research META
finterm bundle wait <runId>
finterm bundle result <runId>
finterm bundle download <runId> --room ./datarooms/meta
finterm runs list
```

### Dataroom Commands

`finterm dataroom` exposes the read/search subset needed for local Datarooms:

- `finterm dataroom info <room>` - Show room metadata
- `finterm dataroom list <room>` - List room contents
- `finterm dataroom files <room>` - List file artifacts
- `finterm dataroom search <room> <query>` - Search file contents
- `finterm dataroom read <room> <artifact-ref>` - Read one artifact

Examples:

```bash
finterm dataroom info ./datarooms/aapl
finterm dataroom list ./datarooms/aapl
finterm dataroom files ./datarooms/aapl
finterm dataroom search ./datarooms/aapl "revenue"
finterm dataroom read ./datarooms/aapl <artifact-ref>
```

Room-mutating and authoring verbs are not exposed under `finterm dataroom`.

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
| `NO_COLOR` | Disable colors |
| `CI` | Enables non-interactive mode automatically |

## Links

- npm package target: https://www.npmjs.com/package/finterm
