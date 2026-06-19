/**
 * finterm - Command-line interface for Finterm developer tools (finterm command)
 *
 * This is the library entry point. For CLI usage, see ./cli/cli.ts
 */

// Re-exported so the CLI can also be driven programmatically by library consumers.
export { runCli } from './cli/cli.js';
export { VERSION } from './cli/lib/version.js';

export type { CommandContext, OutputFormat, ColorOption } from './cli/lib/context.js';
export type { OutputManager } from './cli/lib/output.js';
export type { CLIError } from './cli/lib/errors.js';
