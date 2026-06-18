/**
 * `finterm docs` - Show full documentation.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { BaseCommand } from '../lib/base-command.js';
import { isExpectedFsError } from '../lib/errors.js';
import { getColorOptionFromArgv } from '../lib/output.js';
import { renderMarkdown } from '../lib/markdown.js';
import { showInPager } from '../lib/pager.js';

/**
 * Get the dist directory path based on the binary location.
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
 * Load documentation content from bundled file.
 */
export function loadDocsContent(): string {
  const distDir = getDistDir();
  const paths = [
    join(distDir, 'docs', 'finterm-docs.md'),
    // Development fallback paths
    join(process.cwd(), 'packages', 'finterm-cli', 'src', 'docs', 'finterm-docs.md'),
    join(process.cwd(), 'src', 'docs', 'finterm-docs.md'),
  ];

  for (const docPath of paths) {
    try {
      return readFileSync(docPath, 'utf-8');
    } catch (error) {
      // Only continue to next path for expected errors (file not found)
      if (!isExpectedFsError(error)) {
        throw error;
      }
    }
  }

  // Fallback inline content
  return `# Finterm CLI

Run \`finterm --help\` for available commands.
Run \`finterm setup claude\` to install Claude Code integration.
`;
}

class DocsHandler extends BaseCommand {
  async run(): Promise<void> {
    const content = loadDocsContent();
    const colorOption = getColorOptionFromArgv();
    const rendered = await renderMarkdown(content, colorOption);

    if (this.ctx.json) {
      this.output.data({ content });
    } else {
      await showInPager(rendered);
    }
  }
}

export const docsCommand = new Command('docs')
  .description('Show full documentation')
  .action(async (_options, command) => {
    const handler = new DocsHandler(command);
    await handler.run();
  });
