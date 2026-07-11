---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: sec_filing_diff
  title: SEC Filing Diff
  summary: Compare two of a company’s SEC filings and report section-level changes.
  publication_state: published
  schema: finterm.result:SecFilingDiff/v1
  fields:
    - name: ticker
      type: string
      description: The stock ticker symbol, uppercased (e.g. "AAPL").
    - name: base
      type: "object{year: number; period: string; form_type: string | null; filed_at:
        string | null; period_of_report: string | null}"
      description: "The baseline (earlier) filing reference: fiscal year and period,
        plus the resolved form type, filing date, and period-end date when
        available."
    - name: compare
      type: "object{year: number; period: string; form_type: string | null; filed_at:
        string | null; period_of_report: string | null}"
      description: "The comparison (later) filing reference: fiscal year and period,
        plus the resolved form type, filing date, and period-end date when
        available."
    - name: mode
      type: '"diff" | "raw" | "summary"'
      description: 'The output mode: "diff" (changed hunks), "summary" (manifest
        only), or "raw" (both section texts in the report).'
    - name: manifest
      type: '(object{section: string; status: "changed" | "unchanged" | "returned_raw"
        | "unavailable" | "error"; added: number | null; removed: number | null;
        churn_pct: number | null; note: string | null})[]'
      description: Per-section change summary. Each row gives the section name, its
        status, and, for changed sections, the added/removed line counts and the
        prose churn percentage.
    - name: report
      type: string | null
      description: The rendered comparison report in Markdown, or null when the report
        was delivered out of band.
  examples:
    - comment: Summarize changed risk factors between two annual filings.
      command: finterm tool sec_filing_diff AAPL --base 2023:FY --compare 2024:FY
        --sections risk_factors --mode summary
---
# SEC Filing Diff

Compare two SEC filings for the same company across fiscal periods and report what
changed, section by section.
Returns a compact per-section manifest (changed, unchanged, or unavailable, with line
counts and a prose churn percentage for changed sections) alongside a rendered Markdown
report. Summary mode returns the manifest only; diff mode adds the changed hunks.
