/**
 * `finterm skill` - Output the full SKILL.md content (static reference).
 *
 * This command outputs the skill file content, which serves as a static
 * reference for AI agents. Unlike `finterm prime` which provides dynamic
 * context recovery, this outputs the complete documentation.
 *
 * Usage:
 * - `finterm skill` - Full SKILL.md content
 * - `finterm skill --brief` - Condensed workflow rules (skill-brief.md)
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { BaseCommand } from '../lib/base-command.js';
import { isExpectedFsError } from '../lib/errors.js';

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
 * Load the SKILL.md content from the bundled docs.
 */
function loadSkillContent(): string {
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

  return `# Finterm CLI

Run \`finterm --help\` for available commands.
Run \`finterm docs\` for full documentation.
`;
}

/**
 * Load the skill-brief.md content from the bundled docs.
 */
function loadSkillBriefContent(): string {
  const distDir = getDistDir();
  const paths = [
    join(distDir, 'docs', 'skill-brief.md'),
    // Development fallback paths
    join(process.cwd(), 'packages', 'finterm-cli', 'src', 'docs', 'skill-brief.md'),
    join(process.cwd(), 'src', 'docs', 'skill-brief.md'),
  ];

  for (const briefPath of paths) {
    try {
      return readFileSync(briefPath, 'utf-8');
    } catch (error) {
      // Only continue to next path for expected errors (file not found)
      if (!isExpectedFsError(error)) {
        throw error;
      }
    }
  }

  return `# Finterm Workflow Rules (Brief)

Run \`finterm skill\` for full documentation.
`;
}

interface SkillOptions {
  brief: boolean;
}

class SkillHandler extends BaseCommand {
  async run(options: SkillOptions): Promise<void> {
    const content = options.brief ? loadSkillBriefContent() : loadSkillContent();

    this.output.data(
      {
        type: options.brief ? 'brief' : 'full',
        content,
      },
      () => {
        // Output raw content for text mode (useful for piping)
        console.log(content.trim());
      }
    );
  }
}

export const skillCommand = new Command('skill')
  .description('Show agent workflow for auth, setup, and company research bundles')
  .option('--brief', 'Output condensed company research workflow rules', false)
  .action(async (options, command) => {
    const handler = new SkillHandler(command);
    await handler.run(options);
  });
