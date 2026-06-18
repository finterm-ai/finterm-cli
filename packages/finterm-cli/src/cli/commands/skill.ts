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
 * Resolve the bundled `dist` directory from the running binary's location, falling back
 * to the in-repo path so the command works both when installed and when run from source.
 */
function getDistDir(): string {
  const scriptPath = process.argv[1] || '';
  const scriptDir = dirname(scriptPath);

  if (scriptDir.endsWith('/dist') || scriptDir.endsWith('\\dist')) {
    return scriptDir;
  }

  return join(process.cwd(), 'packages', 'finterm-cli', 'dist');
}

/**
 * Load `SKILL.md`, trying the installed copy then source-tree fallbacks, and returning a
 * minimal placeholder rather than failing if none is found (so `finterm skill` always
 * produces usable output). Non-"file not found" errors still propagate.
 */
function loadSkillContent(): string {
  const distDir = getDistDir();
  const paths = [
    join(distDir, 'docs', 'SKILL.md'),
    join(process.cwd(), 'packages', 'finterm-cli', 'src', 'docs', 'SKILL.md'),
    join(process.cwd(), 'src', 'docs', 'SKILL.md'),
  ];

  for (const skillPath of paths) {
    try {
      return readFileSync(skillPath, 'utf-8');
    } catch (error) {
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
 * Load `skill-brief.md` (the condensed workflow rules) with the same install/source
 * fallback and placeholder behavior as {@link loadSkillContent}.
 */
function loadSkillBriefContent(): string {
  const distDir = getDistDir();
  const paths = [
    join(distDir, 'docs', 'skill-brief.md'),
    join(process.cwd(), 'packages', 'finterm-cli', 'src', 'docs', 'skill-brief.md'),
    join(process.cwd(), 'src', 'docs', 'skill-brief.md'),
  ];

  for (const briefPath of paths) {
    try {
      return readFileSync(briefPath, 'utf-8');
    } catch (error) {
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
        // Plain Markdown (no JSON envelope) so the output pipes cleanly into a file or pager.
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
