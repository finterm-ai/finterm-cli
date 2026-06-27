# Changelog

## 0.1.1

### Fixes

- Sync `finterm tool` help descriptions from the committed public `.api.md`
  definitions, including the corrected `ticker_sentiment` 0-100 composite summary.
- Add drift checks for generated tool descriptions and command-spec metadata so CLI
  help, docs inputs, and packaged API definitions stay aligned.
- Replace the placeholder e2e/uninstall checks with real CLI smoke coverage in the
  release CI path.

## 0.1.0

First public release of the `finterm` CLI for Finterm financial research and Dataroom
workflows.

### Features

- **Point data tools** (`finterm tool`): nine authenticated tools —
  `financial_statements`, `insider_trades`, `institutional_holdings`,
  `options_overview`, `options_sentiment`, `sec_filing_diff`, `sec_filing_fetch`,
  `sec_filings_search`, and `ticker_sentiment`.
- **Company research bundles** (`finterm bundle`): run the `company_web_research` bundle
  and manage its lifecycle with `catalog`, `describe`, `run`, `status`, `wait`,
  `result`, `artifacts`, and `download`. List recorded runs with `finterm runs list`.
- **Local Dataroom** (`finterm dataroom`): inspect and query a downloaded room with
  `info`, `list`, `files`, `search`, and `read`.
- **Authentication** (`finterm auth`): token-based `login`, `logout`, and `status`.
- **Agent integration**: `finterm setup`, `init`, `docs`, `prime`, `skill`, `shortcut`,
  and `resources` wire the CLI into coding agents.
