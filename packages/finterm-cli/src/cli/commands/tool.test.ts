import { describe, expect, it } from 'vitest';

import { FINTERM_TOOL_DEFINITIONS } from '../../api/toolDefinitions.generated.js';
import { createToolCommand } from './tool.js';

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
});
