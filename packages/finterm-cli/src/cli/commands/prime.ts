/**
 * `finterm prime` - Show quick context for AI agents.
 *
 * Called automatically by Claude Code hooks on session start
 * and before context compaction.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { BaseCommand } from '../lib/base-command.js';
import { isExpectedFsError } from '../lib/errors.js';
import { getColorOptionFromArgv } from '../lib/output.js';
import { renderMarkdown } from '../lib/markdown.js';

/**
 * Get the dist directory path based on the binary location.
 * Works for both bundled binary (dist/bin.mjs) and development (tsx).
 */
function getDistDir(): string {
  // process.argv[1] is the script being executed
  // For bundled: /path/to/dist/bin.mjs or /path/to/dist/bin-bootstrap.cjs
  // For dev: /path/to/node_modules/.pnpm/tsx@.../bin.ts
  const scriptPath = process.argv[1] || '';
  const scriptDir = dirname(scriptPath);

  // If running from dist/, use that directory
  if (scriptDir.endsWith('/dist') || scriptDir.endsWith('\\dist')) {
    return scriptDir;
  }

  // If running via tsx or other, try to find dist relative to cwd
  return join(process.cwd(), 'packages', 'finterm-cli', 'dist');
}

/**
 * Load prime (quick context) content from bundled file.
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
 * Load skill file content.
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

export const primeCommand = new Command('prime')
  .description('Show quick context for AI agents')
  .action(async (_options, command) => {
    const handler = new PrimeHandler(command);
    await handler.run();
  });
