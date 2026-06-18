/**
 * OutputManager for dual-mode output (text + JSON).
 */

import pc from 'picocolors';
import type { Command } from 'commander';

import type { CommandContext, ColorOption } from './context.js';
import { shouldColorize } from './context.js';

/**
 * Standard icons for CLI output.
 */
export const ICONS = {
  SUCCESS: '\u2713', // U+2713
  ERROR: '\u2717', // U+2717
  WARN: '\u26A0', // U+26A0
  NOTICE: '\u2022', // U+2022
} as const;

/**
 * Maximum width for help text.
 */
export const MAX_HELP_WIDTH = 88;

/**
 * Default terminal width when stdout is not a TTY.
 */
const DEFAULT_TERMINAL_WIDTH = 80;

/**
 * Get the terminal width, falling back to default if not available.
 */
export function getTerminalWidth(): number {
  return process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH;
}

/**
 * Pre-parse argv to determine color setting before Commander parses options.
 */
export function getColorOptionFromArgv(): ColorOption {
  const colorArg = process.argv.find((arg) => arg.startsWith('--color='));
  if (colorArg) {
    const value = colorArg.split('=')[1];
    if (value === 'always' || value === 'never' || value === 'auto') {
      return value;
    }
  }
  const colorIdx = process.argv.indexOf('--color');
  if (colorIdx !== -1 && process.argv[colorIdx + 1]) {
    const value = process.argv[colorIdx + 1];
    if (value === 'always' || value === 'never' || value === 'auto') {
      return value;
    }
  }
  return 'auto';
}

/**
 * Create colored help configuration for Commander.js.
 */
export function createColoredHelpConfig(colorOption: ColorOption = 'auto') {
  const colors = pc.createColors(shouldColorize(colorOption));

  return {
    helpWidth: Math.min(MAX_HELP_WIDTH, process.stdout.columns || 80),
    styleTitle: (str: string) => colors.bold(colors.cyan(str)),
    styleCommandText: (str: string) => colors.green(str),
    styleOptionText: (str: string) => colors.yellow(str),
    showGlobalOptions: true,
  };
}

/**
 * Create the help epilog text with color.
 */
export function createHelpEpilog(colorOption: ColorOption = 'auto'): string {
  const colors = createColors(colorOption);
  // Bright (not dim): the quick-start hint is the most important line in help.
  return colors.hint('Quick start: `finterm auth login` -> `finterm setup`');
}

/**
 * Configure Commander.js with colored help text.
 *
 * configureOutput is required as well as configureHelp: Commander strips ANSI
 * from help/error output whenever its own detection says no-color, regardless
 * of what the style functions emit — so `--color always | cat` would lose its
 * colors unless getOutHasColors/getErrHasColors agree with shouldColorize.
 */
export function configureColoredHelp(program: Command): Command {
  const colorOption = getColorOptionFromArgv();
  return program.configureHelp(createColoredHelpConfig(colorOption)).configureOutput({
    getOutHasColors: () => shouldColorize(colorOption),
    getErrHasColors: () => shouldColorize(colorOption),
  });
}

/**
 * Color utilities with conditional colorization.
 */
export function createColors(colorOption: ColorOption) {
  const enabled = shouldColorize(colorOption);
  const colors = pc.createColors(enabled);

  return {
    // Status colors
    success: colors.green,
    error: colors.red,
    warn: colors.yellow,
    info: colors.blue,

    // Text formatting
    bold: colors.bold,
    dim: colors.dim,
    italic: colors.italic,
    underline: colors.underline,

    // Semantic colors
    id: colors.cyan,
    label: colors.magenta,
    path: colors.blue,
    /** Section/list heading or a runnable command in a listing. */
    heading: colors.bold,
    /** Hyperlink. */
    url: colors.underline,
    /** Statistics/summary lines (timings, token counts, cost). */
    stat: colors.blue,
    /** Emphasized call-to-action hints (help epilog quick start). */
    hint: colors.yellow,
  };
}

/**
 * Spinner interface for progress indication.
 */
export interface Spinner {
  message(msg: string): void;
  stop(msg?: string): void;
}

/**
 * No-op spinner for non-TTY or quiet mode.
 */
const noopSpinner: Spinner = {
  message: () => {},
  stop: () => {},
};

/**
 * OutputManager handles all CLI output with format switching.
 */
export class OutputManager {
  private ctx: CommandContext;
  private colors: ReturnType<typeof createColors>;

  constructor(ctx: CommandContext) {
    this.ctx = ctx;
    this.colors = createColors(ctx.color);
  }

  /**
   * Output structured data - always goes to stdout.
   */
  data<T>(data: T, textFormatter?: (data: T) => void): void {
    if (this.ctx.json) {
      console.log(JSON.stringify(data, null, 2));
    } else if (textFormatter) {
      textFormatter(data);
    }
  }

  /**
   * Output success message - text mode only, stdout.
   */
  success(message: string): void {
    if (!this.ctx.json && !this.ctx.quiet) {
      console.log(this.colors.success(`${ICONS.SUCCESS} ${message}`));
    }
  }

  /**
   * Output notice message - noteworthy events during normal operation.
   */
  notice(message: string): void {
    if (!this.ctx.json && !this.ctx.quiet) {
      console.log(this.colors.info(`${ICONS.NOTICE} ${message}`));
    }
  }

  /**
   * Output info message - requires --verbose or --debug.
   */
  info(message: string): void {
    if (!this.ctx.json && (this.ctx.verbose || this.ctx.debug)) {
      console.error(this.colors.dim(message));
    }
  }

  /**
   * Output debug diagnostics - requires --debug. Always stderr.
   */
  debug(message: string): void {
    if (this.ctx.debug) {
      console.error(this.colors.dim(`[debug] ${message}`));
    }
  }

  /**
   * Log an executed sub-operation (external command, API request) - requires
   * --verbose or --debug. Always stderr, so it never pollutes piped data.
   */
  command(cmd: string, args: string[] = []): void {
    if (this.ctx.verbose || this.ctx.debug) {
      console.error(this.colors.dim(`> ${[cmd, ...args].join(' ')}`));
    }
  }

  /**
   * Emit brief diagnostic statistics. Always stderr, including JSON mode, so machine
   * readable stdout remains clean.
   */
  stat(message: string): void {
    if (!this.ctx.quiet && (this.ctx.verbose || this.ctx.debug)) {
      console.error(this.colors.dim(message));
    }
  }

  /**
   * Section heading for grouped stderr diagnostics (e.g. session summaries).
   */
  heading(title: string): void {
    if (!this.ctx.json) {
      console.error(
        this.colors.heading(
          this.colors.stat(`─── ${title} ${'─'.repeat(Math.max(0, 46 - title.length))}`)
        )
      );
    }
  }

  /**
   * Closing rule matching heading(), for grouped stderr diagnostics.
   */
  rule(): void {
    if (!this.ctx.json) {
      console.error(this.colors.stat('─'.repeat(51)));
    }
  }

  /**
   * Output warning - issues that didn't stop operation.
   */
  warn(message: string): void {
    if (this.ctx.json) {
      console.error(JSON.stringify({ warning: message }));
    } else if (!this.ctx.quiet) {
      console.error(this.colors.warn(`${ICONS.WARN} ${message}`));
    }
  }

  /**
   * Output error - failures that stop operation.
   */
  error(message: string, err?: Error): void {
    if (this.ctx.json) {
      console.error(JSON.stringify({ error: message, details: err?.message }));
    } else {
      console.error(this.colors.error(`${ICONS.ERROR} ${message}`));
      // Always show error details if they provide additional context
      if (err?.message && err.message !== message) {
        console.error(this.colors.dim(`  ${err.message}`));
      }
      if (this.ctx.verbose && err?.stack) {
        console.error(this.colors.dim(err.stack));
      }
    }
  }

  /**
   * Output dry-run indication.
   */
  dryRun(message: string, details?: object): void {
    if (this.ctx.json) {
      console.log(JSON.stringify({ dryRun: true, action: message, ...details }));
    } else {
      console.log(this.colors.warn(`[DRY-RUN] ${message}`));
      if (details && this.ctx.verbose) {
        console.log(this.colors.dim(JSON.stringify(details, null, 2)));
      }
    }
  }

  /**
   * Create a spinner for progress indication.
   */
  spinner(message: string): Spinner {
    if (this.ctx.json || this.ctx.quiet || !process.stderr.isTTY) {
      return noopSpinner;
    }

    let frame = 0;
    const frames = [
      '\u280B',
      '\u2819',
      '\u2839',
      '\u2838',
      '\u283C',
      '\u2834',
      '\u2826',
      '\u2827',
      '\u2807',
      '\u280F',
    ];
    let currentMessage = message;

    const spinnerColor = this.colors.info;
    const write = () => {
      process.stderr.write(`\r${spinnerColor(frames[frame] ?? '\u280B')} ${currentMessage}`);
      frame = (frame + 1) % frames.length;
    };

    write();
    const interval = setInterval(write, 80);

    return {
      message: (msg: string) => {
        currentMessage = msg;
      },
      stop: (msg?: string) => {
        clearInterval(interval);
        process.stderr.write('\r' + ' '.repeat(currentMessage.length + 3) + '\r');
        if (msg) {
          console.error(msg);
        }
      },
    };
  }

  /**
   * Get colors instance for direct use.
   */
  getColors() {
    return this.colors;
  }
}
