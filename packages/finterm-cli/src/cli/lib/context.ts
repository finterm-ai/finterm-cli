/**
 * Command context and global option handling.
 */

import type { Command } from 'commander';

/**
 * Output format options.
 */
export type OutputFormat = 'text' | 'json';

/**
 * Color mode options.
 */
export type ColorOption = 'auto' | 'always' | 'never';

/**
 * Context shared across all commands.
 * Extracted from global options.
 */
export interface CommandContext {
  dryRun: boolean;
  verbose: boolean;
  quiet: boolean;
  json: boolean;
  color: ColorOption;
  nonInteractive: boolean;
  debug: boolean;
  experimental: boolean;
}

/**
 * Extract command context from Commander options.
 */
export function getCommandContext(command: Command): CommandContext {
  const opts = command.optsWithGlobals();
  const isCI = Boolean(process.env.CI);

  return {
    dryRun: opts.dryRun ?? false,
    verbose: opts.verbose ?? false,
    quiet: opts.quiet ?? false,
    json: opts.json ?? false,
    color: (opts.color as ColorOption) ?? 'auto',
    nonInteractive: (opts.nonInteractive ?? !process.stdin.isTTY) || isCI,
    debug: opts.debug ?? false,
    experimental: opts.experimental ?? false,
  };
}

/**
 * Determine if colors should be enabled based on option and environment.
 *
 * Precedence: explicit `--color always|never` > NO_COLOR > FORCE_COLOR > TTY.
 */
export function shouldColorize(colorOption: ColorOption): boolean {
  if (colorOption === 'always') return true;
  if (colorOption === 'never') return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return process.stdout.isTTY ?? false;
}
