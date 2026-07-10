import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';

import { FINTERM_TOOL_DEFINITIONS } from '../../api/toolDefinitions.generated.js';
import { createToolCommand, parseAsOfDate, todayUtcIsoDate } from './tool.js';

describe('createToolCommand', () => {
  it('uses .api.md summaries for visible tool command descriptions', () => {
    const command = createToolCommand({ experimental: true });

    for (const subcommand of command.commands) {
      const definition = FINTERM_TOOL_DEFINITIONS[subcommand.name()];
      expect(
        definition,
        `${subcommand.name()} missing from generated tool definitions`
      ).toBeDefined();
      expect(subcommand.description()).toBe(definition?.summary);
    }
  });

  it('marks every mandatory option as (required) in its help text', () => {
    const command = createToolCommand({ experimental: true });

    for (const subcommand of command.commands) {
      for (const option of subcommand.options) {
        if (option.mandatory) {
          expect(
            option.description,
            `${subcommand.name()} ${option.flags} is mandatory but not marked (required)`
          ).toContain('(required)');
        }
      }
    }
  });
});

describe('parseAsOfDate', () => {
  it('accepts a real calendar date', () => {
    expect(parseAsOfDate('2026-07-07')).toBe('2026-07-07');
  });

  it('resolves the literal "today" to the current UTC date', () => {
    expect(parseAsOfDate('today')).toBe(todayUtcIsoDate());
    expect(parseAsOfDate('today')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects non-ISO formats before any network call', () => {
    for (const bad of ['07/07/2026', '2026-7-7', 'not-a-date', '20260707']) {
      expect(() => parseAsOfDate(bad), bad).toThrow(InvalidArgumentError);
    }
  });

  it('rejects impossible calendar dates', () => {
    for (const bad of ['2026-13-45', '2026-02-30', '2026-00-10']) {
      expect(() => parseAsOfDate(bad), bad).toThrow(InvalidArgumentError);
    }
  });
});
