# Finterm CLI Agent Guide

This repository builds the public `@finterm-ai/cli` npm package and its `finterm`
command, a client for the Finterm API and for reading local Datarooms.
See [README.md](README.md) for user-facing usage, [CONTRIBUTING.md](CONTRIBUTING.md) for
the contribution flow, and [docs/RELEASING.md](docs/RELEASING.md) for the npm release
process (one-time OIDC bootstrap and the ongoing automated flow).

## Repository Layout

This is a pnpm workspace.
The published package lives in `packages/finterm-cli`:

- `src/cli/cli.ts` registers the commands.
- `src/cli/commands/` holds one file per command.
- `src/api/*.api.md` are the published point-tool API docs.

The `packages/dataroom-cli` and `packages/dataroom` packages provide the local Dataroom
read and search surface that `finterm dataroom` mounts.

## Published Surface

Keep agent guidance aligned with the code, not with memory.
The CLI deliberately exposes a narrow surface:

- **Point tools** (`finterm tool <id>`): `financial_statements`, `insider_trades`,
  `institutional_holdings`, `options_overview`, `options_sentiment`, `sec_filing_diff`,
  `sec_filing_fetch`, `sec_filings_search`, `ticker_sentiment`.
- **Research bundle** (`finterm bundle run <id> <ticker>`): `company_web_research`. Live
  runs require the fiscal-period parameters
  `--param q=<n> --param fy=<year> --param prev_q=<n> --param prev_fy=<year>`; a run
  without them is rejected before the API call.
- **Dataroom** (`finterm dataroom <verb> <room>`): `info`, `list`, `files`, `search`,
  `read`.

The canonical lists are `FINTERM_TOOL_IDS` in `src/api/toolIds.ts` and
`PUBLISHED_BUNDLE_NAMES` in `src/cli/commands/bundle.ts`. A startup guard rejects drift
between those lists and the registered commands, so update the source, not just the
docs.

## Check Suite

Run the full suite before opening a pull request:

```bash
pnpm install --frozen-lockfile
pnpm ci
```

`pnpm ci` runs format, lint and typecheck, tests, build, `publint`, the packed-artifact
smoke test, and `pnpm public:check` (the guard that no unpublished surface leaks into
the package).

## Rules

- The repo ships one npm package named `@finterm-ai/cli` and one binary named `finterm`.
- Use `contact@finterm.ai` for public support and security contacts.
- Install dependencies with `pnpm install --frozen-lockfile`. The project `.npmrc`
  enforces a 14-day package release-age gate; see
  [SUPPLY-CHAIN-SECURITY.md](SUPPLY-CHAIN-SECURITY.md).
- Node `>=22.12` is required (`package.json` `engines`).
