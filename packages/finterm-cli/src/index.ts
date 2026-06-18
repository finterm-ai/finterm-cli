/**
 * finterm - Command-line interface for Finterm developer tools (finterm command)
 *
 * This is the library entry point. For CLI usage, see ./cli/cli.ts
 */

// Re-export CLI components for programmatic use
export { runCli } from './cli/cli.js';
export { VERSION } from './cli/lib/version.js';

// Re-export types
export type { CommandContext, OutputFormat, ColorOption } from './cli/lib/context.js';
export type { OutputManager } from './cli/lib/output.js';
export type { CLIError } from './cli/lib/errors.js';
