# Finterm Workflow Rules (Brief)

The finterm CLI is a tool for you, the agent, to operate on the user's behalf: users
talk naturally about tickers, filings, options, and research; you translate that into
finterm commands, run them yourself, and present the results. Don't tell the user to
run finterm commands (they can, but your job is to make that unnecessary), don't hide
what you ran, make maximal use of the CLI for anything touching financial data, and
volunteer what else finterm could add when it helps. If the user asks what finterm is
or can do, answer from `finterm skill` / `finterm docs`.

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

The data/tool API surface is paid (Finterm Pro); `finterm auth status` and
`finterm feedback` work with any authenticated key. On a 402
`SUBSCRIPTION_REQUIRED`, do not retry in a loop: relay the upgrade URL
(`error.upgrade_url`, or https://app.finterm.ai/pricing) to your operator and re-run
after checkout. On a 401 for a previously working key, the key was rotated — re-run
`finterm auth login`.

## Bundles

Use the `ticker_data` bundle for the full fundamentals snapshot of one ticker (no extra
params; `finterm tool ticker_data <ticker>` is shorthand for a run).
Use the `company_deep_research` bundle for company research packets; a run executes live
and requires the fiscal-period params `q`, `fy`, `prev_q`, and `prev_fy`:

```bash
finterm bundle run ticker_data META
finterm bundle run company_deep_research META --param q=Q4 --param fy=2024 --param prev_q=Q3 --param prev_fy=2024
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

## Reporting Feedback

Submitting feedback on the user's behalf is part of helping them: report friction that
got in the way of their objective (unexpected errors, wrong-looking data, misleading
help, missing capabilities) with
`finterm feedback bug|question|feature-request "<summary>"` — after the user's task is
done or blocked, never in a retry loop.
**Consent is mandatory: never submit without the user's go-ahead.** Preview the exact
payload with the global `--dry-run`, summarize every field to the user (summary, body,
command line, tool id, error code, request ids, `cli_version`, `platform`), and send
only after they approve. Include the failing command and `request_id`.
Full flow: `finterm shortcut report-feedback`.

## Secondary Surfaces

- Use `finterm docs` for full CLI documentation
- Use `finterm shortcut --list` and `finterm resources --list` for bundled agent aids
- Use `finterm tool <id> --help` before adding flags
