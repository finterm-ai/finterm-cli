# Finterm Workflow Rules (Brief)

## First Path

Use the authenticated public point-tool surface before composing an answer:

```bash
finterm auth status
finterm auth login
finterm setup --check
finterm tool --help
finterm tool financial_statements --help
```

Run the narrow tool that matches the user’s question:

```bash
finterm tool financial_statements META --statement-type income_statement --timeframe quarterly --as-of-date 2024-12-01
finterm tool sec_filings_search META --form-type 10-K --as-of-date 2024-12-31
finterm tool options_overview META
finterm tool ticker_sentiment META
```

Approved point-tool ids are `financial_statements`, `insider_trades`,
`institutional_holdings`, `options_sentiment`, `options_overview`, `sec_filing_diff`,
`sec_filing_fetch`, `sec_filings_search`, `stock_prices_current`,
`technical_indicators`, and `ticker_sentiment`.

Use `--json` when another tool or agent needs structured output.

The API surface is paid (Finterm Pro; 3-day trial, card required). On a 402
`SUBSCRIPTION_REQUIRED`, do not retry in a loop: relay the upgrade URL
(`error.upgrade_url`, or https://app.finterm.ai/pricing) to your operator and re-run
after checkout. On a 401 for a previously working key, the key was rotated — re-run
`finterm auth login`.

## Bundles

Use the `ticker_data` bundle for the full fundamentals snapshot of one ticker (no extra
params; `finterm tool ticker_data <ticker>` is shorthand for a run).
Use the `company_web_research` bundle for company research packets; a run executes live
and requires the fiscal-period params `q`, `fy`, `prev_q`, and `prev_fy`:

```bash
finterm bundle run ticker_data META
finterm bundle run company_web_research META --param q=Q4 --param fy=2024 --param prev_q=Q3 --param prev_fy=2024
finterm bundle wait <runId>
finterm bundle download <runId> --room ./datarooms/meta
```

## Dataroom Follow-Up

When the user provides a local Dataroom path, read and search it with:

```bash
finterm dataroom info ./datarooms/meta
finterm dataroom list ./datarooms/meta
finterm dataroom files ./datarooms/meta
finterm dataroom search ./datarooms/meta "revenue"
finterm dataroom read ./datarooms/meta <artifact-ref>
```

The mounted Dataroom surface is `info`, `list`, `files`, `search`, and `read`.

## Secondary Surfaces

- Use `finterm docs` for full CLI documentation
- Use `finterm shortcut --list` and `finterm resources --list` for bundled agent aids
- Use `finterm tool <id> --help` before adding flags
