---
softschema:
  contract: finterm.api:PublicToolDefinition/v1
  envelope: definition
  status: enforced
definition:
  tool_id: financial_statements
  title: Financial Statements
  summary: Reported balance sheet, income statement, or cash flow for a company.
  publication_state: published
  schema: finterm.result:FinancialStatements/v1
  fields:
    - name: ticker
      type: string
      description: The stock ticker symbol, uppercased (e.g. "AAPL").
    - name: statement_type
      type: '"balance_sheet" | "income_statement" | "cash_flow"'
      description: 'Which statement was requested: "balance_sheet",
        "income_statement", or "cash_flow".'
    - name: periods
      type: "(object{fiscal_year: number; fiscal_quarter: number | null; period_end:
        string; filing_date: string; timeframe: string; total_assets: number |
        null; total_current_assets: number | null; cash_and_equivalents: number
        | null; short_term_investments: number | null; accounts_receivable:
        number | null; inventory: number | null; total_non_current_assets:
        number | null; property_plant_equipment: number | null; goodwill: number
        | null; intangible_assets: number | null; total_liabilities: number |
        null; total_current_liabilities: number | null; accounts_payable: number
        | null; short_term_debt: number | null; total_non_current_liabilities:
        number | null; long_term_debt: number | null; total_equity: number |
        null; retained_earnings: number | null; common_stock: number | null} |
        object{fiscal_year: number; fiscal_quarter: number | null; period_end:
        string; filing_date: string; timeframe: string; total_revenue: number |
        null; cost_of_revenue: number | null; gross_profit: number | null;
        operating_expenses: number | null; operating_income: number | null;
        research_and_development: number | null; selling_general_admin: number |
        null; interest_expense: number | null; interest_income: number | null;
        other_income: number | null; income_before_tax: number | null;
        income_tax: number | null; net_income: number | null;
        earnings_per_share: number | null; earnings_per_share_diluted: number |
        null; shares_outstanding: number | null; shares_outstanding_diluted:
        number | null} | object{fiscal_year: number; fiscal_quarter: number |
        null; period_end: string; filing_date: string; timeframe: string;
        net_cash_from_operating: number | null; depreciation_amortization:
        number | null; stock_based_compensation: number | null;
        change_in_working_capital: number | null; net_cash_from_investing:
        number | null; capital_expenditures: number | null; acquisitions: number
        | null; investment_purchases: number | null; investment_sales: number |
        null; net_cash_from_financing: number | null; dividends_paid: number |
        null; share_repurchases: number | null; debt_issuance: number | null;
        debt_repayment: number | null; net_change_in_cash: number | null;
        free_cash_flow: number | null})[]"
      description: One record per reporting period, newest first. Each record carries
        the period identity (fiscal_year, fiscal_quarter, period_end,
        filing_date, timeframe) plus the line items for the requested statement
        type. Amounts are in USD; a missing line item is null.
  examples:
    - comment: The last four quarterly income statements.
      command: finterm tool financial_statements AAPL --statement-type
        income_statement --as-of-date 2024-12-01 --timeframe quarterly
---
# Financial Statements

Get a company’s reported financial statements (balance sheet, income statement, or cash
flow), one statement type per call, as a series of reporting periods.
Use it to analyze financial health, profitability, and cash generation.
Each period carries its fiscal year and quarter, the period end and filing dates, and
the statement’s line items.
