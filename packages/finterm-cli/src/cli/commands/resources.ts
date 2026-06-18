/**
 * `finterm resources` - Find and output reference resources.
 *
 * Resources are reference documents providing factual information
 * that agents can look up (market hours, symbol lists, etc.).
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
 * Get search paths for resources (dist first, then dev fallbacks).
 */
function getResourcePaths(): { paths: string[]; baseDir: string } {
  const distDir = getDistDir();

  return {
    paths: [join('docs', 'resources')],
    baseDir: distDir,
  };
}

/**
 * Get development fallback paths for resources.
 */
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

class ResourcesHandler extends DocCommandHandler {
  constructor(command: Command) {
    const prodConfig = getResourcePaths();
    const devConfigs = getDevResourcePaths();

    const allPaths: string[] = [];

    // Add production path
    allPaths.push(...prodConfig.paths.map((p) => join(prodConfig.baseDir, p)));

    // Add dev fallback paths
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
