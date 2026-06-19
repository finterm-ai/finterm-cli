/**
 * `finterm shortcut` - Find and output agent shortcuts.
 *
 * Shortcuts are reusable instruction templates for common workflows.
 */

import { Command } from 'commander';
import { dirname, join } from 'node:path';

import { DocCommandHandler, type DocCommandOptions } from '../lib/doc-command-handler.js';

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

/** Primary (installed) shortcut search location, rooted at the bundled `dist` dir. */
function getShortcutPaths(): { paths: string[]; baseDir: string } {
  const distDir = getDistDir();

  return {
    paths: [join('docs', 'shortcuts')],
    baseDir: distDir,
  };
}

/** Source-tree fallback locations used when running before/without a build. */
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

/**
 * Serves shortcuts: reusable instruction templates for common agent workflows. Earlier
 * search paths shadow later ones, so the installed copy wins over source-tree fallbacks;
 * missing directories are skipped during lookup.
 */
class ShortcutHandler extends DocCommandHandler {
  constructor(command: Command) {
    const prodConfig = getShortcutPaths();
    const devConfigs = getDevShortcutPaths();

    const allPaths: string[] = [];
    allPaths.push(...prodConfig.paths.map((p) => join(prodConfig.baseDir, p)));
    for (const devConfig of devConfigs) {
      allPaths.push(...devConfig.paths.map((p) => join(devConfig.baseDir, p)));
    }

    super(command, {
      typeName: 'shortcut',
      commandName: 'shortcut',
      typeNamePlural: 'shortcuts',
      paths: allPaths,
      baseDir: '/',
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
