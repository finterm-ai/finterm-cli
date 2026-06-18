/**
 * `finterm shortcut` - Find and output agent shortcuts.
 *
 * Shortcuts are reusable instruction templates for common workflows.
 * Follows the CLI-as-Agent-Skill pattern from tbd.
 */

import { Command } from 'commander';
import { dirname, join } from 'node:path';

import { DocCommandHandler, type DocCommandOptions } from '../lib/doc-command-handler.js';

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
 * Get search paths for shortcuts (dist first, then dev fallbacks).
 */
function getShortcutPaths(): { paths: string[]; baseDir: string } {
  const distDir = getDistDir();

  // Check if we're running from dist or dev
  // If dist/docs/shortcuts exists, use dist as base
  // Otherwise use dev paths

  return {
    paths: [
      // Production: dist/docs/shortcuts/
      join('docs', 'shortcuts'),
    ],
    baseDir: distDir,
  };
}

/**
 * Get development fallback paths for shortcuts.
 */
function getDevShortcutPaths(): { paths: string[]; baseDir: string }[] {
  return [
    {
      paths: ['src/docs/shortcuts'],
      baseDir: join(process.cwd(), 'packages', 'finterm-cli'),
    },
    {
      paths: ['src/docs/shortcuts'],
      baseDir: process.cwd(),
    },
  ];
}

class ShortcutHandler extends DocCommandHandler {
  constructor(command: Command) {
    // Try production paths first, then dev fallbacks
    const prodConfig = getShortcutPaths();
    const devConfigs = getDevShortcutPaths();

    // Combine all possible paths - DocCache will skip non-existent dirs
    const allPaths: string[] = [];

    // Add production path
    allPaths.push(...prodConfig.paths.map((p) => join(prodConfig.baseDir, p)));

    // Add dev fallback paths
    for (const devConfig of devConfigs) {
      allPaths.push(...devConfig.paths.map((p) => join(devConfig.baseDir, p)));
    }

    super(command, {
      typeName: 'shortcut',
      commandName: 'shortcut',
      typeNamePlural: 'shortcuts',
      paths: allPaths,
      baseDir: '/', // Paths are absolute
      agentHeader: '# Shortcut Instructions\n\nFollow these instructions:',
    });
  }

  async run(query: string | undefined, options: DocCommandOptions): Promise<void> {
    await this.initCache();

    if (options.list) {
      await this.handleList(options.all, options.category);
    } else if (query) {
      await this.handleQuery(query);
    } else {
      await this.handleNoQuery();
    }
  }
}

export const shortcutCommand = new Command('shortcut')
  .description('Find and output agent shortcuts')
  .argument('[query]', 'Shortcut name or search query')
  .option('--list', 'List all available shortcuts', false)
  .option('--all', 'Include shadowed shortcuts (with --list)', false)
  .option('--category <cat>', 'Filter by category (with --list)')
  .action(async (query, options, command) => {
    const handler = new ShortcutHandler(command);
    await handler.run(query, options);
  });
