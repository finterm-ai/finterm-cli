/**
 * `finterm init` - Initialize finterm in the current directory.
 *
 * Creates .finterm/config.yml with minimal configuration.
 * Does NOT configure integrations - use `finterm setup` for that.
 */

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as yaml from 'yaml';

import { BaseCommand } from '../lib/base-command.js';
import { isExpectedFsError } from '../lib/errors.js';
import { pathExists, writeFile } from '../lib/fs.js';
import { VERSION } from '../lib/version.js';

/**
 * Config file structure for .finterm/config.yml
 */
interface FintermConfig {
  version: string;
  initialized_at: string;
  initialized_by: string;
}

/**
 * Read and parse the finterm config file.
 */
export async function readFintermConfig(cwd: string): Promise<FintermConfig | null> {
  const configPath = join(cwd, '.finterm', 'config.yml');
  try {
    const content = await readFile(configPath, 'utf-8');
    return yaml.parse(content) as FintermConfig;
  } catch (error) {
    // Expected: file not found when finterm not initialized
    if (!isExpectedFsError(error)) {
      throw error;
    }
    return null;
  }
}

/**
 * Check if finterm is initialized in the given directory.
 */
export async function isInitialized(cwd: string): Promise<boolean> {
  const configPath = join(cwd, '.finterm', 'config.yml');
  return pathExists(configPath);
}

/**
 * Get the finterm directory path.
 */
export function getFintermDir(cwd: string): string {
  return join(cwd, '.finterm');
}

/**
 * Get the config file path.
 */
export function getConfigPath(cwd: string): string {
  return join(cwd, '.finterm', 'config.yml');
}

/**
 * Writes the minimal `.finterm/config.yml` for a project. Re-running is safe: an existing
 * config is reported as a no-op rather than overwritten.
 */
class InitHandler extends BaseCommand {
  async run(): Promise<void> {
    const cwd = process.cwd();
    const configPath = getConfigPath(cwd);
    const fintermDir = getFintermDir(cwd);

    const existingConfig = await readFintermConfig(cwd);
    if (existingConfig) {
      const initDate = existingConfig.initialized_at
        ? new Date(existingConfig.initialized_at).toLocaleDateString()
        : 'unknown date';

      this.output.data(
        {
          initialized: true,
          version: existingConfig.version,
          initialized_at: existingConfig.initialized_at,
          message: 'Already initialized',
        },
        () => {
          console.log(`Already initialized (v${existingConfig.version}, ${initDate}).`);
          console.log('Nothing to do.');
        }
      );
      return;
    }

    if (
      this.checkDryRun('Would initialize finterm in this directory', {
        configPath,
        fintermDir,
      })
    ) {
      return;
    }

    const config: FintermConfig = {
      version: VERSION,
      initialized_at: new Date().toISOString(),
      initialized_by: 'finterm init',
    };

    const configContent = `# Finterm CLI configuration
# Created by finterm init

${yaml.stringify(config)}
# Future: Additional configuration options can be added here
# features:
#   auto_prime: true
`;

    const gitignoreContent = `# Local-only files (not committed)
*.local
*.local.yml
`;

    await writeFile(configPath, configContent);
    await writeFile(join(fintermDir, '.gitignore'), gitignoreContent);

    this.output.data(
      {
        initialized: true,
        version: VERSION,
        configPath,
        fintermDir,
      },
      () => {
        const colors = this.output.getColors();

        console.log('');
        console.log('Initialized finterm in this directory.');
        console.log(`  ${colors.success('\u2713')} Created .finterm/config.yml`);
        console.log('');
        console.log('Next steps:');
        console.log('  git add .finterm/ && git commit -m "Initialize finterm"');
        console.log('  finterm setup auto   # Configure integrations');
      }
    );
  }
}

/** Top-level `init` command that scaffolds project-local finterm configuration. */
export const initCommand = new Command('init')
  .description('Initialize finterm in the current directory')
  .action(async (_options, command) => {
    const handler = new InitHandler(command);
    await handler.run();
  });
