---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: sec_filing_fetch
  title: SEC Filing Fetch
  summary: Fetch narrative sections from a company’s SEC filing by fiscal year and
    period.
  publication_state: published
  schema: finterm.result:SecFilingFetch/v1
  fields:
    - name: ticker
      type: string
      description: The stock ticker symbol, uppercased (e.g. "AAPL").
    - name: year
      type: number
      description: The fiscal year of the resolved filing.
    - name: period
      type: string
      description: 'The fiscal period: "FY" for annual, "Q1"-"Q4" for quarterly.'
    - name: form_type
      type: string
      description: The resolved SEC form type (e.g. "10-K", "10-Q", "20-F").
    - name: filed_at
      type: string
      description: The date the filing was filed, in ISO 8601 format.
    - name: period_of_report
      type: string | null
      description: The period-end date the filing reports for, in YYYY-MM-DD format,
        or null when not reported.
    - name: accession_number
      type: string
      description: The SEC accession number uniquely identifying the filing.
    - name: company_name
      type: string
      description: The filer company name as reported in the filing.
    - name: filing_url
      type: string
      description: A URL to the filing on SEC EDGAR.
    - name: sections
      type: record<string, string>
      description: The requested narrative sections, as a map of section name to its
        extracted text.
  examples:
    - comment: Fetch annual risk factors and MD&A for a company.
      command: finterm tool sec_filing_fetch AAPL --year 2024 --period FY --sections
        risk_factors,mda
---
# SEC Filing Fetch

Resolve a single SEC filing by ticker, fiscal year, and fiscal period, then return the
requested narrative sections (such as risk factors, MD&A, business, or legal
proceedings) as plain text.
Semantic section names map across annual and interim filer forms, so the same request
works for a 10-K or a 10-Q.
