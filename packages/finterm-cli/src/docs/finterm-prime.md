# Finterm CLI Quick Context

The `finterm` CLI provides authenticated financial-data lookups and local Dataroom
reading for agents and terminal users.

## Essential Commands

```bash
finterm --help            # Full command list
finterm auth status       # Check account email and plan/trial state
finterm auth login        # Authenticate when needed
finterm setup --check     # Verify agent setup
finterm setup             # Install supported agent setup
finterm skill --brief     # Short workflow rules
finterm docs              # Full CLI documentation
```

## Paid Model

Every authenticated data/tool call requires Finterm Pro; activate at
https://app.finterm.ai/pricing (pricing and trial terms are stated there).
Exceptions that work with any authenticated key: `finterm auth status` and
`finterm feedback`.
A non-Pro call fails with 402 `SUBSCRIPTION_REQUIRED` (machine-readable
`error.upgrade_url` under `--json`): do not retry in a loop — relay the upgrade URL to
your operator, then re-run after checkout (access activates automatically).
A 401 on a previously working key means the key was rotated (one active key per
account); re-run `finterm auth login`.

## Point Tools

```bash
finterm tool --help
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

Approved point-tool ids: `financial_statements`, `insider_trades`,
`institutional_holdings`, `options_sentiment`, `options_overview`, `sec_filing_diff`,
`sec_filing_fetch`, `sec_filings_search`, `stock_prices_current`,
`technical_indicators`, and `ticker_sentiment`.

## Bundles

The `ticker_data` bundle returns the full fundamentals snapshot for one ticker with no
extra params (`finterm tool ticker_data <ticker>` is shorthand for a run).
The `company_deep_research` bundle runs live and requires the fiscal-period params `q`,
`fy`, `prev_q`, and `prev_fy`:

```bash
finterm bundle run ticker_data META
finterm bundle run company_deep_research META --param q=Q4 --param fy=2024 --param prev_q=Q3 --param prev_fy=2024
finterm bundle wait <runId>
finterm bundle download <runId> --room ./datarooms/meta
```

## Dataroom Follow-Up

When the user provides a local Dataroom path:

```bash
finterm dataroom info ./datarooms/meta
finterm dataroom list ./datarooms/meta
finterm dataroom files ./datarooms/meta
finterm dataroom search ./datarooms/meta "revenue"
finterm dataroom read ./datarooms/meta <artifact-ref>
```

Only `info`, `list`, `files`, `search`, and `read` are exposed under `finterm dataroom`.

## Reporting Feedback

`finterm feedback bug|question|feature-request "<summary>"` reports friction to the
Finterm team (works without Pro). Submitting on the user's behalf is part of helping
them — but **never without their go-ahead**: preview the payload with `--dry-run`,
summarize every shared field to the user (summary, body, command, tool id, error code,
request ids, `cli_version`, `platform`), and send only after they approve.
Details: `finterm shortcut report-feedback`.

## Global Options

- `--dry-run` - Preview changes
- `--verbose` - Detailed output
- `--quiet` - Minimal output
- `--json` - JSON output
- `--color auto|always|never`
