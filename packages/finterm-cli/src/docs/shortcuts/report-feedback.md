---
title: Report Feedback
description: Report a bug, question, or feature request to the Finterm team — with the mandatory operator-consent flow
category: support
tags:
  - feedback
  - bug
  - support
---
# Report Feedback

Send a bug report, question, or feature request to the Finterm team with
`finterm feedback`. It posts to the authenticated feedback endpoint (works without a
Pro subscription), so friction you hit reaches the people who can fix it.

## When to Report

Report after you have finished (or are genuinely blocked on) the user's actual task —
never from inside a retry loop:

- an unexpected error (5xx faults, `RUNTIME_*` codes, crashes);
- data that looks wrong (stale prices, impossible values, missing periods);
- misleading `--help` text or docs that sent you down the wrong path;
- a capability the user needed that Finterm does not offer (use `feature-request`).

One report per distinct issue. Do not report paywall (402) or auth (401) outcomes —
those are working as designed; relay them to your operator instead.

## Consent Is Mandatory

**Never submit feedback autonomously.** Before sending, you MUST confirm with the user
and summarize exactly what will be shared, field by field:

1. Build the command, then preview the exact payload without sending:

   ```bash
   finterm --dry-run feedback bug "sec_filing_fetch 500s for BRK.B FY2024" \
     --command "finterm tool sec_filing_fetch BRK.B --year 2024 --period FY" \
     --tool sec_filing_fetch --error-code UPSTREAM_HTTP_502 \
     --request-id req_abc123 --body "Expected filing sections; got HTTP 502 twice."
   ```

2. Show the user what will be shared and ask for approval. Cover every field: the
   summary, the body, and each context field — the command line, the tool id, the
   error code, the request ids, plus the two auto-filled fields (`cli_version` and
   `platform`). Nothing else is sent.

3. Only after the user approves, re-run the same command without `--dry-run`.

## Writing a Useful Report

- Put the one-line symptom in the summary (at most 200 characters).
- Put expected vs. actual and reproduction steps in `--body` (or `--body-file`).
- Always attach the failing command (`--command`) and the `request_id` from the error
  envelope (`--request-id`) — both are in your transcript, and they let the team
  correlate your report with server logs.
- `--last` fills those context fields automatically from the most recent recorded API
  call (preferring the last failed one); explicit flags always win, and the payload is
  still previewed and confirmed before sending.
- Never include secrets; the CLI rejects obvious token shapes in the body, but the
  payload preview is your real review step.

## Subcommands

```bash
finterm feedback bug "<summary>"              # something is broken or wrong
finterm feedback question "<summary>"         # ask the team a question
finterm feedback feature-request "<summary>"  # request a missing capability
```

A successful submission prints a feedback id (`fb_...`); include it if the user later
asks about the report.
