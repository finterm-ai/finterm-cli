# Finterm CLI

Command-line interface for Finterm financial data and Dataroom workflows.

## Installation

```bash
npx finterm@latest --help
npm install -g finterm@latest
```

## Quick Start

```bash
# Authenticate with Finterm
finterm auth login

# Run a company web research bundle and sync its output locally
finterm bundle run company_web_research AAPL
finterm bundle wait <runId>
finterm bundle download <runId> --room ./datarooms/aapl

# Run a point data tool
finterm tool financial_statements AAPL

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
finterm bundle run company_web_research AAPL # Start a web research run
finterm bundle status|wait|result <runId>    # Inspect or poll a run
finterm bundle download <runId> --room <dir> # Sync published run files into a local room
finterm runs list                            # Local ledger of resumable runs
finterm dataroom info|list|files|search|read <room>
                                             # Read and search a downloaded Dataroom
```

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
- `ticker_sentiment`

### Authentication

Secure token-based authentication with Finterm services:

```bash
finterm auth login   # Authenticate; rotates the single account API key
finterm auth logout  # Sign out
finterm auth status  # Check source, token id, and masked key
```

### Developer Tools

- **Prime** - Load development context
- **Docs** - View documentation
- **Setup** - Install and verify agent integration files (`finterm setup|--check`)
- **Shortcuts/resources** - Inspect agent shortcuts and reference resources
- **Activity summary** - A bundle download prints a brief size/time summary in regular
  output; `--verbose` or `--debug` add per-request API and bundle-download stats on
  stderr, and `--debug` also saves a structured activity snapshot under the local
  Finterm config directory

## Configuration

### Environment Variables

- `FINTERM_API_URL` - Finterm API base URL (default: production)
- `FINTERM_API_KEY` - Account API key override (from the dashboard or
  `finterm auth login`)

## Commands

### Authentication

```bash
finterm auth login          # Sign in and rotate the account API key
finterm auth logout         # Sign out
finterm auth status         # Check source, token id, and masked key
```

`finterm auth login` opens the browser by default and prints the URL in the terminal as
a fallback. `--no-browser` keeps the same URL flow without attempting to open the
browser. `--non-interactive` requires `FINTERM_API_KEY` for automation.

### Preview Commands

`--experimental` enables preview command groups.
Preview tools are not part of the stable first-release CLI surface.

### Developer Tools

```bash
finterm prime              # Load agent context
finterm docs               # View CLI documentation
finterm skill              # Print the full agent skill
finterm shortcut --list    # List agent shortcuts
finterm resources --list   # List reference resources
finterm setup       # Install supported agent integration files
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

# Run locally
node dist/bin-bootstrap.cjs
```

### Running Tests

```bash
pnpm test              # Run all tests
pnpm test:install      # Smoke-test local preview install
pnpm test:watch        # Watch mode
pnpm test:pack         # Smoke-test the packed npm artifact
```

## Contributing

We welcome contributions!

## License

MIT

## Support

For issues and questions, use
[GitHub Issues](https://github.com/finterm-ai/finterm-cli/issues) or email
contact@finterm.ai.
