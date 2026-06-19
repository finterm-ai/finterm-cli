---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: sec_filings_search
  title: SEC Filings Search
  summary: Search SEC EDGAR filings for a company by ticker and form type.
  publication_state: published
  schema: finterm.result:SecFilingsSearch/v1
  fields:
    - name: total_results
      type: number
      description: Total number of matching filings (may exceed the number returned).
    - name: filings
      type: "(object{accession_number: string; form_type: string; filed_at: string;
        company_name: string; filing_url: string; period_of_report: string |
        null; fiscal_year: number | null; fiscal_period: string | null})[]"
      description: The matching filings, most recent first. Each carries the accession
        number, form type, filing date, company name, document URL, and the
        fiscal year/period and period-end date when available.
  examples:
    - comment: Find recent annual reports for a company.
      command: finterm tool sec_filings_search AAPL --form-type 10-K --as-of-date
        2024-12-31
---
# SEC Filings Search

Find a company’s SEC filings by ticker symbol.
Covers annual reports (10-K, 20-F) and interim reports (10-Q, 6-K). Each result carries
the accession number, form type, filing date, company name, document URL, and the fiscal
year, fiscal period, and period-end date when available.
Use the returned fiscal year and period with sec_filing_fetch to pull narrative
sections.
