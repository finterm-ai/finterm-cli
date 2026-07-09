# Changelog

## 0.3.1

### Fixes

- Clarify that `stock_prices_current` returns the latest available stock prices and
  that values are delayed by up to 15 minutes depending on provider plan and exchange
  entitlements.

## 0.3.0

### Breaking

- The deep-research bundle id is now `company_deep_research` (renamed server-side
  from `company_web_research`, finterm-main `feat(api)!`): commands, agent docs,
  and the mock client all use the new id. The old id 404s once the API deploys
  the rename — there is no alias layer.

## 0.2.2

### Fixes

- Bundled agent docs now resolve in global installs: `finterm skill`, `docs`, and
  `prime` serve the real content and `finterm setup` works from any directory.
  Previously the bin symlink defeated resolution, so published installs printed
  placeholders and `setup` failed with "SKILL.md not found".
- Removed `--as-of-date` from `finterm tool ticker_data` and `finterm bundle run`:
  the public bundle-run contract never had the field, so passing it always failed
  with a validation error.

### Improvements

- Required options are marked `(required)` in `--help`, and `--as-of-date` on
  `financial_statements`, `options_sentiment`, and `technical_indicators` is now
  optional, defaulting to today (UTC) — so "latest" queries work without flags.
- As-of dates are validated as real `YYYY-MM-DD` calendar dates before any network
  call (the literal `today` is also accepted), failing fast as a usage error
  instead of surfacing an upstream HTTP error.
- An API failure without a structured error envelope (e.g. a gateway 502) now
  renders as an explicit service-fault or rejected-request block with the HTTP
  status, instead of a bare `HTTP <status>` message that read like bad input.

## 0.2.1

### Improvements

- API errors in the default (human) output mode now render as a concise block on
  stderr — title, message, error code, and remedy — instead of the raw
  `{finterm,error}` JSON envelope. `--json`/`--format` callers keep the wire shape on
  stdout unchanged.
- `SUBSCRIPTION_REQUIRED` (402) renders a paywall block with the server's message and
  the machine-readable `error.upgrade_url`, and offers to open the upgrade page in the
  browser on an interactive terminal — never for agents, CI, or `--non-interactive`.
  After checkout, re-running the command resumes access automatically.
- `finterm auth login` closes with plan-aware messaging from the login entitlement
  summary; older servers keep the generic line.
- `finterm auth status` performs a server entitlement check and reports the account
  email and plan/trial state, names a rotated key (401) as the
  one-active-key-per-account cause, and falls back to the local credential readout
  when the server is unreachable.
- Invalid, expired, or revoked token errors explain the one-active-key-per-account
  rotation cause and point at `finterm auth login`.
- Agent guidance (`SKILL.md`, prime, brief) covers the paid model: the 402
  relay-don't-retry rule, `upgrade_url`, and 401 key-rotation recovery.

## 0.2.0

### Features

- **Three new published tools**, matching the Finterm API surface:
  - `finterm tool stock_prices_current <symbols...>` — latest trade price for one or
    more symbols.
  - `finterm tool technical_indicators <symbols...> --as-of-date <date>` — RSI, MACD,
    and SMA indicators.
  - `ticker_data` — the full ticker snapshot bundle: `finterm bundle catalog`,
    `describe`, and `run` now accept it, and `finterm tool ticker_data <ticker>` is
    shorthand for creating a run.
- Mock mode covers the new tools and the `ticker_data` bundle.
- Skill, prime, brief, and docs surfaces list the new tools and bundle.

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
