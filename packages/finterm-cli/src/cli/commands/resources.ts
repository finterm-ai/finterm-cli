/**
 * `finterm resources` - Find and output reference resources.
 *
 * Resources are reference documents providing factual information
 * that agents can look up (market hours, symbol lists, etc.).
 */

import { Command } from 'commander';
import { join } from 'node:path';

import { getDistDir } from '../lib/dist-dir.js';
import { DocCommandHandler, type DocCommandOptions } from '../lib/doc-command-handler.js';

/** Primary (installed) resource search location, rooted at the bundled `dist` dir. */
function getResourcePaths(): { paths: string[]; baseDir: string } {
  const distDir = getDistDir();

  return {
    paths: [join('docs', 'resources')],
    baseDir: distDir,
  };
}

/** Source-tree fallback locations used when running before/without a build. */
function getDevResourcePaths(): { paths: string[]; baseDir: string }[] {
  return [
    {
      paths: ['src/docs/resources'],
      baseDir: join(process.cwd(), 'packages', 'finterm-cli'),
    },
    {
      paths: ['src/docs/resources'],
      baseDir: process.cwd(),
    },
  ];
}

/**
 * Serves reference resources: factual lookup documents (market hours, symbol lists, and
 * the like) shipped with the CLI for agents to consult. Earlier search paths shadow later
 * ones, so the installed copy wins over source-tree fallbacks.
 */
class ResourcesHandler extends DocCommandHandler {
  constructor(command: Command) {
    const prodConfig = getResourcePaths();
    const devConfigs = getDevResourcePaths();

    const allPaths: string[] = [];
    allPaths.push(...prodConfig.paths.map((p) => join(prodConfig.baseDir, p)));
    for (const devConfig of devConfigs) {
      allPaths.push(...devConfig.paths.map((p) => join(devConfig.baseDir, p)));
    }

    super(command, {
      typeName: 'resource',
      commandName: 'resources',
      typeNamePlural: 'resources',
      paths: allPaths,
      baseDir: '/',
      agentHeader: '# Reference Resource\n\nUse this information:',
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

export const resourcesCommand = new Command('resources')
  .description('Find and output reference resources')
  .argument('[query]', 'Resource name or search query')
  .option('--list', 'List all available resources', false)
  .option('--all', 'Include shadowed resources (with --list)', false)
  .option('--category <cat>', 'Filter by category (with --list)')
  .action(async (query, options, command) => {
    const handler = new ResourcesHandler(command);
    await handler.run(query, options);
  });
