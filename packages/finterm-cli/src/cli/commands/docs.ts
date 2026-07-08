/**
 * `finterm docs` - Show full documentation.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BaseCommand } from '../lib/base-command.js';
import { getDistDir } from '../lib/dist-dir.js';
import { isExpectedFsError } from '../lib/errors.js';
import { getColorOptionFromArgv } from '../lib/output.js';
import { renderMarkdown } from '../lib/markdown.js';
import { showInPager } from '../lib/pager.js';

/**
 * Load the bundled documentation, trying the built location first and source paths as a
 * dev fallback. Returns minimal inline help if no file is found, so `docs` never fails.
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

  return `# Finterm CLI

Run \`finterm --help\` for available commands.
Run \`finterm setup\` to install agent integration files.
`;
}

/**
 * Renders the bundled docs as markdown to a pager for humans, or as raw content in JSON
 * mode so the text can be consumed programmatically.
 */
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

/** Top-level `docs` command that displays the full bundled documentation. */
export const docsCommand = new Command('docs')
  .description('Show full documentation')
  .action(async (_options, command) => {
    const handler = new DocsHandler(command);
    await handler.run();
  });
