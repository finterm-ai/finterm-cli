/**
 * Base command class for CLI handlers.
 */

import type { Command } from 'commander';

import type { CommandContext, OutputFormat } from './context.js';
import { getCommandContext } from './context.js';
import { OutputManager } from './output.js';
import { CLIError } from './errors.js';
import type { APIResponse, ApiRequestObserver } from '../../lib/api-client.js';
import { formatApiRequestEvent, recordApiRequestEvent } from './activity-stats.js';

/**
 * Base class for all CLI command handlers.
 * Provides common functionality for context, output, and error handling.
 */
export abstract class BaseCommand {
  protected ctx: CommandContext;
  protected output: OutputManager;

  constructor(command: Command) {
    this.ctx = getCommandContext(command);
    this.output = new OutputManager(this.ctx);
  }

  /**
   * Execute an async action with error handling.
   * Preserves the original error as the cause for debugging.
   * The error message includes the original error context for better visibility.
   *
   * Note: Errors are NOT output here - let the top-level handler in cli.ts do it.
   * This prevents duplicate error output in JSON mode.
   */
  protected async execute<T>(action: () => Promise<T>, errorMessage: string): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof CLIError) {
        // Re-throw CLIError as-is, top-level handler will output it
        throw error;
      }
      const originalError = error instanceof Error ? error : undefined;
      // Include original error message in the main error for better visibility
      // e.g., "Failed to start login: connect ECONNREFUSED 127.0.0.1:443"
      const fullMessage =
        originalError?.message && originalError.message !== errorMessage
          ? `${errorMessage}: ${originalError.message}`
          : errorMessage;
      throw new CLIError(fullMessage, { cause: originalError });
    }
  }

  /**
   * Unwrap the older in-process API response shape to its domain payload.
   * Public API data commands render the canonical `{finterm,data|error}` wire
   * result directly; this helper remains for commands that still consume local
   * non-wire responses.
   */
  protected unwrapData<T>(response: APIResponse<T>, context: string): T {
    if (!response.success || response.data === undefined) {
      throw new CLIError(response.error?.message ?? context, { code: response.error?.code });
    }
    return response.data;
  }

  /**
   * Diagnostic request logger for API clients: logs `> GET /path` lines at
   * --verbose/--debug level via OutputManager.command().
   */
  protected requestLogger(): ApiRequestObserver {
    return (event) => {
      recordApiRequestEvent(event);
      if (event.phase === 'start') {
        this.output.command(event.method, [event.path]);
        return;
      }
      const line = formatApiRequestEvent(event);
      if (line) {
        this.output.stat(line);
      }
    };
  }

  /**
   * Check if dry-run mode is enabled and log the action.
   * Returns true if in dry-run mode (caller should skip the actual action).
   */
  protected checkDryRun(message: string, details?: object): boolean {
    if (this.ctx.dryRun) {
      this.output.dryRun(message, details);
      return true;
    }
    return false;
  }

  /**
   * Abstract method that subclasses must implement.
   */
  abstract run(...args: unknown[]): Promise<void>;
}

/**
 * Collapse the `--json` flag into the single text/json discriminator that
 * formatting code switches on, so callers never branch on `ctx.json` directly.
 */
export function getOutputFormat(ctx: CommandContext): OutputFormat {
  return ctx.json ? 'json' : 'text';
}
