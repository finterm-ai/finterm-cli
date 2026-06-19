# Finterm CLI Quick Context

The `finterm` CLI provides authenticated financial-data lookups and local Dataroom
reading for agents and terminal users.

## Essential Commands

```bash
finterm --help            # Full command list
finterm auth status       # Check token state
finterm auth login        # Authenticate when needed
finterm setup --check     # Verify agent setup
finterm setup             # Install supported agent setup
finterm skill --brief     # Short workflow rules
finterm docs              # Full CLI documentation
```

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
```

Approved point-tool ids: `financial_statements`, `insider_trades`,
`institutional_holdings`, `options_sentiment`, `options_overview`, `sec_filing_diff`,
`sec_filing_fetch`, `sec_filings_search`, and `ticker_sentiment`.

## Web Research Bundle

```bash
finterm bundle run company_web_research META
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

## Global Options

- `--dry-run` - Preview changes
- `--verbose` - Detailed output
- `--quiet` - Minimal output
- `--json` - JSON output
- `--color auto|always|never`
