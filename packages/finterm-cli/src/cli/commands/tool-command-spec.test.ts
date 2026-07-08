import { describe, expect, it } from 'vitest';

import { createToolCommand } from './tool.js';
import { extractToolCommandSpecs, type ToolCommandSpec } from './tool-command-spec.js';

function specFor(id: string): ToolCommandSpec {
  const specs = extractToolCommandSpecs(createToolCommand({ experimental: true }));
  const spec = specs.find((item) => item.id === id);
  if (!spec) {
    throw new Error(`no command spec for ${id}`);
  }
  return spec;
}

describe('extractToolCommandSpecs', () => {
  it('captures positional arguments, including optional args', () => {
    expect(specFor('financial_statements').args).toEqual([
      { name: 'ticker', required: true, variadic: false, description: 'Stock ticker (e.g., AAPL)' },
    ]);
    expect(specFor('institutional_holdings').args[0]).toMatchObject({
      name: 'ticker',
      required: false,
    });
  });

  it('captures choices, defaults, and required flags', () => {
    const options = specFor('financial_statements').options;
    expect(options.find((option) => option.flags === '--statement-type <type>')).toEqual({
      flags: '--statement-type <type>',
      description: 'Statement type (required)',
      required: true,
      takesValue: true,
      negate: false,
      choices: ['balance_sheet', 'income_statement', 'cash_flow'],
    });
    expect(options.find((option) => option.flags === '--timeframe <timeframe>')).toMatchObject({
      default: 'annual',
      choices: ['quarterly', 'annual', 'trailing_twelve_months'],
    });
    expect(options.find((option) => option.flags === '--limit <number>')).toMatchObject({
      default: 4,
    });
    expect(options.find((option) => option.flags === '--format <format>')?.choices).toEqual([
      'json',
      'yaml',
    ]);
  });

  it('captures negating boolean flags', () => {
    const noQa = specFor('sec_filing_diff').options.find((option) => option.flags === '--no-qa');
    expect(noQa).toEqual({
      flags: '--no-qa',
      description: 'Skip the QA fidelity review',
      required: false,
      takesValue: false,
      negate: true,
    });
  });

  it('covers every visible tool subcommand', () => {
    const specs = extractToolCommandSpecs(createToolCommand({ experimental: true }));
    expect(specs.length).toBe(12);
    for (const spec of specs) {
      expect(spec.summary.length).toBeGreaterThan(0);
      expect(spec.args.length).toBeGreaterThan(0);
    }
  });
});
