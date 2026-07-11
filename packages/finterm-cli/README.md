# Finterm CLI

Command-line interface for Finterm financial data and Dataroom workflows.

## Installation

```bash
npx @finterm-ai/cli@latest --help
npm install -g @finterm-ai/cli@latest
```

## Quick Start

```bash
# Authenticate with Finterm
finterm auth login

# Run a company web research bundle and sync its output locally.
# Live runs require the fiscal-period params (current and prior quarter/year).
finterm bundle run company_deep_research AAPL \
  --param q=Q1 --param fy=2025 --param prev_q=Q4 --param prev_fy=2024
finterm bundle wait <runId>
finterm bundle download <runId> --room ./datarooms/aapl

# Run a point data tool
finterm tool financial_statements AAPL \
  --statement-type income_statement --as-of-date 2025-01-01

# View help
finterm --help
finterm tool --help
```

`finterm auth login` opens the browser and also prints the login URL for manual copy and
paste.

## Features

### Company Research Bundles

Authenticated bundle runs against the Finterm platform, with a local run ledger and
Dataroom sync:

```bash
finterm bundle catalog                       # List available research bundles
finterm bundle describe company_deep_research # Show one bundle's descriptor
# Start a live web research run (fiscal-period params are required):
finterm bundle run company_deep_research AAPL \
  --param q=Q1 --param fy=2025 --param prev_q=Q4 --param prev_fy=2024
finterm bundle status|wait|result <runId>    # Inspect or poll a run
finterm bundle download <runId> --room <dir> # Sync published run files into a local room
finterm runs list                            # Local ledger of resumable runs
finterm dataroom info|list|files|search|read <room>
                                             # Read and search a downloaded Dataroom
```

Two bundles are published: `company_deep_research` (async web research packet) and
`ticker_data` (the one-call ticker snapshot; `finterm tool ticker_data <ticker>` is
shorthand for starting a run).

### Point Data Tools

Published point tools:

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
- `ticker_sentiment`

### Authentication

Secure token-based authentication with Finterm services:

```bash
finterm auth login   # Authenticate; rotates the single account API key
finterm auth logout  # Sign out
finterm auth status  # Check account email, plan/trial state, and the stored key
```

### Developer Tools

- **Prime:** Load development context
- **Docs:** View documentation
- **Setup:** Install and verify agent integration files (`finterm setup`,
  `finterm setup --check`)
- **Shortcuts and resources:** Inspect agent shortcuts and reference resources
- **Activity summary:** A bundle download prints a brief size/time summary in regular
  output; `--verbose` or `--debug` add per-request API and bundle-download stats on
  stderr, and `--debug` also saves a structured activity snapshot under the local
  Finterm config directory

## Configuration

### Environment Variables

- `FINTERM_API_URL`: Finterm API base URL (default: production)
- `FINTERM_API_KEY`: Account API key override (from the dashboard or
  `finterm auth login`)

## Commands

### Authentication

```bash
finterm auth login          # Sign in and rotate the account API key
finterm auth logout         # Sign out
finterm auth status         # Check account email, plan/trial state, and the stored key
```

`finterm auth login` opens the browser by default and prints the URL in the terminal as
a fallback. `--no-browser` keeps the same URL flow without attempting to open the
browser. `--non-interactive` requires `FINTERM_API_KEY` for automation.

### Preview Commands

`--experimental` enables preview command groups.
Preview tools are not part of the stable first-release CLI surface.

### Developer Tools

```bash
finterm init               # Initialize finterm in the current directory
finterm prime              # Load agent context
finterm docs               # View CLI documentation
finterm skill              # Print the full agent skill
finterm shortcut --list    # List agent shortcuts
finterm resources --list   # List reference resources
finterm setup              # Install supported agent integration files
finterm setup --check      # Verify the skill and setup state
```

## Development

### Building from Source

```bash
# Clone repository
git clone https://github.com/finterm-ai/finterm-cli
cd finterm-cli

# Install dependencies
pnpm install

# Build
pnpm build

# Run locally (builds the CLI package and runs the bundled binary)
pnpm finterm:bin
```

### Running Tests

```bash
pnpm test              # Run all tests
pnpm test:install      # Smoke-test local preview install
pnpm test:watch        # Watch mode
pnpm test:pack         # Smoke-test the packed npm artifact
```

## Contributing

Contributions are welcome.
See
[CONTRIBUTING.md](https://github.com/finterm-ai/finterm-cli/blob/main/CONTRIBUTING.md)
for how to get started.

## License

Copyright (C) 2026 Finterm.

Licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later).
See [LICENSE](LICENSE) for the full text.

## Feedback and Support

Report a bug, ask a question, or request a feature straight from the CLI (works with
any authenticated key, no Pro subscription needed):

```bash
finterm feedback bug "One-line summary" --body "Expected vs. actual, repro steps"
```

The exact payload is always shown before sending, and the global `--dry-run` previews
it without sending. `--last` attaches the most recent failed API call's context
(command, error code, request id) from a small local history file
(`~/.finterm/recent-requests.json`, last 20 call outcomes, secret-redacted,
owner-readable only) that exists solely for this purpose — nothing is sent anywhere
until you run `finterm feedback` and see the payload.

You can also use
[GitHub Issues](https://github.com/finterm-ai/finterm-cli/issues) or email
<contact@finterm.ai>.
