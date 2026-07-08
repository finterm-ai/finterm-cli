/**
 * `finterm prime` - Show quick context for AI agents.
 *
 * Called automatically by Claude Code hooks on session start
 * and before context compaction.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BaseCommand } from '../lib/base-command.js';
import { getDistDir } from '../lib/dist-dir.js';
import { isExpectedFsError } from '../lib/errors.js';
import { getColorOptionFromArgv } from '../lib/output.js';
import { renderMarkdown } from '../lib/markdown.js';

/**
 * Load the quick-context file, trying the built location first and source paths as a dev
 * fallback. Returns minimal inline guidance if none is found, so `prime` never fails.
 */
export function loadPrimeContent(): string {
  const distDir = getDistDir();
  const paths = [
    join(distDir, 'docs', 'finterm-prime.md'),
    // Development fallback paths
    join(process.cwd(), 'packages', 'finterm-cli', 'src', 'docs', 'finterm-prime.md'),
    join(process.cwd(), 'src', 'docs', 'finterm-prime.md'),
  ];

  for (const primePath of paths) {
    try {
      return readFileSync(primePath, 'utf-8');
    } catch (error) {
      // Only continue to next path for expected errors (file not found)
      if (!isExpectedFsError(error)) {
        throw error;
      }
    }
  }

  // Fallback inline content
  return `# Finterm CLI Quick Context

Run \`finterm --help\` for commands.
Run \`finterm docs\` for full documentation.
`;
}

/**
 * Load the bundled skill file, trying the built location first and source paths as a dev
 * fallback. Unlike the context loaders, a missing skill file is a hard error.
 */
export function loadSkillContent(): string {
  const distDir = getDistDir();
  const paths = [
    join(distDir, 'docs', 'SKILL.md'),
    // Development fallback paths
    join(process.cwd(), 'packages', 'finterm-cli', 'src', 'docs', 'SKILL.md'),
    join(process.cwd(), 'src', 'docs', 'SKILL.md'),
  ];

  for (const skillPath of paths) {
    try {
      return readFileSync(skillPath, 'utf-8');
    } catch (error) {
      // Only continue to next path for expected errors (file not found)
      if (!isExpectedFsError(error)) {
        throw error;
      }
    }
  }

  throw new Error('SKILL.md not found');
}

/**
 * Prints the quick-context file: rendered markdown to stdout for humans, or raw content
 * in JSON mode so agent hooks can capture it programmatically.
 */
class PrimeHandler extends BaseCommand {
  async run(): Promise<void> {
    const content = loadPrimeContent();
    const colorOption = getColorOptionFromArgv();
    const rendered = await renderMarkdown(content, colorOption);

    if (this.ctx.json) {
      this.output.data({ content });
    } else {
      console.log(rendered);
    }
  }
}

/** Top-level `prime` command that emits quick session context for AI agents. */
export const primeCommand = new Command('prime')
  .description('Show quick context for AI agents')
  .action(async (_options, command) => {
    const handler = new PrimeHandler(command);
    await handler.run();
  });
